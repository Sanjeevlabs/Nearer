// Heartbeats pile up faster than 500 rows cover the days the window needs, so
// presence is read by time window, not as the newest 500.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { calls: [] as string[], limit: 0 };
  const q: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      if (prop === "limit") return (n: number) => ((state.limit = n), q);
      if (prop === "gte") return (c: string, v: string) => (state.calls.push(`gte:${c}:${v}`), q);
      return () => q;
    },
  });
  return { state, fake: { from: () => q } };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));

import { listDocs } from "@/lib/family-docs";

beforeEach(() => {
  vi.stubEnv("MOCK", "false");
  vi.stubEnv("META_API_KEY", "test-not-a-key");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T09:00:00.000Z"));
  h.state.calls = [];
  h.state.limit = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("listDocs window", () => {
  it("without a window it is the newest 500", async () => {
    await listDocs("fam-real0000001", "presence");
    expect(h.state.limit).toBe(500);
    expect(h.state.calls).toEqual([]);
  });

  it("with sinceMs it asks for rows written since then, up to 3000", async () => {
    await listDocs("fam-real0000001", "presence", { sinceMs: 16 * 86_400_000 });
    expect(h.state.calls).toEqual(["gte:created_at:2026-10-12T09:00:00.000Z"]);
    expect(h.state.limit).toBe(3000);
  });
});
