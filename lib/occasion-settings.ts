// Occasions settings: one family-level choice, never per person.
// `traditions`: which traditions the family celebrates (ids from
// data/traditions.json; optional; used only to show festivals).
// `kept` / `skipped`: manual per-festival overrides on / off (holiday keys
// or ritual config slugs). Default: nothing chosen, so a new family sees
// birthdays and national days until someone picks.
// Stored in the family_docs table like the other family docs (kind
// "ritual_settings", one row per family), validated with Zod on the way in
// and out; in-memory in mock mode and as a fallback. Server only.
import { z } from "zod";
import { RITUAL_FILES } from "@/rituals";
import { DbWriteError, dbFor } from "./family-db";
import { isDemoFamily } from "./family";

export const RitualSettingsSchema = z.object({
  id: z.literal("ritual-settings"),
  traditions: z.array(z.string().min(1).max(30)).max(12).default([]),
  kept: z.array(z.string().min(1).max(60)).max(40).default([]),
  skipped: z.array(z.string().min(1).max(60)).max(80).default([]),
  updatedBy: z.string().max(80).nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type RitualSettings = z.infer<typeof RitualSettingsSchema>;

const KIND = "ritual_settings";
const ID = "ritual-settings";
// Kept on globalThis so a dev-server recompile doesn't drop mock-mode choices.
const g = globalThis as typeof globalThis & { __aanganRitualSettings?: Map<string, RitualSettings> };
const mem = (g.__aanganRitualSettings ??= new Map<string, RitualSettings>());

// Demo families stay in memory (dbFor returns null for them).

function empty(familyId = ""): RitualSettings {
  // The demo families start out keeping every festival that has a ritual guide
  // (rituals/*.json), so Festival Week has something to show before anyone picks.
  const kept = isDemoFamily(familyId)
    ? RITUAL_FILES.map((f) => (f.json as { slug?: unknown }).slug).filter((s): s is string => typeof s === "string" && s !== "birthday")
    : [];
  return { id: ID, traditions: [], kept, skipped: [], updatedBy: null, updatedAt: new Date(0).toISOString() };
}

/** The family_docs kind and row id these settings live under, for a caller that reads them in its own batch. */
export const RITUAL_SETTINGS_KIND = KIND;
export const ritualSettingsRowId = (familyId: string) => `${familyId}:${ID}`;

/** getRitualSettings from rows of RITUAL_SETTINGS_KIND another query already read (null: not read; read it here). */
export async function ritualSettingsFromBatch(familyId: string, rows: { id: string; data: unknown }[] | null | undefined): Promise<RitualSettings> {
  if (!rows || !dbFor(familyId)) return getRitualSettings(familyId);
  const local = mem.get(familyId);
  const row = rows.find((r) => r.id === ritualSettingsRowId(familyId));
  if (!row) return local ?? empty(familyId);
  const parsed = RitualSettingsSchema.safeParse(row.data);
  return parsed.success ? parsed.data : (local ?? empty(familyId));
}

export async function getRitualSettings(familyId: string): Promise<RitualSettings> {
  const local = mem.get(familyId);
  const sb = dbFor(familyId);
  if (!sb) return local ?? empty(familyId);
  const { data, error } = await sb.from("family_docs").select("data").eq("id", `${familyId}:${ID}`).eq("kind", KIND).maybeSingle();
  if (error || !data) return local ?? empty(familyId);
  const parsed = RitualSettingsSchema.safeParse((data as { data: unknown }).data);
  return parsed.success ? parsed.data : (local ?? empty(familyId));
}

/** The festival slugs this family keeps (birthdays are always kept). */
export async function keptFestivals(familyId: string): Promise<string[]> {
  return (await getRitualSettings(familyId)).kept;
}

export async function setKeptFestivals(familyId: string, kept: string[], by: string): Promise<RitualSettings> {
  return setRitualSettings(familyId, { kept }, by);
}

/** Merge a change into the family's settings (any field left out stays as it was). */
export async function setRitualSettings(familyId: string, patch: { traditions?: string[]; kept?: string[]; skipped?: string[] }, by: string): Promise<RitualSettings> {
  const cur = await getRitualSettings(familyId);
  const uniq = (xs: string[]) => Array.from(new Set(xs));
  const doc = RitualSettingsSchema.parse({
    id: ID,
    traditions: uniq(patch.traditions ?? cur.traditions),
    kept: uniq(patch.kept ?? cur.kept),
    skipped: uniq(patch.skipped ?? cur.skipped),
    updatedBy: by,
    updatedAt: new Date().toISOString(),
  });
  const sb = dbFor(familyId);
  if (!sb) {
    mem.set(familyId, doc);
    return doc;
  }
  const { error } = await sb
    .from("family_docs")
    .upsert({ id: `${familyId}:${ID}`, family_id: familyId, kind: KIND, data: doc, updated_at: doc.updatedAt }, { onConflict: "id" });
  if (error) throw new DbWriteError("family_docs", error.message);
  return doc;
}

export function resetRitualSettings(): void {
  mem.clear();
}
