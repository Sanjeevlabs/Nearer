"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { awakeNow } from "@/lib/glance";
import { grandparentsOf, guardiansOf } from "@/lib/kids";
import { callName, memberPhoto } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { postJson, useJson } from "@/lib/use-json";
import { usePlayer } from "./player";
import { useShell } from "./shell";
import { Avatar, Icon, type IconName } from "./ui/kit";
import { useViewer } from "./viewer";

// What a child sees first. Big, warm, three things to do: Show, Tell, Ask. The
// grandparents' faces with who is awake, tonight's story, and the child's own wall.
// A child never sees the grown-ups' courtyard or window (app/page.tsx).

const INK = "#2a211b";

function BigButton({ label, hint, icon, tone, onClick }: { label: string; hint: string; icon: IconName; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-kid={label.toLowerCase()} className="press flex min-h-[104px] w-full items-center gap-4 rounded-[30px] px-5 text-left" style={{ background: tone, color: INK }}>
      <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-white/70">
        <Icon name={icon} size={30} strokeWidth={1.9} />
      </span>
      <span className="min-w-0">
        <span className="block text-[28px] font-semibold leading-none">{label}</span>
        <span className="mt-1.5 block text-[16px] leading-tight opacity-75">{hint}</span>
      </span>
    </button>
  );
}

/** Tonight's story: the newest one recorded for this child, playable any time. "Another one?" asks for the next. */
function Tonight() {
  const { members, viewer } = useViewer();
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { play, current, isPlaying, toggle } = usePlayer();
  const tonight = useJson<{ tonight: { id: string; byMemberId: string; cardId: string | null; at: string } | null; open: boolean }>("/api/bedtime", { every: 120_000 });
  const [asked, setAsked] = useState(false);
  const t = tonight.data?.tonight ?? null;
  const by = members.find((m) => m.id === t?.byMemberId);
  const card = cards?.find((c) => c.id === t?.cardId);
  const playing = Boolean(card && current?.id === card.id && isPlaying);

  const another = async () => {
    setAsked(true);
    const ok = await postJson("/api/kid-ask", { action: "ask", topic: "story", text: "Another story, please", toMemberId: t?.byMemberId ?? null });
    if (!ok) setAsked(false);
  };

  return (
    <section data-ui="kid-tonight" aria-label="Tonight's story" className="mt-8">
      <h2 className="m-0 text-[22px]">{by ? `${callName(by)}’s story for tonight` : "Your story for tonight"}</h2>
      {tonight.data === null ? (
        <div className="skeleton mt-3 h-[96px] rounded-[26px]" />
      ) : !t ? (
        <p className="m-0 mt-2 text-[17px] leading-snug text-ink-soft">No story yet. Ask for one with the big Ask button!</p>
      ) : !card ? (
        <div className="skeleton mt-3 h-[96px] rounded-[26px]" />
      ) : (
        <div className="mt-3 rounded-[26px] bg-surface p-4" style={{ boxShadow: "var(--surface-edge)" }}>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => (current?.id === card.id ? toggle() : play(card))} aria-label={playing ? "Pause the story" : "Play the story"} className="press grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-black text-white">
              <Icon name={playing ? "pause" : "play"} size={30} />
            </button>
            <p className="voice m-0 min-w-0 text-[20px] leading-snug">{card.caption || "A story for you"}</p>
          </div>
          <button type="button" onClick={another} disabled={asked} className="press mt-4 h-12 w-full rounded-full bg-well text-[17px] font-semibold disabled:opacity-60">
            {asked ? `Asked. ${callName(by ?? viewer)} will hear it.` : "Another one?"}
          </button>
        </div>
      )}
    </section>
  );
}

export function KidHome() {
  const { viewer, members, relationships } = useViewer();
  const { openAdd } = useShell();
  const now = useMemo(() => new Date(), []);
  // Grandparents from the tree; until it loads (or if nobody is linked), the older generation of the family.
  const grand = useMemo(() => {
    const ids = grandparentsOf(viewer.id, relationships);
    const linked = members.filter((m) => ids.includes(m.id));
    return linked.length ? linked : members.filter((m) => m.role === "elder" && m.id !== viewer.id);
  }, [viewer.id, members, relationships]);
  const awake = useMemo(() => new Set(awakeNow(members, viewer.id, now).map((a) => a.id)), [members, viewer.id, now]);
  const askers = guardiansOf(viewer.id, relationships);
  const grandIds = grand.map((g) => g.id);

  return (
    <div data-ui="kid-home" className="pb-32 pt-5">
      <header className="flex items-center gap-3">
        <h1 className="m-0 min-w-0 flex-1 truncate text-[32px] font-light leading-tight">Hello, {callName(viewer)}</h1>
        <Link href="/settings" aria-label="You: settings" className="press rounded-full no-underline">
          <Avatar src={memberPhoto(viewer)} name={viewer.firstName} size={52} ring />
        </Link>
      </header>

      {grand.length > 0 && (
        <ul data-ui="kid-grandparents" aria-label="Your grandparents" className="m-0 mt-5 flex list-none gap-4 overflow-x-auto p-0 pb-1">
          {grand.slice(0, 4).map((g) => (
            <li key={g.id} className="flex w-[88px] shrink-0 flex-col items-center text-center">
              <span className="relative">
                <Avatar src={memberPhoto(g)} name={callName(g)} size={80} ring />
                <span className="absolute bottom-0 right-0 h-5 w-5 rounded-full ring-2 ring-white" style={{ background: awake.has(g.id) ? "#3f9d5a" : "#9a9086" }} aria-hidden="true" />
              </span>
              <span className="mt-1.5 block max-w-full truncate text-[17px] font-semibold">{callName(g)}</span>
              <span className="text-[14px] text-ink-soft">{awake.has(g.id) ? "Awake" : "Asleep"}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 space-y-3">
        <BigButton label="Show" hint="A photo or a drawing" icon="camera" tone="#f4d7b5" onClick={() => openAdd("photos")} />
        <BigButton label="Tell" hint="Say something with your voice" icon="mic" tone="#dfe3c8" onClick={() => openAdd("voice", null, grandIds.length ? grandIds : null)} />
        <BigButton label="Ask" hint="A question, or a story" icon="sparkle" tone="#d7e2e4" onClick={() => openAdd("voice", { kind: "kid_ask", toMemberId: askers.length === 1 ? askers[0] : undefined }, grandIds.length ? grandIds : askers)} />
      </div>

      <Tonight />
    </div>
  );
}
