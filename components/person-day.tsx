"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CareSettings, Presence } from "@/lib/kinds";
import { DAY_LINE_MAX } from "@/lib/day-line";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, cardCover, relativeDay } from "@/lib/people";
import { printWhen, printWhere } from "@/lib/print";
import type { Card, Member } from "@/lib/schemas";
import { useDisplayText } from "@/lib/use-display-text";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { placeFromTz } from "@/lib/zones";
import { usePlayer, VoiceControls } from "./player";
import { PrintFrame } from "./print-frame";
import { ReactButtons, ReactorsLine, useCardReactions } from "./reactions";
import { useShell } from "./shell";
import { Icon, Photo } from "./ui/kit";
import { useViewer } from "./viewer";

// Their day (SPEC §30.2): tap someone in the Everyone row and see today's (or
// their latest day's) photos, videos and voices in order, tapping through.
// Photos come as prints (when, where and a note in the border); voices have
// full controls; who reacted shows by name. No likes, no counts, no "seen",
// nothing expires: it is all kept in Memory Lane. On your own day you can add
// a photo, a voice, or one line about today that lasts until your midnight.

/* ------------------------------------------------------------ pure helpers */

function localDay(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Their shared things from today (their local day), else from their latest day; oldest first. */
export function dayOf(member: Pick<Member, "id" | "tz">, cards: Card[], now = new Date()): { items: Card[]; today: boolean } {
  const mine = cards.filter((c) => c.authorId === member.id && Date.parse(c.takenAt) <= now.getTime());
  if (!mine.length) return { items: [], today: false };
  const latest = mine.reduce((a, b) => (a.takenAt > b.takenAt ? a : b));
  const day = localDay(latest.takenAt, member.tz);
  const items = mine.filter((c) => localDay(c.takenAt, member.tz) === day).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  return { items, today: day === localDay(now.toISOString(), member.tz) };
}

/**
 * The lamp-glow ring: warm when they were active or shared something today
 * (their local day). Someone who turned off "Show my lamp and activity" never
 * glows and never shows when they were last here.
 */
export function lampFor(member: Pick<Member, "id" | "tz" | "city">, data: { presence: Presence[]; settings: CareSettings[]; cards: Card[] }, now = new Date()): { glow: boolean; line: string } {
  const place = member.city || placeFromTz(member.tz);
  const shares = data.settings.find((s) => s.memberId === member.id)?.shareVisits ?? true;
  if (!shares) return { glow: false, line: place };
  const today = localDay(now.toISOString(), member.tz);
  const t = now.getTime();
  const cards = data.cards.filter((c) => c.authorId === member.id && Date.parse(c.takenAt) <= t);
  // Only moments they chose to share: the automatic "here" (opening Nearer) is never shown to others.
  const presence = data.presence.filter((p) => p.memberId === member.id && p.moment !== "here" && Date.parse(p.at) <= t);
  const fresh = cards.some((c) => localDay(c.takenAt, member.tz) === today);
  const activeToday = presence.some((p) => localDay(p.at, member.tz) === today);
  const glow = fresh || activeToday;
  // Words, never a count or a "last seen" clock.
  if (fresh) return { glow, line: "shared today" };
  if (activeToday) return { glow, line: "shared today" };
  return { glow, line: place };
}

/* ------------------------------------------------------------------ viewer */

const PHOTO_MS = 6000;
/** The print fits between the top bar (and the day's line) and the actions below it. */
function printWidth(reserve: number): string {
  return `min(calc(100vw - 56px), 400px, calc((100dvh - ${reserve}px) * 0.8 + 24px))`;
}

type DayLineView = { memberId: string; text: string; until: string };

function useDayLine(memberId: string) {
  const { data, reload } = useJson<{ lines: DayLineView[] }>("/api/day-line");
  const line = data?.lines.find((l) => l.memberId === memberId && Date.parse(l.until) > Date.now()) ?? null;
  return { line, reload };
}

function VoiceWords({ card }: { card: Card }) {
  const { displayLang } = useViewer();
  const words = card.transcript || card.caption;
  const { text } = useDisplayText(words, card.transcript ? card.transcriptLang : card.lang, displayLang);
  if (!words) return null;
  return <p className="voice m-0 line-clamp-4 text-title leading-snug">&ldquo;{text ?? words}&rdquo;</p>;
}

function DayLineEditor({ initial, onSaved, onCancel }: { initial: string; onSaved: () => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    const out = await postJson("/api/day-line", { text: text.trim() });
    setBusy(false);
    if (!out) return setError("Couldn't save that. Try again.");
    onSaved();
  };
  const takeDown = async () => {
    setBusy(true);
    await postJson("/api/day-line", {}, "DELETE");
    setBusy(false);
    onSaved();
  };
  return (
    <form
      className="rounded-[24px] bg-white p-2.5 text-ink"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void save();
      }}
    >
      <label htmlFor="day-line" className="block px-2 pb-1.5 pt-0.5 text-callout font-semibold">
        A line about today
      </label>
      <input
        id="day-line"
        autoFocus
        value={text}
        maxLength={DAY_LINE_MAX}
        onChange={(e) => setText(e.target.value)}
        placeholder="At the temple with Papa"
        className="h-12 w-full rounded-[16px] bg-surface px-4 font-hand text-title text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-black"
      />
      <p className="m-0 px-2 pt-1.5 text-footnote text-ink-soft">Shows on your day until midnight your time.</p>
      {error && (
        <p className="m-0 px-2 pt-1 text-callout text-[#b42318]" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {initial ? (
          <button type="button" onClick={() => void takeDown()} disabled={busy} className="press h-12 flex-1 rounded-full bg-surface text-body font-semibold">
            Take it down
          </button>
        ) : (
          <button type="button" onClick={onCancel} className="press h-12 flex-1 rounded-full bg-surface text-body font-semibold">
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy || !text.trim()} className="press h-12 flex-[1.4] rounded-full bg-accent text-body font-semibold text-accent-ink disabled:opacity-40">
          {busy ? "Saving…" : "Show it today"}
        </button>
      </div>
    </form>
  );
}

export function PersonDay({ member, cards, onClose }: { member: Member; cards: Card[]; onClose: () => void }) {
  const { viewer, members } = useViewer();
  const { openAdd } = useShell();
  const player = usePlayer();
  const own = member.id === viewer.id;
  const { items, today } = dayOf(member, cards);
  const [at, setAt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [editingLine, setEditingLine] = useState(false);
  const { line, reload: reloadLine } = useDayLine(member.id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const card = items.length ? items[Math.min(at, items.length - 1)] : undefined;
  const name = callName(member);
  const place = member.city || placeFromTz(member.tz);
  const { reactions, mine, toggle: react } = useCardReactions(card?.id ?? null);
  // Paused by the person, or while they write their line: nothing moves on.
  const holding = paused || editingLine;

  const next = useCallback(() => {
    if (at + 1 >= items.length) {
      // Others' days close at the end; your own day stays so you can add to it.
      if (own) {
        setProgress(1);
        setPaused(true);
      } else onClose();
      return;
    }
    setProgress(0);
    setAt(at + 1);
  }, [at, items.length, own, onClose]);
  const prev = useCallback(() => {
    setProgress(0);
    setAt((i) => Math.max(0, i - 1));
  }, []);
  // Stepping by hand means "show me": it lifts a pause.
  const stepNext = useCallback(() => {
    if (at + 1 < items.length) setPaused(false);
    next();
  }, [at, items.length, next]);
  const stepPrev = useCallback(() => {
    setPaused(false);
    prev();
  }, [prev]);

  // Esc closes (or cancels the line); arrows step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingLine) {
        if (e.key === "Escape") setEditingLine(false);
        return;
      }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") stepNext();
      if (e.key === "ArrowLeft") stepPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, stepNext, stepPrev, editingLine]);

  // Photos hold for a few seconds (pause stops the clock); voices play through the shared player.
  const cardId = card?.id;
  const cardType = card?.type;
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [cardId]);
  useEffect(() => {
    if (!cardId || cardType !== "photo" || holding) return;
    let last = Date.now();
    const t = window.setInterval(() => {
      const now = Date.now();
      elapsed.current += now - last;
      last = now;
      const p = elapsed.current / PHOTO_MS;
      if (p >= 1) {
        window.clearInterval(t);
        next();
      } else setProgress(p);
    }, 100);
    return () => window.clearInterval(t);
  }, [cardId, cardType, holding, next]);

  // A video follows pause too.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (holding) v.pause();
    else void v.play().catch(() => undefined);
  }, [holding, cardId]);

  const ours = card?.type === "audio" && player.current?.id === card.id;
  const voiceP = ours && player.duration ? Math.min(1, player.currentTime / player.duration) : 0;
  useEffect(() => {
    if (ours) setProgress(voiceP);
  }, [ours, voiceP]);
  // Pausing the voice pauses the day; playing it again resumes.
  const voicePRef = useRef(voiceP);
  voicePRef.current = voiceP;
  useEffect(() => {
    if (!ours) return;
    if (player.isPlaying) setPaused(false);
    else if (voicePRef.current < 0.999) setPaused(true);
  }, [ours, player.isPlaying]);
  // A voice that finished moves on to the next moment.
  useEffect(() => {
    if (ours && !player.isPlaying && voiceP >= 0.999 && !editingLine) next();
  }, [ours, player.isPlaying, voiceP, next, editingLine]);

  const playerRef = useRef(player);
  playerRef.current = player;
  const holdingRef = useRef(holding);
  holdingRef.current = holding;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Arriving at a voice starts it, unless the day is paused.
  useEffect(() => {
    const p = playerRef.current;
    const c = itemsRef.current.find((x) => x.id === cardId);
    if (!c || c.type !== "audio" || holdingRef.current || p.current?.id === c.id) return;
    p.play(c, itemsRef.current);
    p.collapse();
  }, [cardId]);
  // Leaving a voice (or the viewer) stops it.
  useEffect(
    () => () => {
      const p = playerRef.current;
      if (p.isPlaying && p.current?.id === cardId) p.toggle();
    },
    [cardId],
  );

  const close = () => onClose();
  const author = members.find((m) => m.id === card?.authorId) ?? member;
  const cover = card ? cardCover(card, members) : "";
  const videoSrc = card?.type === "video" ? resolveMediaUrl(card.mediaRef) : null;

  return (
    <div data-ui="person-day" role="dialog" aria-modal="true" aria-label={own ? "Your day" : `${name}'s day`} className="fixed inset-0 z-[60] flex justify-center bg-[#0d0b0a] text-white">
      <div className="relative flex h-full w-full max-w-[480px] flex-col overflow-hidden">
        {/* the photo is the colour: a soft, dim wash of it behind everything */}
        {card && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute inset-[-40px]" style={{ filter: "blur(44px) saturate(1.15) brightness(.5)" }}>
              <Photo key={card.id} src={cover} alt="" sizes="200px" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/10 to-black/70" />
          </div>
        )}

        {/* progress bars + who */}
        <div className="relative z-10 px-3" style={{ paddingTop: "calc(10px + env(safe-area-inset-top))" }}>
          <div className="flex gap-1" aria-hidden="true">
            {items.map((c, i) => (
              <span key={c.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <span className="block h-full bg-white" style={{ width: `${i < at ? 100 : i === at ? progress * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 px-1">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">{own ? "Your day" : name}</span>
              <span className="block text-footnote text-white/75">
                {today ? "Today" : card ? relativeDay(card.takenAt) : own ? "Today" : "Their day"} · {place}
              </span>
            </span>
            {card && card.type !== "audio" && (
              <button
                type="button"
                onClick={() => setPaused((v) => !v)}
                aria-label={holding ? "Resume" : "Pause"}
                aria-pressed={holding}
                className="press grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur"
              >
                <Icon name={holding ? "play" : "pause"} size={18} />
              </button>
            )}
            <button type="button" onClick={close} aria-label="Close" className="press grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur">
              <Icon name="close" size={20} />
            </button>
          </div>
          {line && !editingLine && (
            <p className="m-0 mt-2 px-1 font-hand text-title leading-snug text-white" aria-label={`${own ? "Your" : `${name}'s`} line about today: ${line.text}`}>
              &ldquo;{line.text}&rdquo;
            </p>
          )}
        </div>

        {/* the moment */}
        <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 py-3">
          {!card ? (
            <div className="px-6 text-center">
              <p className="voice m-0 text-title">{own ? "Nothing from you yet today." : `Nothing from ${name} yet.`}</p>
              <p className="m-0 mt-2 text-body text-white/70">
                {own ? "Add a photo or a voice and it shows here for the family." : "When they share a photo or a voice, their day appears here."}
              </p>
            </div>
          ) : card.type === "audio" ? (
            <div className="flex w-full max-w-[400px] flex-col items-center">
              <div className="relative h-[156px] w-[156px] overflow-hidden rounded-[24px]" style={{ boxShadow: "0 24px 48px rgba(0,0,0,.45)" }}>
                <Photo src={cover} alt="" sizes="312px" position="center 30%" />
              </div>
              <div className="mt-5 w-full">
                <VoiceWords card={card} />
                <p className="m-0 mt-2 text-callout text-white/70">{[printWhen(card.takenAt, author.tz), printWhere(card, author)].filter(Boolean).join(" · ")}</p>
              </div>
              <VoiceControls card={card} queue={items} onPrev={at > 0 ? stepPrev : null} onNext={at + 1 < items.length ? stepNext : null} className="mt-3 w-full" />
            </div>
          ) : (
            <PrintFrame key={card.id} card={card} author={author} src={cover} width={printWidth(400 + (line ? 44 : 0) + (own ? 64 : 0))} priority sizes="400px" share={own && !videoSrc} onShareOpen={(o) => o && setPaused(true)}>
              {videoSrc && (
                <video
                  key={card.id}
                  ref={videoRef}
                  src={videoSrc}
                  poster={cover}
                  autoPlay
                  playsInline
                  className="absolute inset-0 h-full w-full object-cover"
                  onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
                  onEnded={next}
                />
              )}
              {/* tap zones on the picture: left = back, right = next */}
              <button type="button" onClick={stepPrev} aria-label="Previous" className="absolute inset-y-0 left-0 z-10 w-1/3" />
              <button type="button" onClick={stepNext} aria-label="Next" className="absolute inset-y-0 right-0 z-10 w-2/3" />
            </PrintFrame>
          )}
        </div>

        {/* who reacted, and the ways to answer (or, on your own day, to add) */}
        <div className="relative z-10 px-4 pt-1" style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
          {card && <ReactorsLine reactions={reactions} className="mb-3" />}
          {own ? (
            editingLine ? (
              <DayLineEditor
                initial={line?.text ?? ""}
                onCancel={() => setEditingLine(false)}
                onSaved={() => {
                  setEditingLine(false);
                  void reloadLine();
                }}
              />
            ) : (
              <div className="space-y-2">
                <button type="button" onClick={() => setEditingLine(true)} className="press flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/35 bg-white/10 text-body font-semibold backdrop-blur">
                  <Icon name="edit" size={18} />
                  {line ? "Change today's line" : "A line about today"}
                </button>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2">
              {card && <ReactButtons mine={mine} onToggle={(k) => void react(k)} />}
              <button
                type="button"
                onClick={() => {
                  close();
                  openAdd("voice", null, [member.id]);
                }}
                className={cn("press flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white text-body font-semibold text-black")}
              >
                <Icon name="mic" size={18} />
                {card ? "Reply by voice" : "Send a voice"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

