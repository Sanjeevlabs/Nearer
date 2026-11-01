// Family events and dismissed event prompts. Stored in the family_docs table
// (kinds "event" and "event_dismiss"), validated with Zod on the way in and
// out; in memory in mock mode and as a fallback, like lib/occasion-settings.
// Server only.
import { z } from "zod";
import { EventSchema, type FamilyEvent } from "./events";
import { DbWriteError, dbFor } from "./family-db";

const DismissSchema = z.object({ id: z.string().min(1), memberId: z.string().min(1), key: z.string().min(1).max(160), at: z.string().datetime() });
type Dismiss = z.infer<typeof DismissSchema>;

// On globalThis so a dev-server recompile keeps mock-mode events.
const g = globalThis as typeof globalThis & { __aanganEvents?: Map<string, FamilyEvent>; __aanganEventDismiss?: Map<string, Dismiss> };
const events = (g.__aanganEvents ??= new Map<string, FamilyEvent>());
const dismissals = (g.__aanganEventDismiss ??= new Map<string, Dismiss>());

// Demo families stay in memory (dbFor returns null for them).
const key = (familyId: string, id: string) => `${familyId}::${id}`;

async function listLive<T>(familyId: string, kind: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T[] | null> {
  const sb = dbFor(familyId);
  if (!sb) return null;
  const { data, error } = await sb.from("family_docs").select("data").eq("family_id", familyId).eq("kind", kind).limit(500);
  if (error || !data) return null;
  return data.map((r) => schema.safeParse((r as { data: unknown }).data)).filter((p): p is z.SafeParseSuccess<T> => p.success).map((p) => p.data);
}

async function putLive(familyId: string, kind: string, id: string, data: unknown): Promise<void> {
  const sb = dbFor(familyId);
  if (!sb) return;
  const { error } = await sb.from("family_docs").upsert({ id: `${familyId}:${id}`, family_id: familyId, kind, data, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new DbWriteError("family_docs", error.message);
}

export async function listEvents(familyId: string): Promise<FamilyEvent[]> {
  const local: FamilyEvent[] = [];
  events.forEach((e, k) => {
    if (k.startsWith(`${familyId}::`)) local.push(e);
  });
  const rows = (await listLive(familyId, "event", EventSchema)) ?? [];
  const ids = new Set(rows.map((r) => r.id));
  return [...rows, ...local.filter((e) => !ids.has(e.id))].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export async function getEvent(familyId: string, id: string): Promise<FamilyEvent | undefined> {
  return (await listEvents(familyId)).find((e) => e.id === id);
}

/** Insert or replace. Throws on a schema violation (callers validate input first). */
export async function putEvent(familyId: string, input: unknown): Promise<FamilyEvent> {
  const e = EventSchema.parse(input);
  // Memory copy only once the database took it (or when there is no database).
  await putLive(familyId, "event", e.id, e);
  events.set(key(familyId, e.id), e);
  return e;
}

export async function listDismissed(familyId: string, memberId: string): Promise<string[]> {
  const local: Dismiss[] = [];
  dismissals.forEach((d, k) => {
    if (k.startsWith(`${familyId}::`)) local.push(d);
  });
  const rows = (await listLive(familyId, "event_dismiss", DismissSchema)) ?? [];
  return Array.from(new Set([...rows, ...local].filter((d) => d.memberId === memberId).map((d) => d.key)));
}

export async function dismiss(familyId: string, memberId: string, k: string): Promise<void> {
  const d = DismissSchema.parse({ id: `dismiss-${memberId}-${k}`.slice(0, 200), memberId, key: k, at: new Date().toISOString() });
  await putLive(familyId, "event_dismiss", d.id, d);
  dismissals.set(key(familyId, d.id), d);
}

/** Demo only: plant an event in memory (no database, no await). */
export function seedEvent(familyId: string, input: unknown): void {
  const e = EventSchema.parse(input);
  events.set(key(familyId, e.id), e);
}

export function resetEvents(): void {
  events.clear();
  dismissals.clear();
}

/** The calendar day a dismissal key is about: the last `YYYY-MM-DD` in it (`suggest:<occasion>:<who>:<date>`). */
function keyDay(k: string): string | null {
  return /(\d{4}-\d{2}-\d{2})$/.exec(k)?.[1] ?? null;
}

/**
 * Drop dismissals whose event has gone by (`today` is YYYY-MM-DD). A key with no
 * date in it falls back to 60 days after it was dismissed. Returns how many went.
 */
export async function purgeDismissals(familyId: string, today: string, now: Date = new Date()): Promise<number> {
  const rows: Dismiss[] = [];
  const sb = dbFor(familyId);
  if (sb) {
    for (let from = 0; from < 5000; from += 500) {
      const { data, error } = await sb.from("family_docs").select("data").eq("family_id", familyId).eq("kind", "event_dismiss").range(from, from + 499);
      if (error || !data) break;
      for (const r of data) {
        const p = DismissSchema.safeParse((r as { data: unknown }).data);
        if (p.success) rows.push(p.data);
      }
      if (data.length < 500) break;
    }
  }
  dismissals.forEach((d, k) => {
    if (k.startsWith(`${familyId}::`)) rows.push(d);
  });
  let gone = 0;
  for (const d of rows) {
    const day = keyDay(d.key);
    const expired = day ? day < today : now.getTime() - Date.parse(d.at) > 60 * 86_400_000;
    if (!expired) continue;
    dismissals.delete(key(familyId, d.id));
    if (sb) await sb.from("family_docs").delete().eq("id", `${familyId}:${d.id}`).eq("kind", "event_dismiss");
    gone++;
  }
  return gone;
}
