// The words on the first screen. Pure (client + server), so each sentence can be
// tested: every one states only what the data says, and says nothing when the
// data is missing (no weather fetched, no lamp lit, nothing shared yet).
import { FADE_HOURS } from "./lamp";
import type { SafetyCheckin } from "./kinds";
import { answeredAt } from "./safety";
import type { Weather } from "./weather";

function localDay(at: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** "today", "yesterday", else the weekday ("Friday") in that zone. Never "N days ago". */
export function dayWord(iso: string, now: Date, tz: string): string {
  const at = new Date(iso);
  const day = localDay(at, tz);
  if (day === localDay(now, tz)) return "today";
  if (day === localDay(new Date(now.getTime() - 86_400_000), tz)) return "yesterday";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(at);
  } catch {
    return "";
  }
}

/** "9:12 AM" in that zone. */
export function clockWord(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * "Lit by Maa, Friday": only when a lamp was really lit and is still glowing
 * (it fades over three days of silence). null otherwise: the row then just
 * offers the button. This is who lit it and which day, never a last-seen clock.
 */
export function lampLine(last: { litAt: string | null; litBy: string | null } | undefined, who: string, now: Date, tz: string): string | null {
  if (!last?.litAt) return null;
  const hours = (now.getTime() - Date.parse(last.litAt)) / 3_600_000;
  if (hours < 0 || hours > FADE_HOURS) return null;
  return `Lit by ${who || "someone"}, ${dayWord(last.litAt, now, tz)}`;
}

/** The lamp row's line: "Lit by Maa · 2 h ago" while it is lit (within a day), else "Not lit yet today". */
export function lampToday(last: { litAt: string | null } | undefined, who: string, now: Date): { lit: boolean; line: string } {
  const hours = last?.litAt ? (now.getTime() - Date.parse(last.litAt)) / 3_600_000 : Infinity;
  if (!(hours >= 0 && hours < 24)) return { lit: false, line: "Not lit yet today" };
  const ago = hours < 1 ? "just now" : `${Math.floor(hours)} h ago`;
  return { lit: true, line: `Lit by ${who || "someone"} · ${ago}` };
}

/** "Chai · 6:40 AM"-style facts for one shared moment. */
export interface DayMoment {
  label: string;
  note: string;
  at: string;
}

/** What a safety check-in said, as one or two timed events (it was made, and it was closed). */
export function checkinEvents(c: Pick<SafetyCheckin, "kind" | "at" | "closedAt"> & { noReply?: boolean }): { at: string; label: string }[] {
  const made: Record<string, string> = { heading: "Heading home", journey: "Travelling", help: "Asked for help", "out-late": "Out late", "home-safe": "Home safe" };
  const closed: Record<string, string> = { heading: "Home safe", journey: "Landed safe", help: "Okay now", "out-late": "Home safe", "home-safe": "Home safe" };
  const out = [{ at: c.at, label: made[c.kind] ?? "Checked in" }];
  if (answeredAt(c) && c.closedAt !== c.at && c.kind !== "home-safe") out.push({ at: c.closedAt as string, label: closed[c.kind] ?? "Closed" });
  return out;
}

/**
 * The line under the photo. Only facts: the latest thing shared today (with its
 * time) and the fetched weather. No weather fetched: it says nothing about the
 * sky. Nothing at all to say: an empty string, and the page shows no line.
 */
export function composedLine(input: { who: string; moment: { label: string; at: string } | null; weather: Weather | null; city: string; tz: string }): string {
  const parts: string[] = [];
  if (input.moment) parts.push(`Latest from ${input.who || "them"}: ${input.moment.label.toLowerCase()}, ${clockWord(input.moment.at, input.tz)}.`);
  if (input.weather) parts.push(`${input.weather.label}, ${input.weather.tempC}°C${input.city ? ` in ${input.city}` : ""}.`);
  return parts.join(" ");
}

/** The small badge on the photo: their time always; the weather only if it was fetched; a glyph only by the sun's real place. */
export function badgeParts(input: { time: string; weather: Weather | null; glyph: "sun" | "moon" | null }): { time: string; weather: { kind: Weather["kind"]; tempC: number; label: string } | null; glyph: "sun" | "moon" | null } {
  return { time: input.time, weather: input.weather ? { kind: input.weather.kind, tempC: input.weather.tempC, label: input.weather.label } : null, glyph: input.glyph };
}
