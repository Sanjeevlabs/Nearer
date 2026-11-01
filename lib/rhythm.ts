// A day in words (SPEC §30.1): "up since 6:10 · active 11 min ago", or
// "quiet since 10 AM, usually busy by now". Compares today with the person's
// own usual day (median first and last sign of life over the past two weeks),
// not a fixed threshold. Only in-app activity they already share. Pure.
import { hourIn } from "./zones";

export interface DayRhythm {
  /** Today's activity, as positions 0..1 on a 6 AM → midnight axis. */
  ticks: number[];
  /** Their usual waking band on the same axis, or null until there are 3 days of history. */
  usual: [number, number] | null;
  /** Where "now" sits on the axis (null outside 6 AM–midnight). */
  now: number | null;
  /** First sign of life today, ISO. */
  firstToday: string | null;
}

const AXIS_START = 6;
const AXIS_END = 24;
const pos = (h: number) => Math.max(0, Math.min(1, (h - AXIS_START) / (AXIS_END - AXIS_START)));

function localDay(iso: string | Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function dayRhythm(times: string[], tz: string, now = new Date()): DayRhythm {
  const today = localDay(now, tz);
  const byDay = new Map<string, number[]>();
  for (const t of times) {
    if (Date.parse(t) > now.getTime() || now.getTime() - Date.parse(t) > 15 * 86_400_000) continue;
    const d = localDay(t, tz);
    byDay.set(d, [...(byDay.get(d) ?? []), hourIn(tz, new Date(t))]);
  }
  const todays = (byDay.get(today) ?? []).sort((a, b) => a - b);
  // One tick per quarter hour, so a burst of activity doesn't paint a bar.
  const ticks = Array.from(new Set(todays.map((h) => Math.round(h * 4) / 4))).map(pos);
  const past = Array.from(byDay.entries()).filter(([d]) => d !== today).map(([, hs]) => hs);
  const usual: [number, number] | null = past.length >= 3 ? [pos(median(past.map((h) => Math.min(...h)))), pos(median(past.map((h) => Math.max(...h))))] : null;
  const h = hourIn(tz, now);
  const firstIdx = times.filter((t) => localDay(t, tz) === today && Date.parse(t) <= now.getTime()).sort()[0] ?? null;
  return { ticks, usual, now: h >= AXIS_START ? pos(h) : null, firstToday: firstIdx };
}

/** Axis position back to an hour, for words ("usually up by 7"). */
export function axisHour(p: number): number {
  return AXIS_START + p * (AXIS_END - AXIS_START);
}

function clock(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(":00", "");
  } catch {
    return "";
  }
}

function hourWord(h: number): string {
  const hh = Math.floor(h) % 24;
  const m = Math.round((h - Math.floor(h)) * 60);
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return m >= 15 && m < 45 ? `${h12}:30 ${ap}` : `${h12} ${ap}`;
}

/** The sentence under a name. */
/** An app heartbeat (just opening Aangan) older than this no longer says "active": it says "quiet since". */
export const HEARTBEAT_FRESH_MS = 6 * 3_600_000;

export function rhythmLine(
  state: "active" | "quiet" | "asleep" | "unknown" | "private",
  lastActive: string | null,
  r: DayRhythm,
  tz: string,
  ago: (iso: string) => string,
  opts: { heartbeatOnly?: boolean; now?: Date } = {},
): string {
  if (state === "private") return "Keeps their activity private";
  if (state === "asleep") return r.usual ? `Asleep · usually up by ${hourWord(axisHour(r.usual[0]))}` : "Asleep";
  if (!lastActive) return "Not seen yet today";
  if (state === "active") {
    // The only sign is the app heartbeat and it is old: don't call that "active".
    const stale = opts.heartbeatOnly && (opts.now ?? new Date()).getTime() - Date.parse(lastActive) > HEARTBEAT_FRESH_MS;
    if (stale) return r.firstToday ? `Up since ${clock(r.firstToday, tz)} · quiet since ${clock(lastActive, tz)}` : `Quiet since ${clock(lastActive, tz)}`;
    return r.firstToday ? `Up since ${clock(r.firstToday, tz)} · active ${ago(lastActive)}` : `Active ${ago(lastActive)}`;
  }
  if (state === "quiet") {
    const usuallyBusy = r.usual && r.now !== null && r.now >= r.usual[0] && r.now <= r.usual[1];
    return `Quiet since ${clock(lastActive, tz)}${usuallyBusy ? ", usually busy by now" : ""}`;
  }
  return `Last seen ${ago(lastActive)}`;
}
