"use client";

// The full-screen Now Playing sheet. Loaded the first time something plays
// (components/player.tsx), because it is the only user of framer-motion's
// full `motion` (drag) and of the waveform canvas and the reaction bar.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { resolveMediaUrl } from "@/lib/media-session";
import type { Card } from "@/lib/schemas";
import { estimateSegments } from "@/lib/voice";
import { callName, cardCover, formatDuration } from "@/lib/people";
import { useShell } from "./shell";
import { Icon, Photo } from "./ui/kit";
import { useDisplayText } from "@/lib/use-display-text";
import { ReactionBar } from "./reactions";
import { useViewer } from "./viewer";
import { VoiceControls, usePlayer } from "./player";
import { RemindMe } from "./remind-sheet";
import { WordsPanel, WordsToggle } from "./voice-card";
import { LISTEN_WORDS } from "@/lib/listen";

// The waveform IS the scrubber: played bars in warm amber, the rest dim.
// Pointer down/drag seeks. Live analyser waves when real audio plays.
function WaveScrubber({
  card,
  analyserRef,
}: {
  card: Card;
  analyserRef: React.MutableRefObject<{ ctx: AudioContext; analyser: AnalyserNode } | null>;
}) {
  const { currentTime, duration, seek, isPlaying } = usePlayer();
  const { displayLang } = useViewer();
  const url = resolveMediaUrl(card.mediaRef);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const dragRef = useRef(false);

  const peaks = useMemo(() => {
    const p = card.peaks.length >= 24 ? card.peaks : new Array(48).fill(0.4);
    return p.slice(0, 48);
  }, [card.peaks]);

  // Live waves from the AnalyserNode while real audio plays.
  useEffect(() => {
    const canvas = canvasRef.current;
    const entry = analyserRef.current;
    if (!canvas || !url || !isPlaying || !entry) {
      setLive(false);
      return;
    }
    setLive(true);
    const { ctx, analyser } = entry;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    let raf = 0;
    const draw = () => {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const g = canvas.getContext("2d");
      if (g) {
        const w = canvas.width;
        const h = canvas.height;
        g.clearRect(0, 0, w, h);
        const n = 48;
        const bw = w / n;
        for (let i = 0; i < n; i++) {
          const v = data[Math.floor((i / n) * data.length)] / 255;
          const bh = Math.max(3, v * h);
          const played = (i / n) * duration <= currentTime;
          g.fillStyle = played ? "#ffffff" : "rgba(255,255,255,0.36)";
          g.fillRect(i * bw + 1, (h - bh) / 2, Math.max(1, bw - 2), bh);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [url, isPlaying, analyserRef, duration, currentTime]);

  const ratioToTime = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * duration;
  };

  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;

  return (
    <div>
      <div
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(currentTime + 2);
          if (e.key === "ArrowLeft") seek(currentTime - 2);
        }}
        onPointerDown={(e) => {
          dragRef.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seek(ratioToTime(e.clientX, e.currentTarget));
        }}
        onPointerMove={(e) => {
          if (dragRef.current) seek(ratioToTime(e.clientX, e.currentTarget));
        }}
        onPointerUp={() => {
          dragRef.current = false;
        }}
        className="flex h-14 w-full cursor-pointer touch-none items-center"
      >
        {live ? (
          <canvas ref={canvasRef} width={480} height={56} className="h-14 w-full" aria-hidden="true" />
        ) : (
          <div className="flex h-14 w-full items-center gap-[2.5px]" aria-hidden="true">
            {peaks.map((p, i) => {
              const played = i / peaks.length <= progress;
              return (
                <span
                  key={i}
                  className="min-w-[2px] max-w-[4px] flex-1 rounded-full"
                  style={{
                    height: `${Math.max(6, Math.round(Number(p) * 50))}px`,
                    background: played ? "#ffffff" : "rgba(255,255,255,0.36)",
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-caption tabular-nums text-white/60" aria-hidden="true">
        <span>{formatDuration(currentTime)}</span>
        <span>-{formatDuration(Math.max(0, duration - currentTime))}</span>
      </div>
      <span className="sr-only">
        {displayLang === "en" ? "Audio progress" : "progress"}
      </span>
    </div>
  );
}

function SyncedLyrics({ card, duration, currentTime }: { card: Card; duration: number; currentTime: number }) {
  const { displayLang } = useViewer();
  const source = card.transcript || card.caption;
  const sourceLang = card.transcript ? card.transcriptLang : card.lang;
  const { text: translated, translated: wasTranslated } = useDisplayText(source, sourceLang, displayLang);

  const lines = useMemo(() => {
    if (!wasTranslated && card.segments.length > 0 && card.transcript) return card.segments;
    if (translated === null) return null;
    return estimateSegments(translated, duration);
  }, [wasTranslated, card.segments, card.transcript, translated, duration]);

  if (lines === null) {
    return (
      <div aria-busy="true" aria-label="Loading words">
        <div className="mb-3 h-7 w-4/5 rounded-lg bg-white/15" />
        <div className="h-5 w-1/2 rounded-lg bg-white/10" />
      </div>
    );
  }
  let active = 0;
  lines.forEach((l, i) => {
    if (currentTime >= l.start) active = i;
  });
  return (
    <ol className="m-0 list-none p-0" aria-live="polite">
      {lines.map((l, i) =>
        i < active - 1 ? null : (
          <li
            key={i}
            aria-current={i === active ? "true" : undefined}
            className={
              i === active
                ? "voice mb-3 text-display leading-[1.25] text-white transition-all"
                : "mb-3 text-headline leading-snug text-white/45 transition-all"
            }
          >
            {l.text}
          </li>
        ),
      )}
    </ol>
  );
}

// Full-screen Now Playing: the photo becomes the room. Blurred art fills the
// screen, the waveform is the scrubber, and the words arrive like lyrics.
export default function FullPlayer({
  analyserRef,
}: {
  analyserRef: React.MutableRefObject<{ ctx: AudioContext; analyser: AnalyserNode } | null>;
}) {
  const { current, open, currentTime, duration, toggle, collapse, playNext, playPrev } = usePlayer();
  const { displayLang, members, viewer } = useViewer();
  const { openAdd } = useShell();
  const { translated } = useDisplayText(current?.caption ?? "", current?.lang, displayLang);
  const [words, setWords] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, collapse, toggle]);

  const author = current ? members.find((m) => m.id === current.authorId) : undefined;
  const art = current ? cardCover(current, members) : "";

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Voice memory from ${callName(author)}`}
          className="fixed inset-0 z-50 overflow-hidden bg-[var(--player-ground)] text-white"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 34 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 140 || info.velocity.y > 600) collapse();
          }}
        >
          <div className="absolute inset-[-60px] scale-110" aria-hidden="true" style={{ filter: "blur(60px) saturate(1.4) brightness(.62)" }}>
            <Photo src={art} alt="" sizes="200px" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/45" aria-hidden="true" />
          <div
            className="relative mx-auto flex h-full w-full max-w-[480px] flex-col px-6"
            style={{ paddingTop: "calc(14px + env(safe-area-inset-top))", paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center justify-between">
              <button type="button" onClick={collapse} aria-label="Minimise player" className="press -ml-2 grid h-11 w-11 place-items-center rounded-full">
                <Icon name="down" size={26} />
              </button>
              <span className="mx-auto block h-1.5 w-10 rounded-full bg-white/35" aria-hidden="true" />
              <span className="w-11" aria-hidden="true" />
            </div>

            <div className="relative mx-auto mt-4 aspect-square w-full max-w-[340px] overflow-hidden rounded-[28px]" style={{ boxShadow: "0 30px 60px rgba(0,0,0,.45)" }}>
              <Photo src={art} alt={`${callName(author)}`} sizes="680px" priority position="center 30%" />
            </div>

            <div className="mt-6 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 truncate text-title font-bold leading-tight">{callName(author)}</p>
                <p className="m-0 mt-0.5 text-body text-white/65">{translated ? "Translated for you" : "Voice memory"}</p>
                {/* "How to listen": the server adds it only for the people this note was sent to. */}
                {current.listen && (
                  <p data-ui="listen-label" className="m-0 mt-0.5 text-footnote text-white/80">
                    {callName(author)}: {LISTEN_WORDS[current.listen]}
                  </p>
                )}
              </div>
              {current.authorId && current.authorId !== viewer.id && <RemindMe aboutId={current.authorId} href={`/lane?card=${encodeURIComponent(current.id)}`} what={(current.caption || "their voice memory").slice(0, 80)} tone="dark" className="shrink-0" />}
            </div>

            <div className="mt-4">
              <WaveScrubber card={current} analyserRef={analyserRef} />
              <VoiceControls card={current} bar={false} onPrev={playPrev} onNext={playNext} className="mt-1" />
            </div>

            <div className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto">
              {current.transcript.trim() && (
                <div className="mb-2">
                  <WordsToggle open={words} onToggle={() => setWords((v) => !v)} controls="player-words" dark />
                  {words && <WordsPanel card={current} id="player-words" dark />}
                </div>
              )}
              <SyncedLyrics card={current} duration={duration} currentTime={currentTime} />
            </div>

            <ReactionBar
              cardId={current.id}
              tone="glass"
              onReply={() => {
                collapse();
                openAdd("voice", { kind: "card_reply", cardId: current.id }, current.authorId);
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

