// The daily purge against the database: batched deletes by id, stops on a short batch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { ids: [] as string[], selects: 0, deletes: [] as string[][], orFilter: "", limit: 0 };
  const fake = {
    from: (t: string) => {
      if (t !== "sessions") throw new Error(t);
      const b: Record<string, unknown> = {
        select: () => b,
        or: (f: string) => ((state.orFilter = f), b),
        limit: (n: number) => {
          state.limit = n;
          state.selects++;
          return Promise.resolve({ data: state.ids.slice(0, n).map((id) => ({ id })), error: null });
        },
        delete: () => ({
          in: (_k: string, ids: string[]) => {
            state.deletes.push(ids);
            state.ids = state.ids.filter((x) => !ids.includes(x));
            return Promise.resolve({ error: null });
          },
        }),
      };
      return b;
    },
  };
  return { state, fake };
});
vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));
import { purgeSessions } from "@/lib/sessions";

beforeEach(() => vi.stubEnv("MOCK", "false"));
afterEach(() => vi.unstubAllEnvs());

describe("purgeSessions on the database", () => {
  it("deletes old rows in batches and stops when a batch comes back short", async () => {
    h.state.ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const now = Date.parse("2026-11-10T00:00:00Z");
    const n = await purgeSessions(now, 5, 10);
    expect(n).toBe(12);
    expect(h.state.deletes.map((d) => d.length)).toEqual([5, 5, 2]);
    expect(h.state.limit).toBe(5);
    // 7 days before `now`, on both columns
    expect(h.state.orFilter).toBe("expires_at.lt.2026-11-03T00:00:00.000Z,revoked_at.lt.2026-11-03T00:00:00.000Z");
  });
});
