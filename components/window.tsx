"use client";

import { m } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { whatsappInvite } from "@/lib/invite-link";
import { haptic } from "@/lib/native";
import type { Knock, SafetyCheckin } from "@/lib/kinds";
import { DEFAULT_IMAGE, rememberHero } from "@/lib/hero";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, memberPhoto } from "@/lib/people";
import { stateOf, type SafetyState } from "@/lib/safety";
import type { Card, Member } from "@/lib/schemas";
import { awakeCities, type Glance } from "@/lib/glance";
import type { DayRhythm } from "@/lib/rhythm";
import { ALIVE_LOOK, type Alive } from "@/lib/status";
import { invalidateJson, postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import type { Weather } from "@/lib/weather";
import { badgeParts, clockWord, dayWord, lampToday, type DayMoment } from "@/lib/window-words";
import { timeIn } from "@/lib/zones";
import { InviteSheet, inviteCode } from "./invite-sheet";
import { PeoplePicker } from "./people-picker";
import { PushAsk } from "./push-ask";
import { usePlayer } from "./player";
import { BottomSheet } from "./share-panel";
import { useShell } from "./shell";
import { Avatar, Icon, Photo, type IconName } from "./ui/kit";
import { useViewer } from "./viewer";
import { HeroBox, earlyHeroSrc } from "./window-hero";

// The first screen. A real photograph of their home, full width and about half
// the screen, with one small badge on it (their time, weather, sun or moon).
// Everything else is under the photo, in boxes of one size and one background:
// the lamp and their latest voice, Safe & sound (tap a person for their day),
// the glance strip, since you were here, and the call row.

interface WindowPersonData {
  id: string;
  lastActive: string | null;
  state: Alive;
  line: string;
  rhythm: DayRhythm;
  moments?: DayMoment[];
  checkins?: { at: string; label: string }[];
}

interface WindowData {
  imageRef: string;
  far: { ids: string[]; names: string; city: string; tz: string } | null;
  weather: Weather | null;
  line: string;
  people: WindowPersonData[];
  since?: { at: string | null };
  lamp?: LampData;
  voice?: Card | null;
  chosen?: boolean;
  joined?: boolean;
  km: number | null;
  sky: { glyph: "sun" | "moon" | null; moon: { illumination: number; waxing: boolean; name: string }; bothNight: boolean };
  call: { good: boolean; text: string };
  glance?: Glance;
  homePhoto?: string | null;
}

export const WELCOME_KEY = "aangan:welcome";

/** Every box under the photo: one radius, one background. */
const CARD = "rounded-[18px] bg-surface";
const EDGE = { boxShadow: "var(--surface-edge)" } as const;

const WEATHER_ICON: Partial<Record<Weather["kind"], IconName>> = { clouds: "cloud", rain: "rain", storm: "storm", fog: "fog", snow: "snow" };

/* ------------------------------------------------------------ the badge */
/** Top-right of the photo: their time; the sun or moon by their real sky; the weather only if it was fetched. */
function Badge({ time, weather, glyph }: { time: string; weather: Weather | null; glyph: "sun" | "moon" | null }) {
  const b = badgeParts({ time, weather, glyph });
  const wIcon = b.weather ? WEATHER_ICON[b.weather.kind] : undefined;
  return (
    <div className="absolute right-4 flex h-[32px] items-center gap-1.5 rounded-full bg-black/35 px-3 text-footnote font-medium text-white backdrop-blur-md" style={{ top: "calc(10px + env(safe-area-inset-top))" }} aria-label={[b.time, b.weather ? `${b.weather.label}, ${b.weather.tempC} degrees` : ""].filter(Boolean).join(", ")}>
      {b.glyph && <Icon name={b.glyph} size={15} strokeWidth={2} />}
      <span className="tnum">{b.time}</span>
      {b.weather && (
        <>
          <span aria-hidden="true" className="opacity-60">
            ·
          </span>
          {wIcon && <Icon name={wIcon} size={15} strokeWidth={2} />}
          <span className="tnum">{b.weather.tempC}°C</span>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------- slide the key home */
// The bar: 280px at most, 48px tall, centred. The key (left) and the house (right) are both
// 40px, 4px in from their ends, so the key lands exactly on the house.
const BAR_H = 48;
const KNOB = 40;
const INSET = (BAR_H - KNOB) / 2;

/** Slide the key to the house to open home (or press Enter / Space on the key). Nothing moves until you do. */
export function SlideHome({ onOpen }: { onOpen: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const max = () => Math.max(1, (track.current?.clientWidth ?? 280) - KNOB - INSET * 2);
  const finish = useCallback(() => {
    setDone(true);
    setX(max());
    void haptic("selection");
    window.setTimeout(onOpen, 160);
    window.setTimeout(() => {
      setDone(false);
      setX(0);
    }, 2400);
  }, [onOpen]);
  const p = Math.min(1, x / max());
  return (
    <div ref={track} data-ui="window-key" className="relative mx-auto w-full max-w-[280px] select-none overflow-hidden rounded-full bg-ink" style={{ height: BAR_H, touchAction: "none" }}>
      {/* Chevrons centred on the whole track */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 text-white/50" style={{ opacity: 1 - p * 1.4 }} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <Icon key={i} name="chevron" size={14} />
        ))}
      </span>
      <span className="pointer-events-none absolute grid place-items-center rounded-full text-white" style={{ right: INSET, top: INSET, width: KNOB, height: KNOB, background: `rgba(255,255,255,${0.1 + p * 0.25})` }} aria-hidden="true">
        <Icon name="village" size={18} strokeWidth={1.8} />
      </span>
      <button
        type="button"
        aria-label="Slide to open the house"
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), finish())}
        onPointerDown={(e) => {
          if (done) return;
          start.current = e.clientX - x;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => start.current !== null && setX(Math.min(max(), Math.max(0, e.clientX - start.current)))}
        onPointerUp={() => {
          if (start.current === null) return;
          start.current = null;
          if (x / max() > 0.8) finish();
          else setX(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setX(0);
        }}
        // The visible knob is 40px; the hit area is the full 48px bar height (touch target >= 44px).
        className="absolute grid place-items-center rounded-full motion-reduce:transition-none"
        style={{ left: 0, top: 0, width: KNOB + INSET * 2, height: BAR_H, transform: `translateX(${x}px)`, transition: start.current === null ? "transform 260ms cubic-bezier(.2,.9,.3,1.2)" : "none" }}
      >
        <span className="sr-only">Slide to open the house</span>
        <span className="grid place-items-center rounded-full bg-white text-ink shadow-[0_6px_18px_rgba(0,0,0,.35)]" style={{ width: KNOB, height: KNOB }} aria-hidden="true">
          <m.span animate={done ? { rotate: 90 } : { rotate: 0 }} transition={{ duration: 0.2 }} className="grid place-items-center">
            <Icon name={done ? "lockOpen" : "key"} size={19} strokeWidth={2} />
          </m.span>
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------- the light, and their voice */
interface LampData {
  lamps: { homeKey: string; memberIds: string[]; litAt: string | null; litBy: string | null; glow: number }[];
  beats: { from: string; at: string }[];
}

/** "Light the lamp": tap lights it, hold sends a heartbeat. */
function LampButton({ lit, onLight, onHold, pulseKey }: { lit: boolean; onLight: () => void; onHold: () => void; pulseKey: number }) {
  const held = useRef<number | "held" | null>(null);
  return (
    <button
      type="button"
      aria-label="Light the lamp. Hold to send a heartbeat"
      title="Tap to light · hold for a heartbeat"
      className="press flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-callout font-semibold text-white"
      onPointerDown={() => {
        held.current = window.setTimeout(() => {
          held.current = "held";
          onHold();
        }, 600);
      }}
      onPointerUp={() => {
        if (held.current === "held") return void (held.current = null);
        if (held.current !== null) window.clearTimeout(held.current);
        held.current = null;
        onLight();
      }}
      onPointerLeave={() => {
        if (typeof held.current === "number") window.clearTimeout(held.current);
        held.current = null;
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span key={pulseKey} className={cn("grid place-items-center", pulseKey > 0 && "lamp-ring rounded-full")}>
        <Icon name="lamp" size={17} className={lit ? "text-[#ffd48a]" : undefined} />
      </span>
      Light the lamp
    </button>
  );
}

/** The lamp as a picture: unlit and lit stacked, a 200 ms crossfade between them (none with reduced motion). */
function LampPhoto({ lit, className, sizes }: { lit: boolean; className?: string; sizes: string }) {
  return (
    <span className={cn("relative block overflow-hidden bg-[#2a211b]", className)}>
      <Photo src="/demo/lamp-unlit.jpg" alt="" sizes={sizes} />
      <span className={cn("absolute inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none", lit ? "opacity-100" : "opacity-0")}>
        <Photo src="/demo/lamp-lit.jpg" alt="" sizes={sizes} />
      </span>
    </span>
  );
}

/** Tap the lamp: the big picture, and who lit it today in both homes. */
function LampSheet({ open, onClose, lit, rows }: { open: boolean; onClose: () => void; lit: boolean; rows: { key: string; who: string; at: string }[] }) {
  return (
    <BottomSheet open={open} onClose={onClose} label="The lamp">
      <div data-ui="lamp-sheet">
        <LampPhoto lit={lit} sizes="(max-width: 480px) 100vw, 440px" className="mx-auto aspect-square w-full max-w-[360px] rounded-[24px]" />
        <h3 className="m-0 mt-4 text-headline font-semibold">{lit ? "The lamp is lit" : "The lamp is out"}</h3>
        <SheetList title="Lit today" empty="Nobody has lit it today." rows={rows.map((r) => ({ key: r.key, at: r.at, main: r.who }))} />
      </div>
    </BottomSheet>
  );
}

/* ------------------------------------------------------- safe & sound */
const STATUS_WORD: Partial<Record<Alive, { word: string; ink: string }>> = {
  active: { word: "All good", ink: "#1e7a45" },
  quiet: { word: "Quiet for a while", ink: "#9a5b00" },
  asleep: { word: "Night-time there", ink: "var(--ink-soft)" },
};

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** One person: tap to open their day. */
function PersonRow({ p, st, check, onOpen }: { p: Member; st: WindowPersonData | undefined; check: SafetyState | null; onOpen: () => void }) {
  const look = ALIVE_LOOK[st?.state ?? "unknown"];
  const word = st ? STATUS_WORD[st.state] : undefined;
  const alarm = check && (check.tone === "overdue" || check.tone === "help");
  return (
    <button type="button" onClick={onOpen} className="press grid min-h-[56px] w-full grid-cols-[38px_1fr_16px] items-center gap-x-3 py-1.5 text-left" aria-label={`${callName(p)}: ${st?.line ?? ""}. Open their day`}>
      <span className="relative">
        <Avatar src={memberPhoto(p)} name={callName(p)} size={38} />
        <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--surface,#fff)]", st?.state === "active" && "alive-breathe")} style={{ background: look.dot, color: look.dot }} />
      </span>
      <span className="block min-w-0" suppressHydrationWarning>
        <span className="block text-callout leading-snug text-ink-soft">
          <b className="font-semibold text-ink">{callName(p)}</b> · {st ? lowerFirst(st.line) : "…"}
        </span>
        {(word || check) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption leading-snug text-ink-soft">
            {word && (
              <span className="inline-flex items-center gap-1.5" style={{ color: word.ink }}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: look.dot }} aria-hidden="true" />
                {word.word}
              </span>
            )}
            {word && check && <span aria-hidden="true">·</span>}
            {check && (
              <span className={cn("inline-flex items-center gap-1", alarm && "font-semibold text-[#c2343a]")}>
                <Icon name="shield" size={12} /> {check.label} · {clockWord(check.at, p.tz)}
              </span>
            )}
          </span>
        )}
      </span>
      <Icon name="chevron" size={16} className="text-ink-faint" />
    </button>
  );
}

/** Their day on one line: today's signs of life against the band they usually keep. */
function RhythmBar({ rhythm }: { rhythm: DayRhythm }) {
  const usual = rhythm.usual;
  return (
    <div>
      <div className="relative h-[30px]" role="img" aria-label={rhythm.ticks.length ? `Active at ${rhythm.ticks.length} times today${usual ? ", against their usual day" : ""}` : "Nothing yet today"}>
        <div className="absolute inset-x-0 top-[11px] h-[8px] rounded-full bg-black/[.06]" />
        {usual && <div className="absolute top-[11px] h-[8px] rounded-full bg-black/[.16]" style={{ left: `${usual[0] * 100}%`, width: `${Math.max(2, (usual[1] - usual[0]) * 100)}%` }} />}
        {rhythm.ticks.map((t, i) => (
          <span key={i} className="absolute top-[5px] h-[20px] w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${t * 100}%` }} />
        ))}
        {rhythm.now !== null && <span className="absolute top-[26px] h-[4px] w-[4px] -translate-x-1/2 rounded-full bg-[#c2343a]" style={{ left: `${rhythm.now * 100}%` }} aria-hidden="true" />}
      </div>
      <div className="mt-0.5 flex justify-between text-caption text-ink-faint" aria-hidden="true">
        {["6 AM", "12 PM", "6 PM", "12 AM"].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <p className="m-0 mt-1.5 text-caption leading-snug text-ink-soft">{usual ? "Dark marks: today. Grey band: their usual day." : "Dark marks: today. Their usual day appears after a few days."}</p>
    </div>
  );
}

function SheetList({ title, empty, rows }: { title: string; empty: string; rows: { key: string; at: string; main: string; note?: string }[] }) {
  return (
    <section data-ui="window-section" className="mt-5" aria-label={title}>
      <h3 className="m-0 text-footnote font-medium text-ink-soft">{title}</h3>
      {rows.length === 0 ? (
        <p className="m-0 mt-1.5 text-callout text-ink-soft">{empty}</p>
      ) : (
        <ul className="m-0 mt-1 list-none p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex min-h-[44px] items-baseline gap-3 border-t border-[var(--line)] py-2.5 first:border-0">
              <span className="tnum w-[68px] shrink-0 text-footnote text-ink-soft">{r.at}</span>
              <span className="min-w-0 text-body leading-snug">
                {r.main}
                {r.note && <span className="block text-footnote text-ink-soft">{r.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A person's day: the rhythm, what they shared, their check-ins, and two ways to reach them. */
function PersonSheet({ person, st, onTalk, onCall, onClose }: { person: Member | null; st: WindowPersonData | undefined; onTalk: () => void; onCall: () => void; onClose: () => void }) {
  // Keep the last person while the sheet slides away.
  const last = useRef<{ person: Member; st: WindowPersonData | undefined } | null>(null);
  if (person) last.current = { person, st };
  const shown = person ? { person, st } : last.current;
  const p = shown?.person;
  const s = shown?.st;
  const look = ALIVE_LOOK[s?.state ?? "unknown"];
  return (
    <BottomSheet open={Boolean(person)} onClose={onClose} label={p ? `${callName(p)}'s day` : "Their day"}>
      {p && (
        <div>
          <div className="flex items-center gap-3">
            <span className="relative">
              <Avatar src={memberPhoto(p)} name={callName(p)} size={44} />
              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full ring-2 ring-paper" style={{ background: look.dot }} />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-title font-semibold">{callName(p)}</p>
              <p className="m-0 text-callout leading-snug text-ink-soft">{s?.line ?? ""}</p>
            </div>
          </div>
          <section data-ui="window-their-day" className="mt-5" aria-label="Their day">
            <h3 className="m-0 mb-1 text-footnote font-medium text-ink-soft">Their day</h3>
            {s ? <RhythmBar rhythm={s.rhythm} /> : <div className="skeleton h-[60px]" />}
          </section>
          <SheetList title="Shared today" empty="Nothing shared yet today." rows={(s?.moments ?? []).map((mo, i) => ({ key: `${mo.at}-${i}`, at: clockWord(mo.at, p.tz), main: mo.label, note: mo.note }))} />
          <SheetList title="Check-ins" empty="No check-ins today." rows={(s?.checkins ?? []).map((c, i) => ({ key: `${c.at}-${i}`, at: clockWord(c.at, p.tz), main: c.label }))} />
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" onClick={onTalk} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-black/[.06] text-body font-semibold text-ink">
              <Icon name="mic" size={19} /> Voice note
            </button>
            <button type="button" onClick={onCall} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-ink text-body font-semibold text-white">
              <Icon name="video" size={19} /> Call
            </button>
          </div>
          {s?.state === "quiet" && (
            <Link href="/nearby" className="mt-2 flex min-h-[44px] items-center justify-center gap-1.5 text-callout font-medium text-ink-soft no-underline">
              <Icon name="gather" size={16} /> Who to call near them
            </Link>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

/* ------------------------------------------------------- the glance strip */
// Four 3-second answers across the whole family. Words, never counts. Every
// tile is the same height as its skeleton, so nothing jumps when it loads.
const TILE = cn("flex h-[80px] min-w-0 flex-col justify-between px-3 py-2", CARD);

function Tile({ href, label, aria, children, onOpen }: { href: string; label: string; aria: string; children: React.ReactNode; onOpen?: () => void }) {
  return (
    <Link href={href} aria-label={aria} onClick={onOpen} className={cn(TILE, "press text-ink no-underline")} style={EDGE}>
      <span className="truncate text-body font-medium leading-[1.2] text-ink-soft">{label}</span>
      {children}
    </Link>
  );
}

const detail = "line-clamp-2 text-body font-semibold leading-[1.2]";

function GlanceStrip({ glance, members }: { glance: Glance | null; members: Member[] }) {
  if (!glance)
    return (
      <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Looking across the family">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(TILE, "animate-pulse")} style={EDGE} />
        ))}
      </div>
    );
  const faces = glance.awake.slice(0, 5).map((a) => ({ a, m: members.find((mm) => mm.id === a.id) }));
  const cities = awakeCities(glance.awake);
  const who = faces.map((f) => callName(f.m)).filter(Boolean).join(", ");
  return (
    <nav data-ui="window-glance" aria-label="Across the family" className="grid grid-cols-2 gap-3">
      <Tile href="/" label="Awake now" aria={glance.awake.length ? `Awake now: ${who}${cities ? `, in ${cities}` : ""}` : "Everyone's asleep"}>
        {glance.awake.length ? (
          <span className="block min-w-0">
            <span className="flex items-center" aria-hidden="true">
              {faces.map(({ a, m }, i) => (
                <span key={a.id} className={cn("rounded-full ring-2 ring-white", i > 0 && "-ml-1.5")}>
                  <Avatar src={memberPhoto(m)} name={callName(m)} size={22} />
                </span>
              ))}
              {glance.awake.length > faces.length && <span className="ml-1 text-body leading-none text-ink-soft">…</span>}
            </span>
            <span className="block truncate text-body font-semibold leading-[1.2]">{cities}</span>
          </span>
        ) : (
          <span className={detail}>Everyone&apos;s asleep</span>
        )}
      </Tile>
      {glance.waiting && (
        <Tile
          href={glance.waiting.href}
          label="Waiting for you"
          aria={`Waiting for you: ${glance.waiting.text}`}
          onOpen={() => {
            // Opening a nudge is seeing it: it stops waiting (the dock dot goes with it).
            const id = glance.waiting?.nudgeId;
            if (id) void postJson("/api/nudges/seen", { ids: [id] }).then(() => invalidateJson());
          }}
        >
          <span className={detail}>{glance.waiting.text}</span>
        </Tile>
      )}
      {glance.kids && (
        <Tile href={glance.kids.href} label="From the kids" aria={`From the kids: ${glance.kids.text}`}>
          <span className={detail}>{glance.kids.text}</span>
        </Tile>
      )}
      {glance.next && (
        <Tile href={glance.next.href} label="Next" aria={`Next: ${glance.next.text}`}>
          <span className={detail}>{glance.next.text}</span>
        </Tile>
      )}
      <Tile href={glance.call.href} label="Our call" aria={`Our call: ${glance.call.text}`}>
        <span className={cn(detail, !glance.call.set && "font-medium text-ink-soft")} suppressHydrationWarning>
          {glance.call.text}
        </span>
      </Tile>
    </nav>
  );
}

/* ---------------------------------------------------------------- the screen */
export function LiteWindow({ onOpenDoor }: { onOpenDoor: () => void }) {
  const router = useRouter();
  const { viewer, members } = useViewer();
  const { openAdd, refreshKey } = useShell();
  const { play, current, isPlaying, toggle } = usePlayer();
  const win = useJson<WindowData>("/api/window", { every: 60_000 });
  const sit = useJson<{ knocks: Knock[] }>("/api/sit");
  const safety = useJson<{ checkins: SafetyCheckin[] }>("/api/safety");
  const [, setTick] = useState(0);
  const [calling, setCalling] = useState(false);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<Member | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [lampNote, setLampNote] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [lampOpen, setLampOpen] = useState(false);
  const data = win.data;
  // The lamp and their latest voice come with the window (one request on first paint).
  // A light just tapped shows at once, before the server answers.
  const [litNow, setLitNow] = useState<string | null>(null);
  const lamp = { data: data?.lamp ?? null, failed: win.failed, reload: win.reload };
  const farIds = useMemo(() => new Set(data?.far?.ids ?? []), [data?.far?.ids]);
  const atWindow = useMemo(() => (data?.people ?? []).map((p) => members.find((mm) => mm.id === p.id)).filter((mm): mm is Member => Boolean(mm)), [data?.people, members]);
  const statusOf = (id: string) => data?.people.find((p) => p.id === id);
  const waiting = Boolean(data && (!data.far || data.joined === false));
  const names = data?.far?.names ?? "";
  const now = new Date();

  const talk = (ids?: string[]) => {
    if (!ids && atWindow.length > 1) return setPicking(true);
    setPicking(false);
    setOpen(null);
    openAdd("voice", null, ids ?? atWindow.map((p) => p.id));
  };

  useEffect(() => {
    try {
      const w = sessionStorage.getItem(WELCOME_KEY);
      if (w) {
        setWelcome(w);
        sessionStorage.removeItem(WELCOME_KEY);
      }
    } catch {
      /* private mode */
    }
  }, []);

  // The clock and "now" move on their own.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // A heartbeat waiting for you: feel it once, then it's gone.
  useEffect(() => {
    const beats = lamp.data?.beats ?? [];
    if (!beats.length) return;
    const from = members.find((mm) => mm.id === beats[beats.length - 1].from);
    setLampNote(`${callName(from)} sent you a heartbeat`);
    let n = 0;
    const iv = window.setInterval(() => {
      setPulse((k) => k + 1);
      void haptic("light");
      if (++n >= 4) window.clearInterval(iv);
    }, 1000);
    void postJson("/api/lamp", { action: "felt" });
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lamp.data?.beats?.length]);

  const latestVoice: Card | undefined = data?.voice ?? undefined;
  const voiceBy = members.find((mm) => mm.id === latestVoice?.authorId);
  const knock = (sit.data?.knocks ?? []).find((k) => farIds.has(k.memberId));

  // The photo: their own home photo, else the one chosen, else the default. Remembered for the next load.
  const heroRef = data ? (data.homePhoto ?? data.imageRef) : null;
  const heroSrc = heroRef ? (resolveMediaUrl(heroRef) ?? DEFAULT_IMAGE) : earlyHeroSrc();
  useEffect(() => {
    if (heroRef) rememberHero(heroRef);
  }, [heroRef]);

  // The light between your home and theirs: whoever reached out last.
  const pair = useMemo(() => {
    const ls = (lamp.data?.lamps ?? []).map((l) => (litNow && l.memberIds.includes(viewer.id) ? { ...l, litAt: litNow, litBy: viewer.id, glow: 1 } : l));
    const theirs = ls.find((l) => l.memberIds.some((id) => farIds.has(id)));
    const mine = ls.find((l) => l.memberIds.includes(viewer.id));
    const last = [theirs, mine].filter((l): l is NonNullable<typeof l> => Boolean(l?.litAt)).sort((a, b) => (b.litAt ?? "").localeCompare(a.litAt ?? ""))[0];
    return { glow: Math.max(theirs?.glow ?? 0, mine?.glow ?? 0), last };
  }, [lamp.data, farIds, viewer.id, litNow]);
  const lastBy = members.find((mm) => mm.id === pair.last?.litBy);
  const today = lampToday(pair.last, pair.last?.litBy === viewer.id ? "you" : callName(lastBy), now);
  // Who lit it today, in both homes (the sheet).
  const litToday = (lamp.data?.lamps ?? [])
    .filter((l) => l.litAt && l.litBy && dayWord(l.litAt, now, viewer.tz) === "today")
    .sort((a, b) => (b.litAt ?? "").localeCompare(a.litAt ?? ""))
    .map((l) => ({ key: `${l.homeKey}-${l.litAt}`, who: l.litBy === viewer.id ? "You" : callName(members.find((mm) => mm.id === l.litBy)) || "Someone", at: clockWord(l.litAt as string, viewer.tz) }));

  const checkOf = (id: string): SafetyState | null => {
    const s = stateOf(safety.data?.checkins ?? [], id);
    return s && (s.tone !== "calm" || Date.now() - Date.parse(s.at) < 24 * 3_600_000) ? s : null;
  };

  const call = async () => {
    setOpen(null);
    if (knock) return router.push(`/call/${knock.id}`);
    setCalling(true);
    const out = await postJson<{ knock: Knock }>("/api/sit", { action: "knock", minutes: 45, note: "Come sit with me" });
    setCalling(false);
    if (out?.knock) router.push(`/call/${out.knock.id}`);
  };
  const light = async () => {
    setPulse((k) => k + 1);
    setLampNote(`You lit it just now · it's glowing in ${data?.far?.city || "their home"}`);
    setLitNow(new Date().toISOString());
    void haptic("medium");
    // The write refetches only the lamp and the window (lib/use-json.ts scopeOfWrite).
    await postJson("/api/lamp", { action: "light" });
  };
  const heartbeat = async () => {
    const to = atWindow[0];
    if (!to) return;
    setLampNote(`Heartbeat sent · ${callName(to)} will feel it next time they open Nearer`);
    let n = 0;
    const iv = window.setInterval(() => {
      setPulse((k) => k + 1);
      if (++n >= 4) window.clearInterval(iv);
    }, 1000);
    setLitNow(new Date().toISOString());
    await postJson("/api/lamp", { action: "beat", toMemberId: to.id });
  };

  const playing = latestVoice && current?.id === latestVoice.id && isPlaying;
  const clock = data?.far ? timeIn(data.far.tz, now) : "";
  const lampLoading = !lamp.data && !lamp.failed;
  const cardsLoading = !data;

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-paper text-ink" style={{ overscrollBehavior: "contain" }}>
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        {/* The photograph: the whole width, about half the screen. The badge is the only thing on it besides your own face. */}
        <HeroBox src={heroSrc}>
          <button type="button" onClick={() => router.push("/settings")} aria-label="Your profile and settings" className="press absolute left-3 grid h-[44px] w-[44px] place-items-center rounded-full" style={{ top: "calc(6px + env(safe-area-inset-top))" }}>
            <span className="rounded-full ring-2 ring-white/70">
              <Avatar src={memberPhoto(viewer)} name={viewer.firstName} size={36} />
            </span>
          </button>
          {data?.far && <Badge time={clock} weather={data.weather} glyph={data.sky.glyph} />}
        </HeroBox>

        <div className="flex flex-1 flex-col gap-3 px-4 pt-4" style={{ paddingBottom: 12 }}>
          {/* Who, where, and one true line */}
          <header data-ui="window-header" className="min-h-[48px]">
            {data ? (
              <>
                <h1 data-display className="m-0 truncate text-display font-light leading-[1.15] tracking-[-0.01em]">{names || "Your window"}</h1>
                {data.far && (
                  <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2.5 text-callout text-ink-soft">
                    <span>{data.far.city || "Their home"}</span>
                    <span className="tnum" suppressHydrationWarning>
                      {clock}
                    </span>
                    {data.km ? <span>{data.km.toLocaleString("en-US")} km away</span> : null}
                  </p>
                )}
                {data.line && <p className="m-0 mt-1.5 text-callout leading-snug">{data.line}</p>}
                {data.sky.bothNight && data.far && (
                  <p className="m-0 mt-1.5 flex items-center gap-1.5 text-footnote leading-snug text-ink-soft">
                    <Icon name="moon" size={14} /> Look up: {names.split(" & ")[0]} can see this same moon tonight, {Math.round(data.sky.moon.illumination * 100)}% full
                  </p>
                )}
                {welcome && <p className="voice m-0 mt-1.5 text-body">{welcome}</p>}
              </>
            ) : win.failed ? null : (
              <>
                <div className="skeleton h-[30px] w-[55%]" />
                <div className="skeleton mt-2 h-[18px] w-[70%]" />
              </>
            )}
          </header>

          {!data && win.failed && (
            <section className={cn(CARD, "p-4")} style={EDGE} role="alert">
              <p className="m-0 text-body font-semibold">Couldn&apos;t open the window</p>
              <p className="m-0 mt-1 text-callout text-ink-soft">Check your connection and try again.</p>
              <button type="button" onClick={() => void win.reload()} className="press mt-3 h-11 rounded-full bg-ink px-5 text-callout font-semibold text-white">
                Try again
              </button>
            </section>
          )}

          {!data && !win.failed && (
            <>
              <div className={cn(CARD, "h-[132px] animate-pulse")} style={EDGE} aria-busy="true" aria-label="Opening the window" />
              <div className={cn(CARD, "h-[190px] animate-pulse")} style={EDGE} />
              <GlanceStrip glance={null} members={members} />
            </>
          )}

          {data && waiting && <WaitingCard names={names} />}

          {data && !waiting && (
            <>
              {/* 1. The lamp, and their latest voice */}
              <section data-ui="window-lamp" className={cn(CARD, "px-4")} style={EDGE} aria-label="The lamp and their latest voice">
                <div className="flex min-h-[56px] items-center gap-3 py-2">
                  <button type="button" onClick={() => setLampOpen(true)} aria-label="See the lamp" className="press h-14 w-14 shrink-0 overflow-hidden rounded-2xl">
                    <LampPhoto lit={today.lit || Boolean(lampNote?.startsWith("You lit"))} sizes="56px" className="h-full w-full" />
                  </button>
                  <p className="m-0 min-w-0 flex-1 text-callout leading-snug" suppressHydrationWarning>
                    {lampNote ?? (lamp.failed && !lamp.data ? "Couldn't reach the lamp" : lampLoading ? " " : today.line)}
                  </p>
                  {lamp.failed && !lamp.data ? (
                    <button type="button" onClick={() => void lamp.reload()} className="press h-11 shrink-0 rounded-full bg-ink px-4 text-callout font-semibold text-white">
                      Try again
                    </button>
                  ) : (
                    <LampButton lit={today.lit} onLight={() => void light()} onHold={() => void heartbeat()} pulseKey={pulse} />
                  )}
                </div>
                <div className="flex min-h-[56px] items-center gap-3 border-t border-[var(--line)] py-2">
                  {cardsLoading ? (
                    <div className="skeleton h-[44px] w-full" aria-busy="true" aria-label="Looking for their latest voice" />
                  ) : latestVoice ? (
                    <>
                      <button type="button" onClick={() => (current?.id === latestVoice.id ? toggle() : play(latestVoice))} aria-label={`${playing ? "Pause" : "Play"} ${callName(voiceBy)}'s voice note`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white">
                        <Icon name={playing ? "pause" : "play"} size={16} />
                      </button>
                      <p className="m-0 min-w-0 flex-1 text-callout leading-snug">
                        <b className="font-semibold">{callName(voiceBy)}</b> · voice note
                        <span className="block text-footnote text-ink-soft" suppressHydrationWarning>
                          {dayWord(latestVoice.takenAt, now, viewer.tz)}, {clockWord(latestVoice.takenAt, viewer.tz)}
                        </span>
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/[.06] text-ink-soft" aria-hidden="true">
                        <Icon name="mic" size={18} />
                      </span>
                      <p className="m-0 min-w-0 flex-1 text-callout leading-snug text-ink-soft">No voice note from {names.split(" & ")[0] || "them"} yet</p>
                    </>
                  )}
                </div>
              </section>

              {/* 2. Safe & sound: tap a person for their day */}
              <section data-ui="window-safe" className={cn(CARD, "px-4 pb-1.5 pt-1")} style={EDGE} aria-label="Safe and sound">
                <div className="flex min-h-[44px] items-center justify-between gap-3">
                  <h2 className="m-0 text-headline font-semibold leading-tight tracking-[-0.01em]">Safe &amp; sound</h2>
                  <Link href="/safe" className="-mr-2 flex min-h-[44px] shrink-0 items-center gap-0.5 px-2 text-footnote font-medium text-ink-soft no-underline">
                    See check-ins <Icon name="chevron" size={14} />
                  </Link>
                </div>
                {atWindow.map((p, i) => (
                  <div key={p.id} className={cn(i > 0 && "border-t border-[var(--line)]")}>
                    <PersonRow p={p} st={statusOf(p.id)} check={checkOf(p.id)} onOpen={() => setOpen(p)} />
                  </div>
                ))}
              </section>

              {/* 3. The glance strip, two by two */}
              {!win.failed && <GlanceStrip glance={data.glance ?? null} members={members} />}

              {/* 5. The call row */}
              <section data-ui="window-call" className={cn(CARD, "flex items-center gap-2.5 px-4 py-3")} style={EDGE} aria-label="Call">
                <p className="m-0 min-w-0 flex-1 text-callout leading-snug">
                  {knock ? (
                    <>
                      <b className="font-semibold">{callName(members.find((mm) => mm.id === knock.memberId))} is at the window</b>
                      <span className="block text-footnote text-ink-soft">On a video call now</span>
                    </>
                  ) : (
                    <b className={cn("font-semibold", !data.call.good && "font-normal text-ink-soft")}>{data.call.text}</b>
                  )}
                </p>
                {atWindow.length > 0 && (
                  <button type="button" onClick={() => router.push(`/send?for=${encodeURIComponent(atWindow[0].id)}`)} aria-label={`Send ${names || callName(atWindow[0])} something`} title={`Send ${names || callName(atWindow[0])} something`} className="press grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-black/[.06]">
                    <Icon name="gift" size={20} strokeWidth={1.9} />
                  </button>
                )}
                <button type="button" onClick={() => talk()} disabled={!atWindow.length} aria-label={atWindow.length === 1 ? `Voice note to ${callName(atWindow[0])}` : "Voice note"} className="press grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-black/[.06] disabled:opacity-40">
                  <Icon name="mic" size={20} strokeWidth={1.9} />
                </button>
                <button type="button" onClick={() => void call()} disabled={calling} aria-label={knock ? "Join the video call" : "Video call"} className={cn("press relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-ink text-white", calling && "opacity-60")}>
                  <Icon name="video" size={20} strokeWidth={1.9} />
                  {knock && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 animate-ping rounded-full bg-[#3ccf7a]" />}
                </button>
              </section>

              {/* 6. A soft ask for gentle notes: only when this server can push and this device has not said yes */}
              <PushAsk />
            </>
          )}
        </div>

        {/* The key home stays within reach at the bottom of the screen */}
        <div className="sticky bottom-0 z-10 mt-auto bg-gradient-to-t from-paper from-70% to-transparent px-4 pt-3" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
          <SlideHome onOpen={onOpenDoor} />
        </div>
      </div>

      <PeoplePicker
        open={picking}
        title="Voice note to"
        people={atWindow}
        status={(p) => {
          const st = statusOf(p.id);
          return st ? { text: st.line, dot: ALIVE_LOOK[st.state].dot } : null;
        }}
        onPick={(ids) => talk(ids)}
        onClose={() => setPicking(false)}
      />
      <LampSheet open={lampOpen} onClose={() => setLampOpen(false)} lit={today.lit || Boolean(lampNote?.startsWith("You lit"))} rows={litToday} />
      <PersonSheet person={open} st={open ? statusOf(open.id) : undefined} onTalk={() => open && talk([open.id])} onCall={() => void call()} onClose={() => setOpen(null)} />
    </div>
  );
}

/* ------------------------------------------------------- empty window */
/** Nobody from the other side has joined yet: the window waits, the invite is one tap. */
function WaitingCard({ names }: { names: string }) {
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const send = async () => {
    setBusy(true);
    const code = await inviteCode();
    setBusy(false);
    // No code (or no right to make one): the invite sheet says why and lets them retry, in place.
    if (!code) return setSheet(true);
    window.open(whatsappInvite(window.location.origin, code), "_blank", "noopener");
  };
  return (
    <section data-ui="window-waiting" className={cn(CARD, "p-4")} style={EDGE} aria-label="Waiting for them to join">
      <p className="m-0 flex items-center gap-2 text-caption uppercase tracking-[0.16em] text-ink-soft">
        <span className="h-2 w-2 animate-pulse rounded-full bg-ink-soft" /> Waiting
      </p>
      <p className="m-0 mt-2 text-title font-light leading-snug">{names ? `${names} hasn't opened the window yet` : "Add the people on the other side"}</p>
      <p className="m-0 mt-1 text-callout text-ink-soft">When they join, you&apos;ll see their day here and they&apos;ll see yours.</p>
      <button type="button" onClick={() => void send()} disabled={busy} className="press mt-4 flex h-12 items-center gap-2 rounded-full bg-ink px-5 text-body font-semibold text-white">
        <Icon name="send" size={17} /> {busy ? "Opening…" : "Send the invite again"}
      </button>
      <InviteSheet open={sheet} onClose={() => setSheet(false)} />
    </section>
  );
}
