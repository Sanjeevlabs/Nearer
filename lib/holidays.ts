// Festival and national-day dates for a family's country, from Google's
// PUBLIC holiday calendar (an iCal feed, no key, no personal data sent),
// mapped to traditions by data/traditions.json. Cached in memory for 24 h;
// a 4 s timeout; the bundled data/holidays-fallback.json fills in when the
// fetch fails, in MOCK mode, and for any festival the feed lacks that year
// (a country's calendar rarely lists every tradition's festivals).
// Nothing here names a festival or a culture: names, patterns and URLs are data.
import fallbackRaw from "../data/holidays-fallback.json";
import { edgeGet, edgePut } from "./edge-cache";
import traditionsRaw from "../data/traditions.json";
import { z } from "zod";
import { isMockMode } from "./config";

const PatternSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  match: z.string().min(1),
  title: z.string().min(1),
  traditions: z.array(z.string()).default([]),
  /** Country code: a national day of that country, shown to every family there. */
  national: z.string().optional(),
  ritual: z.string().optional(),
  lampHour: z.number().int().min(0).max(23).optional(),
});
const TraditionsDataSchema = z.object({
  traditions: z.array(z.object({ id: z.string(), label: z.string(), exclusive: z.boolean().optional() })),
  defaultCountry: z.string(),
  calendars: z.record(z.object({ name: z.string(), ics: z.string().url() })),
  zones: z.array(z.object({ match: z.string(), country: z.string() })),
  patterns: z.array(PatternSchema),
});
const DatedName = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string() });
const FallbackSchema = z.object({ festivals: z.array(DatedName), national: z.record(z.array(DatedName)) });

export const TRADITIONS_DATA = TraditionsDataSchema.parse(traditionsRaw);
const FALLBACK = FallbackSchema.parse(fallbackRaw);
const PATTERNS = TRADITIONS_DATA.patterns.map((p) => ({ ...p, re: new RegExp(p.match, "i") }));

export const DEFAULT_LAMP_HOUR = 19;

export interface TraditionChoice {
  id: string;
  label: string;
  exclusive: boolean;
}
export function traditionChoices(): TraditionChoice[] {
  return TRADITIONS_DATA.traditions.map((t) => ({ id: t.id, label: t.label, exclusive: Boolean(t.exclusive) }));
}

export interface HolidayItem {
  /** Stable key from data/traditions.json (also the ritual-run slug). */
  key: string;
  date: string;
  title: string;
  kind: "festival" | "national";
  traditions: string[];
  /** Linked rituals/*.json slug, if any. */
  ritual: string | null;
  /** Local hour every home lights its lamp (festivals only). */
  lampHour: number | null;
}

export type HolidaySource = "google" | "fallback";

export interface IcsEvent {
  date: string;
  summary: string;
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

/**
 * Minimal iCal reader for all-day VEVENTs: unfolds continuation lines, then
 * takes DTSTART (VALUE=DATE or a date-time; only the date is kept) and
 * SUMMARY. Anything else is ignored; an event missing either is skipped.
 */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: IcsEvent[] = [];
  let cur: { date?: string; summary?: string } | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.date && cur.summary) out.push({ date: cur.date, summary: cur.summary });
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0].toUpperCase();
    const value = line.slice(colon + 1);
    if (name === "DTSTART") {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
      if (m) cur.date = `${m[1]}-${m[2]}-${m[3]}`;
    } else if (name === "SUMMARY") {
      cur.summary = unescapeText(value);
    }
  }
  return out;
}

/** Map named dates to holiday items for a country. Unmatched names are dropped; duplicates (key + date) merge. */
export function mapHolidays(events: IcsEvent[], country: string): HolidayItem[] {
  const seen = new Map<string, HolidayItem>();
  for (const e of events) {
    const p = PATTERNS.find((x) => (x.national ? x.national === country : true) && x.re.test(e.summary));
    if (!p) continue;
    const id = `${p.key}:${e.date}`;
    if (seen.has(id)) continue;
    const national = Boolean(p.national);
    seen.set(id, {
      key: p.key,
      date: e.date,
      title: p.title,
      kind: national ? "national" : "festival",
      traditions: p.traditions,
      ritual: p.ritual ?? null,
      lampHour: national ? null : (p.lampHour ?? DEFAULT_LAMP_HOUR),
    });
  }
  return Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/** The most common country among the members' time zones (data/traditions.json zones); the default when none match. */
export function countryForZones(zones: string[]): string {
  const counts = new Map<string, number>();
  for (const tz of zones) {
    const z = TRADITIONS_DATA.zones.find((x) => new RegExp(x.match).test(tz));
    if (z) counts.set(z.country, (counts.get(z.country) ?? 0) + 1);
  }
  let best = TRADITIONS_DATA.defaultCountry;
  let n = 0;
  counts.forEach((k, c) => {
    if (k > n) [best, n] = [c, k];
  });
  return best;
}

export function countryName(country: string): string {
  return TRADITIONS_DATA.calendars[country]?.name ?? country;
}

function fallbackEvents(country: string, kinds: "all" | "festivals"): IcsEvent[] {
  const festivals = FALLBACK.festivals.map((f) => ({ date: f.date, summary: f.name }));
  if (kinds === "festivals") return festivals;
  return [...festivals, ...(FALLBACK.national[country] ?? []).map((f) => ({ date: f.date, summary: f.name }))];
}

/** Feed items plus any bundled festival the feed lacks in that year. */
export function mergeWithFallback(feed: HolidayItem[], country: string): HolidayItem[] {
  const have = new Set(feed.map((h) => `${h.key}:${h.date.slice(0, 4)}`));
  const extra = mapHolidays(fallbackEvents(country, "festivals"), country).filter((h) => !have.has(`${h.key}:${h.date.slice(0, 4)}`));
  return [...feed, ...extra].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

const DAY_MS = 86_400_000;
const TTL_MS = DAY_MS;
const FAIL_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 4000;
const cache = new Map<string, { at: number; ttl: number; items: HolidayItem[]; source: HolidaySource }>();

export function resetHolidayCache(): void {
  cache.clear();
}

export interface HolidayDeps {
  fetchText?: (url: string, signal: AbortSignal) => Promise<string>;
  now?: number;
  /** Tests: force the network path even in MOCK mode. */
  live?: boolean;
}

async function defaultFetch(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal, headers: { accept: "text/calendar" } });
  if (!res.ok) throw new Error(`holidays-${res.status}`);
  return res.text();
}

/** Holidays for a country: Google's public calendar (cached 24 h), else the bundled list. */
export async function holidaysFor(country: string, deps: HolidayDeps = {}): Promise<{ items: HolidayItem[]; source: HolidaySource }> {
  const now = deps.now ?? Date.now();
  const hit = cache.get(country);
  if (hit && now - hit.at < hit.ttl) return { items: hit.items, source: hit.source };
  const fallback = () => ({ items: mapHolidays(fallbackEvents(country, "all"), country), source: "fallback" as const });
  const cal = TRADITIONS_DATA.calendars[country];
  if (!cal || (isMockMode() && !deps.live && !deps.fetchText)) {
    const fb = fallback();
    cache.set(country, { at: now, ttl: TTL_MS, ...fb });
    return fb;
  }
  // Another isolate in this data centre may have read the feed already (a cold isolate otherwise waits on Google).
  if (!deps.fetchText) {
    const shared = await edgeGet<{ items: HolidayItem[]; source: HolidaySource }>(`holidays:${country}`);
    if (shared?.items?.length) {
      cache.set(country, { at: now, ttl: TTL_MS, ...shared });
      return shared;
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const text = await (deps.fetchText ?? defaultFetch)(cal.ics, ctrl.signal);
    const events = parseIcs(text);
    if (events.length === 0) throw new Error("holidays-empty");
    const items = mergeWithFallback(mapHolidays(events, country), country);
    cache.set(country, { at: now, ttl: TTL_MS, items, source: "google" });
    if (!deps.fetchText) await edgePut(`holidays:${country}`, { items, source: "google" }, TTL_MS / 1000);
    return { items, source: "google" };
  } catch {
    const fb = fallback();
    // Retry the feed within the hour rather than stalling every request.
    cache.set(country, { at: now, ttl: FAIL_TTL_MS, ...fb });
    return fb;
  } finally {
    clearTimeout(timer);
  }
}
