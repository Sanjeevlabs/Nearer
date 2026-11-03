import { vi, beforeEach, describe, expect, it } from "vitest";
import { clearJsonCache, readCache, revalidate } from "@/lib/use-json";

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
const down = (async () => {
  throw new TypeError("offline");
}) as unknown as typeof fetch;

describe("useJson stale-while-revalidate core", () => {
  beforeEach(() => clearJsonCache());

  it("a good response is cached and returned fresh", async () => {
    const r = await revalidate<{ n: number }>("/api/x", ok({ n: 1 }));
    expect(r).toEqual({ data: { n: 1 }, stale: false, failed: false });
    expect(readCache("/api/x")).toEqual({ n: 1 });
  });

  it("a network error keeps the last good payload and flags it stale, not failed", async () => {
    await revalidate("/api/x", ok({ n: 1 }));
    expect(await revalidate("/api/x", down)).toEqual({ data: { n: 1 }, stale: true, failed: false });
    const http500 = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect((await revalidate("/api/x", http500)).stale).toBe(true);
  });

  it("an error with nothing cached is failed, and caches are per URL", async () => {
    // A network error is retried quietly (3 times, lib/retry.ts) before it counts as failed.
    vi.useFakeTimers();
    const first = revalidate("/api/y", down);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await first).toEqual({ data: null, stale: false, failed: true });
    vi.useRealTimers();
    await revalidate("/api/x", ok({ n: 1 }));
    vi.useFakeTimers();
    const second = revalidate("/api/y", down);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await second).data).toBeNull();
    vi.useRealTimers();
  });

  it("clearJsonCache forgets everything (sign-out)", async () => {
    await revalidate("/api/x", ok({ n: 1 }));
    clearJsonCache();
    expect(readCache("/api/x")).toBeNull();
  });
});
