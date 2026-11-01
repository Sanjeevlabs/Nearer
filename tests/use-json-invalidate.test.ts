// A write that changes a list invalidates the client cache and makes the lists
// on screen refetch; sign-in, sign-out and family switches clear every cached
// copy (memory, sessionStorage) so nothing deleted or foreign can come back.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearJsonCache, invalidateJson, isChangingWrite, readCache, revalidate, subscribeInvalidate, watchWrites } from "@/lib/use-json";

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

describe("which writes count as a change", () => {
  it("POST/PUT/PATCH/DELETE on /api/ do; GET and the open-the-app heartbeat do not", () => {
    expect(isChangingWrite("/api/cards", "POST", "{}")).toBe(true);
    expect(isChangingWrite("/api/reactions", "DELETE", "{}")).toBe(true);
    expect(isChangingWrite("/api/suggestions/abc/approve", "POST", "{}")).toBe(true);
    expect(isChangingWrite("/api/plays", "POST", "{}")).toBe(true);
    expect(isChangingWrite("/api/cards", "GET", undefined)).toBe(false);
    expect(isChangingWrite("/api/cards", undefined, undefined)).toBe(false);
    expect(isChangingWrite("/api/presence", "POST", JSON.stringify({ moment: "here" }))).toBe(false);
    expect(isChangingWrite("/api/presence", "POST", JSON.stringify({ moment: "chai", note: "" }))).toBe(true);
    expect(isChangingWrite("/api/transcribe", "POST", "x")).toBe(false);
    expect(isChangingWrite("https://elsewhere.example/upload", "PUT", "x")).toBe(false);
  });
});

describe("invalidateJson", () => {
  let events: string[];
  let target: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    clearJsonCache();
    events = [];
    target = new EventTarget();
    target.addEventListener("aangan:changed", () => events.push("changed"));
    vi.stubGlobal("window", target);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drops every cached payload at once, then tells mounted readers once (coalesced)", async () => {
    await revalidate("/api/cards", ok({ cards: [{ id: "deleted-later" }] }));
    await revalidate("/api/today", ok({ n: 1 }));
    let refetches = 0;
    const off = subscribeInvalidate(() => refetches++);
    invalidateJson();
    invalidateJson();
    invalidateJson();
    expect(readCache("/api/cards")).toBeNull();
    expect(readCache("/api/today")).toBeNull();
    expect(refetches).toBe(0);
    vi.advanceTimersByTime(250);
    expect(refetches).toBe(1);
    expect(events).toEqual(["changed"]);
    off();
    invalidateJson();
    vi.advanceTimersByTime(250);
    expect(refetches).toBe(1);
  });

  it("a successful write through fetch invalidates; a read, a failed write and the heartbeat do not", async () => {
    const calls: string[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response("{}", { status: url.includes("fail") ? 500 : 200 });
    }) as unknown as typeof fetch;
    (target as unknown as { fetch: typeof fetch }).fetch = base;
    const undo = watchWrites();
    const f = (target as unknown as { fetch: typeof fetch }).fetch;
    let refetches = 0;
    subscribeInvalidate(() => refetches++);
    const prime = () => revalidate("/api/cards", ok({ cards: [] }));

    await prime();
    await f("/api/cards", { method: "POST", body: "{}" });
    expect(readCache("/api/cards")).toBeNull();
    vi.advanceTimersByTime(250);
    expect(refetches).toBe(1);

    await prime();
    await f("/api/cards");
    await f("/api/fail", { method: "POST", body: "{}" });
    await f("/api/presence", { method: "POST", body: JSON.stringify({ moment: "here" }) });
    expect(readCache("/api/cards")).not.toBeNull();
    vi.advanceTimersByTime(250);
    expect(refetches).toBe(1);

    undo();
  });

  it("a 401 (the session is gone) clears the cache so the next person never sees it", async () => {
    (target as unknown as { fetch: typeof fetch }).fetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const undo = watchWrites();
    await revalidate("/api/cards", ok({ cards: [{ id: "a" }] }));
    await (target as unknown as { fetch: typeof fetch }).fetch("/api/window");
    expect(readCache("/api/cards")).toBeNull();
    undo();
  });
});

describe("every path that changes who is signed in, or which family, tells the app", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (n === "api" || n === "node_modules") return [];
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  const sources = [...files("app"), ...files("components")].map((p) => ({ p, s: readFileSync(p, "utf8") }));

  it("each file that signs in, out, switches person or family dispatches aangan:auth", () => {
    const changers = /fetch\("\/api\/session(\/switch)?"|fetch\("\/api\/auth\/verify"|"\/api\/sides", \{ action: "switch"|"\/api\/privacy\/membership"/;
    const hits = sources.filter(({ s }) => changers.test(s));
    expect(hits.length).toBeGreaterThanOrEqual(6);
    const silent = hits.filter(({ s }) => !s.includes('"aangan:auth"')).map(({ p }) => p);
    expect(silent).toEqual([]);
  });

  it("a full-page reload to / after a family change is preceded by the dispatch (sessionStorage survives reloads)", () => {
    const reloaders = sources.filter(({ s }) => s.includes('window.location.assign("/")'));
    expect(reloaders.length).toBeGreaterThan(0);
    for (const { p, s } of reloaders) expect(s, p).toContain('"aangan:auth"');
  });
});
