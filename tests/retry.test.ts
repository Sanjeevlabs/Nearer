import { describe, expect, it } from "vitest";
import { RETRY_DELAYS_MS, RETRY_JITTER_MS, fetchGet, isRetryableStatus, retryDelay, retryGet, shouldRetry } from "@/lib/retry";

const res = (status: number) => new Response(status === 200 ? "{}" : "x", { status });
const run = (statuses: (number | "net")[], opts: Parameters<typeof retryGet>[1] = {}) => {
  const waits: number[] = [];
  let calls = 0;
  const p = retryGet(
    async () => {
      const s = statuses[Math.min(calls++, statuses.length - 1)];
      if (s === "net") throw new TypeError("Failed to fetch");
      return res(s);
    },
    { sleep: async (ms) => void waits.push(ms), random: () => 0, ...opts },
  );
  return { p, waits, calls: () => calls };
};

describe("retry policy", () => {
  it("retries only the host's failures", () => {
    for (const s of [502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [200, 201, 301, 400, 401, 403, 404, 408, 409, 422, 429, 500, 501]) expect(isRetryableStatus(s)).toBe(false);
  });

  it("never retries writes", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(shouldRetry(503, 0, m)).toBe(false);
      expect(shouldRetry("network", 0, m)).toBe(false);
    }
    for (const m of [undefined, "GET", "HEAD"]) expect(shouldRetry(503, 0, m)).toBe(true);
  });

  it("allows exactly three retries", () => {
    expect(shouldRetry(503, 0)).toBe(true);
    expect(shouldRetry(503, 2)).toBe(true);
    expect(shouldRetry(503, 3)).toBe(false);
  });

  it("delays are 200, 600, 1500 ms plus 0-150 ms of jitter", () => {
    expect(RETRY_DELAYS_MS).toEqual([200, 600, 1500]);
    expect([0, 1, 2].map((n) => retryDelay(n, () => 0))).toEqual([200, 600, 1500]);
    expect([0, 1, 2].map((n) => retryDelay(n, () => 0.999999))).toEqual([200 + RETRY_JITTER_MS, 600 + RETRY_JITTER_MS, 1500 + RETRY_JITTER_MS]);
  });

  it("a 503 then 200 returns the 200 after one wait", async () => {
    const t = run([503, 200]);
    expect((await t.p).status).toBe(200);
    expect(t.waits).toEqual([200]);
  });

  it("gives up after 3 retries and returns the last 503 (4 attempts)", async () => {
    const t = run([503]);
    expect((await t.p).status).toBe(503);
    expect(t.calls()).toBe(4);
    expect(t.waits).toEqual([200, 600, 1500]);
  });

  it("retries network errors, and throws the last one when it never works", async () => {
    const ok = run(["net", "net", 200]);
    expect((await ok.p).status).toBe(200);
    const bad = run(["net"]);
    await expect(bad.p).rejects.toThrow("Failed to fetch");
    expect(bad.calls()).toBe(4);
  });

  it("never retries a 4xx or a 200", async () => {
    for (const s of [200, 400, 401, 404, 429]) {
      const t = run([s]);
      expect((await t.p).status).toBe(s);
      expect(t.calls()).toBe(1);
    }
  });

  it("does not retry past the overall budget", async () => {
    let clock = 0;
    const t = run([503], { totalMs: 700, now: () => clock, sleep: async (ms) => void (clock += ms) });
    expect((await t.p).status).toBe(503);
    expect(t.calls()).toBe(2); // 200 ms wait fits, the 600 ms one would end past 700
  });

  it("fetchGet never retries a write", async () => {
    let calls = 0;
    const f = (async () => (calls++, res(503))) as unknown as typeof fetch;
    expect((await fetchGet("/x", { method: "POST" }, f)).status).toBe(503);
    expect(calls).toBe(1);
  });
});
