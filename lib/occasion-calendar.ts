// Pure date helpers for the Occasions room: which birthdays, national days
// and the family's festivals fall on which day. Client-safe (no fs).
// Festival specifics come from data/ and rituals/ via the API; nothing here
// names a festival.
import { parseBirthday } from "./birthday";

export interface OccasionStep {
  key: string;
  kind: string;
  prompt: string;
  cardTemplate: string;
}
export interface OccasionConfig {
  slug: string;
  title: string;
  cultureNotes: string;
  steps: OccasionStep[];
  /** Optional colour (#rrggbb) and greeting from the ritual JSON. */
  accent?: string;
  lampAccent?: string;
  greeting?: string;
}
export interface OccasionPerson {
  id: string;
  birthday?: string;
}
/** A dated festival or national day (lib/holidays.ts), as the client sees it. */
export interface CalHoliday {
  key: string;
  date: string;
  title: string;
  kind: "festival" | "national";
  traditions: string[];
  ritual: string | null;
  lampHour: number | null;
}
export interface OccasionChoices {
  traditions: string[];
  kept: string[];
  skipped: string[];
}
export interface CalOccasion {
  id: string;
  /** "birthday", or the holiday key (also the ritual-run slug). */
  slug: string;
  kind: "birthday" | "festival" | "national";
  /** YYYY-MM-DD */
  date: string;
  /** Holiday title; empty for birthdays (the page names the person). */
  title: string;
  memberId: string | null;
  /** Local hour every home lights its lamp (festivals only). */
  lampHour: number | null;
}

/**
 * Is this holiday on the family's calendar? A manual override wins (skipped
 * off, kept on); then national days always; then festivals of a chosen
 * tradition. No traditions chosen = national days only.
 */
export function holidayVisible(h: Pick<CalHoliday, "key" | "kind" | "traditions" | "ritual">, c: OccasionChoices): boolean {
  if (c.skipped.includes(h.key)) return false;
  if (c.kept.includes(h.key) || (h.ritual !== null && c.kept.includes(h.ritual))) return true;
  if (h.kind === "national") return true;
  return h.traditions.some((t) => c.traditions.includes(t));
}

export function visibleHolidays<T extends CalHoliday>(list: T[], c: OccasionChoices): T[] {
  return list.filter((h) => holidayVisible(h, c));
}

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "Birthday — family guide" → "Birthday". */
export function cleanTitle(title: string): string {
  return title.split(/\s+[—-]\s+/)[0].trim();
}

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today in the viewer's own zone. */
export function localTodayIso(now = new Date()): string {
  return isoOf(now);
}

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utc(toIso) - utc(fromIso)) / DAY);
}

function birthdayIn(year: number, birthday: string): string | null {
  // Either stored shape ("MM-DD" or "YYYY-MM-DD"): the calendar only wants the day and month.
  const p = parseBirthday(birthday);
  if (!p) return null;
  const { month: m, day: d } = p;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  // 29 Feb is kept on 28 Feb in other years.
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  const dt = new Date(Date.UTC(year, m - 1, day));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Every birthday and every given holiday (already filtered to the family's
 * choice, see visibleHolidays) between start and end (inclusive), by date.
 */
export function occasionsInRange(members: OccasionPerson[], holidays: CalHoliday[], startIso: string, endIso: string): CalOccasion[] {
  if (!ISO.test(startIso) || !ISO.test(endIso) || endIso < startIso) return [];
  const out: CalOccasion[] = [];
  const y0 = Number(startIso.slice(0, 4));
  const y1 = Number(endIso.slice(0, 4));
  for (const m of members) {
    if (!m.birthday) continue;
    for (let y = y0; y <= y1; y++) {
      const date = birthdayIn(y, m.birthday);
      if (date && date >= startIso && date <= endIso) out.push({ id: `birthday:${m.id}:${date}`, slug: "birthday", kind: "birthday", date, title: "", memberId: m.id, lampHour: null });
    }
  }
  for (const h of holidays) {
    if (!ISO.test(h.date) || h.date < startIso || h.date > endIso) continue;
    out.push({ id: `${h.key}:${h.date}`, slug: h.key, kind: h.kind, date: h.date, title: h.title, memberId: null, lampHour: h.kind === "festival" ? h.lampHour : null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** "19" → "7 PM", "9" → "9 AM". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

/** One month as calendar cells, weeks starting Sunday; only the weeks it needs. */
export function monthGrid(year: number, month0: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  const start = first.getTime() - lead * DAY;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(start + i * DAY);
    return { iso: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month0 };
  });
}

export function whenLabel(days: number, iso: string): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
