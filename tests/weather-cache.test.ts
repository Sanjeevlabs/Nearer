// The sky is cached twice: in the isolate, and in the data centre's Cache API so
// a cold isolate does not refetch what its neighbour just read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakeEdge() {
  const store = new Map<string, Response>();
  return {
    store,
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res.clone()),
    },
  };
}

function fakeNetwork() {
  const urls: string[] = [];
  const fetcher = (async (url: string) => {
    urls.push(url);
    if (url.includes("geocoding")) return Response.json({ results: [{ latitude: 31.63, longitude: 74.87, country_code: "IN", timezone: "Asia/Kolkata" }] });
    return Response.json({ current: { temperature_2m: 28.4, weather_code: 0 } });
  }) as unknown as typeof fetch;
  return { urls, fetcher };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("weather cache", () => {
  it("a second isolate (empty memory) is served from the shared cache without touching the network", async () => {
    const edge = fakeEdge();
    vi.stubGlobal("caches", edge);
    const net = fakeNetwork();
    const first = await import("@/lib/weather");
    const a = await first.fetchWeather("Amritsar", { country: "IN" }, net.fetcher);
    expect(a?.tempC).toBe(28);
    expect(net.urls.length).toBe(2); // geocode + forecast

    vi.resetModules(); // another isolate: same data centre cache, fresh memory
    const second = await import("@/lib/weather");
    const net2 = fakeNetwork();
    const b = await second.fetchWeather("Amritsar", { country: "IN" }, net2.fetcher);
    expect(net2.urls).toEqual([]);
    expect(b).toMatchObject({ city: "Amritsar", tempC: 28, kind: "clear", lat: 31.63, lon: 74.87 });
    expect(await second.geocode("Amritsar", { country: "IN" }, net2.fetcher)).toEqual({ lat: 31.63, lon: 74.87 });
    expect(net2.urls).toEqual([]);
  });

  it("keeps coordinates for 30 days and the reading for 20 minutes", async () => {
    const edge = fakeEdge();
    vi.stubGlobal("caches", edge);
    const w = await import("@/lib/weather");
    await w.fetchWeather("Pune", { country: "IN" }, fakeNetwork().fetcher);
    const ages = Object.fromEntries([...edge.store].map(([url, res]) => [decodeURIComponent(url).includes("geo:") ? "geo" : "wx", res.headers.get("cache-control")]));
    expect(ages).toEqual({ geo: `public, max-age=${30 * 24 * 3600}`, wx: "public, max-age=1200" });
  });

  it("works with no Cache API at all (Node, tests), and with one that throws", async () => {
    const net = fakeNetwork();
    const w = await import("@/lib/weather");
    expect((await w.fetchWeather("Delhi", { country: "IN" }, net.fetcher))?.kind).toBe("clear");
    vi.stubGlobal("caches", { default: { match: async () => Promise.reject(new Error("boom")), put: async () => Promise.reject(new Error("boom")) } });
    vi.resetModules();
    const w2 = await import("@/lib/weather");
    expect((await w2.fetchWeather("Jaipur", { country: "IN" }, fakeNetwork().fetcher))?.kind).toBe("clear");
  });

  it("asks the network once when the weather and the distance want the same city at the same time", async () => {
    const net = fakeNetwork();
    const w = await import("@/lib/weather");
    await Promise.all([w.fetchWeather("Chennai", { country: "IN" }, net.fetcher), w.geocode("Chennai", { country: "IN" }, net.fetcher)]);
    expect(net.urls.filter((u) => u.includes("geocoding")).length).toBe(1);
  });

  it("the holiday feed is shared the same way", async () => {
    vi.stubGlobal("caches", fakeEdge());
    const { edgePut } = await import("@/lib/edge-cache");
    const items = [{ key: "diwali", title: "Diwali", date: "2026-11-08", kind: "festival", ritual: null, lampHour: 18 }];
    await edgePut("holidays:IN", { items, source: "google" }, 86_400);
    const fetchSpy = vi.fn(async () => Promise.reject(new Error("must not be called")));
    vi.stubGlobal("fetch", fetchSpy);
    const { holidaysFor } = await import("@/lib/holidays");
    const out = await holidaysFor("IN", { live: true });
    expect(out).toEqual({ items, source: "google" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
