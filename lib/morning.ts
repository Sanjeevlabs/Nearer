// The morning lamp is the parent's "I'm okay". Their first lamp (or first moment shared, or first
// open if they allow that) each day is the day's check-in. If it has not come by their usual time
// plus two hours, the far child hears one gentle invitation, never an alarm and never at night.
// Pure (client + server); the sweep that sends it is lib/push/morning.ts.
import type { Presence } from "./kinds";
import { usualFirstHour } from "./presence";
import { hourIn } from "./zones";

/** How long past their usual first moment before the invitation. */
export const QUIET_AFTER_HOURS = 2;
/** "Usual" is the median over this many days. */
export const RHYTHM_DAYS = 14;
/** They must have shown up on at least this many of those days, or there is no habit to miss. */
export const MIN_ACTIVE_DAYS = 2;
/** The invitation goes to a person only between these hours where THEY are (not at night). */
export const INVITE_FROM_HOUR = 8;
export const INVITE_TO_HOUR = 21;

export function localDay(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type MorningVerdict = "checked-in" | "early" | "night" | "private" | "no-habit" | "quiet";

export interface MorningInput {
  parentId: string;
  tz: string;
  /** Presence moments (any people; only the parent's are read). */
  presence: Pick<Presence, "memberId" | "at">[];
  /** Other times the parent did something on purpose, e.g. lit the lamp (ISO). */
  signals?: string[];
  /** The parent's own switch "Show my lamp and activity". False: we infer nothing from what they did not share. */
  shareVisits: boolean;
  now: Date;
}

/**
 * Has the parent checked in today, and if not, is it past their usual time plus two hours?
 * verdict "quiet" is the only one that invites anyone.
 */
export function morningCheck(i: MorningInput): { verdict: MorningVerdict; usualHour: number; dueHour: number } {
  const mine = i.presence.filter((p) => p.memberId === i.parentId && i.now.getTime() - Date.parse(p.at) < RHYTHM_DAYS * 86_400_000 && Date.parse(p.at) <= i.now.getTime());
  const usualHour = usualFirstHour(i.parentId, mine as Presence[], i.tz);
  const dueHour = usualHour + QUIET_AFTER_HOURS;
  const out = (verdict: MorningVerdict) => ({ verdict, usualHour, dueHour });
  if (!i.shareVisits) return out("private");
  const today = localDay(i.now, i.tz);
  const stamps = [...mine.map((p) => p.at), ...(i.signals ?? [])].filter((t) => Date.parse(t) <= i.now.getTime());
  if (stamps.some((t) => localDay(t, i.tz) === today)) return out("checked-in");
  if (new Set(stamps.map((t) => localDay(t, i.tz))).size < MIN_ACTIVE_DAYS) return out("no-habit");
  const hour = hourIn(i.tz, i.now);
  // Late evening there: the day is over, not worth a worry now.
  if (hour < dueHour) return out("early");
  if (hour >= INVITE_TO_HOUR) return out("night");
  return out("quiet");
}

/** Is it a decent hour for the person who would hear it (8:00 to 21:00 where they are)? */
export function decentHour(tz: string, at: Date): boolean {
  const h = hourIn(tz, at);
  return h >= INVITE_FROM_HOUR && h < INVITE_TO_HOUR;
}
