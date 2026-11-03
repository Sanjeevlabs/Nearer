// The words on the first screen. Pure (client + server), so each sentence can be
// tested: every one states only what the data says, and says nothing when the
// data is missing (no weather fetched, no lamp lit, nothing shared yet).
import { dateInZone, clockInZone, zonedFormatter } from "./time-format";
import { FADE_HOURS, LAMP_ARRIVED_HOURS, LAMP_GLOW_HOURS } from "./lamp";
import type { SafetyCheckin } from "./kinds";
import { answeredAt } from "./safety";
import type { Weather } from "./weather";

const weekdayInZone = zonedFormatter("en-US", { weekday: "long" });

function localDay(at: Date, tz: string): string {
  try {
    return dateInZone(tz).format(at);
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
    return weekdayInZone(tz).format(at);
  } catch {
    return "";
  }
}

/** "9:12 AM" in that zone. */
export function clockWord(iso: string, tz: string): string {
  try {
    return clockInZone(tz).format(new Date(iso));
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

/** "2 h", "1 h 20 m", "45 m": time left on the glow, never a bare "0". */
export function glowLeft(litAt: string, now: Date, hours = LAMP_GLOW_HOURS): string {
  const mins = Math.max(1, Math.ceil(hours * 60 - (now.getTime() - Date.parse(litAt)) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h} h ${m} m` : h ? `${h} h` : `${m} m`;
}

/** The lamp's invitation, when it is not lit. */
export const LAMP_ASK = "Light the lamp — they’ll know you’re thinking of them";

/** The lamp's one-line explanation, for the small "?" sheet. */
export const lampWhy = (hours = LAMP_GLOW_HOURS) => `Tap the lamp to say you’re thinking of them. It glows in their window for ${hours} hours. Only a tap lights it, never a voice memory or a photo.`;

/**
 * The lamp's single line. Whoever lit it last, while it still glows:
 * "Glowing for Maa · 1 h 20 m" (you lit it) / "Maa lit it for you · 8:10 AM",
 * else the invitation. `felt`: the sender also sees "Maa saw it · 7:12 AM". Clocks are in the viewer's zone.
 */
export function lampState(i: {
  theirs: { litAt: string | null; litBy: string | null } | undefined;
  mine: { litAt: string | null; litBy: string | null } | undefined;
  viewerId: string;
  nameOf: (id: string) => string;
  /** First name of the person at the window ("Maa"), for "Glowing for Maa". */
  forName?: string;
  felt: { by: string; at: string } | null;
  now: Date;
  tz: string;
}): { lit: boolean; line: string; felt: string | null } {
  const fresh = (l?: { litAt: string | null; litBy: string | null }) => {
    if (!l?.litAt || !l.litBy) return null;
    const h = (i.now.getTime() - Date.parse(l.litAt)) / 3_600_000;
    return h >= 0 && h < LAMP_GLOW_HOURS ? { at: l.litAt, by: l.litBy } : null;
  };
  const cands = [fresh(i.theirs), fresh(i.mine)].filter((x): x is { at: string; by: string } => Boolean(x)).sort((a, b) => b.at.localeCompare(a.at));
  const last = cands[0];
  if (!last) return { lit: false, line: LAMP_ASK, felt: null };
  if (last.by === i.viewerId) {
    const felt = i.felt && i.felt.at >= last.at ? `${i.nameOf(i.felt.by) || "They"} saw it · ${clockWord(i.felt.at, i.tz)}` : null;
    return { lit: true, line: `Glowing for ${i.forName || "them"} · ${glowLeft(last.at, i.now)}`, felt };
  }
  return { lit: true, line: `${i.nameOf(last.by) || "Someone"} lit it for you · ${clockWord(last.at, i.tz)}`, felt: null };
}

/** "Same moon tonight · 49%": only at night at their end, with the real figure. */
export function moonLine(visible: boolean, city: string, illumination: number): string | null {
  if (!visible || !city) return null;
  return `Same moon tonight · ${Math.round(illumination * 100)}%`;
}

/**
 * Their day, one row per person at the window: literal facts only. The latest thing they
 * chose to share today ("Maa · chai, 7:10 AM"), else "nothing shared yet today". A safety
 * check-in they made themselves that is overdue or asked for help comes first. Nothing is
 * read from when they opened Nearer, the lamp, the clock or silence: no "all good", no
 * "asleep", no "quiet since".
 */
export function theirDayRows(
  people: { id: string; name: string; tz: string; latest: { label: string; at: string } | null; alarm?: string | null }[],
): { id: string; text: string; alarm: boolean }[] {
  return people.map((p) => {
    if (p.alarm) return { id: p.id, text: `${p.name} \u00b7 ${p.alarm}`, alarm: true };
    if (p.latest) return { id: p.id, text: `${p.name} \u00b7 ${p.latest.label.toLowerCase()}, ${clockWord(p.latest.at, p.tz)}`, alarm: false };
    return { id: p.id, text: `${p.name} \u00b7 nothing shared yet today`, alarm: false };
  });
}

/** "It's 11:40 PM in Amritsar": a place's local time, nothing read into it. */
export function localTimeLine(tz: string, place: string, now: Date = new Date()): string {
  const t = clockWord(now.toISOString(), tz);
  return place ? `It's ${t} in ${place}` : `It's ${t} there`;
}

/** The first person's own name, for lines about one person ("Maa", never "Maa, Papa"). */
export function firstNameOf(names: string[]): string {
  return (names[0] ?? "").trim().split(/[\s,&]+/)[0] ?? "";
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

/**
 * A light that arrived while the viewer was away: "Arjun is thinking of you", shown once for
 * LAMP_ARRIVED_HOURS after it was lit (the glow itself is shorter). null when there is none or it is too old.
 */
export function arrivedLine(arrived: { from: string; at: string } | null | undefined, nameOf: (id: string) => string, now: Date): string | null {
  if (!arrived) return null;
  const h = (now.getTime() - Date.parse(arrived.at)) / 3_600_000;
  if (!(h >= 0 && h < LAMP_ARRIVED_HOURS)) return null;
  return `${nameOf(arrived.from) || "Someone"} is thinking of you`;
}
