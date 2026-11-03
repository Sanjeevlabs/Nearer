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
    let cols = "*";
    let embedSince = "";
    // members → families(name, members(*), cards(...)): the embed PostgREST makes through the family foreign keys.
    const embed = (r: Row): Row => {
      if (t !== "members" || !cols.includes("families(")) return { ...r };
      const fam = rows("families").find((f) => f.id === r.family_id);
      const out: Row = { ...r, families: fam ? { name: fam.name } : null };
      if (fam && cols.includes("members(")) Object.assign(out.families as Row, { members: rows("members").filter((m) => m.family_id === r.family_id).map((m) => ({ ...m })), cards: rows("cards").filter((c) => c.family_id === r.family_id && (!embedSince || String(c.taken_at) >= embedSince)).map((c) => ({ author_id: c.author_id, taken_at: c.taken_at })) });
      return out;
    };
    const run = () => {
      const all = rows(t);
      const hit = all.filter((r) => preds.every((f) => f(r)));
      if (op === "delete") tables.set(t, all.filter((r) => !hit.includes(r)));
      if (op === "update") hit.forEach((r) => Object.assign(r, patch));
      return { data: head ? null : hit.slice(0, lim).map(embed), error: null, count: hit.length };
    };
    const add = (label: string, f: (r: Row) => boolean) => (filters.push(label), preds.push(f), b);
    const b: Record<string, unknown> = {
      select: (c?: string, o?: { head?: boolean }) => ((cols = c ?? "*"), (head = Boolean(o?.head)), b),
      delete: () => ((op = "delete"), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      eq: (k: string, v: unknown) => add(`${k}=${String(v).slice(0, 20)}`, (r) => r[k] === v),
      neq: (k: string, v: unknown) => add(`${k}!=`, (r) => r[k] !== v),
      in: (k: string, vs: unknown[]) => add(`${k} in ${vs.length}`, (r) => vs.includes(r[k])),
      like: (k: string, p: string) => add(`${k} like`, (r) => like(r[k], p)),
      gte: (k: string, v: string) => (k.includes(".") ? ((embedSince = v), b) : add(`${k}>=`, (r) => String(r[k]) >= v)),
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
      // A copy into the database is a round trip too (the demo sign-in is mostly inserts).
      insert: (input: Row | Row[]) =>
        new Promise((res) =>
          dispatch(`${t}(insert)`, () => {
            for (const r of Array.isArray(input) ? input : [input]) rows(t).push({ created_at: new Date().toISOString(), ...r });
            res({ error: null });
          }),
        ),
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
import { GET as kidsRoute } from "@/app/api/kids/route";
import { GET as festivalWeekRoute } from "@/app/api/festival-week/route";
import { POST as session } from "@/app/api/session/route";
import { GET as windowRoute } from "@/app/api/window/route";
import { GET as membersRoute } from "@/app/api/members/route";
import { GET as relationshipsRoute } from "@/app/api/relationships/route";
import { GET as whoami } from "@/app/api/session/route";
import { GET as sidesGet, POST as sidesPost } from "@/app/api/sides/route";
import { sandboxIdle } from "@/lib/demo-sandbox";
import { GET as cardsRoute } from "@/app/api/cards/route";
import { GET as waitingRoute } from "@/app/api/waiting/route";
import { requireCan, requireSession } from "@/lib/auth";
import { readDbStats, resetDbStats } from "@/lib/db-stats";
import { listDocs, listDocsMany, putDoc } from "@/lib/family-docs";
import { windowState } from "@/lib/window-server";

/** Ceilings per endpoint: { calls: from() count, depth: sequential waves }. Tightened as the work lands. */
const BUDGET = {
  // Calls run in parallel waves; depth (sequential waves) is what the person waits for.
  // The window also reads presence by time window and the viewer's unseen nudges (one wave, two more calls).
  // The documents, the events and the calendar settings are one query; the session's own row comes out of the family list.
  windowState: { calls: 5, depth: 1 },
  window: { calls: 5, depth: 1 },
  // At most 5 at once: a Worker keeps 6 connections open, and a 7th waits for one to close.
  courtyard: { calls: 10, depth: 2, width: 6 },
  courtyardOne: { calls: 9, depth: 2 },
  // The first screen's "who am I", with the family and its relationships: one wave.
  sessionFamily: { calls: 3, depth: 1 },
  members: { calls: 2, depth: 1 },
  relationships: { calls: 2, depth: 1 },
  // (a switch also ends the old session and starts the new one: two writes, one more wave after the reads)
  sideSwitch: { calls: 4, depth: 2 },
  // The rest of the first screen's wave: everything with the session check.
  cards: { calls: 3, depth: 1 },
  waiting: { calls: 6, depth: 1 },
  // The demo sign-in: brakes + family rows, members, what the first screens read. The rest copies after the answer.
  // (the session row is one more write after the copy is made)
  signIn: { depth: 4 },
  festivalWeek: { calls: 6, depth: 2 },
  // The Kids page: members, relationships, cards and the document kinds, all in the wave after the session lookup.
  kids: { calls: 6, depth: 2 },
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
  const res = await session(new Request("http://test/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId: "arjun" }) }));
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

function report(name: string, m: { calls: number; depth: number; byTable: Record<string, number>; log?: string[] }) {
  console.log(`[round-trips] ${name}: calls=${m.calls} depth=${m.depth} ${JSON.stringify(m.byTable)}`);
  if (process.env.WAVES) console.log((m as { log?: string[] }).log?.join("\n"));
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
    expect(m.byTable.family_docs).toBeLessThanOrEqual(5);
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
    await courtyard(get("/api/courtyard")); // a festival's first look creates its run (one insert); this is the steady state
    const m = await measure(async () => (await courtyard(get("/api/courtyard"))).status);
    report("GET /api/courtyard", m);
    expect(m.out).toBe(200);
    // No wave wider than the Worker's open connections (the rest would queue behind them).
    const width = Math.max(...Object.values(m.log.reduce<Record<string, number>>((acc, q) => ((acc[q.split(":")[0]] = (acc[q.split(":")[0]] ?? 0) + 1), acc), {})));
    expect(width).toBeLessThanOrEqual(BUDGET.courtyard.width);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.courtyard.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.courtyard.depth);
  });

  it("GET /api/courtyard for someone in one family only", async () => {
    // Their other homes are a second hop (find them, then read each); with none, it is one wave after the auth lookup.
    for (const r of h.tables.get("members")!) if (r.id === memberId) r.person_id = null;
    await courtyard(get("/api/courtyard"));
    const m = await measure(async () => (await courtyard(get("/api/courtyard"))).status);
    report("GET /api/courtyard (one family)", m);
    expect(m.out).toBe(200);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.courtyardOne.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.courtyardOne.depth);
  });

  it("GET /api/kids", async () => {
    const m = await measure(async () => (await kidsRoute(get("/api/kids"))).status);
    report("GET /api/kids", m);
    expect(m.out).toBe(200);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.kids.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.kids.depth);
  });

  it("GET /api/festival-week", async () => {
    await festivalWeekRoute(get("/api/festival-week")); // the first look of the festival creates its run; this is the steady state
    const m = await measure(async () => (await festivalWeekRoute(get("/api/festival-week"))).status);
    report("GET /api/festival-week", m);
    expect(m.out).toBe(200);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.festivalWeek.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.festivalWeek.depth);
  });
});

describe("the first visit and the side switch", () => {
  it("GET /api/session?family=1", async () => {
    const m = await measure(async () => (await whoami(get("/api/session?family=1"))).json() as Promise<{ members: unknown[]; relationships: unknown[]; status: string }>);
    report("GET /api/session?family=1", m);
    expect(m.out.status).toBe("active");
    expect(m.out.members.length).toBeGreaterThan(5);
    expect(m.out.relationships.length).toBeGreaterThan(5);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.sessionFamily.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.sessionFamily.depth);
  });

  it("GET /api/session?family=1 answers what /api/members and /api/relationships answer", async () => {
    const full = (await (await whoami(get("/api/session?family=1"))).json()) as Record<string, unknown>;
    const members = (await (await membersRoute(get("/api/members"))).json()) as Record<string, unknown>;
    const rels = (await (await relationshipsRoute(get("/api/relationships"))).json()) as Record<string, unknown>;
    expect(full.members).toEqual(members.members);
    expect(full.pending).toEqual(members.pending);
    expect(full.family).toEqual(members.family);
    expect(full.relationships).toEqual(rels.relationships);
  });

  it("GET /api/cards and GET /api/waiting", async () => {
    const a = await measure(async () => (await cardsRoute(get("/api/cards"))).status);
    const b = await measure(async () => (await waitingRoute(get("/api/waiting"))).status);
    report("GET /api/cards", a);
    report("GET /api/waiting", b);
    expect([a.out, b.out]).toEqual([200, 200]);
    expect(a.calls).toBeLessThanOrEqual(BUDGET.cards.calls);
    expect(a.depth).toBeLessThanOrEqual(BUDGET.cards.depth);
    expect(b.calls).toBeLessThanOrEqual(BUDGET.waiting.calls);
    expect(b.depth).toBeLessThanOrEqual(BUDGET.waiting.depth);
  });

  it("GET /api/members and GET /api/relationships", async () => {
    const a = await measure(async () => (await membersRoute(get("/api/members"))).status);
    const b = await measure(async () => (await relationshipsRoute(get("/api/relationships"))).status);
    report("GET /api/members", a);
    report("GET /api/relationships", b);
    expect([a.out, b.out]).toEqual([200, 200]);
    expect(a.calls).toBeLessThanOrEqual(BUDGET.members.calls);
    expect(a.depth).toBeLessThanOrEqual(BUDGET.members.depth);
    expect(b.calls).toBeLessThanOrEqual(BUDGET.relationships.calls);
    expect(b.depth).toBeLessThanOrEqual(BUDGET.relationships.depth);
  });

  it("POST /api/sides switch is one wave, and only to a home this person has", async () => {
    const sides = (await (await sidesGet(get("/api/sides"))).json()) as { sides: { familyId: string; name: string; people: number; fresh: number }[] };
    const other = sides.sides.find((s) => s.familyId !== familyId);
    expect(other).toBeDefined();
    const post = (body: unknown) => sidesPost(new Request("http://test/api/sides", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
    const m = await measure(async () => (await post({ action: "switch", familyId: other!.familyId })).json() as Promise<{ familyId: string; memberId: string }>);
    report("POST /api/sides switch", m);
    expect(m.out.familyId).toBe(other!.familyId);
    expect(m.calls).toBeLessThanOrEqual(BUDGET.sideSwitch.calls);
    expect(m.depth).toBeLessThanOrEqual(BUDGET.sideSwitch.depth);
    expect((await post({ action: "switch", familyId: "demo-family" })).status).toBe(403);
    expect((await post({ action: "switch", familyId: "fam-someone-else" })).status).toBe(403);
  });

  it("the sides read with the side's people and week embedded answer what the separate reads answer", async () => {
    const embedded = (await (await sidesGet(get("/api/sides"))).json()) as { sides: unknown[] };
    // Without the embed (an older database, or PostgREST refusing it) the same answer comes from separate reads.
    const realFrom = h.fake.from;
    h.fake.from = (t: string) => {
      const q = realFrom(t) as Record<string, unknown>;
      const select = q.select as (c?: string) => unknown;
      return { ...q, select: (c?: string) => select(c?.replace(/, families\(.*\)$/, "")) } as unknown as ReturnType<typeof realFrom>;
    };
    try {
      const separate = (await (await sidesGet(get("/api/sides"))).json()) as { sides: unknown[] };
      expect(separate.sides).toEqual(embedded.sides);
    } finally {
      h.fake.from = realFrom;
    }
  });

  it("the demo sign-in waits for three waves", async () => {
    h.reset();
    const res = await session(new Request("http://test/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.2.0.1" }, body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId: "arjun" }) }));
    const waited = h.stats.tick;
    expect(res.status).toBe(200);
    console.log(`[round-trips] POST /api/session (demo sign-in): waited ${waited} waves`);
    expect(waited).toBeLessThanOrEqual(BUDGET.signIn.depth);
    await sandboxIdle();
  });
});

describe("the sky never holds the window", () => {
  it("answers with no weather after about 600 ms when the weather service hangs", async () => {
    vi.stubGlobal("fetch", () => new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 3000)));
    const t0 = Date.now();
    const state = await windowState(familyId, memberId);
    const ms = Date.now() - t0;
    expect(state.weather).toBeNull();
    expect(ms).toBeGreaterThanOrEqual(550);
    expect(ms).toBeLessThan(1400);
    await new Promise((r) => setTimeout(r, 2600)); // let the hung lookups end before the next test
  }, 10_000);
});
