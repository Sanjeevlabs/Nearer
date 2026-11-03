// A failed read of the live database must say so (DbReadError -> 503
// "read-failed"), never show an empty page from this isolate's (empty) memory.
// A genuinely empty answer is still an empty answer. Live is simulated with a
// fake client whose selects fail for the tables in `failOn`, or for one family.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { failOn: new Set<string>(), failFamily: null as string | null, families: [] as string[] };
  const fake = {
    from: (t: string) => {
      let family: string | null = null;
      const result = () => {
        const bad = state.failOn.has(t) || (state.failFamily !== null && family === state.failFamily);
        if (bad) return { data: null, error: { message: "boom" } };
        return { data: t === "families" ? state.families.map((id) => ({ id })) : [], error: null, count: 0 };
      };
      const read: unknown = new Proxy(function () {}, {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result());
          if (prop === "maybeSingle") return () => Promise.resolve(state.failOn.has(t) ? { data: null, error: { message: "boom" } } : { data: null, error: null });
          if (prop === "eq") return (col: string, v: string) => ((family = col === "family_id" ? v : family), read);
          return () => read;
        },
      });
      return read;
    },
  };
  return { state, fake };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));

import { guardApi } from "@/lib/api-guard";
import { dbGetMember, dbListCards, dbListFamilyIds, dbListMembers } from "@/lib/db";
import { DbReadError } from "@/lib/family-db";
import { getDoc, listDocs, resetDocs } from "@/lib/family-docs";
import { resetCronState } from "@/lib/cron-state";
import { GET as pushSweep } from "@/app/api/push/sweep/route";

const REAL = "fam-real0000001";
const listRoute = guardApi(async () => Response.json({ cards: await dbListCards(REAL) }));

beforeEach(() => {
  vi.stubEnv("MOCK", "false");
  vi.stubEnv("META_API_KEY", "test-not-a-key");
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  h.state.failOn = new Set();
  h.state.failFamily = null;
  h.state.families = [];
  resetDocs();
  resetCronState();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("live read failures", () => {
  it("a list read with an error throws DbReadError, and the route answers 503 read-failed (no-store)", async () => {
    h.state.failOn = new Set(["cards"]);
    await expect(dbListCards(REAL)).rejects.toBeInstanceOf(DbReadError);
    const res = await listRoute();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "read-failed" });
  });

  it("every list read fails loudly, not only cards", async () => {
    h.state.failOn = new Set(["members", "family_docs"]);
    await expect(dbListMembers(REAL)).rejects.toBeInstanceOf(DbReadError);
    await expect(listDocs(REAL, "chitthi")).rejects.toBeInstanceOf(DbReadError);
    await expect(getDoc(REAL, "chitthi", "x")).rejects.toBeInstanceOf(DbReadError);
  });

  it("a genuinely empty result is 200 with an empty list", async () => {
    const res = await listRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cards: [] });
    expect(await listDocs(REAL, "chitthi")).toEqual([]);
  });

  it("maybeSingle with no row is not an error (no such member, no such doc)", async () => {
    expect(await dbGetMember("mem-nobody")).toBeUndefined();
    expect(await getDoc(REAL, "chitthi", "none")).toBeUndefined();
  });

  it("an error that is not a database failure still propagates", async () => {
    await expect(guardApi(async () => Promise.reject(new Error("other")))()).rejects.toThrow("other");
  });
});

describe("cron paths", () => {
  it("the push sweep carries on past a family whose read fails", async () => {
    h.state.families = ["fam-a0000000001", "fam-b0000000002"];
    h.state.failFamily = "fam-a0000000001";
    const res = await pushSweep(new Request("http://test/api/push/sweep", { headers: { authorization: "Bearer cron-test-secret" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ told: 0, invited: 0 });
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("fam-a0000000001");
    expect(logged).not.toContain("boom"); // the error name only, never its message
  });

  it("a failed family list is a 503 read-failed, not a run over zero families", async () => {
    h.state.failOn = new Set(["families"]);
    await expect(dbListFamilyIds()).rejects.toBeInstanceOf(DbReadError);
    const res = await pushSweep(new Request("http://test/api/push/sweep", { headers: { authorization: "Bearer cron-test-secret" } }));
    expect(res.status).toBe(503);
  });
});
