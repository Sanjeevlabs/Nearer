// The push_subscriptions table, driven through a small in-memory stand-in for the Supabase client
// (like tests/demo-isolation.test.ts): proves the queries the live path makes are the ones the
// table supports (unique token, scoped deletes), and that schema.sql has the table and the kind.
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => {
  const rows: Row[] = [];
  const builder = (table: string) => {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let patch: Row = {};
    const filters: ((r: Row) => boolean)[] = [];
    let wantRows = false;
    const run = () => {
      if (table !== "push_subscriptions") return { data: [], error: null };
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, patch));
        return { data: wantRows ? hit : null, error: null };
      }
      if (op === "delete") {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: wantRows ? hit : null, error: null };
      }
      return { data: hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => ((wantRows = true), q),
      insert: (r: Row) => {
        if (rows.some((x) => x.token === r.token)) return Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint" } });
        rows.push({ ...r });
        return Promise.resolve({ data: null, error: null });
      },
      update: (p: Row) => ((op = "update"), (patch = p), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      order: () => q,
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  };
  return { rows, fake: { from: builder } };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));

import { MAX_DEVICES, listSubs, noteFailure, noteOk, removeByToken, removeSub, upsertSub } from "@/lib/push/store";

const REAL_A = "fam-realaaaaaaa1";
const REAL_B = "fam-realbbbbbbb1";
const input = (over: Partial<Parameters<typeof upsertSub>[0]> = {}) => ({ familyId: REAL_A, memberId: "m1", kind: "fcm" as const, token: "tok-1-aaaaaaaaaaaaaaaaaaaa", platform: "android", ...over });

beforeEach(() => {
  vi.stubEnv("MOCK", "false");
  h.rows.length = 0;
});

describe("live push_subscriptions", () => {
  it("inserts, then updates the same token in place (re-bound, failures reset)", async () => {
    const a = await upsertSub(input());
    await noteFailure(a);
    expect(h.rows[0].failures).toBe(1);
    const b = await upsertSub(input({ familyId: REAL_B, memberId: "m9", platform: "ios" }));
    expect(h.rows).toHaveLength(1);
    expect(b.id).toBe(a.id);
    expect(h.rows[0]).toMatchObject({ family_id: REAL_B, member_id: "m9", platform: "ios", failures: 0 });
    expect(await listSubs(REAL_A, "m1")).toEqual([]);
    expect(await listSubs(REAL_B, "m9")).toHaveLength(1);
  });

  it("deletes only inside the family and member that ask", async () => {
    await upsertSub(input());
    expect(await removeByToken(REAL_B, "m1", "tok-1-aaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(await removeByToken(REAL_A, "m2", "tok-1-aaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(h.rows).toHaveLength(1);
    expect(await removeByToken(REAL_A, "m1", "tok-1-aaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(h.rows).toHaveLength(0);
  });

  it("keeps ten devices at most, a success clears the failure count, a gone one is deleted", async () => {
    for (let i = 0; i < MAX_DEVICES + 2; i++) await upsertSub(input({ token: `tok-${i}-aaaaaaaaaaaaaaaaaaaa` }));
    expect(h.rows.length).toBe(MAX_DEVICES);
    const [first] = await listSubs(REAL_A, "m1");
    await noteFailure(first);
    await noteOk({ ...first, failures: 1 });
    expect(h.rows.find((r) => r.id === first.id)).toMatchObject({ failures: 0 });
    await removeSub(first);
    expect(h.rows.some((r) => r.id === first.id)).toBe(false);
  });
});

describe("schema.sql", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  it("has the table, unique token, RLS on and no policy, and cascades with the family and member", () => {
    const block = sql.slice(sql.indexOf("create table if not exists push_subscriptions"), sql.indexOf("drop policy if exists \"family scope\" on push_subscriptions;"));
    expect(block).toContain("token text not null unique");
    expect(block).toContain("references families(id) on delete cascade");
    expect(block).toContain("references members(id) on delete cascade");
    expect(block).toContain("check (kind in ('fcm', 'webpush'))");
    expect(block).toContain("alter table push_subscriptions enable row level security;");
    expect(sql).not.toMatch(/create policy[^;]*on push_subscriptions/);
  });
  it("allows the push_settings document kind", () => {
    const line = sql.split("\n").find((l) => l.includes("family_docs_kind_check check")) ?? "";
    expect(line).toContain("'push_settings'");
  });
});
