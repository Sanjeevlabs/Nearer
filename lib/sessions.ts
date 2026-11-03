// Server-side sessions (supabase/schema.sql `sessions`). The signed cookie only proves "we issued
// this"; the row says whether it still counts: present, not revoked, not expired. Sign-out, "sign out
// of all devices", issuing a new session on a device, and removing a member all revoke rows.
// Without a database (mock mode, tests) the same rules run on an in-memory map. Server only.
import { randomBytes } from "crypto";
import { dbFor } from "./family-db";

export type SessionKind = "real" | "demo";

export interface SessionRow {
  id: string;
  memberId: string;
  familyId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  kind: SessionKind;
}

const mem = new Map<string, SessionRow>();
// A positive answer is trusted this long in this isolate (a revoke here busts it at once; a revoke
// served by another isolate lands within CACHE_MS).
export const CACHE_MS = 20_000;
const trusted = new Map<string, { until: number; memberId: string }>();

/** 192 random bits, base64url. */
export function newSid(): string {
  return randomBytes(24).toString("base64url");
}

/** Mock/test store only: add a row directly. */
export function memoryInsert(row: SessionRow): void {
  mem.set(row.id, row);
}

export function resetSessionStore(): void {
  mem.clear();
  trusted.clear();
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown): number | null => (typeof v === "string" ? Date.parse(v) : null);

export async function createSessionRow(row: SessionRow): Promise<void> {
  const sb = dbFor(null);
  if (!sb) return memoryInsert(row);
  const { error } = await sb.from("sessions").insert({ id: row.id, member_id: row.memberId, family_id: row.familyId, created_at: iso(row.createdAt), expires_at: iso(row.expiresAt), kind: row.kind });
  if (error) throw new Error("session-create-failed");
  // The isolate that just wrote it knows it is live: its next requests skip the check.
  trusted.set(row.id, { until: Date.now() + CACHE_MS, memberId: row.memberId });
}

/** Is this sid a live session? Throws when the database can't say (callers answer 503, not "signed out"). */
export async function sessionActive(sid: string, now = Date.now()): Promise<boolean> {
  const hit = trusted.get(sid);
  if (hit && hit.until > now) return true;
  trusted.delete(sid);
  const sb = dbFor(null);
  let live: boolean;
  let memberId = "";
  if (!sb) {
    const r = mem.get(sid);
    live = Boolean(r && r.revokedAt === null && r.expiresAt > now);
    memberId = r?.memberId ?? "";
  } else {
    const { data, error } = await sb.from("sessions").select("member_id, expires_at, revoked_at").eq("id", sid).maybeSingle();
    if (error) throw new Error("session-check-failed");
    const d = data as { member_id?: string; expires_at?: string; revoked_at?: string | null } | null;
    live = Boolean(d && !d.revoked_at && (ms(d.expires_at) ?? 0) > now);
    memberId = d?.member_id ?? "";
  }
  if (live) trusted.set(sid, { until: now + CACHE_MS, memberId });
  return live;
}

/** Sliding renewal: move the expiry. Only a row that is still live; never inserts, never un-revokes. */
export async function renewSessionRow(sid: string, expiresAt: number): Promise<void> {
  const sb = dbFor(null);
  if (!sb) {
    const r = mem.get(sid);
    if (r && r.revokedAt === null) r.expiresAt = expiresAt;
    return;
  }
  await sb.from("sessions").update({ expires_at: iso(expiresAt) }).eq("id", sid).is("revoked_at", null);
}

export async function revokeSid(sid: string): Promise<void> {
  trusted.delete(sid);
  const sb = dbFor(null);
  if (!sb) {
    const r = mem.get(sid);
    if (r && r.revokedAt === null) r.revokedAt = Date.now();
    return;
  }
  const { error } = await sb.from("sessions").update({ revoked_at: iso(Date.now()) }).eq("id", sid).is("revoked_at", null);
  if (error) throw new Error("session-revoke-failed");
}

/** Every live session of these members (all their devices), optionally keeping one. */
export async function revokeMembers(memberIds: string[], exceptSid?: string): Promise<void> {
  if (!memberIds.length) return;
  for (const [sid, t] of Array.from(trusted)) if (memberIds.includes(t.memberId) && sid !== exceptSid) trusted.delete(sid);
  const sb = dbFor(null);
  if (!sb) {
    for (const r of Array.from(mem.values())) if (memberIds.includes(r.memberId) && r.revokedAt === null && r.id !== exceptSid) r.revokedAt = Date.now();
    return;
  }
  let q = sb.from("sessions").update({ revoked_at: iso(Date.now()) }).in("member_id", memberIds).is("revoked_at", null);
  if (exceptSid) q = q.neq("id", exceptSid);
  const { error } = await q;
  if (error) throw new Error("session-revoke-failed");
}

/** Of these members (one person's sides), the one signed in to most recently, revoked or not. */
export async function lastUsedMember(memberIds: string[]): Promise<string | null> {
  if (memberIds.length < 2) return memberIds[0] ?? null;
  const sb = dbFor(null);
  if (!sb) {
    // Newest first; rows made in the same millisecond keep their insertion order, latest first.
    const rows = Array.from(mem.values()).filter((r) => memberIds.includes(r.memberId)).reverse().sort((a, b) => b.createdAt - a.createdAt);
    return rows[0]?.memberId ?? null;
  }
  const { data } = await sb.from("sessions").select("member_id").in("member_id", memberIds).order("created_at", { ascending: false }).limit(1);
  return (data as { member_id?: string }[] | null)?.[0]?.member_id ?? null;
}

/** Rows this long past expiry or revocation are only clutter (demo visitors make one each). */
export const SESSION_KEEP_DAYS = 7;

/**
 * Daily cron: delete sessions that expired, or were revoked, more than a week ago. Batched
 * (`batch` ids per round, at most `rounds` rounds) so one run never holds the database.
 * Returns how many rows went.
 */
export async function purgeSessions(now = Date.now(), batch = 500, rounds = 10): Promise<number> {
  const cutoff = now - SESSION_KEEP_DAYS * 86_400_000;
  const sb = dbFor(null);
  if (!sb) {
    let n = 0;
    for (const [id, r] of Array.from(mem)) {
      if (r.expiresAt < cutoff || (r.revokedAt !== null && r.revokedAt < cutoff)) {
        mem.delete(id);
        trusted.delete(id);
        n++;
      }
    }
    return n;
  }
  const at = iso(cutoff);
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const { data, error } = await sb.from("sessions").select("id").or(`expires_at.lt.${at},revoked_at.lt.${at}`).limit(batch);
    if (error || !data?.length) break;
    const ids = (data as { id: string }[]).map((r) => r.id);
    const { error: delErr } = await sb.from("sessions").delete().in("id", ids);
    if (delErr) break;
    total += ids.length;
    if (ids.length < batch) break;
  }
  return total;
}
