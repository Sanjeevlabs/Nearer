import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as whereami } from "@/app/api/whereami/route";
import { GET as reverse } from "@/app/api/geocode/reverse/route";
import { clearAuthAttempts } from "@/lib/otp";
import { NOMINATIM_UA, resetReverseState, reverseGeocode, roundCoord, WhereAmISchema, whereAmIFromCf } from "@/lib/location";

beforeEach(() => {
  resetReverseState();
  clearAuthAttempts();
});
afterEach(() => vi.unstubAllEnvs());

describe("whereAmIFromCf", () => {
  it("maps a full cf object", () => {
    expect(whereAmIFromCf({ city: "Bengaluru", region: "Karnataka", country: "IN", timezone: "Asia/Kolkata", latitude: "12.97", longitude: "77.59" })).toEqual({
      city: "Bengaluru",
      region: "Karnataka",
      country: "IN",
      tz: "Asia/Kolkata",
    });
  });
  it("keeps what exists and drops the rest", () => {
    expect(whereAmIFromCf({ city: "Pune", country: "IN" })).toEqual({ city: "Pune", country: "IN" });
  });
  it("no city, no cf, or junk -> {}", () => {
    expect(whereAmIFromCf({ country: "IN" })).toEqual({});
    expect(whereAmIFromCf({ city: "  " })).toEqual({});
    expect(whereAmIFromCf(undefined)).toEqual({});
    expect(whereAmIFromCf("x")).toEqual({});
    expect(whereAmIFromCf({ city: 4 })).toEqual({});
  });
  it("never carries coordinates and always satisfies the schema", () => {
    const out = whereAmIFromCf({ city: "Oslo", latitude: "59.9", longitude: "10.7", postalCode: "0150" });
    expect(JSON.stringify(out)).not.toMatch(/59\.9|10\.7|0150|latitude/);
    expect(WhereAmISchema.safeParse(out).success).toBe(true);
  });
});

describe("/api/whereami", () => {
  it("mock mode answers {} and is never cached", async () => {
    const res = await whereami(new Request("http://x/api/whereami", { headers: { "cf-connecting-ip": "1.1.1.1" } }));
    expect(await res.json()).toEqual({});
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("is rate limited per address", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await whereami(new Request("http://x/api/whereami", { headers: { "cf-connecting-ip": "2.2.2.2" } }))).status;
    expect(last).toBe(429);
  });
  it("outside mock, reads request.cf", async () => {
    vi.stubEnv("MOCK", "false");
    const req = Object.assign(new Request("http://x/api/whereami"), { cf: { city: "Lisbon", country: "PT", timezone: "Europe/Lisbon" } });
    expect(await (await whereami(req)).json()).toEqual({ city: "Lisbon", country: "PT", tz: "Europe/Lisbon" });
  });
});

const nominatim = (address: Record<string, string>) => Response.json({ address });

describe("reverseGeocode", () => {
  const deps = (f: typeof fetch, extra: object = {}) => ({ fetch: f, sleep: async () => {}, ...extra });

  it("returns only city and country, with the right request", async () => {
    const f = vi.fn(async () => nominatim({ city: "Toronto", state: "Ontario", country: "Canada", postcode: "M5V", road: "King St" })) as unknown as typeof fetch;
    const out = await reverseGeocode(43.6532, -79.3832, "en", deps(f));
    expect(out).toEqual({ city: "Toronto", country: "Canada" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.searchParams.get("zoom")).toBe("10");
    expect(u.searchParams.get("accept-language")).toBe("en");
    expect(u.searchParams.get("lat")).toBe("43.65");
    expect(u.searchParams.get("lon")).toBe("-79.38");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(NOMINATIM_UA);
    expect(JSON.stringify(out)).not.toMatch(/43\.6|79\.3|M5V|King/);
  });
  it("falls back from city to town/village", async () => {
    const f = vi.fn(async () => nominatim({ village: "Hampi", country: "India" })) as unknown as typeof fetch;
    expect((await reverseGeocode(15.33, 76.46, "en", deps(f)))?.city).toBe("Hampi");
  });
  it("failure, bad body, or no place -> null", async () => {
    expect(await reverseGeocode(1, 1, "en", deps((async () => new Response("no", { status: 500 })) as unknown as typeof fetch))).toBeNull();
    expect(await reverseGeocode(2, 2, "en", deps((async () => { throw new Error("down"); }) as unknown as typeof fetch))).toBeNull();
    expect(await reverseGeocode(3, 3, "en", deps((async () => Response.json({ nope: 1 })) as unknown as typeof fetch))).toBeNull();
    expect(await reverseGeocode(4, 4, "en", deps((async () => nominatim({ country: "Ocean" })) as unknown as typeof fetch))).toBeNull();
  });
  it("rounds to 2 decimals and serves neighbours from cache without refetching", async () => {
    expect(roundCoord(12.97441)).toBe(12.97);
    const f = vi.fn(async () => nominatim({ city: "Bengaluru", country: "India" })) as unknown as typeof fetch;
    await reverseGeocode(12.971, 77.594, "en", deps(f));
    const again = await reverseGeocode(12.9749, 77.5949, "en", deps(f));
    expect(again?.city).toBe("Bengaluru");
    expect(f).toHaveBeenCalledTimes(1);
    await reverseGeocode(12.971, 77.594, "hi", deps(f)); // another language is another entry
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("cache expires after 30 days", async () => {
    const f = vi.fn(async () => nominatim({ city: "Pune" })) as unknown as typeof fetch;
    let t = 1_000_000;
    await reverseGeocode(18.52, 73.86, "en", deps(f, { now: () => t }));
    t += 29 * 86_400_000;
    await reverseGeocode(18.52, 73.86, "en", deps(f, { now: () => t }));
    expect(f).toHaveBeenCalledTimes(1);
    t += 2 * 86_400_000;
    await reverseGeocode(18.52, 73.86, "en", deps(f, { now: () => t }));
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("spaces upstream calls at least a second apart", async () => {
    const sleeps: number[] = [];
    const f = vi.fn(async () => nominatim({ city: "X" })) as unknown as typeof fetch;
    const d = deps(f, { now: () => 5_000, sleep: async (ms: number) => void sleeps.push(ms) });
    await reverseGeocode(10, 10, "en", d);
    await reverseGeocode(20, 20, "en", d);
    await reverseGeocode(30, 30, "en", d);
    expect(sleeps).toEqual([1000, 2000]);
  });
  it("refuses when the queue is too long", async () => {
    const f = vi.fn(async () => nominatim({ city: "X" })) as unknown as typeof fetch;
    const d = deps(f, { now: () => 5_000 });
    const out = [];
    for (let i = 0; i < 8; i++) out.push(await reverseGeocode(i * 10, 5, "en", d));
    expect(out.slice(-1)[0]).toBeNull();
  });
  it("rejects impossible coordinates", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await reverseGeocode(91, 0, "en", deps(f))).toBeNull();
    expect(await reverseGeocode(NaN, 0, "en", deps(f))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("logs nothing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await reverseGeocode(50.11, 8.68, "en", deps((async () => new Response("x", { status: 500 })) as unknown as typeof fetch));
    await reverseGeocode(50.12, 8.69, "en", deps((async () => nominatim({ city: "Frankfurt" })) as unknown as typeof fetch));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});

describe("/api/geocode/reverse", () => {
  const get = (qs: string, ip = "3.3.3.3") => reverse(new Request(`http://x/api/geocode/reverse${qs}`, { headers: { "cf-connecting-ip": ip } }));
  it("rejects missing or bad coordinates with 400", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?lat=abc&lng=1")).status).toBe(400);
    expect((await get("?lat=95&lng=1")).status).toBe(400);
  });
  it("mock mode answers 503 so the UI keeps the connection guess, and echoes no coordinates", async () => {
    const res = await get("?lat=12.97&lng=77.59");
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/12\.97|77\.59/);
  });
  it("is rate limited per address", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await get("?lat=1&lng=1", "4.4.4.4")).status;
    expect(last).toBe(429);
  });
});
