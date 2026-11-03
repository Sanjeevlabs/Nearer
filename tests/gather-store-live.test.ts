// With the database live, events and dismissals come from the database on every
// read. This process's memory copy (kept only as a fallback when the database
// cannot be read) must never bring back a row another Worker has removed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = { id: string; family_id: string; kind: string; data: unknown };
  const table = new Map<string, Row>();
  const state = { failReads: false };
  // A tiny chainable fake of the supabase calls lib/gather-store.ts makes.
  const builder = (op: "select" | "delete" | "upsert", payload?: Row) => {
    const filters: [string, unknown][] = [];
    const run = () => {
      const match = (r: Row) => filters.every(([c, v]) => (c === "id" ? r.id === v : c === "family_id" ? r.family_id === v : c === "kind" ? r.kind === v : true));
      if (op === "upsert" && payload) {
        table.set(payload.id, payload);
        return { data: null, error: null };
      }
      if (op === "delete") {
        for (const [k, r] of Array.from(table)) if (match(r)) table.delete(k);
        return { data: null, error: null };
      }
      if (state.failReads) return { data: null, error: { message: "down" } };
      return { data: Array.from(table.values()).filter(match).map((r) => ({ data: r.data })), error: null };
    };
    const q: Record<string, unknown> = {
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      limit: () => q,
      range: () => q,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  const fake = {
    from: () => ({
      select: () => builder("select"),
      delete: () => builder("delete"),
      upsert: (row: Row) => builder("upsert", row),
    }),
  };
  return { table, state, fake };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));

import { fallbackPlan } from "@/lib/events";
import { DbReadError } from "@/lib/family-db";
import { dismiss, listDismissed, listEvents, putEvent, resetEvents } from "@/lib/gather-store";

const FAM = "fam-real0000001";
const event = {
  id: "ev1",
  type: "custom" as const,
  title: "Diwali dinner",
  date: "2026-11-08",
  hostId: "m1",
  createdAt: "2026-10-28T09:00:00.000Z",
  plan: fallbackPlan("custom", [], { hostId: "m1", honoreeId: null }),
};

beforeEach(() => {
  vi.stubEnv("MOCK", "false");
  vi.stubEnv("META_API_KEY", "test-not-a-key");
  h.table.clear();
  h.state.failReads = false;
  resetEvents();
});
afterEach(() => vi.unstubAllEnvs());

describe("gather-store with the database live", () => {
  it("an event another Worker removed does not come back from this one's memory", async () => {
    await putEvent(FAM, event);
    expect((await listEvents(FAM)).map((e) => e.id)).toEqual(["ev1"]);
    h.table.clear(); // removed elsewhere
    expect(await listEvents(FAM)).toEqual([]);
  });

  it("a dismissal removed elsewhere (the daily purge) does not come back", async () => {
    await dismiss(FAM, "m1", "suggest:diwali:all:2026-11-08");
    expect(await listDismissed(FAM, "m1")).toEqual(["suggest:diwali:all:2026-11-08"]);
    h.table.clear();
    expect(await listDismissed(FAM, "m1")).toEqual([]);
  });

  it("when the database cannot be read, the read fails loudly (this Worker's memory is not the store)", async () => {
    await dismiss(FAM, "m1", "suggest:diwali:all:2026-11-08");
    h.state.failReads = true;
    await expect(listDismissed(FAM, "m1")).rejects.toBeInstanceOf(DbReadError);
  });
});
