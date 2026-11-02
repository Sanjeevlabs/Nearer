"use client";

import { m } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { whatsappInvite } from "@/lib/invite-link";
import { haptic } from "@/lib/native";
import type { Knock, SafetyCheckin } from "@/lib/kinds";
import { rememberHero, type SceneSpace } from "@/lib/hero";
import type { LampView } from "@/lib/lamp";
import { skyState } from "@/lib/sky-state";
import { resolveMediaUrl } from "@/lib/media-session";
import { callName, memberPhoto } from "@/lib/people";
import { stateOf, type SafetyState } from "@/lib/safety";
import { useFamilyCards } from "@/lib/use-family";
import type { Card, Member } from "@/lib/schemas";
import type { Glance } from "@/lib/glance";
import { ALIVE_LOOK } from "@/lib/status";
import { postJson, useJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import type { Weather } from "@/lib/weather";
import { LAMP_GLOW_HOURS } from "@/lib/lamp";
import { arrivedLine, badgeParts, clockWord, dayWord, firstNameOf, lampState, lampWhy, moonLine, statusLine } from "@/lib/window-words";
import { timeIn } from "@/lib/zones";
import { InviteSheet, inviteCode } from "./invite-sheet";
import dynamic from "next/dynamic";
import { PeoplePicker } from "./people-picker";
import { PersonSheet, type WindowPersonData } from "./person-sheet";
import { PushAsk } from "./push-ask";
import { usePlayer } from "./player";
import { BottomSheet } from "./share-panel";
import { useShell } from "./shell";
import { Avatar, Icon, type IconName } from "./ui/kit";
import { useViewer } from "./viewer";
import { WindowScene } from "./window-scene";

// The full day view is only needed after a tap on "See their day": it stays out of the first paint.
const PersonDay = dynamic(() => import("./person-day").then((m) => m.PersonDay), { ssr: false });

// The first screen. A real photograph of their home, full width and about half
// the screen, with one small badge on it (their time, weather, sun or moon).
// Everything else is under the photo, in boxes of one size and one background:
// the lamp and their latest voice, Safe & sound (tap a person for their day),
// the glance strip, since you were here, and the call row.

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
  place?: { lat: number; lon: number } | null;
  next?: { text: string; href: string } | null;
  scene?: SceneSpace;
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
    <div ref={track} data-ui="window-key" className="relative mx-auto w-full max-w-[280px] select-none overflow-hidden rounded-full bg-deep" style={{ height: BAR_H, touchAction: "none" }}>
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
        <span className="grid place-items-center rounded-full bg-white text-[#1c1c1c] shadow-[0_6px_18px_rgba(0,0,0,.35)]" style={{ width: KNOB, height: KNOB }} aria-hidden="true">
          <m.span animate={done ? { rotate: 90 } : { rotate: 0 }} transition={{ duration: 0.2 }} className="grid place-items-center">
            <Icon name={done ? "lockOpen" : "key"} size={19} strokeWidth={2} />
          </m.span>
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------- the light, and their voice */
type LampData = LampView;

/* ---------------------------------------------------------------- the screen */
export function LiteWindow({ onOpenDoor }: { onOpenDoor: () => void }) {
  const router = useRouter();
  const { viewer, members } = useViewer();
  const { openAdd } = useShell();
  const { play, current, isPlaying, toggle } = usePlayer();
  const win = useJson<WindowData>("/api/window", { every: 60_000 });
  const sit = useJson<{ knocks: Knock[] }>("/api/sit");
  const safety = useJson<{ checkins: SafetyCheckin[] }>("/api/safety");
  const waitingFor = useJson<{ items: unknown[] }>("/api/waiting", { every: 60_000 });
  const hasWaiting = (waitingFor.data?.items.length ?? 0) > 0;
  const [, setTick] = useState(0);
  const [calling, setCalling] = useState(false);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<Member | null>(null);
  const [dayOfId, setDayOfId] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const { refreshKey } = useShell();
  const { cards } = useFamilyCards(refreshKey, dayOfId !== null);
  const dayPerson = members.find((mm) => mm.id === dayOfId);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [lampNote, setLampNote] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
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
  // Lines about one person use the first person's own first name ("Maa"), never the joined list.
  const first = firstNameOf([callName(members.find((mm) => mm.id === data?.far?.ids.find((id) => members.find((x) => x.id === id)?.role !== "child")))]) || firstNameOf([names]);
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
    setLampNote(`${firstNameOf([callName(from)])} sent you a heartbeat`);
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

  // Their light arrived since you last looked: it shows in the state line; tell them you felt it.
  const arrivedAt = lamp.data?.arrived?.at ?? null;
  // "Arjun is thinking of you" stays for this visit even after "felt" is posted and the server stops reporting it.
  const [arrivedSeen, setArrivedSeen] = useState<{ from: string; at: string } | null>(null);
  useEffect(() => {
    if (lamp.data?.arrived) setArrivedSeen(lamp.data.arrived);
  }, [lamp.data?.arrived]);
  useEffect(() => {
    if (!arrivedAt || lamp.data?.beats?.length) return;
    setPulse((k) => k + 1);
    void haptic("light");
    void postJson("/api/lamp", { action: "felt" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedAt]);

  const latestVoice: Card | undefined = data?.voice ?? undefined;
  const voiceBy = members.find((mm) => mm.id === latestVoice?.authorId);
  const knock = (sit.data?.knocks ?? []).find((k) => farIds.has(k.memberId));

  // Their own home photo (Settings, Your window, Photo) shows as is; otherwise the scene is drawn.
  const ownRef = data?.homePhoto ?? null;
  const ownPhoto = ownRef ? resolveMediaUrl(ownRef) : null;
  useEffect(() => {
    if (ownRef) rememberHero(ownRef);
  }, [ownRef]);

  // The light between your home and theirs: whoever reached out last.
  const pair = useMemo(() => {
    const ls = (lamp.data?.lamps ?? []).map((l) => (litNow && l.memberIds.includes(viewer.id) ? { ...l, litAt: litNow, litBy: viewer.id, glow: 1 } : l));
    const theirs = ls.find((l) => l.memberIds.some((id) => farIds.has(id)));
    const mine = ls.find((l) => l.memberIds.includes(viewer.id));
    const last = [theirs, mine].filter((l): l is NonNullable<typeof l> => Boolean(l?.litAt)).sort((a, b) => (b.litAt ?? "").localeCompare(a.litAt ?? ""))[0];
    return { glow: Math.max(theirs?.glow ?? 0, mine?.glow ?? 0), last, theirs, mine };
  }, [lamp.data, farIds, viewer.id, litNow]);
  const nameOf = (id: string) => firstNameOf([callName(members.find((mm) => mm.id === id))]);
  const lampNow = lampState({ theirs: pair.theirs, mine: pair.mine, viewerId: viewer.id, nameOf, felt: lamp.data?.felt ?? null, now, tz: viewer.tz, forName: first });
  const arrivedWords = arrivedLine(arrivedSeen, nameOf, now);
  // The real sky over their city, now; the lamp glows from whoever lit it last.
  const sky = skyState({ lat: data?.place?.lat, lon: data?.place?.lon, tz: data?.far?.tz ?? viewer.tz, now, weatherCode: data?.weather?.code ?? null, lampLitAt: pair.last?.litAt ?? null });
  const moon = moonLine(sky.moonVisible, data?.far?.city ?? "", sky.moon.illumination);

  const checkOf = (id: string): SafetyState | null => {
    const s = stateOf(safety.data?.checkins ?? [], id);
    return s && (s.tone !== "calm" || Date.now() - Date.parse(s.at) < 24 * 3_600_000) ? s : null;
  };

  const status = statusLine(
    atWindow.map((p) => {
      const st = statusOf(p.id);
      const chk = checkOf(p.id);
      const alarm = chk && (chk.tone === "overdue" || chk.tone === "help") ? `${chk.label} \u00b7 ${clockWord(chk.at, p.tz)}` : null;
      return { name: callName(p), state: st?.state ?? "unknown", lastActive: st?.lastActive ?? null, tz: p.tz, alarm };
    }),
  );

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
    setLampNote(`Glowing for ${first || "them"} \u00b7 ${LAMP_GLOW_HOURS} h`);
    setLitNow(new Date().toISOString());
    void haptic("medium");
    // The write refetches only the lamp and the window (lib/use-json.ts scopeOfWrite).
    await postJson("/api/lamp", { action: "light" });
  };
  const heartbeat = async () => {
    const to = atWindow[0];
    if (!to) return;
    setLampNote(`Heartbeat sent \u00b7 ${callName(to)} will feel it when they open Nearer`);
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

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-paper text-ink" style={{ overscrollBehavior: "contain" }}>
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        {/* Their home under their real sky, with the lamp hanging in it (a real button). */}
        <WindowScene
          sky={sky}
          space={data?.scene ?? "window"}
          ownPhoto={ownPhoto}
          onLight={() => void light()}
          onHold={() => void heartbeat()}
          pulseKey={pulse}
          lampLabel={`${lampNow.lit ? "The lamp is lit" : "The lamp is not lit"}. Tap to light it for ${first || "them"}; hold to send a heartbeat`}
        >
          <button type="button" onClick={() => router.push("/settings")} aria-label="Your profile and settings" className="press absolute left-3 grid h-[44px] w-[44px] place-items-center rounded-full" style={{ top: "calc(6px + env(safe-area-inset-top))" }}>
            <span className="rounded-full ring-2 ring-white/70">
              <Avatar src={memberPhoto(viewer)} name={viewer.firstName} size={36} />
            </span>
          </button>
          <Link href="/inbox" data-ui="window-bell" aria-label={hasWaiting ? "For you: something is waiting" : "For you"} className="press absolute left-[60px] grid h-[44px] w-[44px] place-items-center rounded-full bg-black/30 text-white no-underline backdrop-blur-md" style={{ top: "calc(6px + env(safe-area-inset-top))" }}>
            <Icon name="bell" size={19} strokeWidth={1.9} />
            {hasWaiting && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#e8735a] ring-2 ring-white" aria-hidden="true" />}
          </Link>
          {data?.far && <Badge time={clock} weather={data.weather} glyph={data.sky.glyph} />}
        </WindowScene>

        <div className="flex flex-1 flex-col gap-3 px-4 pt-4" style={{ paddingBottom: 12 }}>
          {/* Who, where, what time: one line. The moon only at night. */}
          <header data-ui="window-header" className="min-h-[32px]">
            {data ? (
              <>
                <h1 data-display className="m-0 truncate text-title font-semibold leading-tight" suppressHydrationWarning>
                  {names || "Your window"}
                  {data.far && <span className="font-normal text-ink-soft">{` · ${data.far.city || "Their home"} · ${clock}`}</span>}
                </h1>
                {moon && (
                  <p data-ui="window-moon" className="m-0 mt-1 flex items-center gap-1.5 text-footnote leading-snug text-ink-soft">
                    <Icon name="moon" size={14} /> {moon}
                  </p>
                )}
                {welcome && <p className="voice m-0 mt-1.5 text-body">{welcome}</p>}
              </>
            ) : win.failed ? null : (
              <div className="skeleton h-[26px] w-[70%]" />
            )}
          </header>

          {!data && win.failed && (
            <section className={cn(CARD, "p-4")} style={EDGE} role="alert">
              <p className="m-0 text-body font-semibold">Couldn&apos;t open the window</p>
              <p className="m-0 mt-1 text-callout text-ink-soft">Check your connection and try again.</p>
              <button type="button" onClick={() => void win.reload()} className="press mt-3 h-11 rounded-full bg-accent px-5 text-callout font-semibold text-accent-ink">
                Try again
              </button>
            </section>
          )}

          {!data && !win.failed && (
            <>
              <div className={cn(CARD, "h-[56px] animate-pulse")} style={EDGE} aria-busy="true" aria-label="Opening the window" />
              <div className={cn(CARD, "h-[56px] animate-pulse")} style={EDGE} />
            </>
          )}

          {data && (
            <>
              {/* ONE status line (Safe & sound): everyone is fine, or the one person to look at. Tap a face for their day. */}
              <section data-ui="window-safe" className={cn(CARD, "flex min-h-[56px] items-center gap-2 py-1 pl-2 pr-3")} style={EDGE} aria-label="Safe and sound">
                {atWindow.length > 0 ? (
                  <>
                    <div className="flex shrink-0 items-center">
                      {atWindow.map((p) => {
                        const st = statusOf(p.id);
                        return (
                          <button key={p.id} type="button" onClick={() => setOpen(p)} aria-label={`${callName(p)}: ${st?.line ?? ""}. Open`} className="press relative grid h-11 w-11 place-items-center rounded-full">
                            <Avatar src={memberPhoto(p)} name={callName(p)} size={36} />
                            <span className={cn("absolute bottom-1 right-1 h-3 w-3 rounded-full ring-2 ring-[var(--surface,#fff)]", st?.state === "active" && "alive-breathe")} style={{ background: ALIVE_LOOK[st?.state ?? "unknown"].dot, color: ALIVE_LOOK[st?.state ?? "unknown"].dot }} />
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => setOpen(atWindow[status?.subject ?? 0] ?? atWindow[0])} className={cn("press min-h-[44px] min-w-0 flex-1 px-1 text-left text-callout leading-snug", status?.tone === "alarm" ? "font-semibold text-[#c2343a]" : "font-medium text-ink")} suppressHydrationWarning>
                      {status?.text ?? "…"}
                    </button>
                  </>
                ) : (
                  <p className="m-0 px-2 py-2 text-callout text-ink-soft">Add the people on the other side, and how they are shows here.</p>
                )}
              </section>
              {waiting && <WaitingNote names={first} />}

              {/* The lamp: one line (and a small "?" for the rest). Shown even before they join. */}
              <section data-ui="window-lamp" aria-label="The lamp" aria-live="polite" className="flex min-h-[44px] items-center gap-2 px-1">
                <span data-arrived={arrivedWords && !lampNote ? "true" : undefined} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", lampNow.lit || (arrivedWords && !lampNote) ? "bg-accent text-accent-ink" : "bg-tint text-ink-soft", arrivedWords && !lampNote && "lamp-arrive")} aria-hidden="true">
                  <Icon name="lamp" size={16} />
                </span>
                <p className="m-0 min-w-0 flex-1 text-callout font-medium leading-snug" suppressHydrationWarning>
                  {lampNote ?? arrivedWords ?? lampNow.line}
                  {lampNow.felt && <span className="block text-footnote font-normal text-ink-soft">{lampNow.felt}</span>}
                </p>
                <button type="button" data-ui="window-info" onClick={() => setInfo(true)} aria-label="About the lamp and Safe and sound" className="press grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft">
                  <Icon name="info" size={18} />
                </button>
              </section>

              {/* One action row */}
              <section data-ui="window-actions" aria-label="Reach them" className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => talk()} disabled={!atWindow.length} aria-label="Voice note" className="press flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[16px] bg-surface py-2 text-footnote font-semibold text-ink disabled:opacity-40" style={EDGE}>
                  <Icon name="mic" size={19} strokeWidth={1.9} /> Voice
                </button>
                <button type="button" onClick={() => void call()} disabled={calling || !atWindow.length} aria-label={knock ? "Join the video call" : "Call"} className={cn("press relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[16px] bg-accent py-2 text-footnote font-semibold text-accent-ink disabled:opacity-40", calling && "opacity-60")}>
                  <Icon name="video" size={19} strokeWidth={1.9} /> {knock ? "Join" : "Call"}
                  {knock && <span className="absolute right-3 top-2 h-2.5 w-2.5 animate-ping rounded-full bg-[#3ccf7a] motion-reduce:animate-none" />}
                </button>
                <button type="button" onClick={() => atWindow[0] && router.push(`/send?for=${encodeURIComponent(atWindow[0].id)}`)} disabled={!atWindow.length} aria-label="Send something" className="press flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[16px] bg-surface py-2 text-footnote font-semibold text-ink disabled:opacity-40" style={EDGE}>
                  <Icon name="gift" size={19} strokeWidth={1.9} /> Send
                </button>
              </section>
              {knock && (
                <p className="m-0 -mt-1 px-0.5 text-footnote text-ink-soft">
                  {callName(members.find((mm) => mm.id === knock.memberId))} is on a video call now
                </p>
              )}

              {/* Their latest voice: one compact row */}
              {latestVoice && (
                <section data-ui="window-voice" className={cn(CARD, "flex min-h-[56px] items-center gap-3 px-3 py-1.5")} style={EDGE} aria-label="Their latest voice">
                  <button type="button" onClick={() => (current?.id === latestVoice.id ? toggle() : play(latestVoice))} aria-label={`${playing ? "Pause" : "Play"} ${callName(voiceBy)}'s voice note`} className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
                    <Icon name={playing ? "pause" : "play"} size={16} />
                  </button>
                  <p className="m-0 min-w-0 flex-1 truncate text-callout leading-snug" suppressHydrationWarning>
                    <b className="font-semibold">{callName(voiceBy)}</b>
                    <span className="text-ink-soft">{` · ${dayWord(latestVoice.takenAt, now, viewer.tz)}, ${clockWord(latestVoice.takenAt, viewer.tz)}`}</span>
                  </p>
                </section>
              )}

              {/* A soft ask for gentle notes: only when this server can push and this device has not said yes */}
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
      <PersonSheet person={open} st={open ? statusOf(open.id) : undefined} onTalk={() => open && talk([open.id])} onCall={() => void call()} onSeeDay={() => { setDayOfId(open?.id ?? null); setOpen(null); }} onClose={() => setOpen(null)} />
      {dayPerson && <PersonDay member={dayPerson} cards={cards ?? []} onClose={() => setDayOfId(null)} />}
      <InfoSheet open={info} onClose={() => setInfo(false)} />
    </div>
  );
}

/* ------------------------------------------------------- not joined yet */
/** Nobody from the other side has joined yet: a small note inside People, the invite one tap away. */
function WaitingNote({ names }: { names: string }) {
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
    <div data-ui="window-waiting" className="flex items-center gap-3 border-t border-[var(--line)] py-2">
      <p className="m-0 min-w-0 flex-1 text-footnote leading-snug text-ink-soft">{names ? `${names} hasn't joined yet.` : "They haven't joined yet."} When they do, you&apos;ll see their day here.</p>
      <button type="button" onClick={() => void send()} disabled={busy} className="press flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-footnote font-semibold text-accent-ink">
        <Icon name="whatsapp" size={16} /> {busy ? "Opening…" : "Invite again"}
      </button>
      <InviteSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

/* ------------------------------------------------------- the small "?" */
/** The lamp and Safe & sound in a few lines, so the first screen needn't say them. */
function InfoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="How this works">
      <div data-ui="window-info-sheet" className="space-y-4">
        <section>
          <h3 className="m-0 text-body font-semibold">The lamp</h3>
          <p className="m-0 mt-1 text-callout leading-snug text-ink-soft">{lampWhy()}</p>
        </section>
        <section>
          <h3 className="m-0 text-body font-semibold">Safe &amp; sound</h3>
          <p className="m-0 mt-1 text-callout leading-snug text-ink-soft">From their time in Nearer: opening it, a voice note, a check-in. Nothing outside Nearer is watched.</p>
        </section>
        <Link href="/safe" onClick={onClose} className="press flex min-h-[44px] items-center gap-1 text-callout font-semibold text-accent no-underline">
          See check-ins <Icon name="chevron" size={14} />
        </Link>
      </div>
    </BottomSheet>
  );
}
