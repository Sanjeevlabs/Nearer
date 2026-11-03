// Public shares: the one way anything leaves a family. A person picks one
// thing (today: a recipe) and gets an unguessable link anyone can open, with
// a frozen copy of just that thing — no names beyond what the card shows, no
// voice, no photos of people, no family data. Revocable at any time.
// Postgres table `public_shares` when live; an in-memory map otherwise.
// The seed demo families stay in memory (dbFor returns null for them); a demo
// visitor's copy is a real database family, so its shares go to Postgres too.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { COURSES } from "./kind-values";
import { isSeedFamily } from "./family";
import { DbReadError, dbFor } from "./family-db";
import { IngredientSchema, StepSchema } from "./kinds";

export const PublicRecipeSchema = z.object({
  title: z.string().max(80),
  /** How the family calls the cook ("Dadi"), never a surname. */
  from: z.string().max(40),
  course: z.enum(COURSES),
  prepMins: z.number().int().nullable(),
  cookMins: z.number().int().nullable(),
  serves: z.string().max(40),
  memory: z.string().max(240),
  prepWork: z.array(z.string().max(160)).max(12),
  outcome: z.string().max(240),
  ingredients: z.array(IngredientSchema).max(40),
  steps: z.array(StepSchema).max(30),
});
export type PublicRecipe = z.infer<typeof PublicRecipeSchema>;

export const ShareSchema = z.object({
  token: z.string().min(20).max(64),
  familyId: z.string(),
  kind: z.literal("recipe"),
  refId: z.string(),
  snapshot: PublicRecipeSchema,
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().default(null),
  views: z.number().int().min(0).default(0),
});
export type Share = z.infer<typeof ShareSchema>;

// One map per process, even when Next bundles the page and the API route
// separately (mock mode and the in-memory fallback).
const g = globalThis as typeof globalThis & { __aanganShares?: Map<string, Share> };
const mem = (g.__aanganShares ??= new Map<string, Share>());

export function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function createShare(input: Omit<Share, "token" | "createdAt" | "revokedAt" | "views">): Promise<Share> {
  // One live link per thing: re-sharing returns the same link (and its counts).
  const existing = (await listShares(input.familyId)).find((s) => s.refId === input.refId && !s.revokedAt);
  const share = ShareSchema.parse({ ...input, token: existing?.token ?? newToken(), createdAt: existing?.createdAt ?? new Date().toISOString(), views: existing?.views ?? 0 });
  mem.set(share.token, share);
  const sb = dbFor(share.familyId);
  if (sb) {
    const { error } = await sb.from("public_shares").upsert({ token: share.token, family_id: share.familyId, kind: share.kind, ref_id: share.refId, snapshot: share.snapshot, created_by: share.createdBy, created_at: share.createdAt, revoked_at: null }, { onConflict: "token" });
    if (error) console.error("[shares] write failed, kept in memory", error.message);
  }
  return share;
}

function fromRow(r: Record<string, unknown>): Share | null {
  const out = ShareSchema.safeParse({ token: r.token, familyId: r.family_id, kind: r.kind, refId: r.ref_id, snapshot: r.snapshot, createdBy: r.created_by, createdAt: new Date(String(r.created_at)).toISOString(), revokedAt: r.revoked_at ? new Date(String(r.revoked_at)).toISOString() : null, views: Number(r.views ?? 0) });
  return out.success ? out.data : null;
}

/** Public lookup. Revoked or unknown → null (the page says it's no longer shared). */
export async function getShare(token: string): Promise<Share | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  // With the database live it is the source of truth on every read: a revoke
  // made on another isolate must be honoured, so memory is not consulted first.
  // (No family to check yet, so this follows the database switch.)
  const sb = dbFor(null);
  let share: Share | null;
  if (sb) {
    const { data, error } = await sb.from("public_shares").select("*").eq("token", token).maybeSingle();
    if (error) throw new DbReadError("public_shares", error.message);
    share = data ? fromRow(data as Record<string, unknown>) : null;
    // The seed families never live in the database: a stray row there is ignored, theirs are in memory.
    if (share && isSeedFamily(share.familyId)) share = null;
    if (!share) {
      const m = mem.get(token);
      if (m && isSeedFamily(m.familyId)) share = m;
    }
  } else {
    share = mem.get(token) ?? null;
  }
  if (!share || share.revokedAt) return null;
  return share;
}

export async function countView(token: string): Promise<void> {
  const s = mem.get(token);
  if (s) mem.set(token, { ...s, views: s.views + 1 });
  const sb = dbFor(s?.familyId);
  // Best effort; a counter must never break the page.
  if (sb) await sb.rpc("bump_share_views", { t: token }).then(() => undefined, () => undefined);
}

export async function listShares(familyId: string): Promise<Share[]> {
  const local = Array.from(mem.values()).filter((s) => s.familyId === familyId);
  const sb = dbFor(familyId);
  if (!sb) return local;
  const { data, error } = await sb.from("public_shares").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(200);
  if (error) throw new DbReadError("public_shares", error.message);
  const rows = (data ?? []).map((r) => fromRow(r as Record<string, unknown>)).filter((s): s is Share => s !== null);
  const tokens = new Set(rows.map((r) => r.token));
  return [...rows, ...local.filter((s) => !tokens.has(s.token))];
}

export async function revokeShare(familyId: string, token: string): Promise<boolean> {
  const s = (await listShares(familyId)).find((x) => x.token === token);
  if (!s) return false;
  const revoked = { ...s, revokedAt: new Date().toISOString() };
  mem.set(token, revoked);
  const sb = dbFor(familyId);
  if (sb) await sb.from("public_shares").update({ revoked_at: revoked.revokedAt }).eq("token", token).eq("family_id", familyId);
  return true;
}

export function resetShares(): void {
  mem.clear();
}
