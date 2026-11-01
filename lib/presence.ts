// A parent's day, felt from far away. Pure functions (client and server).
//
// Presence is not tracking. It is what the parent chooses to share: one tap
// ("chai on the verandah"), or simply opening Nearer if they allow it. The
// quiet-day note is opt-in, owned by the parent, goes to one person they
// chose, and is judged against *their own* usual rhythm, never a fixed rule.
import type { CareSettings, Presence, PresenceMoment } from "./kinds";
import { hourIn } from "./zones";

export const MOMENT_LABEL: Record<PresenceMoment, { label: string; line: string }> = {
  awake: { label: "Up", line: "is up" },
  chai: { label: "Chai", line: "is having chai" },
  walk: { label: "Walk", line: "is out for a walk" },
  cooking: { label: "Cooking", line: "is cooking" },
  prayer: { label: "Prayer", line: "is at prayer" },
  garden: { label: "Garden", line: "is in the garden" },
  market: { label: "Market", line: "went to the market" },
  resting: { label: "Resting", line: "is resting" },
  visitors: { label: "Visitors", line: "has visitors" },
  thinking: { label: "Thinking of you", line: "is thinking of you" },
  here: { label: "In Nearer", line: "was in the courtyard" },
  work: { label: "At work", line: "is at work" },
  school: { label: "At school", line: "is at school" },
  commute: { label: "On the way", line: "is on the way" },
  home: { label: "Home", line: "is home" },
  "cooked-yours": { label: "Cooked your recipe", line: "cooked your recipe today" },
};

/** Moments a parent can share in one tap (order = everyday order). */
export const SHAREABLE: PresenceMoment[] = ["awake", "chai", "walk", "cooking", "prayer", "market", "resting", "visitors", "thinking"];

/**
 * Moments a son, daughter or grandchild shares *to* the parent: the ordinary
 * day the parent misses most. Children see the school one, adults the work one.
 */
export function shareableFor(role: "elder" | "adult" | "child"): PresenceMoment[] {
  if (role === "elder") return SHAREABLE;
  return role === "child" ? ["school", "home", "thinking"] : ["work", "commute", "home", "cooked-yours", "thinking"];
}

function localDay(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Their moments today (their local day), oldest first. */
export function todayFor(memberId: string, presence: Presence[], tz: string, now = new Date()): Presence[] {
  const today = localDay(now.toISOString(), tz);
  return presence
    .filter((p) => p.memberId === memberId && localDay(p.at, tz) === today)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function latestFor(memberId: string, presence: Presence[]): Presence | undefined {
  return presence.filter((p) => p.memberId === memberId).sort((a, b) => b.at.localeCompare(a.at))[0];
}

/** Their usual first-moment hour (median of recent days), default 9 AM until we know. */
export function usualFirstHour(memberId: string, presence: Presence[], tz: string): number {
  const firstByDay = new Map<string, number>();
  for (const p of presence.filter((x) => x.memberId === memberId)) {
    const day = localDay(p.at, tz);
    const h = hourIn(tz, new Date(p.at));
    if (!firstByDay.has(day) || (firstByDay.get(day) as number) > h) firstByDay.set(day, h);
  }
  const hours = Array.from(firstByDay.values()).sort((a, b) => a - b);
  if (hours.length < 3) return 9;
  return hours[Math.floor(hours.length / 2)];
}

/**
 * Should `viewerId` gently hear that the parent's day is unusually quiet?
 * Only if the parent opted in, chose this viewer, it's well past their usual
 * first moment, nothing at all was shared today, and it isn't night there.
 */
export function quietDay(settings: CareSettings | undefined, viewerId: string, presence: Presence[], tz: string, now = new Date()): { quiet: boolean; usualHour: number } {
  if (!settings?.quietAlert || settings.tellMemberId !== viewerId) return { quiet: false, usualHour: 9 };
  const usual = usualFirstHour(settings.memberId, presence, tz);
  const h = hourIn(tz, now);
  const shared = todayFor(settings.memberId, presence, tz, now).length > 0;
  return { quiet: !shared && h >= usual + settings.graceHours && h < 21, usualHour: usual };
}

/** "6:40 AM" in the parent's zone. */
export function at(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Whose week it is in a sibling rota (weeks counted from startWeek). */
export function whoseWeek(order: string[], startWeek: string, now = new Date()): { current: string; next: string } {
  const start = Date.parse(`${startWeek}T00:00:00Z`);
  const weeks = Math.max(0, Math.floor((now.getTime() - start) / (7 * 86_400_000)));
  const i = order.length ? weeks % order.length : 0;
  return { current: order[i] ?? "", next: order[(i + 1) % Math.max(1, order.length)] ?? "" };
}
