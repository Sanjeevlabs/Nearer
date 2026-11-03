"use client";

import { useId, useState, type ReactNode } from "react";
import { privateLabel } from "@/lib/card-privacy";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, formatDuration, memberPhoto } from "@/lib/people";
import type { Card } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { cn } from "@/lib/utils";
import { usePlayer } from "./player";
import { Icon, Photo, petalFor } from "./ui/kit";
import { useViewer } from "./viewer";

// A voice memory as a music card: the speaker's face as the cover, the first
// words as the title, "Maa · 2 min · 3 Nov" under it, a big round play button,
// a progress bar with elapsed and total, and "Words" for the transcript (or its
// translation). It drives the one shared player (components/player.tsx), so
// only one voice plays at a time and every play is counted as heard.
//
//   shelf  a square card for a horizontal row (Memory Lane, Stories)
//   row    full width, cover on the left (the inbox)
//   hero   large and centred on a dark screen (a person's day)

export type VoiceCardVariant = "shelf" | "row" | "hero";

/** The first few words, cut at a word. */
export function firstWords(text: string, n = 7): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= n) return words.join(" ");
  return `${words.slice(0, n).join(" ").replace(/[,.;:!?]+$/, "")}…`;
}

/** The title: a given one, the caption when it is not just the transcript again, else the first words spoken. */
export function voiceTitle(card: Pick<Card, "caption" | "transcript">, title?: string): string {
  if (title?.trim()) return title.trim();
  const caption = card.caption.trim();
  const words = card.transcript.trim();
  if (caption && caption !== words) return caption;
  return firstWords(words || caption) || "A voice memory";
}

/** "2 min", "45 sec"; null when the length is not known yet. */
export function lengthLabel(seconds: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds < 60 ? `${Math.max(1, Math.round(seconds))} sec` : `${Math.round(seconds / 60)} min`;
}

/** "3 Nov", or "3 Nov 2024" when it is not this year. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function spokenLength(card: Card): number | null {
  const end = card.segments.reduce((m, s) => Math.max(m, s.end), 0);
  return end > 0 ? end : null;
}

export function VoiceCard({
  card,
  queue,
  variant = "shelf",
  title,
  subtitle,
  cover,
  onOpen,
  className,
  children,
}: {
  card: Card;
  /** The list it sits in, so the player can step through it. */
  queue?: Card[];
  variant?: VoiceCardVariant;
  /** Overrides the words-based title (a story's name). */
  title?: string;
  /** Overrides "Maa · 2 min · 3 Nov". */
  subtitle?: string;
  /** Overrides the speaker's face (a story's art). */
  cover?: ReactNode;
  /** Tapping the title opens it bigger (Memory Lane's viewer). */
  onOpen?: () => void;
  className?: string;
  /** Drawn over the cover (a menu, a share button). */
  children?: ReactNode;
}) {
  const { members, viewer, displayLang } = useViewer();
  const { current, isPlaying, currentTime, duration, play, toggle, seek, collapse } = usePlayer();
  const [words, setWords] = useState(false);
  const wordsId = useId();
  const author = members.find((m) => m.id === card.authorId);
  const name = callName(author);
  const ours = current?.id === card.id;
  const playing = ours && isPlaying;
  const known = spokenLength(card);
  const total = ours ? duration : (known ?? 0);
  const now = ours ? Math.min(currentTime, total) : 0;
  const pct = total > 0 ? (now / total) * 100 : 0;
  const spoken = card.transcript.trim();
  const { text: shown, translated } = useDisplayText(spoken, card.transcriptLang || card.lang, displayLang);
  const label = privateLabel(card, viewer.id, members);
  const heading = voiceTitle(card, title);
  const sub = subtitle ?? [name, lengthLabel(known ?? (ours ? duration : null)), shortDate(card.takenAt)].filter(Boolean).join(" · ");
  const dark = variant === "hero";
  const face = resolveMediaUrl(card.coverRef) ?? memberPhoto(author);

  const start = () => {
    play(card, queue);
    // Keep listening right here; the mini player stays at the bottom.
    collapse();
  };
  const onPlay = () => (ours ? toggle() : start());

  const art = cover ?? (
    face ? (
      <Photo src={face} alt="" sizes={variant === "row" ? "192px" : "400px"} position="center 30%" />
    ) : (
      <span data-display className="voice grid h-full w-full place-items-center text-white" style={{ background: `linear-gradient(140deg, ${petalFor(name)}, #c96f4a 70%, #e8a87c)`, fontSize: variant === "row" ? 34 : 64 }} aria-hidden="true">
        {name.trim().slice(0, 1).toUpperCase() || "?"}
      </span>
    )
  );

  const playButton = (size: number, extra?: string) => (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`${playing ? "Pause" : "Play"} ${name}'s voice memory: ${heading}`}
      aria-pressed={playing}
      className={cn("press grid shrink-0 place-items-center rounded-full shadow-lg", dark ? "bg-white text-black" : "bg-accent text-accent-ink", extra)}
      style={{ width: size, height: size }}
    >
      <Icon name={playing ? "pause" : "play"} size={Math.round(size * 0.42)} solid />
    </button>
  );

  const bar = (
    <div className={cn(variant === "shelf" ? "mt-1.5" : "mt-2")}>
      <div className="relative h-6">
        <span className={cn("pointer-events-none absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full", dark ? "bg-white/25" : "bg-well")} aria-hidden="true">
          <span className={cn("block h-full rounded-full transition-[width] duration-200", dark ? "bg-white" : "bg-accent")} style={{ width: `${pct}%` }} />
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round((total || 12) * 10) / 10)}
          step={0.1}
          value={now}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!ours) {
              start();
              window.setTimeout(() => seek(v), 0);
            } else seek(v);
          }}
          aria-label={`Seek in ${name}'s voice memory`}
          aria-valuetext={`${formatDuration(now)} of ${total ? formatDuration(total) : "unknown"}`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className={cn("flex justify-between text-caption tabular-nums", dark ? "text-white/75" : "text-ink-soft")} aria-hidden="true">
        <span>{formatDuration(now)}</span>
        <span>{total ? formatDuration(total) : "–:––"}</span>
      </div>
    </div>
  );

  const wordsToggle = spoken ? (
    <button
      type="button"
      onClick={() => setWords((v) => !v)}
      aria-expanded={words}
      aria-controls={wordsId}
      className={cn("press -ml-2 flex h-11 items-center gap-1.5 rounded-full px-2 text-footnote font-semibold", dark ? "text-white/85" : "text-ink-soft")}
    >
      <Icon name="info" size={15} />
      {words ? "Hide words" : "Words"}
    </button>
  ) : null;

  const wordsPanel =
    words && spoken ? (
      <div id={wordsId} className={cn("mt-1 rounded-[14px] p-3", dark ? "bg-white/10" : "bg-surface")}>
        <p className={cn("voice m-0 text-callout leading-snug", dark ? "text-white" : "text-ink")} lang={translated ? displayLang : card.transcriptLang || card.lang}>
          {shown ?? spoken}
        </p>
        {translated && shown && shown !== spoken && (
          <p className={cn("m-0 mt-2 text-footnote", dark ? "text-white/70" : "text-ink-soft")} lang={card.transcriptLang || card.lang}>
            <span className="font-semibold">Said: </span>
            {spoken}
          </p>
        )}
      </div>
    ) : null;

  const privateChip = label ? (
    <span data-ui="private-label" className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold", dark ? "bg-white/15 text-white" : "bg-well text-ink")}>
      <Icon name="heart" size={11} solid />
      {label}
    </span>
  ) : null;

  const titleEl = onOpen ? (
    <button type="button" onClick={onOpen} className="press block w-full min-h-11 text-left">
      <span className={cn("line-clamp-2 block font-semibold leading-snug", variant === "shelf" ? "text-callout" : "text-headline", dark ? "text-white" : "text-ink")}>{heading}</span>
      <span className={cn("mt-0.5 block truncate text-footnote", dark ? "text-white/75" : "text-ink-soft")}>{sub}</span>
    </button>
  ) : (
    <div>
      <p className={cn("m-0 line-clamp-2 font-semibold leading-snug", variant === "shelf" ? "text-callout" : "text-headline", dark ? "text-white" : "text-ink")}>{heading}</p>
      <p className={cn("m-0 mt-0.5 truncate text-footnote", dark ? "text-white/75" : "text-ink-soft")}>{sub}</p>
    </div>
  );

  if (variant === "row") {
    return (
      <div data-voice-card={card.id} data-variant="row" className={cn("w-full", className)}>
        <div className="flex items-center gap-3">
          <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[14px] bg-surface">
            {art}
            {children}
          </div>
          <div className="min-w-0 flex-1">
            {privateChip && <div className="mb-1">{privateChip}</div>}
            {titleEl}
          </div>
          {playButton(52)}
        </div>
        {bar}
        {wordsToggle}
        {wordsPanel}
      </div>
    );
  }

  if (variant === "hero") {
    return (
      <div data-voice-card={card.id} data-variant="hero" className={cn("flex w-full max-w-[400px] flex-col items-center", className)}>
        <div className="relative h-[180px] w-[180px] overflow-hidden rounded-[24px]" style={{ boxShadow: "0 24px 48px rgba(0,0,0,.45)" }}>
          {art}
          {children}
        </div>
        <div className="mt-4 w-full">
          {privateChip && <div className="mb-1.5">{privateChip}</div>}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">{titleEl}</div>
            {playButton(60)}
          </div>
          {bar}
          {wordsToggle}
          {wordsPanel}
        </div>
      </div>
    );
  }

  return (
    <div data-voice-card={card.id} data-variant="shelf" className={cn("w-[164px] shrink-0 snap-start", className)}>
      <div className="relative aspect-square w-full overflow-hidden rounded-[18px] bg-surface shadow-card">
        {art}
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(0,0,0,.35))]" aria-hidden="true" />
        {privateChip && <span className="absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] truncate">{privateChip}</span>}
        <span className="absolute bottom-2 right-2">{playButton(48)}</span>
        {children}
      </div>
      <div className="mt-2">{titleEl}</div>
      {bar}
      {wordsToggle}
      {wordsPanel}
    </div>
  );
}
