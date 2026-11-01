"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useMemo, useState } from "react";
import { fridgeKidId, isKid, kidCards, kidsOf, pinnedBy } from "@/lib/kids";
import type { KidAsk } from "@/lib/kinds";
import type { Card, Member } from "@/lib/schemas";
import { callName, cardCover, relativeDay } from "@/lib/people";
import { useFamilyCards } from "@/lib/use-family";
import { postJson, useJson } from "@/lib/use-json";
import { LaneViewer } from "./lane-viewer";
import { usePlayer } from "./player";
import { useShell } from "./shell";
import { Icon, Photo } from "./ui/kit";
import { useViewer } from "./viewer";

// The kids on the grown-ups' courtyard (lib/kids.ts): tonight's bedtime prompt, what the
// kids asked, and the fridge strip.
// Nothing here appears for a child, and nothing appears when the family has no children.

export const Label = ({ children }: { children: React.ReactNode }) => <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-soft">{children}</p>;
export const pill = "press h-11 rounded-full px-5 text-[14px] font-semibold";

/** "Tonight's story for Vihaan": one prompt a day; recording or "Not now" both end it. */
function BedtimePrompt() {
  const { members } = useViewer();
  const { openAdd } = useShell();
  const q = useJson<{ prompt: { childId: string } | null }>("/api/bedtime");
  const [busy, setBusy] = useState(false);
  const child = members.find((m) => m.id === q.data?.prompt?.childId);
  if (!child) return null;
  const notNow = async () => {
    setBusy(true);
    await postJson("/api/bedtime", { action: "not-now" });
    await q.reload();
    setBusy(false);
  };
  return (
    <section data-ui="courtyard-bedtime" aria-label={`Tonight's story for ${callName(child)}`} className="mt-5 rounded-[26px] bg-surface p-5">
      <Label>
        <Icon name="moon" size={13} className="mr-1 inline align-[-2px]" />
        Bedtime
      </Label>
      <p className="voice m-0 mt-2 text-[20px] leading-snug">Tonight&rsquo;s story for {callName(child)}</p>
      <p className="m-0 mt-1 text-[14.5px] leading-snug text-ink-soft">A few minutes in your voice. It waits on their screen for tonight.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => openAdd("voice", { kind: "bedtime", forMemberId: child.id }, [child.id])} className={`${pill} bg-black text-white disabled:opacity-40`}>
          Record a story
        </button>
        <button type="button" disabled={busy} onClick={() => void notNow()} className={`${pill} text-ink-soft disabled:opacity-40`}>
          Not now
        </button>
      </div>
    </section>
  );
}

/** What the kids asked you: play the question, answer by voice (the answer also lands in Stories). */
function AskedByKids() {
  const { members } = useViewer();
  const { openAdd, refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const { play, current, isPlaying, toggle } = usePlayer();
  const q = useJson<{ asks: KidAsk[] }>("/api/kid-ask");
  const asks = q.data?.asks ?? [];
  if (asks.length === 0) return null;
  return (
    <section data-ui="courtyard-kid-asks" aria-label="Asked by the kids" className="mt-5 rounded-[26px] bg-surface p-5">
      <Label>Asked by the kids</Label>
      <ul className="m-0 mt-2 list-none space-y-3 p-0">
        {asks.slice(0, 3).map((a) => {
          const kid = members.find((m) => m.id === a.fromMemberId);
          const card = cards?.find((c) => c.id === a.cardId);
          const playing = Boolean(card && current?.id === card.id && isPlaying);
          const words = a.text || card?.transcript || card?.caption || "";
          return (
            <li key={a.id}>
              <p className="m-0 text-[16px] font-semibold">{a.topic === "story" ? `${callName(kid)} would like a story` : `${callName(kid)} asked you something`}</p>
              {words && <p className="voice m-0 mt-0.5 line-clamp-2 text-[17px] leading-snug text-ink">&ldquo;{words}&rdquo;</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {card && (
                  <button type="button" onClick={() => (current?.id === card.id ? toggle() : play(card))} aria-label={playing ? "Pause" : `Play ${callName(kid)}'s question`} className="press flex h-11 items-center gap-2 rounded-full bg-well px-4 text-[14px] font-semibold">
                    <Icon name={playing ? "pause" : "play"} size={14} />
                    {playing ? "Pause" : "Play"}
                  </button>
                )}
                <button type="button" onClick={() => openAdd("voice", { kind: "kid_answer", askId: a.id, prompt: words || undefined }, [a.fromMemberId])} className={`${pill} bg-black text-white`}>
                  Answer by voice
                </button>
                <span className="text-[12.5px] text-ink-soft">{relativeDay(a.askedAt)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The fridge's polaroids held by a magnet: tap one to open it, and a "Reply by voice" pill per child.
 * `grid` wraps them all (the Kids page); otherwise one scrolling strip (the courtyard).
 */
export function FridgeBoard({ cards, replyTo, grid = false }: { cards: Card[]; replyTo: Member[]; grid?: boolean }) {
  const { members } = useViewer();
  const { openAdd } = useShell();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ul className={grid ? "m-0 mt-3 flex list-none flex-wrap gap-x-3 gap-y-4 p-0 pt-2" : "no-scrollbar -mx-1 m-0 mt-3 flex list-none gap-3 overflow-x-auto px-1 pb-2 pt-2"}>
        {cards.map((c, i) => {
          const author = members.find((m) => m.id === fridgeKidId(c));
          const pinner = pinnedBy(c);
          const pinnerName = pinner ? callName(members.find((m) => m.id === pinner)) : null;
          return (
            <li key={c.id} className="shrink-0" style={{ transform: `rotate(${i % 2 ? 2.2 : -2.2}deg)` }}>
              <button type="button" onClick={() => setOpen(i)} aria-label={`${callName(author)}'s ${c.type === "audio" ? "voice note" : c.type === "video" ? "video" : "picture"}, ${relativeDay(c.takenAt)}${pinnerName ? `, pinned by ${pinnerName}` : ""}`} className={`press relative block bg-white p-1.5 text-left ${pinnerName ? "pb-9" : "pb-6"}`} style={{ width: 104, boxShadow: "0 6px 14px -8px rgba(60,42,24,.5)" }}>
                <span className="absolute -top-1.5 left-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full" style={{ background: ["#d4553f", "#3f7fb5", "#e0a324"][i % 3], boxShadow: "0 2px 3px rgba(0,0,0,.35)" }} aria-hidden="true" />
                <span className="relative block h-[96px] w-full overflow-hidden bg-well">
                  <Photo src={cardCover(c, members)} alt="" sizes="120px" position="center 30%" />
                  {c.type !== "photo" && (
                    <span className="absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white">
                      <Icon name={c.type === "audio" ? "mic" : "play"} size={13} />
                    </span>
                  )}
                </span>
                <span className="absolute inset-x-1.5 bottom-1 block leading-tight">
                  <span className="block truncate text-[12px] font-medium text-ink">{callName(author)}</span>
                  {pinnerName && <span className="block truncate text-[10px] text-ink-soft">Pinned by {pinnerName}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex flex-wrap gap-2">
        {replyTo.map((kid) => (
          <button key={kid.id} type="button" onClick={() => openAdd("voice", null, [kid.id])} className={`${pill} flex items-center gap-2 bg-white text-ink`}>
            <Icon name="mic" size={15} />
            Reply to {callName(kid)} by voice
          </button>
        ))}
      </div>
      <AnimatePresence>{open !== null && <LaneViewer cards={cards} start={open} title="Fridge" onClose={() => setOpen(null)} />}</AnimatePresence>
    </>
  );
}

/** The fridge strip on the courtyard: the kids' latest photos, drawings and voices. */
function Fridge() {
  const { members } = useViewer();
  const { openAdd, refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey);
  const asks = useJson<{ askCardIds?: string[] }>("/api/kid-ask");
  const strip = useMemo(() => {
    const skip = new Set(asks.data?.askCardIds ?? []);
    return kidCards(cards ?? [], members).filter((c) => !skip.has(c.id)).slice(0, 6);
  }, [cards, members, asks.data]);
  if (strip.length === 0) return null;
  const latest = members.find((m) => m.id === fridgeKidId(strip[0]));
  const kids = members.filter((m) => isKid(m) && m.status !== "pending");
  return (
    <section data-ui="courtyard-fridge" aria-label="Fridge" className="mt-5 rounded-[26px] p-5" style={{ background: "var(--well)" }}>
      <div className="flex items-center justify-between gap-3">
        <Label>Fridge</Label>
        <div className="-mr-2 flex items-center">
          <button type="button" onClick={() => openAdd("photos", { kind: "fridge", ...(kids.length === 1 ? { forMemberId: kids[0].id } : {}) })} className="press flex h-10 items-center gap-1 px-2 text-[14px] font-semibold text-ink">
            <Icon name="plus" size={14} />
            Add to the fridge
          </button>
          <Link href="/bond/kids" className="press flex h-10 items-center px-2 text-[14px] font-semibold text-ink no-underline">
            All &rarr;
          </Link>
        </div>
      </div>
      <FridgeBoard cards={strip} replyTo={latest ? [latest] : []} />
    </section>
  );
}

export function KidsCourtyard() {
  const { viewer, members, relationships } = useViewer();
  const hasKids = useMemo(() => members.some((m) => isKid(m)), [members]);
  const mine = useMemo(() => kidsOf(viewer.id, members, relationships), [viewer.id, members, relationships]);
  if (isKid(viewer) || !hasKids) return null;
  return (
    <div data-ui="courtyard-kids">
      {mine.length > 0 && <BedtimePrompt />}
      <AskedByKids />
      <Fridge />
    </div>
  );
}
