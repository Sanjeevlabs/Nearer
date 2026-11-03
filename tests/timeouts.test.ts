import { describe, expect, it } from "vitest";
import { PostgrestClient } from "@supabase/postgrest-js";
import { deadline, fetchWithTimeout, isTimeout } from "@/lib/timeouts";

// A fetch that never answers unless its signal aborts: the shape of a stalled upstream.
function stalled(calls?: { n: number }): typeof fetch {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      if (calls) calls.n++;
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
    });
}

describe("outbound time limits", () => {
  it("a stalled call fails after its limit as an AbortError, instead of hanging", async () => {
    const t0 = Date.now();
    const err = await fetchWithTimeout(50, stalled())("https://example.invalid").catch((e: unknown) => e);
    expect(isTimeout(err)).toBe(true);
    expect((err as Error).name).toBe("AbortError");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("keeps the caller's own signal (in init): aborting it stops the call early with its reason", async () => {
    const ctl = new AbortController();
    const p = fetchWithTimeout(60_000, stalled())("https://example.invalid", { signal: ctl.signal });
    ctl.abort(new Error("caller"));
    await expect(p).rejects.toThrow("caller");
  });

  it("keeps a Request's own signal", async () => {
    const ctl = new AbortController();
    ctl.abort(new Error("request-signal"));
    let seen: AbortSignal | undefined;
    const spy: typeof fetch = async (_i, init) => {
      seen = init?.signal ?? undefined;
      return new Response("x");
    };
    await fetchWithTimeout(60_000, spy)(new Request("https://example.invalid", { signal: ctl.signal }));
    expect(seen?.aborted).toBe(true);
  });

  it("a fast call is untouched", async () => {
    const ok: typeof fetch = async () => new Response("hi");
    const res = await fetchWithTimeout(50, ok)("https://example.invalid");
    expect(await res.text()).toBe("hi");
  });

  it("deadline aborts on its own, and with a caller signal", async () => {
    const s = deadline(20, new AbortController().signal);
    await new Promise((r) => setTimeout(r, 60));
    expect(s.aborted).toBe(true);
  });

  it("a stalled Supabase read is tried once, not retried with back-off (postgrest treats it as final)", async () => {
    const calls = { n: 0 };
    const pg = new PostgrestClient("https://db.example.invalid/rest/v1", { fetch: fetchWithTimeout(60, stalled(calls)) });
    const t0 = Date.now();
    const { error } = await pg.from("members").select("id").limit(1);
    expect(error).toBeTruthy();
    expect(calls.n).toBe(1);
    expect(Date.now() - t0).toBeLessThan(1_500);
  });
});
