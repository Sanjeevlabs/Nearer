"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { resolveMediaUrl } from "@/lib/media-session";
import type { Card } from "@/lib/schemas";
import { callName, cardCover, formatDuration } from "@/lib/people";
import { Icon, Photo, PlayButton } from "./ui/kit";
import { useDisplayText } from "@/lib/use-display-text";
import { useViewer } from "./viewer";

interface PlayerState {
  current: Card | null;
  open: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  /** Play a voice note; pass the list it sits in to get previous / next. */
  play: (card: Card, queue?: Card[]) => void;
  /** The list the current voice came from (empty when played on its own). */
  queue: Card[];
  playNext: (() => void) | null;
  playPrev: (() => void) | null;
  toggle: () => void;
  seek: (seconds: number) => void;
  expand: () => void;
  collapse: () => void;
  closePlayer: () => void;
}

// The full-screen sheet (drag, waveform, lyrics, reactions) loads the first time something plays.
const FullPlayer = dynamic(() => import("./player-full"), { ssr: false });

const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

function segmentsMax(card: Card): number {
  return card.segments.reduce((m, s) => Math.max(m, s.end), 0);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { viewer } = useViewer();
  const [current, setCurrent] = useState<Card | null>(null);
  const [open, setOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(12);
  const [queue, setQueue] = useState<Card[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const url = current ? resolveMediaUrl(current.mediaRef) : null;

  const stopSimulated = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopWaves = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Real audio element, created lazily for uploads with a session URL.
  useEffect(() => {
    if (!url) return;
    const audio = new Audio(url);
    audio.preload = "auto";
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 12);
    const onEnd = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, [url]);

  // Web Audio graph for live frequency waves: source -> analyser ->
  // destination, built once per audio URL.
  useEffect(() => {
    if (!url || !audioRef.current || analyserRef.current) return;
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      const source = ctx.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = { ctx, analyser };
    } catch {
      analyserRef.current = null;
    }
    return () => {
      analyserRef.current?.ctx.close().catch(() => undefined);
      analyserRef.current = null;
    };
  }, [url]);

  // Simulated clock for demo cards without audio bytes.
  useEffect(() => {
    if (!current || url) return;
    if (!isPlaying) {
      stopSimulated();
      return;
    }
    timerRef.current = window.setInterval(() => {
      setCurrentTime((t) => {
        const next = t + 0.25;
        if (next >= duration) {
          setIsPlaying(false);
          stopSimulated();
          return duration;
        }
        return next;
      });
    }, 250);
    return stopSimulated;
  }, [current, url, isPlaying, duration, stopSimulated]);

  useEffect(() => stopSimulated, [stopSimulated]);
  useEffect(() => stopWaves, [stopWaves]);

  const play = useCallback(
    (card: Card, list?: Card[]) => {
      stopSimulated();
      audioRef.current?.pause();
      if (list) setQueue(list.filter((c) => c.type === "audio"));
      else setQueue((q) => (q.some((c) => c.id === card.id) ? q : []));
      setCurrent(card);
      setCurrentTime(0);
      setDuration(Math.max(12, segmentsMax(card)));
      setIsPlaying(true);
      setOpen(true);
      // Heard loop: record the play, fire-and-forget.
      void fetch("/api/plays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: card.id, memberId: viewer.id }),
      }).catch(() => undefined);
    },
    [stopSimulated, viewer.id],
  );

  const toggle = useCallback(() => {
    if (!current) return;
    if (audioRef.current && url) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        void audioRef.current.play().then(
          () => setIsPlaying(true),
          () => setIsPlaying(false),
        );
      }
      return;
    }
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (currentTime >= duration) setCurrentTime(0);
    setIsPlaying(true);
  }, [current, url, isPlaying, currentTime, duration]);

  const seek = useCallback(
    (seconds: number) => {
      const v = Math.max(0, Math.min(duration, seconds));
      if (audioRef.current && url) audioRef.current.currentTime = v;
      setCurrentTime(v);
    },
    [duration, url],
  );

  const at = current ? queue.findIndex((c) => c.id === current.id) : -1;
  const playNext = useMemo(() => (at >= 0 && at + 1 < queue.length ? () => play(queue[at + 1]) : null), [at, queue, play]);
  const playPrev = useMemo(() => (at > 0 ? () => play(queue[at - 1]) : null), [at, queue, play]);

  const expand = useCallback(() => setOpen(true), []);
  const collapse = useCallback(() => setOpen(false), []);
  const closePlayer = useCallback(() => {
    audioRef.current?.pause();
    stopSimulated();
    stopWaves();
    setIsPlaying(false);
    setCurrent(null);
    setOpen(false);
  }, [stopSimulated, stopWaves]);

  // Drive real-audio playback from isPlaying (set by play()).
  useEffect(() => {
    if (!audioRef.current || !url || !current) return;
    if (isPlaying && audioRef.current.paused) {
      void audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [isPlaying, url, current]);

  const value = useMemo<PlayerState>(
    () => ({
      current,
      open,
      isPlaying,
      currentTime,
      duration,
      play,
      queue,
      playNext,
      playPrev,
      toggle,
      seek,
      expand,
      collapse,
      closePlayer,
    }),
    [current, open, isPlaying, currentTime, duration, play, queue, playNext, playPrev, toggle, seek, expand, collapse, closePlayer],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <MiniPlayer />
      {current && <FullPlayer analyserRef={analyserRef} />}
    </PlayerContext.Provider>
  );
}

function MiniPlayer() {
  const { current, open, isPlaying, toggle, expand, closePlayer, currentTime, duration } = usePlayer();
  const { displayLang, members } = useViewer();
  const { text } = useDisplayText(current?.caption ?? "", current?.lang, displayLang);
  if (!current || open) return null;
  const author = members.find((m) => m.id === current.authorId);
  return (
    <div
      className="fixed inset-x-0 z-40 flex justify-center px-3"
      style={{ bottom: "calc(12px + env(safe-area-inset-bottom))" }}
      role="region"
      aria-label="Now playing"
    >
      <div className="frost relative flex w-full max-w-[460px] items-center gap-3 overflow-hidden rounded-[22px] p-2 pr-2">
        <button type="button" onClick={expand} className="press flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Open player">
          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[14px] bg-surface">
            <Photo src={cardCover(current, members)} alt="" sizes="96px" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body font-semibold">{callName(author)}</span>
            <span className="block truncate text-footnote text-ink-soft">{text ?? "…"}</span>
          </span>
        </button>
        <PlayButton playing={isPlaying} onClick={toggle} size={44} tone="dark" label={isPlaying ? "Pause" : "Play"} />
        <button type="button" onClick={closePlayer} aria-label="Stop and close" className="press grid h-11 w-11 place-items-center rounded-full text-ink-soft">
          <Icon name="close" size={20} />
        </button>
        <span className="absolute inset-x-4 bottom-0 h-[2px] rounded-full bg-tint" aria-hidden="true">
          <span className="block h-full rounded-full bg-white" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- voice controls */

function SkipIcon({ dir }: { dir: "back" | "forward" }) {
  // A circular arrow with "10" inside: back or forward ten seconds.
  const flip = dir === "forward";
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <g transform={flip ? "translate(30 0) scale(-1 1)" : undefined}>
        <path d="M8.2 9.3A9.5 9.5 0 1 1 5.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8.6 4.6v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="15.5" y="19" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">
        10
      </text>
    </svg>
  );
}

function StepIcon({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={dir === "next" ? "translate(24 0) scale(-1 1)" : undefined}>
        <rect x="4" y="5" width="2.6" height="14" rx="1.2" fill="currentColor" />
        <path d="M19.2 5.6v12.8a1 1 0 0 1-1.55.83L8.3 12.83a1 1 0 0 1 0-1.66l9.35-6.4a1 1 0 0 1 1.55.83Z" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Same length the shared player assumes before real audio metadata arrives. */
function expectedDuration(card: Card): number {
  return Math.max(12, segmentsMax(card));
}

/**
 * Clear controls for one voice note: a seek bar with elapsed and remaining
 * time, then previous, back 10 s, play/pause, forward 10 s, next. Every target
 * is at least 44 px, labelled, and keyboard reachable (the bar is a native
 * range input under its drawing). Drives the shared player.
 */
export function VoiceControls({
  card,
  queue,
  onPrev,
  onNext,
  bar = true,
  className,
}: {
  card: Card;
  /** The list this voice sits in, so the player can step through it. */
  queue?: Card[];
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  /** Draw the seek bar (off where a waveform already scrubs). */
  bar?: boolean;
  className?: string;
}) {
  const { current, isPlaying, currentTime, duration, play, toggle, seek, collapse } = usePlayer();
  const ours = current?.id === card.id;
  const total = ours ? duration : expectedDuration(card);
  const now = ours ? Math.min(currentTime, total) : 0;
  const playing = ours && isPlaying;
  const pct = total > 0 ? (now / total) * 100 : 0;

  const start = () => {
    play(card, queue);
    collapse();
  };
  const togglePlay = () => (ours ? toggle() : start());
  const jump = (by: number) => {
    if (!ours) {
      start();
      if (by > 0) window.setTimeout(() => seek(by), 0);
      return;
    }
    seek(now + by);
  };
  const btn = "press grid h-12 w-12 shrink-0 place-items-center rounded-full text-white disabled:opacity-30";

  return (
    <div className={className}>
      {bar && (
        <div>
          <div className="relative h-11">
            <span className="pointer-events-none absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 overflow-hidden rounded-full bg-white/25" aria-hidden="true">
              <span className="block h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
            </span>
            <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `${pct}%` }} aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.round(total * 10) / 10)}
              step={0.1}
              value={now}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!ours) {
                  start();
                  window.setTimeout(() => seek(v), 0);
                } else seek(v);
              }}
              aria-label="Seek"
              aria-valuetext={`${formatDuration(now)} of ${formatDuration(total)}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <div className="-mt-1 flex justify-between text-footnote tabular-nums text-white/75" aria-hidden="true">
            <span>{formatDuration(now)}</span>
            <span>-{formatDuration(Math.max(0, total - now))}</span>
          </div>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between" role="group" aria-label="Voice note controls">
        <button type="button" onClick={() => onPrev?.()} disabled={!onPrev} aria-label="Previous" className={btn}>
          <StepIcon dir="prev" />
        </button>
        <button type="button" onClick={() => jump(-10)} aria-label="Back 10 seconds" className={btn}>
          <SkipIcon dir="back" />
        </button>
        <button type="button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="press grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white text-black shadow-xl">
          <Icon name={playing ? "pause" : "play"} size={30} />
        </button>
        <button type="button" onClick={() => jump(10)} aria-label="Forward 10 seconds" className={btn}>
          <SkipIcon dir="forward" />
        </button>
        <button type="button" onClick={() => onNext?.()} disabled={!onNext} aria-label="Next" className={btn}>
          <StepIcon dir="next" />
        </button>
      </div>
    </div>
  );
}
