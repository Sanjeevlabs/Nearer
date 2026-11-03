// The first screen of a brand-new family (one person, no cards, no far home): every request it makes
// answers 200 with an empty-state shape, and nothing it waits on can wait forever.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as verifyAuth } from "@/app/api/auth/verify/route";
import { GET as courtyard } from "@/app/api/courtyard/route";
import { GET as cards } from "@/app/api/cards/route";
import { GET as albums } from "@/app/api/albums/route";
import { GET as lane } from "@/app/api/lane/route";
import { GET as windowRoute } from "@/app/api/window/route";
import { GET as waiting } from "@/app/api/waiting/route";
import { GET as session } from "@/app/api/session/route";
import { fetchFirst } from "@/lib/early";
import { COURTYARD_PATIENCE_MS, courtyardFailed, courtyardReady, everyoneView, fetchWithTimeout, raceTimeout, REQUEST_TIMEOUT_MS } from "@/lib/first-screen";
import { peopleByRecency } from "@/lib/people";
import { clearAuthAttempts, MOCK_OTP } from "@/lib/otp";
import { resetDemo } from "@/lib/store";
import type { Member } from "@/lib/schemas";

const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let cookie = "";

beforeEach(async () => {
  resetDemo();
  clearAuthAttempts();
  const res = await verifyAuth(post("http://t/api/auth/verify", { email: `solo${Date.now()}@example.com`, code: MOCK_OTP, tz: "Asia/Kolkata", birthday: "03-14", city: "Bengaluru", intent: { type: "create", familyName: "Rao", firstName: "Asha" } }));
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
});
afterEach(() => vi.useRealTimers());

const get = (path: string) => new Request(`http://t${path}`, { headers: { cookie } });

describe("a one-person family's first screen", () => {
  it("every first-screen API answers 200 fast, with an empty-state shape", async () => {
    const t0 = Date.now();
    const [s, c, k, w, wait, a, l] = await Promise.all([
      session(get("/api/session?family=1")),
      courtyard(get("/api/courtyard")),
      cards(get("/api/cards")),
      windowRoute(get("/api/window")),
      waiting(get("/api/waiting")),
      albums(get("/api/albums")),
      lane(get("/api/lane")),
    ]);
    expect([s, c, k, w, wait, a, l].map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    expect(Date.now() - t0).toBeLessThan(2000);
    const who = (await s.json()) as { members: Member[]; relationships: unknown[]; status: string };
    expect(who.status).toBe("active");
    expect(who.members).toHaveLength(1);
    expect(who.relationships).toEqual([]);
    expect(((await k.json()) as { cards: unknown[] }).cards).toEqual([]);
    const win = (await w.json()) as { far: unknown; people: unknown[]; moments: unknown[] };
    expect(win.far).toBeNull();
    expect(win.people).toEqual([]);
    expect(((await wait.json()) as { items: unknown[] }).items).toEqual([]);
    expect(((await a.json()) as { albums: unknown[] }).albums).toEqual([]);
    expect(((await l.json()) as { elsewhere: unknown[] }).elsewhere).toEqual([]);
    const yard = (await c.json()) as Record<string, unknown>;
    // The slices the courtyard's hooks read, all there (a missing one would send its hook to fetch alone).
    for (const key of ["sides", "safety", "events", "today", "suggestions", "letters", "presence", "together", "sit", "festivalWeek", "habits", "kidAsk", "bedtime"]) expect(yard).toHaveProperty(key);
    expect(yard.presence).toEqual({ presence: [], settings: [] });
    expect(yard.suggestions).toEqual({ suggestions: [] });
  });

  it("nobody but you is on the Everyone row: the way to add your family shows instead", async () => {
    const me = ((await (await session(get("/api/session?family=1"))).json()) as { members: Member[] }).members;
    const others = peopleByRecency(me[0].id, me, []);
    expect(others).toEqual([]);
    expect(everyoneView(others.length, false, false)).toBe("empty");
  });
});

describe("loading flags resolve", () => {
  it("the courtyard shows its body once cards and payload are in, or after the patience, whichever is first", () => {
    expect(courtyardReady({ cardsLoaded: false, status: "loading", waitedMs: 0 })).toBe(false);
    expect(courtyardReady({ cardsLoaded: true, status: "loading", waitedMs: 0 })).toBe(false);
    expect(courtyardReady({ cardsLoaded: false, status: "ok", waitedMs: 0 })).toBe(false);
    expect(courtyardReady({ cardsLoaded: true, status: "ok", waitedMs: 0 })).toBe(true);
    // Outside the provider there is no payload to wait for.
    expect(courtyardReady({ cardsLoaded: true, status: null, waitedMs: 0 })).toBe(true);
    // A failed payload counts as in (the hooks fetch for themselves).
    expect(courtyardReady({ cardsLoaded: true, status: "failed", waitedMs: 0 })).toBe(true);
    // Never an endless skeleton: whatever is still missing, the body shows after the patience.
    expect(courtyardReady({ cardsLoaded: false, status: "loading", waitedMs: COURTYARD_PATIENCE_MS })).toBe(true);
  });

  it("the Everyone row never stays on chips-loading once presence has answered or failed", () => {
    expect(everyoneView(3, false, false)).toBe("chips-loading");
    expect(everyoneView(3, true, false)).toBe("chips");
    expect(everyoneView(3, false, true)).toBe("chips");
    expect(everyoneView(0, false, false)).toBe("empty");
  });

  it("an unreachable family says so (with Retry) instead of staying blank", () => {
    expect(courtyardFailed("failed", false)).toBe(true);
    expect(courtyardFailed("ok", true)).toBe(true);
    expect(courtyardFailed("ok", false)).toBe(false);
    expect(courtyardFailed(null, false)).toBe(false);
  });
});

describe("a request that never answers ends", () => {
  it("raceTimeout rejects, and does not outlive an answer", async () => {
    vi.useFakeTimers();
    const never = new Promise<number>(() => undefined);
    const p = raceTimeout(never, 1000);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await caught).toBe("timeout");
    expect(await raceTimeout(Promise.resolve(7), 1000)).toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetchWithTimeout aborts a stalled request", async () => {
    vi.useFakeTimers();
    const stalled = ((_: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    const p = fetchWithTimeout(stalled, "/api/x", {}, 500).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe("aborted");
  });

  it("fetchFirst (the session, the cards, the courtyard) gives up on a hung server in about REQUEST_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", ((_: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch);
    const p = fetchFirst("/api/cards").then(
      () => "answered",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 100);
    expect(await p).toBe("aborted");
    vi.unstubAllGlobals();
  });
});
