"use client";

import { useRef, useState } from "react";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, cardCover, cardDuration, formatDuration, relativeDay, tintShadow } from "@/lib/people";
import type { Card } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { cn } from "@/lib/utils";
import { CardActions } from "./memory-card";
import { usePlayer } from "./player";
import { Icon, Photo } from "./ui/kit";
import { useViewer } from "./viewer";

// A voice or a video as an object you could keep on a shelf: one photo, the
// words, a thin line of time, one button. The strip at the bottom is the
// note's own waveform, drawn like a code: every voice looks different.

function firstWords(text: string, max = 2): string {
  return text.split(/(?<=[.!?।])\s+/).slice(0, max).join(" ");
}

/** The voice's own peaks as a symmetric bar code. Real data, never decoration. */
export function VoiceCode({ peaks, progress = 0, bars = 28, className }: { peaks: number[]; progress?: number; bars?: number; className?: string }) {
  const src = peaks.length ? peaks : new Array(bars).fill(0.4);
  const step = src.length / bars;
  return (
    <span className={cn("flex h-6 items-center gap-[3px]", className)} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const v = Math.max(0.16, Math.min(1, Number(src[Math.floor(i * step)] ?? 0.4)));
        return <span key={i} className="w-[3px] rounded-full transition-colors duration-200" style={{ height: `${Math.round(v * 100)}%`, background: i / bars < progress ? "var(--ink)" : "rgba(0,0,0,.22)" }} />;
      })}
    </span>
  );
}

function Frame({ card, children, footer }: { card: Card; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <article className="rounded-[30px] bg-white p-3 ring-1 ring-[var(--line)]" style={{ boxShadow: tintShadow(card, 0.32) }}>
      {children}
      <div className="flex items-center gap-3 border-t border-[var(--line)] px-2 pt-3">{footer}</div>
    </article>
  );
}

function Meta({ title, line, card }: { title: React.ReactNode; line: string; card: Card }) {
  return (
    <div className="flex items-start gap-2 px-2 pt-4">
      <div className="min-w-0 flex-1">
        <p className="voice m-0 line-clamp-2 text-title leading-snug text-ink">{title}</p>
        <p className="m-0 mt-1 text-footnote text-ink-soft">{line}</p>
      </div>
      <CardActions card={card} />
    </div>
  );
}

export function VoicePlaque({ card, ratio = "4/3", priority = false }: { card: Card; ratio?: "1/1" | "4/3"; priority?: boolean }) {
  const { members, displayLang } = useViewer();
  const { play, current, isPlaying, toggle, currentTime, duration, seek } = usePlayer();
  const { text } = useDisplayText(card.transcript || card.caption, card.transcript ? card.transcriptLang : card.lang, displayLang);
  const author = members.find((m) => m.id === card.authorId);
  const active = current?.id === card.id;
  const total = active && duration > 0 ? duration : cardDuration(card);
  const elapsed = active ? currentTime : 0;
  const progress = total > 0 ? elapsed / total : 0;
  const playing = active && isPlaying;

  return (
    <Frame
      card={card}
      footer={
        <>
          <span className="text-caption font-semibold tracking-wide text-ink-soft">NEARER</span>
          <VoiceCode peaks={card.peaks} progress={progress} className="flex-1 justify-end" />
        </>
      }
    >
      <div className="relative overflow-hidden rounded-[22px] bg-surface" style={{ aspectRatio: ratio }}>
        <Photo src={cardCover(card, members)} alt={`${callName(author)}'s photo`} sizes="(max-width: 480px) 100vw, 440px" priority={priority} position="center 30%" />
      </div>
      <Meta card={card} title={text === null ? <span className="inline-block h-5 w-3/4 rounded bg-tint" /> : `“${firstWords(text)}”`} line={`${callName(author)} · ${relativeDay(card.takenAt)}`} />
      <div className="px-2 pt-4">
        <button
          type="button"
          aria-label="Seek"
          disabled={!active}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * total);
          }}
          className="block h-4 w-full"
        >
          <span className="block h-[3px] w-full overflow-hidden rounded-full bg-tint">
            <span className="block h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        </button>
        <div className="tnum flex justify-between text-caption text-ink-faint">
          <span>{formatDuration(elapsed)}</span>
          <span>-{formatDuration(total - elapsed)}</span>
        </div>
        <div className="flex justify-center pb-4 pt-1">
          <button
            type="button"
            onClick={() => (active ? toggle() : play(card))}
            aria-label={playing ? "Pause" : `Play ${callName(author)}'s voice note`}
            className="press grid h-[60px] w-[60px] place-items-center rounded-full bg-accent text-accent-ink"
          >
            <Icon name={playing ? "pause" : "play"} size={22} />
          </button>
        </div>
      </div>
    </Frame>
  );
}

export function VideoPlaque({ card }: { card: Card }) {
  const { members, displayLang } = useViewer();
  const { text } = useDisplayText(card.caption, card.lang, displayLang);
  const author = members.find((m) => m.id === card.authorId);
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const src = resolveMediaUrl(card.mediaRef);
  const poster = cardCover(card, members);

  return (
    <Frame
      card={card}
      footer={
        <>
          <span className="text-caption font-semibold tracking-wide text-ink-soft">NEARER</span>
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-tint">
            <span className="block h-full bg-ink" style={{ width: `${progress * 100}%` }} />
          </span>
        </>
      }
    >
      <div className="relative overflow-hidden rounded-[22px] bg-black" style={{ aspectRatio: "4/5" }}>
        {src ? (
          <video
            ref={ref}
            src={src}
            poster={poster}
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
            onClick={() => ref.current?.pause()}
          />
        ) : (
          <Photo src={poster} alt={text ?? ""} sizes="440px" />
        )}
        {!playing && (
          <button
            type="button"
            aria-label="Play video"
            onClick={() => void ref.current?.play()}
            className="press absolute left-1/2 top-1/2 grid h-[60px] w-[60px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black"
          >
            <Icon name="play" size={22} />
          </button>
        )}
      </div>
      <Meta card={card} title={text || "A moment"} line={`${callName(author)} · ${relativeDay(card.takenAt)}`} />
      <div className="h-4" />
    </Frame>
  );
}
