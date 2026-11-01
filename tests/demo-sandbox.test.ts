// Each demo visitor gets their own copy of the seed in the database
// (lib/demo-sandbox.ts). The database here is an in-memory fake with just
// enough of the PostgREST builder (insert/select/delete with eq, in, like,
// gte, lt) to run the real code paths; nothing touches the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables = new Map<string, Row[]>();
  const removed: string[] = [];
  const rows = (t: string) => tables.get(t) ?? (tables.set(t, []), tables.get(t)!);
  const like = (v: unknown, pat: string) => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`).test(String(v));
  function builder(t: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "delete" | "update" = "select";
    let patch: Row = {};
    let head = false;
    let lim = Infinity;
    const run = () => {
      const all = rows(t);
      const hit = all.filter((r) => filters.every((f) => f(r)));
      if (op === "delete") tables.set(t, all.filter((r) => !hit.includes(r)));
      if (op === "update") hit.forEach((r) => Object.assign(r, patch));
      const data = hit.slice(0, lim).map((r) => ({ ...r }));
      return { data: head ? null : data, error: null, count: hit.length };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), b),
      delete: () => ((op = "delete"), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      like: (k: string, p: string) => (filters.push((r) => like(r[k], p)), b),
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), b),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), b),
      not: () => b,
      or: () => b,
      order: () => b,
      limit: (n: number) => ((lim = n), b),
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => void) => res(run()),
    };
    return b;
  }
  const fake = {
    from: (t: string) => ({
      ...builder(t),
      insert: (input: Row | Row[]) => {
        const list = Array.isArray(input) ? input : [input];
        const ids = new Set(rows(t).map((r) => r.id));
        if (list.some((r) => r.id !== undefined && ids.has(r.id))) return Promise.resolve({ error: { message: `duplicate key in ${t}` } });
        list.forEach((r) => rows(t).push({ created_at: new Date().toISOString(), ...r }));
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
    storage: {
      from: () => ({
        remove: async (paths: string[]) => (removed.push(...paths), { data: paths.map((name) => ({ name })), error: null }),
        createSignedUploadUrl: async () => ({ data: { signedUrl: "https://bucket.test/up" }, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "https://bucket.test/get" }, error: null }),
      }),
    },
  };
  return { tables, removed, fake };
});

vi.mock("@/lib/supabase", () => ({ isDbLive: () => true, supabaseServer: () => h.fake }));

import { POST as session, GET as whoami } from "@/app/api/session/route";
import { POST as switchTo } from "@/app/api/session/switch/route";
import { requireSession } from "@/lib/auth";
import { dbAddCard, dbListCards, dbListMembers, dbListRelationships } from "@/lib/db";
import { buildSandbox, createSandbox, purgeSandboxes, sandboxFamilyId, seedSnapshot, visitorOf } from "@/lib/demo-sandbox";
import { isDemoFamily, isSandboxFamily, isSeedFamily } from "@/lib/family";
import { dbFor } from "@/lib/family-db";
import { listDocs } from "@/lib/family-docs";
import { createUploadUrl, storagePath } from "@/lib/storage";
import { sessionCookie } from "./auth-helper";

const enter = (memberId = "arjun", cookie = "") =>
  session(new Request("http://test/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId }) }));
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

beforeEach(() => {
  vi.stubEnv("MOCK", "false");
  vi.stubEnv("META_API_KEY", "test-not-a-key");
  h.tables.clear();
  h.removed.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("sandbox ids", () => {
  it("tells the seed, a visitor copy and a real family apart", () => {
    expect(isSeedFamily("demo-family")).toBe(true);
    expect(isSandboxFamily("demo-v-0123456789ab")).toBe(true);
    expect(isSandboxFamily("demo-v-0123456789ab-iyer")).toBe(true);
    expect(isSandboxFamily("demo-v-xyz")).toBe(false);
    expect(isDemoFamily("demo-v-0123456789ab")).toBe(true);
    expect(isDemoFamily("fam-0123456789ab")).toBe(false);
    expect(visitorOf("demo-v-0123456789ab-iyer")).toBe("0123456789ab");
    expect(sandboxFamilyId("demo-iyer", "0123456789ab")).toBe("demo-v-0123456789ab-iyer");
  });
});

describe("buildSandbox", () => {
  const snap = seedSnapshot();
  const { snapshot: a } = buildSandbox(snap, "aaaaaaaaaaaa");
  const { snapshot: b } = buildSandbox(snap, "bbbbbbbbbbbb");

  it("copies both sides with every family id moved to the visitor's", () => {
    expect(a.families.map((f) => f.id).sort()).toEqual(["demo-v-aaaaaaaaaaaa", "demo-v-aaaaaaaaaaaa-iyer"]);
    expect(a.members.length).toBe(snap.members.length);
    expect(a.cards.length).toBeGreaterThan(20); // the shelf comes along
    for (const rows of [a.members, a.cards, a.relationships, a.plays, a.reactions, a.wishes, a.ritualRuns]) for (const r of rows as { familyId: string }[]) expect(isSandboxFamily(r.familyId)).toBe(true);
    for (const d of a.docs) expect(isSandboxFamily(d.familyId)).toBe(true);
  });

  it("leaves no seed id behind and keeps every reference pointing inside the copy", () => {
    const seedIds = new Set([...snap.members.map((m) => m.id), ...snap.cards.map((c) => c.id)]);
    const leftovers: string[] = [];
    JSON.stringify(a, (_k, v) => (typeof v === "string" && seedIds.has(v) && leftovers.push(v), v));
    expect(leftovers).toEqual([]);
    const members = new Set(a.members.map((m) => m.id));
    const cards = new Set(a.cards.map((c) => c.id));
    for (const r of a.relationships) expect(members.has(r.memberId) && members.has(r.relationMemberId)).toBe(true);
    for (const c of a.cards) if (c.authorId) expect(members.has(c.authorId)).toBe(true);
    for (const p of a.plays) expect(cards.has(p.cardId) && members.has(p.memberId)).toBe(true);
    const runs = new Set(a.ritualRuns.map((r) => r.id));
    for (const w of a.wishes) if (w.ritualRunId) expect(runs.has(w.ritualRunId)).toBe(true);
  });

  it("gives two visitors disjoint ids", () => {
    const ids = (s: typeof a) => new Set([...s.members, ...s.cards, ...s.relationships, ...s.plays].map((r) => r.id));
    const ia = ids(a);
    expect([...ids(b)].some((id) => ia.has(id))).toBe(false);
  });
});

describe("entering the demo with the database live", () => {
  it("makes the visitor a copy, signs them into it, and their writes persist there", async () => {
    const res = await enter();
    expect(res.status).toBe(200);
    const { familyId, memberId } = (await res.json()) as { familyId: string; memberId: string };
    expect(isSandboxFamily(familyId)).toBe(true);
    expect(dbFor(familyId)).not.toBeNull();
    const cookie = cookieOf(res);
    const auth = await requireSession(new Request("http://test/x", { headers: { cookie } }));
    expect(auth).toMatchObject({ familyId, memberId });

    expect((await dbListMembers(familyId)).length).toBeGreaterThan(5);
    expect((await dbListRelationships(familyId)).length).toBeGreaterThan(5);
    const before = (await dbListCards(familyId)).length;
    expect(before).toBeGreaterThan(20);
    expect((await listDocs(familyId, "recipe")).length).toBeGreaterThan(0);

    // An upload goes to the bucket under the visitor's family, and the card is a row.
    const path = storagePath(familyId, "chai.jpg");
    expect((await createUploadUrl(path, "image/jpeg")).mock).toBe(false);
    await dbAddCard({ familyId, type: "photo", caption: "Chai", lang: "en", takenAt: new Date().toISOString(), source: "upload", mediaRef: `storage:${path}`, authorId: memberId });
    expect((await dbListCards(familyId)).length).toBe(before + 1);
  });

  it("re-entering with the cookie reuses the same copy; persona switch stays inside it", async () => {
    const first = await enter();
    const { familyId } = (await first.json()) as { familyId: string };
    const again = await enter("dadi", cookieOf(first));
    const body = (await again.json()) as { familyId: string; memberId: string };
    expect(body.familyId).toBe(familyId);
    expect(h.tables.get("families")?.length).toBe(2); // one visitor, both sides
    const sw = await switchTo(new Request("http://test/api/session/switch", { method: "POST", headers: { cookie: cookieOf(again) }, body: JSON.stringify({ memberId: body.memberId.replace("dadi", "dada") }) }));
    expect(sw.status).toBe(200);
    const seedSwitch = await switchTo(new Request("http://test/api/session/switch", { method: "POST", headers: { cookie: cookieOf(again) }, body: JSON.stringify({ memberId: "dada" }) }));
    expect(seedSwitch.status).toBe(404);
  });

  it("two visitors never share a family", async () => {
    const a = (await (await enter()).json()) as { familyId: string };
    const b = (await (await enter()).json()) as { familyId: string };
    expect(a.familyId).not.toBe(b.familyId);
  });

  it("an old cookie on the seed is turned away", async () => {
    const res = await whoami(new Request("http://test/api/session", { headers: { cookie: sessionCookie() } }));
    expect(res.status).toBe(401);
  });
});

describe("purge", () => {
  it("deletes copies past 48 hours with their media, and keeps fresh ones and real families", async () => {
    const sb = h.fake as unknown as Parameters<typeof createSandbox>[0];
    const old = await createSandbox(sb, null);
    const fresh = await createSandbox(sb, null);
    if (!old.ok || !fresh.ok) throw new Error("sandbox");
    const oldFam = `demo-v-${old.vid}`;
    h.tables.get("families")!.push({ id: "fam-real00000001", name: "Real", created_at: "2020-01-01T00:00:00.000Z" });
    for (const f of h.tables.get("families")!) if (String(f.id).startsWith(oldFam)) f.created_at = "2020-01-01T00:00:00.000Z";
    await dbAddCard({ familyId: oldFam, type: "photo", caption: "x", lang: "en", takenAt: new Date().toISOString(), source: "upload", mediaRef: `storage:${oldFam}/uploads/u1/a.jpg` });
    const out = await purgeSandboxes(sb);
    expect(out.families).toBe(2);
    expect(h.removed).toEqual([`${oldFam}/uploads/u1/a.jpg`]);
    const left = h.tables.get("families")!.map((f) => f.id);
    expect(left).toContain("fam-real00000001");
    expect(left).toContain(`demo-v-${fresh.vid}`);
    expect(left.some((id) => String(id).startsWith(oldFam))).toBe(false);
    expect(h.tables.get("family_docs")!.some((d) => String(d.family_id).startsWith(oldFam))).toBe(false);
  });
});

describe("per-caller brake", () => {
  const from = (ip: string, cookie = "") => session(new Request("http://test/api/session", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId: "arjun" }) }));

  it("the 6th copy in an hour from one caller is refused; another caller still gets in", async () => {
    for (let i = 0; i < 5; i++) expect((await from("203.0.113.7")).status).toBe(200);
    const sixth = await from("203.0.113.7");
    expect(sixth.status).toBe(503);
    expect(((await sixth.json()) as { error: string }).error).toBe("demo-busy");
    expect((await from("203.0.113.8")).status).toBe(200);
    // Only a hash of the address is stored, on the main copy.
    const stored = h.tables.get("families")!.filter((f) => f.demo_caller).map((f) => f.demo_caller);
    expect(stored.length).toBe(6);
    expect(stored.every((v) => /^[0-9a-f]{16}$/.test(String(v)))).toBe(true);
  });

  it("a visitor whose cookie still works is not counted again", async () => {
    const cookie = cookieOf(await from("203.0.113.9"));
    for (let i = 0; i < 7; i++) expect((await from("203.0.113.9", cookie)).status).toBe(200);
  });
});
