// Validated document store behind Kitchen, presence, care, local helpers, sittings,
// weekly questions and the Muse call log. Postgres (family_docs, jsonb) when
// live; an in-memory map in mock mode and as a fallback, matching lib/db.ts.
// Every row is parsed with its kind's schema on the way in and out; a bad
// row is skipped and logged, never served. Demo families stay in memory
// (dbFor returns null for them), for reads and writes.
import { DbWriteError, dbFor } from "./family-db";
import { DOC_SCHEMAS, type DocKind, type DocOf } from "./kinds";

type Row = { familyId: string; kind: DocKind; data: { id: string } & Record<string, unknown>; createdAt: string };
const mem = new Map<string, Row>();

function memKey(familyId: string, id: string): string {
  return `${familyId}::${id}`;
}

function parse<K extends DocKind>(kind: K, data: unknown): DocOf<K> | null {
  const out = DOC_SCHEMAS[kind].safeParse(data);
  if (!out.success) {
    console.error(`[family-docs] skipped malformed ${kind}`, (data as { id?: unknown } | null)?.id, out.error.issues[0]?.message);
    return null;
  }
  return out.data as DocOf<K>;
}

function memList<K extends DocKind>(familyId: string, kind: K): DocOf<K>[] {
  const rows: DocOf<K>[] = [];
  mem.forEach((r) => {
    if (r.familyId !== familyId || r.kind !== kind) return;
    const d = parse(kind, r.data);
    if (d) rows.push(d);
  });
  return rows;
}

function newest<T>(rows: T[]): T[] {
  const at = (r: T) => String((r as Record<string, unknown>).createdAt ?? (r as Record<string, unknown>).at ?? (r as Record<string, unknown>).updatedAt ?? "");
  return rows.sort((a, b) => at(b).localeCompare(at(a)));
}

/**
 * The family's rows of one kind, newest first. Live, that is the newest 500 rows
 * unless `sinceMs` asks for a time window instead (rows written in the last
 * `sinceMs`, up to 3000): kinds that pile up fast, like heartbeats, would
 * otherwise push the days a screen needs out of the 500.
 */
export async function listDocs<K extends DocKind>(familyId: string, kind: K, opts: { sinceMs?: number } = {}): Promise<DocOf<K>[]> {
  const local = memList(familyId, kind);
  const sb = dbFor(familyId);
  if (!sb) return newest(local);
  let q = sb.from("family_docs").select("data").eq("family_id", familyId).eq("kind", kind);
  if (opts.sinceMs) q = q.gte("created_at", new Date(Date.now() - opts.sinceMs).toISOString());
  const { data, error } = await q.order("created_at", { ascending: false }).limit(opts.sinceMs ? 3000 : 500);
  if (error || !data) return newest(local);
  const rows = data.map((r) => parse(kind, (r as { data: unknown }).data)).filter((d): d is DocOf<K> => d !== null);
  return newest(rows);
}

/**
 * Several kinds for one family in ONE round trip (`kind in (...)`), split by
 * kind and validated per kind exactly as listDocs does. Each kind keeps the
 * newest-500 rule: the single query asks for 500 per kind, and if it comes back
 * full (one chatty kind could have crowded another out) it falls back to one
 * listDocs per kind, so the answer never differs from separate calls.
 */
export async function listDocsMany<const Ks extends readonly DocKind[]>(familyId: string, kinds: Ks): Promise<{ [K in Ks[number]]: DocOf<K>[] }> {
  return (await listDocsManyWith(familyId, kinds, [])).docs;
}

/** Raw rows of other family_docs kinds (stores with their own schema: events, ritual settings), newest first. */
export type RawDocRows = Map<string, { id: string; data: unknown }[]>;

/**
 * listDocsMany, plus the raw rows of `extraKinds` read in the SAME query, so
 * the stores that keep their own kinds in family_docs (lib/gather-store.ts,
 * lib/occasion-settings.ts) ride along instead of costing round trips of their
 * own. `extra` is null when they weren't read (no database, an error, or a
 * full answer): the caller then asks those stores as usual.
 */
export async function listDocsManyWith<const Ks extends readonly DocKind[]>(familyId: string, kinds: Ks, extraKinds: readonly string[]): Promise<{ docs: { [K in Ks[number]]: DocOf<K>[] }; extra: RawDocRows | null }> {
  const out = {} as { [K in Ks[number]]: DocOf<K>[] };
  const unique = Array.from(new Set(kinds)) as Ks[number][];
  const extras = Array.from(new Set(extraKinds)).filter((k) => !(unique as readonly string[]).includes(k));
  const sb = dbFor(familyId);
  const separately = async () => {
    const lists = await Promise.all(unique.map((k) => listDocs(familyId, k)));
    unique.forEach((k, i) => ((out as Record<string, unknown>)[k] = lists[i]));
    return { docs: out, extra: null };
  };
  if (!sb) return separately();
  const limit = 500 * (unique.length + extras.length);
  const { data, error } = await sb.from("family_docs").select("id, kind, data").eq("family_id", familyId).in("kind", [...unique, ...extras]).order("created_at", { ascending: false }).limit(limit);
  if (error || !data || data.length >= limit) return separately();
  const by = new Map<string, unknown[]>(unique.map((k) => [k, []]));
  const extra: RawDocRows = new Map(extras.map((k) => [k, []]));
  for (const r of data as { id: string; kind: string; data: unknown }[]) {
    by.get(r.kind)?.push(r.data);
    extra.get(r.kind)?.push({ id: r.id, data: r.data });
  }
  for (const k of unique) {
    // Rows that are in the database are the answer; memory only stands in on error (as listDocs).
    const rows = (by.get(k) ?? []).slice(0, 500).map((d) => parse(k, d)).filter((d): d is DocOf<typeof k> => d !== null);
    (out as Record<string, unknown>)[k] = newest(rows);
  }
  return { docs: out, extra };
}

/**
 * Every row of one kind, paged past listDocs' newest-500 window. For the daily
 * purge only: expired rows are the OLD ones, which the newest-500 list never reaches.
 */
export async function listAllDocs<K extends DocKind>(familyId: string, kind: K, cap = 5000): Promise<DocOf<K>[]> {
  const sb = dbFor(familyId);
  if (!sb) return memList(familyId, kind);
  const rows: DocOf<K>[] = [];
  for (let from = 0; from < cap; from += 500) {
    const { data, error } = await sb.from("family_docs").select("data").eq("family_id", familyId).eq("kind", kind).order("created_at", { ascending: true }).range(from, from + 499);
    if (error || !data) break;
    for (const r of data) {
      const d = parse(kind, (r as { data: unknown }).data);
      if (d) rows.push(d);
    }
    if (data.length < 500) break;
  }
  return rows;
}

export async function getDoc<K extends DocKind>(familyId: string, kind: K, id: string): Promise<DocOf<K> | undefined> {
  const sb = dbFor(familyId);
  if (!sb) return memList(familyId, kind).find((d) => (d as { id: string }).id === id);
  // One row by its key, not the newest 500 filtered in code (older docs would vanish).
  const { data, error } = await sb.from("family_docs").select("data").eq("id", `${familyId}:${id}`).eq("kind", kind).maybeSingle();
  if (error) return memList(familyId, kind).find((d) => (d as { id: string }).id === id);
  if (!data) return undefined;
  return parse(kind, (data as { data: unknown }).data) ?? undefined;
}

/** Insert or replace by id. Throws on schema violation (callers validate input first). */
export async function putDoc<K extends DocKind>(familyId: string, kind: K, input: unknown): Promise<DocOf<K>> {
  const data = DOC_SCHEMAS[kind].parse(input) as DocOf<K>;
  const row = data as unknown as { id: string } & Record<string, unknown>;
  const sb = dbFor(familyId);
  if (!sb) {
    mem.set(memKey(familyId, row.id), { familyId, kind, data: row, createdAt: new Date().toISOString() });
    return data;
  }
  const { error } = await sb
    .from("family_docs")
    .upsert({ id: `${familyId}:${row.id}`, family_id: familyId, kind, data: row, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new DbWriteError("family_docs", error.message);
  return data;
}

/**
 * Insert only if no row has this id: true when this call created it, false when
 * it already existed (another request, possibly on another Worker, got there
 * first). The one-at-a-time guard for "single use" things. Throws on a write failure.
 */
export async function claimDoc<K extends DocKind>(familyId: string, kind: K, input: unknown): Promise<boolean> {
  const data = DOC_SCHEMAS[kind].parse(input) as DocOf<K>;
  const row = data as unknown as { id: string } & Record<string, unknown>;
  const sb = dbFor(familyId);
  if (!sb) {
    if (mem.has(memKey(familyId, row.id))) return false;
    mem.set(memKey(familyId, row.id), { familyId, kind, data: row, createdAt: new Date().toISOString() });
    return true;
  }
  const { error } = await sb.from("family_docs").insert({ id: `${familyId}:${row.id}`, family_id: familyId, kind, data: row, updated_at: new Date().toISOString() });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw new DbWriteError("family_docs", error.message);
}

export async function deleteDoc(familyId: string, kind: DocKind, id: string): Promise<void> {
  mem.delete(memKey(familyId, id));
  const sb = dbFor(familyId);
  if (!sb) return;
  await sb.from("family_docs").delete().eq("id", `${familyId}:${id}`).eq("kind", kind);
}

/** Remove everything a member authored or that is about them (Leave family). */
export async function deleteDocsForMember(familyId: string, memberId: string): Promise<void> {
  const fields = ["memberId", "cookId", "forMemberId", "askedBy", "toMemberId", "hostId", "addedBy", "fromMemberId", "byMemberId"];
  mem.forEach((r, key) => {
    if (r.familyId === familyId && fields.some((f) => r.data[f] === memberId)) mem.delete(key);
  });
  const sb = dbFor(familyId);
  if (!sb) return;
  for (const f of fields) await sb.from("family_docs").delete().eq("family_id", familyId).eq(`data->>${f}`, memberId);
}

/** Every in-memory document of one family, as stored (the demo copy reads the seed this way). */
export function memDocsOf(familyId: string): { kind: DocKind; data: { id: string } & Record<string, unknown> }[] {
  const out: { kind: DocKind; data: { id: string } & Record<string, unknown> }[] = [];
  mem.forEach((r) => {
    if (r.familyId === familyId) out.push({ kind: r.kind, data: r.data });
  });
  return out;
}

export function resetDocs(): void {
  mem.clear();
}

/** Seed in-memory rows (demo family) without touching the database. */
export function seedDoc<K extends DocKind>(familyId: string, kind: K, input: unknown): void {
  const data = DOC_SCHEMAS[kind].parse(input) as unknown as { id: string } & Record<string, unknown>;
  mem.set(memKey(familyId, data.id), { familyId, kind, data, createdAt: new Date().toISOString() });
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}
