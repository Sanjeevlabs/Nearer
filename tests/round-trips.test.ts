// Round trips to Postgres per request, and how many of them wait on another.
// Mock mode hides all of this (memory answers instantly), so this runs the real
// code paths against a fake database that answers on setImmediate and counts
// "waves": queries issued in the same tick are one wave (they went out
// together); a query issued after an earlier one answered is a later wave. The
// wave count is the sequential depth, and at ~0.5 s per round trip from a
// Worker it is what the user waits for. Budgets below are ceilings the
// endpoints must stay under.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables = new Map<string, Row[]>();
  const rows = (t: string) => tables.get(t) ?? (tables.set(t, []), tables.get(t)!);
  const stats = { tick: 0, queries: 0, maxWave: -1, waves: new Set<number>(), log: [] as string[] };
  let pending: (() => void)[] = [];
  let scheduled = false;
  function dispatch(label: string, fn: () => void) {
    stats.queries++;
    stats.waves.add(stats.tick);
    stats.maxWave = Math.max(stats.maxWave, stats.tick);
    stats.log.push(`${stats.tick}:${label}`);
    pending.push(fn);
    if (!scheduled) {
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        stats.tick++;
        const batch = pending;
        pending = [];
        batch.forEach((f) => f());
      });
    }
  }
  const like = (v: unknown, pat: string) => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`).test(String(v));
  function builder(t: string) {
    const filters: string[] = [];
    const preds: ((r: Row) => boolean)[] = [];
    let op: "select" | "delete" | "update" = "select";
    let patch: Row = {};
    let head = false;
    let lim = Infinity;
    const run = () => {
      const all = rows(t);
      const hit = all.filter((r) => preds.every((f) => f(r)));
      if (op === "delete") tables.set(t, all.filter((r) => !hit.includes(r)));
      if (op === "update") hit.forEach((r) => Object.assign(r, patch));
      return { data: head ? null : hit.slice(0, lim).map((r) => ({ ...r })), error: null, count: hit.length };
    };
    const add = (label: string, f: (r: Row) => boolean) => (filters.push(label), preds.push(f), b);
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), b),
      delete: () => ((op = "delete"), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      eq: (k: string, v: unknown) => add(`${k}=${String(v).slice(0, 20)}`, (r) => r[k] === v),
      neq: (k: string, v: unknown) => add(`${k}!=`, (r) => r[k] !== v),
      in: (k: string, vs: unknown[]) => add(`${k} in ${vs.length}`, (r) => vs.includes(r[k])),
      like: (k: string, p: string) => add(`${k} like`, (r) => like(r[k], p)),
      gte: (k: string, v: string) => add(`${k}>=`, (r) => String(r[k]) >= v),
      lt: (k: string, v: string) => add(`${k}<`, (r) => String(r[k]) < v),
      not: () => b,
      or: () => b,
      order: () => b,
      limit: (n: number) => ((lim = n), b),
      maybeSingle: () => new Promise((res) => dispatch(`${t}(one)`, () => res({ data: run().data?.[0] ?? null, error: null }))),
      then: (res: (v: unknown) => void) => dispatch(`${t}(${filters.join(",")})`, () => res(run())),
    };
    return b;
  }
  const fake = {
    from: (t: string) => ({
      ...builder(t),
      insert: (input: Row | Row[]) => {
        for (const r of Array.isArray(input) ? input : [input]) rows(t).push({ created_at: new Date().toISOString(), ...r });
        return Promise.resolve({ error: null });
      },
      upsert: (input: Row | Row[]) => {
        for (const r of Array.isArray(input) ? input : [input]) {
          const at = rows(t).findIndex((x) => x.id === r.id);
          if (at >= 0) rows(t)[at] = { ...rows(t)[at], ...r };
          else rows(t).push({ created_at: new Date().toISOString(), ...r });
        }
        return Promise.resolve({ error: null });
      },
    }),
    rpc: () => Promise.resolve({ data: 0, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://bucket.test/get" }, error: null }), createSignedUploadUrl: async () => ({ data: { signedUrl: "https://bucket.test/up" }, error: null }) }) },
  };
  const reset = () => {
    stats.tick = 0;
    stats.queries = 0;
    stats.maxWave = -1;
    stats.waves.clear();
    stats.log.length = 0;
  };
  return { tables, fake, stats, reset };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));

import { GET as courtyard } from "@/app/api/courtyard/route";
import { GET as festivalWeekRoute } from "@/app/api/festival-week/route";
import { POST as session } from "@/app/api/session/route";
import { GET as windowRoute } from "@/app/api/window/route";
import { requireCan, requireSession } from "@/lib/auth";
import { readDbStats, resetDbStats } from "@/lib/db-stats";
import { listDocs, listDocsMany, putDoc } from "@/lib/family-docs";
import { windowState } from "@/lib/window-server";

/** Ceilings per endpoint: { calls: from() count, depth: sequential waves }. Tightened as the work lands. */
const BUDGET = {
  windowState: { calls: 8, depth: 2 },
  window: { calls: 9, depth: 2 },
  courtyard: { calls: 33, depth: 6 },
  festivalWeek: { calls: 7, depth: 5 },
};

let cookie = "";
let familyId = "";
let memberId = "";

beforeEach(async () => {
  vi.stubEnv("MOCK", "false");
  vi.stubEnv("META_API_KEY", "");
  // Weather and holiday feeds answer at once (and say "no"): only the database is timed here.
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
  h.tables.clear();
  const res = await session(new Request("http://test/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ inviteCode: "AANGAN-DEMO", memberId: "arjun" }) }));
  expect(res.status).toBe(200);
  ({ familyId, memberId } = (await res.json()) as { familyId: string; memberId: string });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  // Two visits, so "since you were here" has a previous one and reads plays + reactions too.
  const now = Date.now();
  for (const [i, ago] of [3 * 3600_000, 60_000].entries()) await putDoc(familyId, "presence", { id: `presence-t${i}`, memberId, moment: "here", note: "", at: new Date(now - ago).toISOString() });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function measure<T>(run: () => Promise<T>): Promise<{ out: T; calls: number; depth: number; byTable: Record<string, number>; log: string[] }> {
  h.reset();
  resetDbStats();
  const out = await run();
  const s = readDbStats();
  return { out, calls: s.calls, depth: h.stats.waves.size, byTable: s.byTable, log: [...h.stats.log] };
}

const get = (path: string) => new Request(`http://test${path}`, { headers: { cookie } });

function report(name: string, m: { calls: number; depth: number; byTable: Record<string, number> }) {
  console.log(`[round-trips] ${name}: calls=${m.calls} depth=${m.depth} ${JSON.stringify(m.byTable)}`);
}

describe("member memo", () => {
  it("loads the signed-in member once per request, however many guards ask", async () => {
    const req = get("/api/x");
    const m = await measure(async () => {
      const a = await requireSession(req);
      const b = await requireSession(req);
      if (a instanceof Response || b instanceof Response) throw new Error("auth");
      const me = await requireCan(a, "tree.add", req);
      return me instanceof Response ? me.status : me.id;
    });
    expect(m.out).toBe(memberId);
    expect(m.byTable.members).toBe(1);
  });

  it("a second request does not borrow the first one's member", async () => {
    await requireSession(get("/api/x"));
    const m = await measure(() => requireSession(get("/api/x")));
    expect(m.byTable.members).toBe(1);
  });
});

describe("listDocsMany", () => {
  const kinds = ["presence", "safety_checkin", "care_settings", "question", "today_task", "need"] as const;

  it("is one round trip and equals the separate lists", async () => {
    const m = await measure(() => listDocsMany(familyId, kinds));
    expect(m.calls).toBe(1);
    expect(m.depth).toBe(1);
    expect(m.out.presence.length).toBeGreaterThanOrEqual(2);
    for (const k of kinds) expect(m.out[k]).toEqual(await listDocs(familyId, k));
  });

  it("falls back to one query per kind when the single query comes back full", async () => {
    // A chatty kind fills the combined limit, so another kind could have been crowded out.
    const rows = h.tables.get("family_docs")!;
    for (let i = 0; i < 3000; i++) rows.push({ id: `${familyId}:flood${i}`, family_id: familyId, kind: "presence", data: { id: `flood${i}`, memberId: memberId, moment: "chai", note: "", at: new Date(Date.now() - 1e6 - i).toISOString() }, created_at: new Date().toISOString() });
    const m = await measure(() => listDocsMany(familyId, kinds));
    expect(m.calls).toBe(1 + kinds.length);
    for (const k of kinds) expect(m.out[k]).toEqual(await listDocs(familyId, k));
  });
});

describe("database round trips", () => {
  it("windowState", async () => {
    const m = await measure(() => windowState(familyId, memberId));
    report("windowState", m);
    // The recent shelf, not the lane: one bounded cards query, and the family's documents in one.
    expect(m.log.filter((q) => q.includes("cards(")).every((q) => q.includes("taken_at>="))).toBe(true);
    expect(m.byTable.cards).toBe(1);
    expect(m.byTable.family_docs).toBeLessThanOrEqual(3);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.windowState.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.windowState.depth);
  });

  it("GET /api/window", async () => {
    const m = await measure(async () => (await windowRoute(get("/api/window"))).status);
    report("GET /api/window", m);
    expect(m.out).toBe(200);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.window.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.window.depth);
  });

  it("GET /api/courtyard", async () => {
    const m = await measure(async () => (await courtyard(get("/api/courtyard"))).status);
    report("GET /api/courtyard", m);
    expect(m.out).toBe(200);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.courtyard.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.courtyard.depth);
  });

  it("GET /api/festival-week", async () => {
    const m = await measure(async () => (await festivalWeekRoute(get("/api/festival-week"))).status);
    report("GET /api/festival-week", m);
    expect(m.out).toBe(200);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.festivalWeek.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.festivalWeek.depth);
  });
});
