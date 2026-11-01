"use client";

import { m, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hourLabel } from "@/lib/occasion-calendar";
import { slug } from "@/lib/card-kit";
import { callName, memberPhoto } from "@/lib/people";
import { occasionCard } from "@/lib/share-cards";
import { canMakeLampSticker, canShareOccasion } from "@/lib/share-rules";
import type { Card, Member, RitualRun, Wish } from "@/lib/schemas";
import { GarlandPlayer, type GarlandBead } from "./occasion-garland";
import { PhotoWishButton } from "./occasion-wish";
import { ShareButton } from "./share-sheet";
import { StickerButton } from "./sticker-maker";
import { Avatar, Icon, Photo } from "./ui/kit";

// The day itself: the person (or the family, on a festival), a quiet
// sparkle, and everyone who has wished so far. The card opens the garland
// of wishes; on a festival it also asks every home to light its lamp at
// the same local hour.

type LampState = "idle" | "busy" | "lit" | "unavailable" | "failed";

function LampHour({ hour, sticker = false }: { hour: number; sticker?: boolean }) {
  const [state, setState] = useState<LampState>("idle");
  const [now, setNow] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date().getHours()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const light = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/lamp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "light" }) });
      setState(res.ok ? "lit" : res.status === 404 ? "unavailable" : "failed");
    } catch {
      setState("failed");
    }
  };
  const line =
    state === "lit"
      ? "Your lamp is lit. Every home can see it."
      : state === "unavailable"
        ? "Lamps aren\u2019t ready yet. Light a real one with every home."
        : state === "failed"
          ? "Couldn\u2019t light it. Try again."
          : now >= hour
            ? "It\u2019s lamp hour. Light yours with every home."
            : `Light your lamp at ${hourLabel(hour)} with every home`;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[16px] bg-black/25 px-3 py-2">
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#ffd27a]/20 text-[#ffd27a]" style={state === "lit" ? { boxShadow: "0 0 16px 4px rgba(255,190,90,.5)" } : undefined} aria-hidden="true">
        <Icon name="lamp" size={18} />
      </span>
      <p className="m-0 min-w-0 flex-1 text-footnote leading-snug text-white/90">{line}</p>
      {sticker && <StickerButton iconOnly label="Lamp sticker: Thinking of you" className="bg-white/20 text-white" spec={() => ({ kind: "lamp", title: "Lamp sticker" })} />}
      {state !== "lit" && state !== "unavailable" && (
        <button type="button" onClick={() => void light()} disabled={state === "busy"} aria-label="Light your lamp" className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-50">
          <Icon name="lamp" size={18} />
        </button>
      )}
    </div>
  );
}

const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: (i * 53 + 7) % 70,
  size: 3 + ((i * 7) % 4),
  delay: (i * 0.35) % 2.8,
}));

function Sparkle() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {SPARKS.map((s, i) => (
        <m.span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, boxShadow: "0 0 10px 2px rgba(255,255,255,.7)" }}
          initial={{ opacity: 0, y: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0], y: -40, scale: [0.4, 1, 0.6] }}
          transition={{ duration: 2.6, delay: s.delay, repeat: 3, repeatDelay: 0.8, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

export function OccasionCelebration({
  title,
  person,
  members,
  viewer,
  run,
  wishes,
  cards,
  lampHour = null,
  onWish,
  onWished,
}: {
  title: string;
  person: Member | null;
  members: Member[];
  viewer: Member;
  run: RitualRun | null;
  wishes: Wish[];
  cards: Card[];
  /** Festivals: the local hour every home lights its lamp. */
  lampHour?: number | null;
  onWish: () => void;
  /** After a photo wish lands. */
  onWished?: () => void;
}) {
  const reduce = useReducedMotion();
  const [garland, setGarland] = useState(false);
  const wished = Array.from(new Map(wishes.map((w) => [w.memberId, w] as const)).values());
  const wishers = wished.map((w) => ({ wish: w, member: members.find((x) => x.id === w.memberId) })).filter((x): x is { wish: Wish; member: Member } => Boolean(x.member));
  const beads: GarlandBead[] = wishers.map(({ wish, member }) => ({ wish, member, card: wish.cardId ? (cards.find((c) => c.id === wish.cardId) ?? null) : null }));
  // Grown-ups are asked to wish; children may, but "everyone" doesn't wait for them.
  const expected = members.filter((x) => x.id !== person?.id && x.role !== "child");
  const everyone = expected.length > 0 && expected.every((x) => wishers.some((w) => w.member.id === x.id));
  const name = person ? callName(person) : "the family";
  const mine = person?.id === viewer.id;
  const iWished = wishers.some((w) => w.member.id === viewer.id);
  const line = wishers.length === 0 ? (mine ? "Wishes will arrive here today." : `Be the first to wish ${name}.`) : everyone ? `Everyone wished ${mine ? "you" : name}` : `${wishers.length} wished ${mine ? "you" : name}`;

  return (
    <>
    <m.article
      aria-label={`Today: ${title}`}
      className={`relative ${lampHour !== null ? "h-[400px]" : "h-[340px]"} overflow-hidden rounded-hero bg-[#111] text-white`}
      style={{ boxShadow: "0 24px 50px -24px rgba(0,0,0,.6)" }}
      initial={reduce ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Photo src={memberPhoto(person) ?? "/demo/family-group.webp"} alt="" sizes="(max-width: 480px) 100vw, 440px" priority position="center 30%" />
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,0)_35%,rgba(0,0,0,.65))]" aria-hidden="true" />
      <Sparkle />
      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-caption font-semibold text-black">
        <Icon name="sparkle" size={14} />
        Today
      </div>
      {canShareOccasion(viewer) && wishers.length > 0 && (
        <div className="absolute right-3 top-3 z-10">
          <ShareButton
            iconOnly
            tone="glass"
            label="Share the wishes"
            target={() => {
              const cardTitle = `Wishes for ${person ? `${callName(person)}\u2019s birthday` : title}`;
              return {
                title: "Share the wishes",
                note: "An image with everyone who wished. No voices, no messages.",
                filename: `${slug(cardTitle)}.png`,
                text: cardTitle,
                render: () =>
                  occasionCard({
                    title: cardTitle,
                    photo: memberPhoto(person) ?? "/demo/family-group.webp",
                    wishers: wishers.map(({ member }) => ({ name: callName(member), photo: memberPhoto(member) })),
                    line: `${wishers.length} of us wished ${person ? callName(person) : "together"}`,
                    date: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date()),
                  }),
              };
            }}
          />
        </div>
      )}
      <div className="glass absolute inset-x-2.5 bottom-2.5 rounded-[22px] p-4">
        <p className="m-0 text-title font-bold leading-tight">{mine ? "Happy birthday to you" : title}</p>
        <div className="mt-2 flex items-center gap-2">
          {wishers.length > 0 && (
            <div className="flex -space-x-2">
              {wishers.slice(0, 6).map(({ wish, member }) => (
                <button key={wish.id} type="button" onClick={() => setGarland(true)} aria-label={`Play the wishes, starting with ${callName(member)}`} className="press rounded-full ring-2 ring-black/40">
                  <Avatar src={memberPhoto(member)} name={callName(member)} size={30} />
                </button>
              ))}
              {wishers.length > 6 && <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-white/20 text-caption font-semibold ring-2 ring-black/40">+{wishers.length - 6}</span>}
            </div>
          )}
          <p className="m-0 min-w-0 flex-1 text-callout text-white/85">{line}</p>
        </div>
        <div className="mt-3 flex gap-2">
          {!mine && !iWished && (
            <>
              <button type="button" onClick={onWish} className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-white text-body font-semibold text-black">
                <Icon name="mic" size={18} />
                {viewer.role === "elder" ? "Bless" : "Wish"} {person ? name : ""}
              </button>
              {run && <PhotoWishButton run={run} viewer={viewer} forName={name} onDone={onWished} className="h-11 w-11 bg-white/20 text-white" />}
            </>
          )}
          {beads.length > 0 && (
            <button type="button" onClick={() => setGarland(true)} aria-label="Play the Chorus: everyone’s wishes" className={`press flex h-11 items-center justify-center gap-2 rounded-full bg-white/20 px-4 text-body font-semibold text-white ${mine || iWished ? "flex-1" : ""}`}>
              <Icon name="play" size={16} />
              {mine || iWished ? "Play the Chorus" : null}
            </button>
          )}
        </div>
        {run && beads.some((b) => b.card) && (
          <Link href={`/reel/${encodeURIComponent(run.id)}`} className="press mt-2 flex h-10 items-center justify-center gap-1.5 rounded-full text-callout font-semibold text-white/90 no-underline">
            <Icon name="play" size={13} /> Play the reel
          </Link>
        )}
        {lampHour !== null && <LampHour hour={lampHour} sticker={canMakeLampSticker(viewer)} />}
      </div>
    </m.article>
    <GarlandPlayer
      open={garland}
      beads={beads}
      celebrant={mine ? "you" : name}
      everyone={everyone}
      canAdd={!mine && !iWished}
      onAdd={() => {
        setGarland(false);
        onWish();
      }}
      onClose={() => setGarland(false)}
    />
    </>
  );
}
