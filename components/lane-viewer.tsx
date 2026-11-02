"use client";

import { m } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, cardCover } from "@/lib/people";
import type { Card } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { monthChip } from "@/lib/lane-groups";
import { cn } from "@/lib/utils";
import { CaptionEditor, CardActions } from "./memory-card";
import { usePlayer, VoiceControls } from "./player";
import { PrintFrame } from "./print-frame";
import { Icon, Photo } from "./ui/kit";
import { useViewer } from "./viewer";
import { museLabel } from "@/lib/muse-portrait";

// Full-screen viewer for ONE kind of memory (photos, videos or voices):
// swipe left/right (native scroll-snap), arrows on desktop, Esc to close.
// Photos show as prints (when, where and a note in the sharer's hand); voices
// get full controls (previous, back 10 s, play, forward 10 s, next, seek).
// Edit / delete stay one tap away in the top bar.

/** A print as large as the screen allows, below the top bar. */
const LANE_PRINT_W = "min(calc(100vw - 48px), 420px, calc((100dvh - 290px) * 0.8 + 24px))";

function Slide({ card, active, queue, onPrev, onNext }: { card: Card; active: boolean; queue: Card[]; onPrev: (() => void) | null; onNext: (() => void) | null }) {
  const { members, displayLang } = useViewer();
  const words = card.type === "audio" ? card.transcript || card.caption : card.caption;
  const { text } = useDisplayText(words, card.type === "audio" && card.transcript ? card.transcriptLang : card.lang, displayLang);
  const author = members.find((m) => m.id === card.authorId);
  const video = useRef<HTMLVideoElement>(null);
  const src = resolveMediaUrl(card.mediaRef);
  const cover = cardCover(card, members);
  useEffect(() => {
    if (!active) video.current?.pause();
  }, [active]);

  if (card.type === "photo") {
    return (
      <div className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden">
        <div className="pointer-events-none absolute inset-[-40px]" aria-hidden="true" style={{ filter: "blur(44px) saturate(1.15) brightness(.45)" }}>
          <Photo src={cover} alt="" sizes="200px" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-6" style={{ paddingTop: "calc(64px + env(safe-area-inset-top))", paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
          <PrintFrame card={card} author={author} src={cover} alt={text || "Family photo"} width={LANE_PRINT_W} signed share sizes="(max-width: 480px) 92vw, 440px" />
        </div>
        {museLabel(card.source) && (
          <span className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/90 px-3 py-1.5 text-caption font-semibold text-[#1c1b1a]" style={{ marginTop: "calc(64px + env(safe-area-inset-top))" }}>
            {museLabel(card.source)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden">
      {card.type === "video" && src ? (
        <video ref={video} src={src} poster={cover} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full bg-black object-contain" />
      ) : card.type === "audio" ? (
        <div className="absolute inset-0">
          <Photo src={cover} alt="" sizes="100vw" className="scale-110 opacity-40 blur-2xl" />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 pb-24">
            <div className="relative h-[200px] w-[200px] overflow-hidden rounded-[28px] shadow-2xl">
              <Photo src={cover} alt="" sizes="400px" position="center 30%" />
            </div>
            <p className="m-0 mt-4 text-body font-semibold">{callName(author)}&rsquo;s voice memory</p>
            <VoiceControls card={card} queue={queue} onPrev={onPrev} onNext={onNext} className="mt-3 w-full max-w-[360px]" />
          </div>
        </div>
      ) : (
        <Photo src={cover} alt={text || "Family video"} sizes="100vw" className="!object-contain" />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.72))] px-4 pt-16" style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }}>
        <p className="m-0 text-footnote text-white/70">
          {callName(author)} · {monthChip(card.takenAt)}
        </p>
        {text && <p className={cn("m-0 mt-1 line-clamp-3 text-headline leading-snug text-white", card.type === "audio" && "voice")}>{text}</p>}
      </div>
    </div>
  );
}

export function LaneViewer({ cards, start, title, onClose, starred, onStar }: { cards: Card[]; start: number; title: string; onClose: () => void; starred?: string[]; onStar?: (cardId: string) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(Math.min(start, Math.max(0, cards.length - 1)));
  const [editing, setEditing] = useState(false);
  const card = cards[Math.min(index, cards.length - 1)];
  const { play, collapse } = usePlayer();

  const go = useCallback(
    (to: number, smooth = true) => {
      const el = strip.current;
      if (!el) return;
      const next = Math.max(0, Math.min(cards.length - 1, to));
      el.scrollTo({ left: next * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
    },
    [cards.length],
  );

  // Previous / next from a voice's controls: move there, and keep listening if it's a voice.
  const step = (to: number) => {
    go(to);
    const target = cards[to];
    if (target?.type === "audio") {
      play(target, cards);
      collapse();
    }
  };

  // Open on the tapped item, lock the page behind.
  useEffect(() => {
    go(start, false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, onClose, editing]);

  // A delete shrinks the list: stay in range, close when nothing is left.
  useEffect(() => {
    if (cards.length === 0) onClose();
    else if (index > cards.length - 1) setIndex(cards.length - 1);
  }, [cards.length, index, onClose]);

  if (!card) return null;
  return (
    <m.div className="fixed inset-0 z-[60] bg-accent text-accent-ink" role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div
        ref={strip}
        className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== index) {
            setIndex(i);
            setEditing(false);
          }
        }}
      >
        {cards.map((c, i) => (
          <Slide
            key={c.id}
            card={c}
            active={i === index}
            queue={cards}
            onPrev={i > 0 ? () => step(i - 1) : null}
            onNext={i + 1 < cards.length ? () => step(i + 1) : null}
          />
        ))}
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3" style={{ paddingTop: "calc(10px + env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Close" className="press grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur-md">
          <Icon name="close" />
        </button>
        <p className="tnum m-0 flex-1 text-center text-callout font-medium text-white/80">
          {title} · {index + 1} of {cards.length}
        </p>
        {onStar && (
          <button
            type="button"
            onClick={() => onStar(card.id)}
            aria-pressed={starred?.includes(card.id) ?? false}
            aria-label={starred?.includes(card.id) ? "Starred, one of my favourites. Tap to unstar" : "Star it: keep it in my favourites"}
            className="press grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur-md"
          >
            <Icon name="star" size={20} solid={starred?.includes(card.id) ?? false} />
          </button>
        )}
        <div className="rounded-full bg-white/15 backdrop-blur-md">
          <CardActions card={card} tone="light" onEditing={setEditing} />
        </div>
      </div>

      {cards.length > 1 && (
        <>
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous" className="press absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 disabled:opacity-0 sm:grid">
            <Icon name="back" />
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={index === cards.length - 1} aria-label="Next" className="press absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 disabled:opacity-0 sm:grid">
            <Icon name="chevron" />
          </button>
        </>
      )}

      {editing && (
        <div className="absolute inset-x-0 bottom-0 px-3 text-ink" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
          <div className="mx-auto max-w-[480px] rounded-[24px] bg-white p-1">
            <CaptionEditor key={card.id} card={card} onDone={() => setEditing(false)} />
          </div>
        </div>
      )}
    </m.div>
  );
}
