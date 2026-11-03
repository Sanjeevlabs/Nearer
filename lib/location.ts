// Where someone is, as a city name and nothing else. Two coarse sources, both
// data services (no AI model): Cloudflare's own guess from the connection
// (request.cf), and OpenStreetMap Nominatim when someone taps "Use my location".
// Coordinates are used for one lookup and then dropped: never logged, never
// stored, never returned. Only the city text is ever kept (the existing field).
import { z } from "zod";
import { edgeGet, edgePut } from "./edge-cache";

export const WhereAmISchema = z.union([
  z.object({ city: z.string().min(1).max(60), region: z.string().max(60).optional(), country: z.string().max(60).optional(), tz: z.string().max(60).optional() }),
  z.object({}).strict(),
]);
export type WhereAmI = z.infer<typeof WhereAmISchema>;

const clean = (v: unknown, max = 60): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
  return s || undefined;
};

/** Cloudflare's coarse place for a request (its `cf` object) -> { city, region, country, tz }, or {} when it has no city. */
export function whereAmIFromCf(cf: unknown): WhereAmI {
  if (!cf || typeof cf !== "object") return {};
  const o = cf as Record<string, unknown>;
  const city = clean(o.city);
  if (!city) return {};
  const out: { city: string; region?: string; country?: string; tz?: string } = { city };
  const region = clean(o.region);
  const country = clean(o.country, 2);
  const tz = clean(o.timezone);
  if (region) out.region = region;
  if (country) out.country = country;
  if (tz) out.tz = tz;
  return out;
}

// ---------------------------------------------------------------- reverse geocode

export const ReverseSchema = z.object({ city: z.string().min(1).max(60), country: z.string().max(60).optional() });
export type ReverseResult = z.infer<typeof ReverseSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 30 * DAY_MS;
const MIN_GAP_MS = 1000;
const MAX_WAIT_MS = 3000;
const MAX_ENTRIES = 500;
export const NOMINATIM_UA = "Nearer/1.0 (+https://nearer.site)";

const memory = new Map<string, { at: number; value: ReverseResult }>();
let nextSlot = 0;

export function resetReverseState(): void {
  memory.clear();
  nextSlot = 0;
}

export interface ReverseDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Two decimals (~1 km): the cache key, and all the precision a city needs. */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100;

async function digest(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const NominatimSchema = z.object({
  address: z
    .object({
      city: z.string().optional(),
      town: z.string().optional(),
      village: z.string().optional(),
      municipality: z.string().optional(),
      city_district: z.string().optional(),
      county: z.string().optional(),
      state_district: z.string().optional(),
      country: z.string().optional(),
    })
    .passthrough(),
});

/** null = nothing usable or upstream failed (the route answers 503). */
export async function reverseGeocode(lat: number, lng: number, lang: string, deps: ReverseDeps = {}): Promise<ReverseResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const now = deps.now ?? Date.now;
  const rLat = roundCoord(lat);
  const rLng = roundCoord(lng);
  const key = `${rLat.toFixed(2)},${rLng.toFixed(2)},${lang}`;
  const hit = memory.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.value;
  const edgeKey = `geo-rev:${await digest(key)}`;
  const shared = ReverseSchema.safeParse(await edgeGet<unknown>(edgeKey));
  if (shared.success) {
    remember(key, shared.data, now());
    return shared.data;
  }

  // At most one upstream call a second from this isolate.
  const t = now();
  const wait = Math.max(0, nextSlot - t);
  if (wait > MAX_WAIT_MS) return null;
  nextSlot = t + wait + MIN_GAP_MS;
  if (wait > 0) await (deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(wait);

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.search = new URLSearchParams({ format: "jsonv2", lat: String(rLat), lon: String(rLng), zoom: "10", addressdetails: "1", "accept-language": lang }).toString();
    const res = await (deps.fetch ?? fetch)(url.toString(), { headers: { "user-agent": NOMINATIM_UA, accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const parsed = NominatimSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    const a = parsed.data.address;
    const city = clean(a.city ?? a.town ?? a.village ?? a.municipality ?? a.city_district ?? a.county ?? a.state_district);
    if (!city) return null;
    const value: ReverseResult = { city };
    const country = clean(a.country);
    if (country) value.country = country;
    remember(key, value, now());
    await edgePut(edgeKey, value, Math.floor(TTL_MS / 1000));
    return value;
  } catch {
    return null;
  }
}

function remember(key: string, value: ReverseResult, at: number): void {
  if (memory.size >= MAX_ENTRIES) memory.delete(memory.keys().next().value as string);
  memory.set(key, { at, value });
}
