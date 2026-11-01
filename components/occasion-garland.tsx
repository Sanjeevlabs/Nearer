"use client";

import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, memberPhoto } from "@/lib/people";
import type { Card, Member, Wish } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Avatar, Icon, Photo } from "./ui/kit";

// The garland of wishes: on the day, every recorded wish plays one after
// another, full screen. Voice wishes play through an audio element (the
// wisher's photo and their words on screen); photo wishes are slides. A row
// of beads, like a mala, shows where you are. It ends with everyone who
// wished and a mic to add yours.

export interface GarlandBead {
  wish: Wish;
  member: Member;
  card: Card | null;
}

const SLIDE_MS = 5000;
const SILENT_MS = 6000;

function Beads({ count, at, done }: { count: number; at: number; done: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto flex max-w-[320px] items-center justify-center gap-2 py-2" aria-hidden="true">
      {/* the thread */}
      <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-white/25" />
      {Array.from({ length: count }, (_, i) => {
        const past = done || i < at;
        const now = !done && i === at;
        return (
          <m.span
            key={i}
            className={cn("relative block rounded-full", now ? "h-3.5 w-3.5" : "h-2.5 w-2.5", past ? "bg-white" : now ? "bg-[#ffd27a]" : "bg-white/10 ring-1 ring-white/40")}
            style={now ? { boxShadow: "0 0 12px 3px rgba(255,190,90,.55)" } : undefined}
            animate={now && !reduce ? { scale: [1, 1.18, 1] } : undefined}
            transition={now && !reduce ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : undefined}
          />
        );
      })}
      {/* the guru bead that closes the mala */}
      <span className={cn("relative block h-3 w-3 rotate-45 rounded-[3px]", done ? "bg-[#ffd27a]" : "bg-white/10 ring-1 ring-white/40")} style={done ? { boxShadow: "0 0 12px 3px rgba(255,190,90,.55)" } : undefined} />
    </div>
  );
}

export function GarlandPlayer({
  open,
  beads,
  celebrant,
  everyone,
  canAdd,
  onAdd,
  onClose,
}: {
  open: boolean;
  beads: GarlandBead[];
  /** Name as said on screen ("Maa", "the family"). */
  celebrant: string;
  /** Every expected member has wished. */
  everyone: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const done = at >= beads.length;
  const cur = done ? null : beads[at];
  const src = cur?.card ? resolveMediaUrl(cur.card.mediaRef) : null;
  const kind = cur?.card?.type ?? null;
  const next = useCallback(() => setAt((i) => Math.min(beads.length, i + 1)), [beads.length]);
  const prev = useCallback(() => setAt((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (open) {
      setAt(0);
      setPaused(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, next, prev]);

  // Photo slides and voice wishes without playable audio advance on a timer;
  // playable voice advances when it ends.
  const timed = !done && !(kind === "audio" && src) && !(kind === "video" && src);
  useEffect(() => {
    if (!open || !timed || paused) return;
    const t = window.setTimeout(next, kind === "photo" ? SLIDE_MS : SILENT_MS);
    return () => window.clearTimeout(t);
  }, [open, timed, paused, at, kind, next]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (paused) a.pause();
    else void a.play().catch(() => undefined);
  }, [paused, at, src]);

  const words = cur?.card ? cur.card.transcript || cur.card.caption : "";
  const name = cur ? callName(cur.member) : "";
  const wishers = Array.from(new Map(beads.map((b) => [b.member.id, b.member] as const)).values());

  // Portalled to <body>: a transformed ancestor would otherwise trap position:fixed.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <m.div
          role="dialog"
          aria-modal="true"
          aria-label={`Wishes for ${celebrant}`}
          className="fixed inset-0 z-[60] flex flex-col bg-[#15110d] text-white"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
          transition={{ duration: 0.25 }}
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-center gap-2 px-4 pt-3">
            <p className="m-0 min-w-0 flex-1 truncate text-footnote font-semibold uppercase tracking-[0.08em] text-white/60">Wishes for {celebrant}</p>
            {!done && (
              <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play" : "Pause"} className="press grid h-11 w-11 place-items-center rounded-full bg-white/10">
                <Icon name={paused ? "play" : "pause"} size={18} />
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="press grid h-11 w-11 place-items-center rounded-full bg-white/10">
              <Icon name="close" size={20} />
            </button>
          </div>

          <div className="relative min-h-0 flex-1">
            <AnimatePresence mode="wait">
              {cur ? (
                <m.div
                  key={cur.wish.id}
                  className="absolute inset-0 flex flex-col items-center justify-center px-6"
                  initial={reduce ? false : { opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  {kind === "photo" && src ? (
                    <div className="relative h-[58%] w-full max-w-[400px] overflow-hidden rounded-[28px] bg-black">
                      <Photo src={src} alt={`${name}'s wish`} sizes="400px" priority />
                    </div>
                  ) : kind === "video" && src ? (
                    <video src={src} className="h-[58%] w-full max-w-[400px] rounded-[28px] bg-black object-cover" autoPlay playsInline onEnded={next} onError={next} />
                  ) : (
                    <div className="relative">
                      {!reduce && <span className="absolute -inset-6 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,190,90,.28), transparent 70%)" }} aria-hidden="true" />}
                      <div className="relative overflow-hidden rounded-full ring-2 ring-white/30">
                        <Avatar src={memberPhoto(cur.member)} name={name} size={168} />
                      </div>
                    </div>
                  )}
                  <div className="mt-5 flex items-center gap-2.5">
                    {(kind === "photo" || kind === "video") && <Avatar src={memberPhoto(cur.member)} name={name} size={32} />}
                    <p className="m-0 text-title font-semibold">{name}</p>
                  </div>
                  {words && <p className="voice m-0 mt-2 line-clamp-4 max-w-[340px] text-center text-title leading-snug text-white/85">&ldquo;{words}&rdquo;</p>}
                  {kind === "audio" && src && <audio ref={audioRef} key={src} src={src} autoPlay onEnded={next} onError={next} />}
                </m.div>
              ) : (
                <m.div key="end" className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
                  <div className="flex -space-x-3">
                    {wishers.slice(0, 7).map((w) => (
                      <span key={w.id} className="rounded-full ring-2 ring-[#15110d]">
                        <Avatar src={memberPhoto(w)} name={callName(w)} size={44} />
                      </span>
                    ))}
                  </div>
                  <p data-display className="voice m-0 mt-5 text-display leading-tight">{everyone ? `Everyone wished ${celebrant}` : `${wishers.length} wished ${celebrant}`}</p>
                  {canAdd && (
                    <>
                      <button type="button" onClick={onAdd} aria-label={`Record your wish for ${celebrant}`} className="press mt-6 grid h-16 w-16 place-items-center rounded-full bg-white text-black">
                        <Icon name="mic" size={26} />
                      </button>
                      <p className="m-0 mt-2 text-callout text-white/70">Add yours</p>
                    </>
                  )}
                  <button type="button" onClick={() => setAt(0)} className="press mt-5 flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-4 text-callout font-semibold">
                    <Icon name="play" size={14} />
                    Play again
                  </button>
                </m.div>
              )}
            </AnimatePresence>
            {/* Tap left / right thirds to step through. */}
            {!done && (
              <>
                <button type="button" onClick={prev} aria-label="Previous wish" className="absolute inset-y-0 left-0 w-1/4" />
                <button type="button" onClick={next} aria-label="Next wish" className="absolute inset-y-0 right-0 w-1/4" />
              </>
            )}
          </div>

          <div className="px-4 pb-5">
            <Beads count={beads.length} at={at} done={done} />
            <p className="m-0 text-center text-caption text-white/50 tnum" aria-live="polite">
              {done ? `${beads.length} wish${beads.length === 1 ? "" : "es"}` : `${at + 1} of ${beads.length}`}
            </p>
          </div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
