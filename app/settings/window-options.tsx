"use client";

import { useRef, useState } from "react";
import { Avatar, Icon } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";
import { DEFAULT_IMAGE } from "@/lib/hero";
import { processHomeImage } from "@/lib/media-client";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, memberPhoto } from "@/lib/people";
import { can } from "@/lib/permissions";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";

// Your first screen: the photo of home you see (the default one, or your own)
// and who is at your window (up to two). Nothing saves until you tap Save;
// the choices stay in this section until then. Through /api/window; the server
// validates every choice and checks can(member, "window.at").

interface W {
  people: { id: string }[];
  homePhoto?: string | null;
}

export function WindowOptions() {
  const { viewer, members } = useViewer();
  const { data, reload } = useJson<W>("/api/window");
  // undefined = not changed yet.
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [people, setPeople] = useState<string[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!data) return <div key="loading" className="skeleton mb-6 h-[360px] rounded-card" aria-busy="true" aria-label="Loading your first screen" />;

  const savedPhoto = data.homePhoto ?? null;
  const savedPeople = data.people.map((p) => p.id);
  const nowPhoto = photo === undefined ? savedPhoto : photo;
  const nowPeople = people ?? savedPeople;
  const dirty = nowPhoto !== savedPhoto || nowPeople.join() !== savedPeople.join();
  const others = members.filter((mm) => mm.id !== viewer.id && mm.role !== "child" && can(mm, "window.at"));
  const url = resolveMediaUrl(nowPhoto);

  const pick = async (file: File) => {
    setError(null);
    setSaved(false);
    if (file.size > 5 * 1024 * 1024) return setError("That photo is over 5 MB. Try a smaller one.");
    setUploading(true);
    try {
      const { mediaRef } = await processHomeImage(file);
      setPhoto(mediaRef);
    } catch {
      setError("Couldn't read that photo. Try another.");
    }
    setUploading(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    let ok = true;
    if (nowPhoto !== savedPhoto) ok = Boolean((await postJson<{ view?: unknown }>("/api/window", { action: "homePhoto", ref: nowPhoto }))?.view);
    if (ok && nowPeople.join() !== savedPeople.join()) ok = Boolean((await postJson<{ view?: unknown }>("/api/window", { action: "people", people: nowPeople }))?.view);
    if (ok) {
      await reload();
      setPhoto(undefined);
      setPeople(undefined);
      setSaved(true);
    } else setError("Couldn't save that. Try again.");
    setBusy(false);
  };

  const tile = (on: boolean) => cn("press relative block aspect-[4/3] w-full overflow-hidden rounded-[14px] bg-surface ring-1 ring-black/10", on && "outline outline-2 outline-offset-[3px] outline-ink");

  return (
    <div id="window-options" className="mb-6 scroll-mt-6">
      <p className="m-0 text-[13px] font-medium text-ink-soft">The photo you see first</p>
      <div className="mt-2 grid grid-cols-2 gap-3" role="radiogroup" aria-label="The photo you see first">
        <button type="button" role="radio" aria-checked={nowPhoto === null} disabled={busy} onClick={() => (setPhoto(null), setSaved(false))} className="text-left">
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
                  onClick={() => (setPeople(on ? nowPeople.filter((id) => id !== mm.id) : [...nowPeople, mm.id]), setSaved(false))}
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

      <div className="mt-4 flex items-center gap-3">
        <button type="button" disabled={!dirty || busy || uploading} onClick={() => void save()} className="press h-11 rounded-full bg-ink px-6 text-[15px] font-semibold text-white disabled:opacity-35">
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && !dirty && (
          <span className="text-[13px] text-ink-soft" role="status">
            Saved
          </span>
        )}
      </div>
      {error && (
        <p className="m-0 mt-2 text-[13px] text-[#c2343a]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
