import { describe, expect, it } from "vitest";
import { deadline, fetchWithTimeout } from "@/lib/timeouts";

// A fetch that never answers unless its signal aborts: the shape of a stalled upstream.
const stalled: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
  });

describe("outbound time limits", () => {
  it("a stalled call fails after its limit instead of hanging", async () => {
    const t0 = Date.now();
    await expect(fetchWithTimeout(50, stalled)("https://example.invalid")).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("keeps the caller's own signal: aborting it stops the call early", async () => {
    const ctl = new AbortController();
    const p = fetchWithTimeout(60_000, stalled)("https://example.invalid", { signal: ctl.signal });
    ctl.abort(new Error("caller"));
    await expect(p).rejects.toThrow("caller");
  });

  it("a fast call is untouched", async () => {
    const ok: typeof fetch = async () => new Response("hi");
    const res = await fetchWithTimeout(50, ok)("https://example.invalid");
    expect(await res.text()).toBe("hi");
  });

  it("deadline aborts on its own", async () => {
    const s = deadline(20);
    await new Promise((r) => setTimeout(r, 60));
    expect(s.aborted).toBe(true);
  });
});
