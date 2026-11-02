// The sky over the other home: their weather and time of day, so the window
// feels like it opens onto *now* where they are. Pure helpers (client + server)
// plus a server fetch from Open-Meteo (free, no key). Only a city name ever
// leaves the server; nobody's location is tracked.

import { edgeGet, edgePut } from "./edge-cache";

export type SkyKind = "clear" | "clouds" | "fog" | "rain" | "storm" | "snow";
export type DayPhase = "dawn" | "day" | "dusk" | "night";

export interface Weather {
  city: string;
  tempC: number;
  kind: SkyKind;
  /** "Light rain", "Clear" — words, never an icon alone. */
  label: string;
  source: "open-meteo" | "mock";
  at: string;
  /** The Open-Meteo WMO weather_code it came from (the scene draws from this). */
  code?: number;
  /** City coordinates (for the sun's position over their home). Never a person's location. */
  lat?: number;
  lon?: number;
}

/** Coordinates for the demo and tests (no network). */
const KNOWN: Record<string, [number, number]> = {
  amritsar: [31.63, 74.87], bengaluru: [12.97, 77.59], bangalore: [12.97, 77.59], pune: [18.52, 73.86], london: [51.51, -0.13],
  delhi: [28.61, 77.21], "new delhi": [28.61, 77.21], mumbai: [19.08, 72.88], chennai: [13.08, 80.27], kolkata: [22.57, 88.36], hyderabad: [17.39, 78.49],
  jaipur: [26.91, 75.79], "new york": [40.71, -74.01], toronto: [43.65, -79.38], dubai: [25.2, 55.27], singapore: [1.35, 103.82], sydney: [-33.87, 151.21],
};

/** "Amritsar, Punjab" -> "Amritsar": the geocoder wants the place name alone. */
const nameOf = (city: string) => city.split(",")[0].trim();

/** WMO weather code → our six skies (https://open-meteo.com/en/docs). */
export function skyFromWmo(code: number): { kind: SkyKind; label: string } {
  if (code === 0) return { kind: "clear", label: "Clear" };
  if (code <= 2) return { kind: "clouds", label: "Partly cloudy" };
  if (code === 3) return { kind: "clouds", label: "Cloudy" };
  if (code === 45 || code === 48) return { kind: "fog", label: "Foggy" };
  if (code >= 51 && code <= 57) return { kind: "rain", label: "Drizzle" };
  if (code >= 61 && code <= 67) return { kind: "rain", label: code === 61 ? "Light rain" : "Rain" };
  if (code >= 71 && code <= 77) return { kind: "snow", label: "Snow" };
  if (code >= 80 && code <= 82) return { kind: "rain", label: "Showers" };
  if (code >= 85 && code <= 86) return { kind: "snow", label: "Snow showers" };
  if (code >= 95) return { kind: "storm", label: "Thunderstorm" };
  return { kind: "clouds", label: "Cloudy" };
}

export function phaseFor(hour: number): DayPhase {
  if (hour >= 5 && hour < 7.5) return "dawn";
  if (hour >= 7.5 && hour < 17) return "day";
  if (hour >= 17 && hour < 19.5) return "dusk";
  return "night";
}

/** The light over the photo: a tint that follows their clock. */
export const PHASE_TINT: Record<DayPhase, { top: string; bottom: string; lamp: boolean }> = {
  dawn: { top: "rgba(255,170,120,.38)", bottom: "rgba(255,214,170,.10)", lamp: false },
  day: { top: "rgba(150,200,255,.10)", bottom: "rgba(255,255,255,0)", lamp: false },
  dusk: { top: "rgba(250,120,70,.42)", bottom: "rgba(90,40,90,.25)", lamp: true },
  night: { top: "rgba(8,14,40,.72)", bottom: "rgba(10,10,30,.45)", lamp: true },
};

/** Deterministic stand-in so the demo and tests never need the network. */
export function mockWeather(city: string, now = new Date()): Weather {
  let h = 0;
  for (const ch of city.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const day = Math.floor(now.getTime() / 86_400_000);
  const pick = (h + day) % 5;
  const codes = [0, 2, 61, 3, 45];
  const sky = skyFromWmo(codes[pick]);
  const ll = KNOWN[nameOf(city).toLowerCase()];
  return { city, tempC: 14 + ((h >> 3) % 16), ...sky, code: codes[pick], source: "mock", at: now.toISOString(), ...(ll ? { lat: ll[0], lon: ll[1] } : {}) };
}

/** Which Amritsar: the member's country (from their time zone) and the zone itself. */
export interface PlaceHint {
  country?: string | null;
  tz?: string | null;
}

export interface GeoResult {
  latitude: number;
  longitude: number;
  country_code?: string;
  timezone?: string;
}

const tzKey = (tz: string) => (tz === "Asia/Calcutta" ? "Asia/Kolkata" : tz);

/**
 * The first geocoder match in the right country. With no country known, the
 * first match whose time zone is the member's. With neither: null (never a guess).
 */
export function pickPlace(results: GeoResult[] | undefined, hint: PlaceHint): GeoResult | null {
  const list = results ?? [];
  if (hint.country) return list.find((r) => r.country_code?.toUpperCase() === hint.country?.toUpperCase()) ?? null;
  if (hint.tz && hint.tz !== "UTC") return list.find((r) => r.timezone && tzKey(r.timezone) === tzKey(hint.tz as string)) ?? null;
  return null;
}

const CACHE = new Map<string, { at: number; w: Weather }>();
const GEO = new Map<string, { at: number; p: { lat: number; lon: number } | null }>();
// Two cache levels. This isolate's memory is checked first; behind it the data
// centre's Cache API (lib/edge-cache.ts) lets one isolate's fetch serve the
// others, which matters because most requests land on a cold isolate.
const TTL = 20 * 60_000;
const GEO_TTL = 30 * 24 * 3_600_000;
const GEO_MISS_TTL = 10 * 60_000;
const keyOf = (city: string, hint: PlaceHint) => `${city.trim().toLowerCase()}|${(hint.country ?? "").toUpperCase()}|${hint.country ? "" : (hint.tz ?? "")}`;
// The same lookup asked twice at once (the weather and the distance both want the city) is one fetch.
const GEO_FLIGHT = new Map<string, Promise<{ lat: number; lon: number } | null>>();
const WX_FLIGHT = new Map<string, Promise<Weather | null>>();

function inFlight<T>(flights: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const open = flights.get(key);
  if (open) return open;
  const p = run().finally(() => flights.delete(key));
  flights.set(key, p);
  return p;
}

/** Server only. Coordinates of a city in the member's country, cached per city + country (30 days, shared across isolates). */
export async function geocode(city: string, hint: PlaceHint = {}, fetcher: typeof fetch = fetch): Promise<{ lat: number; lon: number } | null> {
  if (!city.trim()) return null;
  const key = keyOf(city, hint);
  const hit = GEO.get(key);
  if (hit && Date.now() - hit.at < (hit.p ? GEO_TTL : GEO_MISS_TTL)) return hit.p;
  return inFlight(GEO_FLIGHT, key, async () => {
    const shared = await edgeGet<{ lat: number; lon: number }>(`geo:${key}`);
    if (shared) {
      GEO.set(key, { at: Date.now(), p: shared });
      return shared;
    }
    try {
      const geo = await fetcher(`https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&format=json&name=${encodeURIComponent(nameOf(city))}`, { signal: AbortSignal.timeout(4000) });
      if (!geo.ok) return null;
      const g = (await geo.json()) as { results?: GeoResult[] };
      const place = pickPlace(g.results, hint);
      const p = place ? { lat: place.latitude, lon: place.longitude } : null;
      GEO.set(key, { at: Date.now(), p });
      if (p) await edgePut(`geo:${key}`, p, GEO_TTL / 1000);
      return p;
    } catch {
      return null;
    }
  });
}

/** Server only. Geocode the city (in the right country), read current weather, cache 20 min (shared across isolates). */
export async function fetchWeather(city: string, hint: PlaceHint = {}, fetcher: typeof fetch = fetch): Promise<Weather | null> {
  const key = keyOf(city, hint);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.w;
  return inFlight(WX_FLIGHT, key, async () => {
    const shared = await edgeGet<Weather>(`wx:${key}`);
    // The cached reading carries the name it was first asked under; this caller's own spelling wins.
    if (shared && Date.now() - Date.parse(shared.at) < TTL) {
      const w = { ...shared, city };
      CACHE.set(key, { at: Date.parse(shared.at), w });
      return w;
    }
    try {
      const place = await geocode(city, hint, fetcher);
      if (!place) return null;
      const res = await fetcher(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const d = (await res.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
      if (typeof d.current?.temperature_2m !== "number" || typeof d.current.weather_code !== "number") return null;
      const w: Weather = { city, tempC: Math.round(d.current.temperature_2m), ...skyFromWmo(d.current.weather_code), code: d.current.weather_code, source: "open-meteo", at: new Date().toISOString(), lat: place.lat, lon: place.lon };
      CACHE.set(key, { at: Date.now(), w });
      await edgePut(`wx:${key}`, w, TTL / 1000);
      return w;
    } catch {
      return null;
    }
  });
}

/** Coordinates for the demo and tests (no network); null for a city we don't know. */
export function mockPlace(city: string): { lat: number; lon: number } | null {
  const ll = KNOWN[nameOf(city).toLowerCase()];
  return ll ? { lat: ll[0], lon: ll[1] } : null;
}
