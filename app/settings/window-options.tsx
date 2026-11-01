"use client";

import { useRef, useState } from "react";
import { Avatar, Icon } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { DEFAULT_IMAGE } from "@/lib/hero";
import { processHomeImage } from "@/lib/media-client";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, memberPhoto } from "@/lib/people";
import { can } from "@/lib/permissions";
import { useJson } from "@/lib/use-json";
import { QUIET_CHOICES, QUIET_HOURS } from "@/lib/status";
import { liveFetch, sameWindow, saveWindow, type WindowDraft } from "@/lib/settings-save";
import { SettingsSection } from "@/components/settings/section";
import { useDraft } from "@/components/settings/use-draft";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";

// Your first screen: the photo of home you see (the default one, or your own)
// and who is at your window (up to two). Nothing saves until you tap Save;
// the choices stay in this section until then. Through /api/window; the server
// validates every choice and checks can(member, "window.at").

interface W {
  people: { id: string }[];
  homePhoto?: string | null;
  quietAfterHours?: number;
}

/** Loads the saved first screen, then hands it to the form below. */
export function WindowOptions({ onMessage }: { onMessage?: (m: string) => void } = {}) {
  const { data, failed, reload } = useJson<W>("/api/window");
  if (failed)
    return (
      <div role="alert" className="mb-6 rounded-[22px] bg-surface px-4 py-4 text-[14px] text-ink-soft">
        Couldn&rsquo;t load your first screen.
        <button type="button" onClick={() => void reload()} className="press ml-2 h-11 rounded-full bg-white px-4 text-[14px] font-semibold text-ink">
          Retry
        </button>
      </div>
    );
  if (!data) return <div key="loading" className="skeleton mb-6 h-[360px] rounded-card" aria-busy="true" aria-label="Loading your first screen" />;
  const initial: WindowDraft = { photo: data.homePhoto ?? null, people: data.people.map((p) => p.id), quietAfterHours: data.quietAfterHours ?? QUIET_HOURS };
  return <WindowForm initial={initial} reload={reload} onMessage={onMessage} />;
}

function WindowForm({ initial, reload, onMessage }: { initial: WindowDraft; reload: () => Promise<void>; onMessage?: (m: string) => void }) {
  const { viewer, members } = useViewer();
  const form = useDraft<WindowDraft>(initial, { id: "window", eq: sameWindow });
  const [uploading, setUploading] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = form.status === "saving";
  const nowPhoto = form.draft.photo;
  const nowPeople = form.draft.people;
  const others = members.filter((mm) => mm.id !== viewer.id && mm.role !== "child" && can(mm, "window.at"));
  const url = resolveMediaUrl(nowPhoto);

  const pick = async (file: File) => {
    setPickError(null);
    if (file.size > 5 * 1024 * 1024) return setPickError("That photo is over 5 MB. Try a smaller one.");
    setUploading(true);
    try {
      const { mediaRef } = await processHomeImage(file);
      form.set({ photo: mediaRef });
    } catch {
      setPickError("Couldn't read that photo. Try another.");
    }
    setUploading(false);
  };

  const tile = (on: boolean) => cn("press relative block aspect-[4/3] w-full overflow-hidden rounded-[14px] bg-surface ring-1 ring-black/10", on && "outline outline-2 outline-offset-[3px] outline-ink");

  return (
    <SettingsSection
      id="window"
      title="Your first screen"
      tab="window"
      form={form}
      onSave={async (d, s) => {
        const r = await saveWindow(liveFetch, d, s);
        await reload();
        if (r.ok) onMessage?.("Saved");
        return r;
      }}
    >
      <p className="m-0 text-[13px] font-medium text-ink-soft">The photo you see first</p>
      <div className="mt-2 grid grid-cols-2 gap-3" role="radiogroup" aria-label="The photo you see first">
        <button type="button" role="radio" aria-checked={nowPhoto === null} disabled={busy} onClick={() => form.set({ photo: null })} className="text-left">
          <span className={tile(nowPhoto === null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={DEFAULT_IMAGE} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </span>
          <span className="mt-1.5 block text-[14px] font-semibold">Default photo</span>
        </button>
        <button type="button" role="radio" aria-checked={nowPhoto !== null} disabled={busy || uploading} onClick={() => input.current?.click()} className="text-left">
          <span className={cn(tile(nowPhoto !== null), "grid place-items-center")}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="Your photo of their home" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-ink-soft">
                <Icon name="camera" size={22} />
              </span>
            )}
          </span>
          <span className="mt-1.5 block text-[14px] font-semibold">{uploading ? "Adding…" : url ? "Your photo · change" : "Upload your own"}</span>
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Photo of their home"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />

      <p className="m-0 mt-5 text-[13px] font-medium text-ink-soft">Who&rsquo;s at your window · up to two</p>
      {others.length === 0 ? (
        <p className="m-0 mt-2 text-[14px] text-ink-soft">When grown-ups in another home join, you can put them here.</p>
      ) : (
        <ul className="m-0 mt-1 list-none p-0">
          {others.map((mm) => {
            const on = nowPeople.includes(mm.id);
            const full = !on && nowPeople.length >= 2;
            return (
              <li key={mm.id} className="flex min-h-[44px] items-center gap-3 border-t border-[var(--line)] py-2.5 first:border-0">
                <Avatar src={memberPhoto(mm)} name={callName(mm)} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px]">{callName(mm)}</span>
                  <span className="block text-[12px] text-ink-soft">{mm.city || placeFromTz(mm.tz)}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${callName(mm)} at your window`}
                  disabled={busy || full}
                  onClick={() => form.set({ people: on ? nowPeople.filter((id) => id !== mm.id) : [...nowPeople, mm.id] })}
                  className={cn("relative h-[44px] w-[52px] shrink-0 rounded-full disabled:opacity-35")}
                >
                  <span className={cn("absolute inset-x-0 top-[9px] h-[26px] rounded-full transition-colors", on ? "bg-ink" : "bg-black/15")} />
                  <span className={cn("absolute top-[12px] h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[28px]" : "left-[4px]")} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="m-0 mt-5 mb-2 text-[13px] font-medium text-ink-soft">Turn their dot amber when they&rsquo;ve been quiet for</p>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Amber after">
        {QUIET_CHOICES.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={form.draft.quietAfterHours === h}
            disabled={busy}
            onClick={() => form.set({ quietAfterHours: h })}
            className={cn("press h-11 flex-1 rounded-full text-[14px] font-semibold", form.draft.quietAfterHours === h ? "bg-ink text-white" : "bg-surface text-ink-soft")}
          >
            {h} h
          </button>
        ))}
      </div>
      <p className="m-0 mt-1.5 text-[12px] text-ink-faint">Only during their day. At night it shows &ldquo;asleep&rdquo;. Based on activity in Nearer.</p>
      {pickError && (
        <p className="m-0 mt-2 text-[13px] text-[#c2343a]" role="alert">
          {pickError}
        </p>
      )}
    </SettingsSection>
  );
}
