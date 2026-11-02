// The public demo, persisted per visitor.
//
// Cloudflare runs many isolates and memory isn't shared between them, so a
// demo write kept in memory is gone on the next request. Instead, entering
// the demo copies the synthetic seed into the database as the visitor's own
// family ("sandbox"): `demo-v-<12 hex>` (Sharma side) and
// `demo-v-<12 hex>-iyer` (Iyer side). From then on the demo runs on exactly
// the code path a real family uses. Strangers never see each other's uploads,
// and the daily cron deletes sandboxes (rows and media) after 48 hours.
//
// Server only. Pure helpers (buildSandbox, sandbox ids) are unit-tested; the
// writes need a live database.
import { createHash } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardRow, memberRow } from "./db";
import { DEMO_SHELF_CARDS } from "./demo";
import { DEMO_FAMILY_IDS, SANDBOX_PREFIX, isSandboxFamily, isSeedFamily } from "./family";
import { memDocsOf } from "./family-docs";
import type { DocKind } from "./kinds";
import { ritualRunId } from "./rituals";
import { MEDIA_BUCKET } from "./storage";
import type { AgentRun, Card, Consent, DailyRole, GatherSession, Member, Play, Reaction, Relationship, RitualRun, Suggestion, Wish } from "./schemas";
import {
  familyName,
  getMember,
  listAgentRuns,
  listCards,
  listConsents,
  listDailyRoles,
  listGatherSessions,
  listMembers,
  listPlays,
  listReactions,
  listRelationships,
  listRitualRuns,
  listSuggestions,
  listWishes,
  resetDemo,
} from "./store";

/** Sandboxes older than this are deleted by the daily cron. */
export const SANDBOX_TTL_HOURS = 48;
/** New sandboxes allowed per hour across all visitors (cost and abuse ceiling). */
export const SANDBOX_HOURLY_CAP = 400;
/** Copies one caller (by address) may make per hour. */
export const SANDBOX_CALLER_CAP = 5;

/** What is stored of a caller key: a short hash, never the address. */
export const callerHash = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 16);

export interface SeedSnapshot {
  members: Member[];
  relationships: Relationship[];
  cards: Card[];
  plays: Play[];
  reactions: Reaction[];
  ritualRuns: RitualRun[];
  wishes: Wish[];
  dailyRoles: DailyRole[];
  gatherSessions: GatherSession[];
  suggestions: Suggestion[];
  agentRuns: AgentRun[];
  consents: Consent[];
  docs: { familyId: string; kind: DocKind; data: { id: string } & Record<string, unknown> }[];
  families: { id: string; name: string }[];
}

export function newVisitorId(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The visitor id inside a sandbox family id, or null. */
export function visitorOf(familyId: string): string | null {
  if (!isSandboxFamily(familyId)) return null;
  return familyId.slice(SANDBOX_PREFIX.length, SANDBOX_PREFIX.length + 12);
}

/** The visitor's copy of a seed family: demo-family -> demo-v-<vid>, demo-iyer -> demo-v-<vid>-iyer. */
export function sandboxFamilyId(seedFamilyId: string, vid: string): string {
  return seedFamilyId === "demo-family" ? `${SANDBOX_PREFIX}${vid}` : `${SANDBOX_PREFIX}${vid}-${seedFamilyId.replace(/^demo-/, "")}`;
}

/** The visitor's copy of a seed id (member, card, relationship…). Database ids are global, so every copy gets its own. */
export function sandboxId(seedId: string, vid: string): string {
  return `${vid}-${seedId}`;
}

/** A member of the seed (either side), from memory: entering the demo looks the seed person up without a round trip. */
export function seedMemberOf(id: string): Member | undefined {
  const m = getMember(id);
  return m && isSeedFamily(m.familyId) ? m : undefined;
}

/** A pristine, fresh-dated snapshot of the seed (both sides), straight from the demo store. */
export function seedSnapshot(): SeedSnapshot {
  // Rebuild the seed so "20 minutes ago" means now. With the database live no
  // session ever writes to the seed (see sessionFromRequest), so this is safe.
  resetDemo();
  const seed = (r: { familyId?: string | null }) => isSeedFamily(r.familyId ?? "");
  const cards = listCards().filter(seed);
  const have = new Set(cards.map((c) => c.id));
  return {
    members: listMembers().filter(seed),
    relationships: listRelationships().filter(seed),
    cards: [...cards, ...DEMO_SHELF_CARDS.filter((c) => seed(c) && !have.has(c.id))],
    plays: listPlays().filter(seed),
    reactions: listReactions().filter(seed),
    ritualRuns: listRitualRuns().filter(seed),
    wishes: listWishes().filter(seed),
    dailyRoles: listDailyRoles().filter(seed),
    gatherSessions: listGatherSessions().filter(seed),
    suggestions: listSuggestions().filter(seed),
    agentRuns: listAgentRuns().filter(seed),
    consents: DEMO_FAMILY_IDS.flatMap((f) => listConsents(f)),
    docs: DEMO_FAMILY_IDS.flatMap((f) => memDocsOf(f).map((d) => ({ familyId: f as string, ...d }))),
    families: DEMO_FAMILY_IDS.map((f) => ({ id: f as string, name: familyName(f) ?? "Family" })),
  };
}

/**
 * The visitor's copy: every family id and every global id remapped, and every
 * reference to them (anywhere in card, doc or payload data) rewritten to match.
 * Pure: no I/O.
 */
export function buildSandbox(snap: SeedSnapshot, vid: string): { snapshot: SeedSnapshot; idMap: Map<string, string> } {
  const map = new Map<string, string>();
  for (const f of snap.families) map.set(f.id, sandboxFamilyId(f.id, vid));
  const famOf = (seedFam: string) => map.get(seedFam) ?? seedFam;
  for (const m of snap.members) {
    map.set(m.id, sandboxId(m.id, vid));
    if (m.personId) map.set(m.personId, sandboxId(m.personId, vid));
  }
  for (const rows of [snap.cards, snap.relationships, snap.plays, snap.reactions, snap.wishes, snap.dailyRoles, snap.gatherSessions, snap.suggestions, snap.agentRuns, snap.consents]) {
    for (const r of rows as { id: string }[]) map.set(r.id, sandboxId(r.id, vid));
  }
  // Ritual runs keep the id the app derives (lib/rituals.ritualRunId), so a
  // later dbEnsureRitualRun finds the copied run instead of making a second.
  for (const r of snap.ritualRuns) map.set(r.id, ritualRunId(famOf(r.familyId), r.ritualSlug, r.occasionDate));

  const remap = <T>(v: T): T => {
    if (typeof v === "string") return (map.get(v) ?? v) as T;
    if (Array.isArray(v)) return v.map(remap) as T;
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = remap(x);
      return out as T;
    }
    return v;
  };
  return {
    idMap: map,
    snapshot: {
      members: snap.members.map(remap),
      relationships: snap.relationships.map(remap),
      cards: snap.cards.map(remap),
      plays: snap.plays.map(remap),
      reactions: snap.reactions.map(remap),
      ritualRuns: snap.ritualRuns.map(remap),
      wishes: snap.wishes.map(remap),
      dailyRoles: snap.dailyRoles.map(remap),
      gatherSessions: snap.gatherSessions.map(remap),
      suggestions: snap.suggestions.map(remap),
      agentRuns: snap.agentRuns.map(remap),
      consents: snap.consents.map(remap),
      // Doc ids are scoped by family in the table ("<family>:<id>"); their
      // contents still point at members and cards, so they're remapped too.
      docs: snap.docs.map((d) => ({ familyId: famOf(d.familyId), kind: d.kind, data: remap(d.data) })),
      families: snap.families.map((f) => ({ id: famOf(f.id), name: f.name })),
    },
  };
}

/** The database rows for a built sandbox, per table, in insert order (parents first). */
export function sandboxRows(s: SeedSnapshot): { table: string; rows: Record<string, unknown>[]; required: boolean }[][] {
  return [
    [{ table: "families", required: true, rows: s.families.map((f) => ({ id: f.id, name: f.name })) }],
    [{ table: "members", required: true, rows: s.members.map(memberRow) }],
    [
      { table: "relationships", required: true, rows: s.relationships.map((r) => ({ id: r.id, family_id: r.familyId, member_id: r.memberId, relation_member_id: r.relationMemberId, relation: r.relation })) },
      { table: "cards", required: true, rows: s.cards.map(cardRow) },
      { table: "ritual_runs", required: false, rows: s.ritualRuns.map((r) => ({ id: r.id, family_id: r.familyId, ritual_slug: r.ritualSlug, occasion_date: r.occasionDate, status: r.status, created_at: r.createdAt })) },
      { table: "daily_roles", required: false, rows: s.dailyRoles.map((r) => ({ id: r.id, family_id: r.familyId, member_id: r.memberId, role_date: r.roleDate, prompt: r.prompt })) },
      { table: "gather_sessions", required: false, rows: s.gatherSessions.map((g) => ({ id: g.id, family_id: g.familyId, title: g.title, starts_at: g.startsAt, invites: g.invites, playlist: g.playlist, created_at: g.createdAt })) },
      { table: "suggestions", required: false, rows: s.suggestions.map((x) => ({ id: x.id, family_id: x.familyId, goal: x.goal, payload: x.payload, status: x.status, created_at: x.createdAt })) },
      { table: "agent_runs", required: false, rows: s.agentRuns.map((a) => ({ id: a.id, family_id: a.familyId, goal: a.goal, tools: a.tools, status: a.status, created_at: a.createdAt })) },
      { table: "consents", required: false, rows: s.consents.map((c) => ({ id: c.id, family_id: c.familyId, member_id: c.memberId, parent_member_id: c.parentMemberId, kind: c.kind, method: c.method, created_at: c.createdAt })) },
      { table: "family_docs", required: false, rows: s.docs.map((d) => ({ id: `${d.familyId}:${d.data.id}`, family_id: d.familyId, kind: d.kind, data: d.data })) },
    ],
    [
      { table: "plays", required: false, rows: s.plays.map((p) => ({ id: p.id, family_id: p.familyId, card_id: p.cardId, member_id: p.memberId, played_at: p.playedAt })) },
      { table: "reactions", required: false, rows: s.reactions.map((r) => ({ id: r.id, family_id: r.familyId, card_id: r.cardId, member_id: r.memberId, kind: r.kind, created_at: r.createdAt })) },
      { table: "wishes", required: false, rows: s.wishes.map((w) => ({ id: w.id, family_id: w.familyId, ritual_run_id: w.ritualRunId, card_id: w.cardId, member_id: w.memberId, kind: w.kind, created_at: w.createdAt })) },
    ],
  ];
}

async function insertAll(sb: SupabaseClient, table: string, rows: Record<string, unknown>[]): Promise<string | null> {
  if (rows.length === 0) return null;
  // Missing keys take the column default (not null): rows differ in which optional columns they send.
  const { error } = await sb.from(table).insert(rows, { defaultToNull: false });
  if (!error) return null;
  if (table === "cards" && /place|note/.test(error.message)) {
    // A database without the newer cards columns: same as dbAddCard, send them only when present.
    const { error: e2 } = await sb.from(table).insert(rows.map(({ place: _p, note: _n, ...r }) => r), { defaultToNull: false });
    return e2 ? e2.message : null;
  }
  return error.message;
}

/** Remove a sandbox's rows (families cascade; family_docs and shares aren't linked by key). */
async function dropSandbox(sb: SupabaseClient, familyIds: string[]): Promise<void> {
  await sb.from("family_docs").delete().in("family_id", familyIds);
  await sb.from("families").delete().in("id", familyIds);
}

export type CreateSandboxResult = { ok: true; vid: string; idMap: Map<string, string>; members: Member[] } | { ok: false; error: "busy" | "failed" };

/**
 * Tables the first screens never read: copied after the visitor is already in
 * (lib/push/background.ts inBackground, which keeps the Worker alive for them).
 * Plays, reactions and wishes also wait on the cards and ritual runs, so they
 * go last either way.
 */
export const SANDBOX_LATER_TABLES = new Set(["daily_roles", "gather_sessions", "agent_runs", "consents", "plays", "reactions", "wishes"]);

const later = new Set<Promise<unknown>>();

/** Tests: wait for the copies createSandbox left running after it answered. */
export async function sandboxIdle(): Promise<void> {
  while (later.size) await Promise.allSettled(Array.from(later));
}

async function copyStage(sb: SupabaseClient, stage: { table: string; rows: Record<string, unknown>[]; required: boolean }[]): Promise<{ table: string; required: boolean }[]> {
  const results = await Promise.all(stage.map(async (t) => ({ t, err: await insertAll(sb, t.table, t.rows) })));
  const failed: { table: string; required: boolean }[] = [];
  for (const { t, err } of results) {
    if (!err) continue;
    console.error(`[demo-sandbox] ${t.table} copy failed`, err);
    failed.push({ table: t.table, required: t.required });
  }
  return failed;
}

/**
 * Copy the seed into the database for one visitor, both sides. The visitor
 * waits for three waves of round trips: the abuse brakes counted alongside the
 * family rows, the members, then everything the first screens read (each wave
 * at most five requests, under the Worker's six open connections). The rest
 * (SANDBOX_LATER_TABLES) is copied after the answer. A required table failing
 * removes the partial copy.
 */
export async function createSandbox(sb: SupabaseClient, callerKey: string | null): Promise<CreateSandboxResult> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const caller = callerKey ? callerHash(callerKey) : null;
  const vid = newVisitorId();
  const { snapshot, idMap } = buildSandbox(seedSnapshot(), vid);
  const families = snapshot.families.map((f) => f.id);
  const stages = sandboxRows(snapshot);
  // Only the main copy carries the caller (the column is sent only when there is one).
  if (caller) stages[0][0].rows[0] = { ...stages[0][0].rows[0], demo_caller: caller };

  // Wave 1: the brakes are counted while the family rows go in; this copy's own rows are never counted.
  let mineQ = sb.from("families").select("id", { count: "exact", head: true }).eq("demo_caller", caller ?? "").gte("created_at", since);
  let allQ = sb.from("families").select("id", { count: "exact", head: true }).like("id", `${SANDBOX_PREFIX}%`).gte("created_at", since);
  for (const id of families) {
    mineQ = mineQ.neq("id", id);
    allQ = allQ.neq("id", id);
  }
  const [mine, all, famFailed] = await Promise.all([
    // Per-caller brake: one address can't fill the table with copies.
    caller ? mineQ : Promise.resolve({ count: 0 }),
    allQ,
    copyStage(sb, stages[0]),
  ]);
  const busy = (mine.count ?? 0) >= SANDBOX_CALLER_CAP || (all.count ?? 0) >= SANDBOX_HOURLY_CAP;
  if (busy || famFailed.length) {
    if (!famFailed.length) await dropSandbox(sb, families).catch(() => null);
    return { ok: false, error: busy ? "busy" : "failed" };
  }

  // Wave 2: the people. Wave 3: what the first screens read.
  const now = stages[2].filter((t) => !SANDBOX_LATER_TABLES.has(t.table));
  for (const stage of [stages[1], now]) {
    const failed = await copyStage(sb, stage);
    if (failed.some((f) => f.required)) {
      await dropSandbox(sb, families).catch(() => null);
      return { ok: false, error: "failed" };
    }
    // Wishes point at ritual runs; if those didn't copy, keep the wishes without the link.
    if (failed.some((f) => f.table === "ritual_runs")) snapshot.wishes = snapshot.wishes.map((w) => ({ ...w, ritualRunId: null }));
  }

  // After the answer: the tables nothing on the first screens reads, then the ones that point at cards.
  const rest = sandboxRows(snapshot);
  const run = (async () => {
    await copyStage(sb, rest[2].filter((t) => SANDBOX_LATER_TABLES.has(t.table)));
    await copyStage(sb, rest[3]);
  })().catch((e: unknown) => console.error("[demo-sandbox] later copy failed", String(e)));
  later.add(run);
  void run.finally(() => later.delete(run));
  try {
    after(() => run);
  } catch {
    /* not inside a request (tests, scripts): the promise simply runs */
  }
  return { ok: true, vid, idMap, members: snapshot.members };
}

/** Storage paths a sandbox's rows point at (`storage:<family>/…`). */
function storagePaths(rows: Record<string, unknown>[], families: string[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    for (const v of Object.values(r)) {
      if (typeof v !== "string" || !v.startsWith("storage:")) continue;
      const path = v.slice("storage:".length);
      if (families.some((f) => path.startsWith(`${f}/`))) out.push(path);
    }
  }
  return out;
}

/**
 * Delete sandboxes older than SANDBOX_TTL_HOURS: their media first (found
 * through the rows that point at it; an upload no card ever used is left in
 * the bucket), then the rows. Bounded per run so the cron stays inside the subrequest budget;
 * the next day's run takes the rest.
 */
export async function purgeSandboxes(sb: SupabaseClient, now = Date.now(), maxFamilies = 40): Promise<{ families: number; objects: number }> {
  const cutoff = new Date(now - SANDBOX_TTL_HOURS * 3_600_000).toISOString();
  const { data } = await sb.from("families").select("id").like("id", `${SANDBOX_PREFIX}%`).lt("created_at", cutoff).limit(maxFamilies);
  const families = (data ?? []).map((r) => String((r as { id: unknown }).id)).filter(isSandboxFamily);
  if (families.length === 0) return { families: 0, objects: 0 };
  const [cards, members] = await Promise.all([
    sb.from("cards").select("media_ref, cover_ref").in("family_id", families),
    sb.from("members").select("photo_ref, home_image_ref").in("family_id", families),
  ]);
  const paths = new Set(storagePaths([...((cards.data ?? []) as Record<string, unknown>[]), ...((members.data ?? []) as Record<string, unknown>[])], families));
  let objects = 0;
  const list = [...paths];
  for (let i = 0; i < list.length; i += 900) {
    const { data: removed } = await sb.storage.from(MEDIA_BUCKET).remove(list.slice(i, i + 900));
    objects += removed?.length ?? 0;
  }
  await dropSandbox(sb, families);
  await sb.from("public_shares").delete().in("family_id", families);
  return { families: families.length, objects };
}
