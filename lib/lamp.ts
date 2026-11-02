// The light in the window (SPEC §30.1). One lamp per home. It is lit ONLY by
// someone tapping it (or holding it for a heartbeat): a voice note or a photo
// does not light it, so a lit lamp always means "I was thinking of you".
// Full glow for 24 h after it is lit, then it fades to nothing at 72 h.
// Pure helpers (client + server).
import type { Household } from "./households";
import type { Lamp } from "./kinds";

export const FADE_HOURS = 72;
/** Full glow this long after it is lit; the fade runs from here to FADE_HOURS. */
export const FULL_HOURS = 24;
/** A heartbeat waits this long to be felt, then it's gone (no backlog of old pulses). */
export const BEAT_TTL_MS = 2 * 86_400_000;

/** 1 for the first 24 h after it was lit, then a straight fade to 0 at 72 h. */
export function glowFrom(lastAt: string | null, now = Date.now()): number {
  if (!lastAt) return 0;
  const h = (now - Date.parse(lastAt)) / 3_600_000;
  if (h <= FULL_HOURS) return 1;
  return Math.max(0, Math.round((1 - (h - FULL_HOURS) / (FADE_HOURS - FULL_HOURS)) * 100) / 100);
}

export interface LampHome {
  homeKey: string;
  memberIds: string[];
  litAt: string | null;
  litBy: string | null;
  glow: number;
}

export interface LampView {
  lamps: LampHome[];
  beats: { from: string; at: string }[];
  /** Another home lit its lamp since the viewer last felt one: show it once, then post "felt". */
  arrived: { from: string; at: string } | null;
  /** Someone in another home felt the viewer's latest light or heartbeat ("Maa felt it · 7:12"). */
  felt: { by: string; at: string } | null;
}

/**
 * Every home's lamp and the heartbeats waiting for `viewerId`. Only an explicit
 * light counts; someone who does not share visits never shows as having lit it.
 * Reads nothing but the lamp documents (no cards): bounded by the number of homes.
 */
export function lampView(homes: Household[], lamps: Lamp[], viewerId: string, hidden: Set<string> = new Set(), now = Date.now()): LampView {
  const mine = homes.find((h) => h.members.some((m) => m.id === viewerId));
  const known = new Set(homes.flatMap((h) => h.members.map((m) => m.id)));
  const myLamp = lamps.find((l) => l.id === mine?.id);
  const others = homes.filter((h) => h.id !== mine?.id);
  // The viewer's latest reach-out: lighting their own lamp, or a heartbeat into another home.
  const reach = [myLamp?.litBy === viewerId ? myLamp.litAt : null, ...lamps.flatMap((l) => l.beats.filter((b) => b.from === viewerId).map((b) => b.at))].filter((t): t is string => Boolean(t)).sort().pop() ?? null;
  let felt: LampView["felt"] = null;
  let arrived: LampView["arrived"] = null;
  const seen = myLamp?.felt[viewerId] ?? "";
  for (const h of others) {
    const lamp = lamps.find((l) => l.id === h.id);
    if (!lamp) continue;
    if (reach) {
      for (const m of h.members) {
        const at = lamp.felt[m.id];
        if (at && at >= reach && !hidden.has(m.id) && (!felt || at > felt.at)) felt = { by: m.id, at };
      }
    }
    const lit = lamp.litAt && lamp.litBy && lamp.litBy !== viewerId && !hidden.has(lamp.litBy) && lamp.litAt > seen && Date.parse(lamp.litAt) <= now && glowFrom(lamp.litAt, now) > 0 ? { from: lamp.litBy, at: lamp.litAt } : null;
    if (lit && (!arrived || lit.at > arrived.at)) arrived = lit;
  }
  return {
    arrived,
    felt,
    lamps: homes.map((h) => {
      const lamp = lamps.find((l) => l.id === h.id);
      const shown = lamp && lamp.litAt && lamp.litBy && !hidden.has(lamp.litBy) && Date.parse(lamp.litAt) <= now ? lamp : undefined;
      const litAt = shown?.litAt ?? null;
      return { homeKey: h.id, memberIds: h.members.map((m) => m.id), litAt, litBy: shown?.litBy ?? null, glow: glowFrom(litAt, now) };
    }),
    beats: pendingBeats(lamps.find((l) => l.id === mine?.id), viewerId, now).filter((b) => known.has(b.from)),
  };
}

/** "#rrggbb" -> "r,g,b" (null for anything else, so nothing but a colour reaches a stylesheet). */
function rgb(hex: string): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : null;
}

/**
 * The courtyard's lamp rings in a festival week's colour (`lampAccent`, from the
 * ritual JSON). Returns a stylesheet that overrides `.kutumb-lamp`, or "" for the
 * usual glow (no accent, or not a colour).
 */
export function lampGlowCss(lampAccent: string | null | undefined): string {
  const c = lampAccent ? rgb(lampAccent) : null;
  if (!c || !lampAccent) return "";
  return `
@keyframes kutumb-lamp-week { 0%,100% { box-shadow: 0 0 0 2.5px ${lampAccent}, 0 0 14px 3px rgba(${c},.55); } 50% { box-shadow: 0 0 0 2.5px ${lampAccent}, 0 0 22px 7px rgba(${c},.8); } }
.kutumb-lamp.kutumb-lamp { box-shadow: 0 0 0 2.5px ${lampAccent}, 0 0 18px 5px rgba(${c},.65); animation: kutumb-lamp-week 4.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .kutumb-lamp.kutumb-lamp { animation: none; } }
`;
}

/** Heartbeats waiting for this member: sent to their home, after the last one they felt. */
export function pendingBeats(lamp: Lamp | undefined, memberId: string, now = Date.now()): { from: string; at: string }[] {
  if (!lamp) return [];
  const felt = lamp.felt[memberId] ?? "";
  return lamp.beats.filter((b) => b.from !== memberId && b.at > felt && now - Date.parse(b.at) < BEAT_TTL_MS);
}
