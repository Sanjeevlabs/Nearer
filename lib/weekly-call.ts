// The fixed weekly call ("Sunday chai"): next-occurrence maths, the two-zone
// label and a hand-written iCalendar file. Pure; no dependencies. The weekday
// and time are meant in the zone they were set in, so a DST change in the
// viewer's zone moves the viewer's clock, not the call.
import type { WeeklyCall } from "./kinds";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const CALL_MINUTES = 45;

type Slot = Pick<WeeklyCall, "weekday" | "hour" | "minute" | "tz">;

export function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Local {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  wd: number;
}

function localParts(tz: string, at: Date): Local {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { y: Number(get("year")), mo: Number(get("month")), d: Number(get("day")), h: Number(get("hour")) % 24, mi: Number(get("minute")), wd: SHORT.indexOf(get("weekday")) };
}

/** Offset of a zone from UTC at an instant, in minutes (IST = 330). */
export function offsetMinutes(tz: string, at: Date): number {
  const l = localParts(tz, at);
  return Math.round((Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** The instant a wall-clock time happens in a zone (corrects a UTC guess by the zone's offset). */
function instantOf(tz: string, y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let at = guess - offsetMinutes(tz, new Date(guess)) * 60_000;
  // Once more, in case the guess sat on the other side of a DST change.
  at = guess - offsetMinutes(tz, new Date(at)) * 60_000;
  return new Date(at);
}

/** The next time the call happens strictly after `now`. */
export function nextOccurrence(call: Slot, now: Date = new Date()): Date {
  const today = localParts(call.tz, now);
  for (let add = 0; add <= 8; add++) {
    // Calendar arithmetic on the zone's own date, so a DST day is still one day.
    const day = new Date(Date.UTC(today.y, today.mo - 1, today.d + add));
    if (day.getUTCDay() !== call.weekday) continue;
    const at = instantOf(call.tz, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), call.hour, call.minute);
    if (at.getTime() > now.getTime()) return at;
  }
  return new Date(now.getTime() + 7 * 86_400_000);
}

function clock(tz: string, at: Date): string {
  const l = localParts(tz, at);
  const h12 = l.h % 12 || 12;
  return `${h12}${l.mi ? `:${String(l.mi).padStart(2, "0")}` : ""} ${l.h < 12 ? "AM" : "PM"}`;
}

/** "Sun 7 PM yours · 8:30 AM theirs". The far home's weekday is added only when it differs. */
export function callLabel(call: Slot, now: Date, yourTz: string, theirTz: string | null): string {
  const at = nextOccurrence(call, now);
  const you = localParts(yourTz, at);
  const mine = `${SHORT[you.wd]} ${clock(yourTz, at)} yours`;
  if (!theirTz || theirTz === yourTz) return mine;
  const them = localParts(theirTz, at);
  return `${mine} · ${them.wd === you.wd ? "" : `${SHORT[them.wd]} `}${clock(theirTz, at)} theirs`;
}

/** The zone of the far home: the host's if it differs from yours, else the first other zone. */
export function farZone(yourTz: string, hostTz: string | undefined, otherTzs: string[]): string | null {
  if (hostTz && hostTz !== yourTz) return hostTz;
  return otherTzs.find((z) => z !== yourTz) ?? null;
}

/* ------------------------------------------------------------------ ICS */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 folding: lines over 75 octets continue after CRLF + space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const sign = (m: number) => `${m < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(m) / 60))}${pad(Math.abs(m) % 60)}`;

/** A VTIMEZONE only for zones without daylight saving; calendars resolve the TZID name for the rest. */
function vtimezone(tz: string, at: Date): string[] {
  const jan = offsetMinutes(tz, new Date(Date.UTC(at.getUTCFullYear(), 0, 1)));
  const jul = offsetMinutes(tz, new Date(Date.UTC(at.getUTCFullYear(), 6, 1)));
  if (jan !== jul) return [];
  return ["BEGIN:VTIMEZONE", `TZID:${tz}`, "BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${sign(jan)}`, `TZOFFSETTO:${sign(jan)}`, `TZNAME:${tz}`, "END:STANDARD", "END:VTIMEZONE"];
}

export interface IcsOptions {
  call: Slot & { name?: string };
  familyId: string;
  now?: Date;
  /** Zones named in the description: the viewer's and the far home's. */
  yourTz: string;
  theirTz: string | null;
}

export function weeklyCallIcs(o: IcsOptions): string {
  const now = o.now ?? new Date();
  const first = nextOccurrence(o.call, now);
  const l = localParts(o.call.tz, first);
  const dt = `${pad(l.y, 4)}${pad(l.mo)}${pad(l.d)}T${pad(l.h)}${pad(l.mi)}00`;
  const title = o.call.name?.trim() || "Our weekly call";
  const desc = [`${title}, every ${WEEKDAYS[o.call.weekday]}.`, callLabel(o.call, now, o.yourTz, o.theirTz), "Open Nearer and tap Start now."].join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nearer//Weekly call//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...vtimezone(o.call.tz, first),
    "BEGIN:VEVENT",
    `UID:weekly-call-${o.familyId}@aangan`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;TZID=${o.call.tz}:${dt}`,
    `DURATION:PT${CALL_MINUTES}M`,
    `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[o.call.weekday]}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(desc)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(title)}`,
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
