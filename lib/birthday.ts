// A birthday is stored as text in one of two shapes: "YYYY-MM-DD" when the year is
// known, "MM-DD" when it is not (and "" when nobody has added it). No schema change:
// the members.birthday column is plain text. Everything that reads a birthday goes
// through here. Pure and client-safe.

/** Either shape, or empty. */
export const BIRTHDAY_RE = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})?$/;
export const MIN_BIRTH_YEAR = 1900;

export interface ParsedBirthday {
  month: number;
  day: number;
  /** null when only the day and month are known. */
  year: number | null;
}

/** Parse either shape; null for "", garbage, or a day that is not on the calendar. */
export function parseBirthday(s: string | null | undefined): ParsedBirthday | null {
  if (!s) return null;
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = m[1] ? Number(m[1]) : null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 29 Feb is a real birthday; with a known year it must be a leap year.
  const probe = new Date(Date.UTC(year ?? 2000, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return null;
  return { month, day, year };
}

/** The "MM-DD" part of either shape, or "". */
export function mmdd(s: string | null | undefined): string {
  const p = parseBirthday(s);
  return p ? `${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : "";
}

/** The birth year when known. */
export function birthYearOf(s: string | null | undefined): number | null {
  return parseBirthday(s)?.year ?? null;
}

/** The calendar day (YYYY-MM-DD) it is in a zone. */
export function todayIn(tz: string | undefined, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Whole years lived by `today` (YYYY-MM-DD); null when the year is unknown. */
export function ageOnDay(birthday: string | null | undefined, today: string): number | null {
  const p = parseBirthday(birthday);
  if (!p || p.year === null) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - p.year;
  if (tm < p.month || (tm === p.month && td < p.day)) age -= 1;
  return age < 0 ? null : age;
}

/** Compose the stored text. No day or month: "". A year makes it the full date. */
export function buildBirthday(month: string, day: string, year?: string | number | null): string {
  if (!month || !day) return "";
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const y = String(year ?? "").trim();
  return y ? `${y}-${mm}-${dd}` : `${mm}-${dd}`;
}

/** A year field's text is fine: empty, or four digits from 1900 to this year. */
export function validYearText(text: string, now: Date = new Date()): boolean {
  const t = text.trim();
  if (t === "") return true;
  if (!/^\d{4}$/.test(t)) return false;
  const y = Number(t);
  return y >= MIN_BIRTH_YEAR && y <= now.getUTCFullYear();
}

/** Valid stored text that is not in the future (when it carries a year). */
export function validBirthday(s: string, now: Date = new Date()): boolean {
  if (s === "") return true;
  const p = parseBirthday(s);
  if (!p) return false;
  if (p.year === null) return true;
  // The furthest-ahead calendar day anywhere on earth, so no one is turned away on their own birthday.
  return p.year >= MIN_BIRTH_YEAR && s <= todayIn("Pacific/Kiritimati", now);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Nov" (never the year). */
export function dayMonthLabel(s: string | null | undefined): string {
  const p = parseBirthday(s);
  return p ? `${p.day} ${MONTHS[p.month - 1]}` : "";
}

/** Why a birthday cannot be saved yet, in a sentence; null when it is fine. */
export function birthdayProblem(month: string, day: string, year: string, now: Date = new Date()): string | null {
  if (!validYearText(year, now)) return `The year is four digits, from ${MIN_BIRTH_YEAR} to ${now.getUTCFullYear()}.`;
  if (year.trim() && !(month && day)) return "Add the day and month too, or clear the year.";
  return null;
}
