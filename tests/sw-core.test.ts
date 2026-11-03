import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const sw = createRequire(import.meta.url)("../public/sw-core.js") as {
  NAV_DELAYS: number[];
  cacheablePage(p: string): boolean;
  overflow(keys: string[], cap?: number): string[];
  navigate(load: () => Promise<Response>, copy: () => Promise<Response | null>, sleep: (ms: number) => Promise<void>, delays?: number[]): Promise<{ kind: string; res?: Response }>;
};

const r = (status: number) => new Response("x", { status });
function go(seq: (number | "net")[], kept: Response | null = null) {
  const waits: number[] = [];
  let calls = 0;
  const p = sw.navigate(
    async () => {
      const s = seq[Math.min(calls++, seq.length - 1)];
      if (s === "net") throw new TypeError("offline");
      return r(s);
    },
    async () => kept,
    async (ms) => void waits.push(ms),
  );
  return { p, waits, calls: () => calls };
}

describe("service worker page navigation", () => {
  it("serves a good page at once", async () => {
    const t = go([200]);
    expect((await t.p).kind).toBe("network");
    expect(t.calls()).toBe(1);
  });

  it("retries a 503 twice (300, 900 ms) and then serves the page", async () => {
    const t = go([503, 503, 200]);
    const out = await t.p;
    expect(out.kind).toBe("network");
    expect(out.res?.status).toBe(200);
    expect(t.waits).toEqual([300, 900]);
  });

  it("falls back to the kept copy after three cut-offs", async () => {
    const copy = r(200);
    const out = await go([503], copy).p;
    expect(out.kind).toBe("copy");
    expect(out.res).toBe(copy);
  });

  it("without a copy, serves the self-retrying page, never the host's error", async () => {
    expect((await go([503]).p).kind).toBe("wait");
    expect((await go([502, "net", 504]).p).kind).toBe("wait");
  });

  it("a device with no connection at all gets the offline page", async () => {
    expect((await go(["net"]).p).kind).toBe("offline");
  });

  it("a 404 or a redirect is a real answer, not retried", async () => {
    const t = go([404]);
    expect((await t.p).kind).toBe("network");
    expect(t.calls()).toBe(1);
  });

  it("keeps app pages but not the API, the sign-in callback or public shares", () => {
    for (const p of ["/", "/home", "/signin", "/people/arjun", "/together/visits"]) expect(sw.cacheablePage(p)).toBe(true);
    for (const p of ["/api/cards", "/auth/callback", "/r/abc123"]) expect(sw.cacheablePage(p)).toBe(false);
  });

  it("caps kept pages at 30, dropping the oldest", () => {
    const keys = Array.from({ length: 33 }, (_, i) => `/p${i}`);
    expect(sw.overflow(keys)).toEqual(["/p0", "/p1", "/p2"]);
    expect(sw.overflow(keys.slice(0, 30))).toEqual([]);
  });
});
