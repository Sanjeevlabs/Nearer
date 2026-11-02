// When a push is allowed to interrupt someone. Pure; the table is in tests/push-policy.test.ts.
//
//   safety      always, at any hour, outside the daily cap (still honours the person's own switch)
//   voice/lamp/ask   now, unless it is quiet hours (22:00 to 07:00 where the person is)
//                    or they already had MAX_IMMEDIATE_PER_DAY today: then it waits for the
//                    8 AM summary ("3 things from your family")
//   digest      the 8 AM summary itself: one push, not in the cap
//
// Nothing here counts inactivity, streaks or days since anyone opened the app.
import type { PushCategory } from "./types";

export const MAX_IMMEDIATE_PER_DAY = 6;
export const QUIET_FROM_HOUR = 22;
export const QUIET_TO_HOUR = 7;

export interface PushPrefs {
  voice: boolean;
  lamp: boolean;
  asks: boolean;
  digest: boolean;
  safety: boolean;
}

export const DEFAULT_PREFS: PushPrefs = { voice: true, lamp: true, asks: true, digest: true, safety: true };

export type Decision = "now" | "batch" | "skip";

const PREF_OF: Record<PushCategory, keyof PushPrefs> = { voice: "voice", lamp: "lamp", ask: "asks", safety: "safety", digest: "digest" };

/** The person's wall-clock date (YYYY-MM-DD) and hour; UTC if the zone is unknown. */
export function localClock(tz: string, at: Date): { day: string; hour: number } {
  let zone = tz || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export function inQuietHours(tz: string, at: Date): boolean {
  const { hour } = localClock(tz, at);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR;
}

export interface DecideInput {
  category: PushCategory;
  tz: string;
  now: Date;
  prefs: PushPrefs;
  /** Immediate pushes already sent to this person today (their zone). */
  sentToday: number;
}

export function decidePush(i: DecideInput): Decision {
  if (!i.prefs[PREF_OF[i.category]]) return "skip";
  if (i.category === "safety" || i.category === "digest") return "now";
  const held = inQuietHours(i.tz, i.now) || i.sentToday >= MAX_IMMEDIATE_PER_DAY;
  if (!held) return "now";
  // Held back: it joins the morning summary, if they want one.
  return i.prefs.digest ? "batch" : "skip";
}
