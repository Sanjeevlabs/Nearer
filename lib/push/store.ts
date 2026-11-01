// Where push subscriptions live: the push_subscriptions table when the database is
// live, a Map in mock mode and for the demo seed (like lib/family-docs.ts). Every
// read and delete is scoped by family (and member where a person asks for their own).
// Server only.
import { DbWriteError, dbFor } from "../family-db";
import type { PushKind, PushSub } from "./types";

/** More than this many devices for one person: the oldest are dropped. */
export const MAX_DEVICES = 10;
/** A subscription that fails this many sends in a row is deleted. */
export const MAX_FAILURES = 5;

const g = globalThis as unknown as { __nearerPushSubs?: Map<string, PushSub> };
const mem: Map<string, PushSub> = (g.__nearerPushSubs ??= new Map());

/** Test hook: forget every subscription held in memory. */
export function resetPushStore(): void {
  mem.clear();
}

function fromRow(r: Record<string, unknown>): PushSub {
  return {
    id: String(r.id),
    familyId: String(r.family_id),
    memberId: String(r.member_id),
    kind: r.kind === "webpush" ? "webpush" : "fcm",
    token: String(r.token),
    p256dh: (r.p256dh as string | null) ?? null,
    auth: (r.auth as string | null) ?? null,
    platform: typeof r.platform === "string" ? r.platform : "web",
    createdAt: new Date(String(r.created_at ?? Date.now())).toISOString(),
    lastOkAt: r.last_ok_at ? new Date(String(r.last_ok_at)).toISOString() : null,
    failures: typeof r.failures === "number" ? r.failures : 0,
  };
}

export interface SubInput {
  familyId: string;
  memberId: string;
  kind: PushKind;
  token: string;
  p256dh?: string | null;
  auth?: string | null;
  platform: string;
}

/**
 * Save a device. The token is unique: a device that was someone else's (signed out
 * without telling us, or a shared tablet) is re-bound to this member and family, and
 * its failure count starts again. Returns the stored row.
 */
export async function upsertSub(input: SubInput, now: Date = new Date()): Promise<PushSub> {
  const sb = dbFor(input.familyId);
  const fields = { familyId: input.familyId, memberId: input.memberId, kind: input.kind, p256dh: input.p256dh ?? null, auth: input.auth ?? null, platform: input.platform, failures: 0 };
  if (!sb) {
    const prev = mem.get(input.token);
    const row: PushSub = { id: prev?.id ?? crypto.randomUUID(), token: input.token, createdAt: prev?.createdAt ?? now.toISOString(), lastOkAt: prev?.lastOkAt ?? null, ...fields };
    mem.set(input.token, row);
    trimMem(input.familyId, input.memberId);
    return row;
  }
  const found = await sb.from("push_subscriptions").select("*").eq("token", input.token).maybeSingle();
  const existing = found.data ? fromRow(found.data as Record<string, unknown>) : null;
  const write = { family_id: input.familyId, member_id: input.memberId, kind: input.kind, p256dh: input.p256dh ?? null, auth: input.auth ?? null, platform: input.platform, failures: 0 };
  if (existing) {
    const { error } = await sb.from("push_subscriptions").update(write).eq("id", existing.id);
    if (error) throw new DbWriteError("push_subscriptions", error.message);
    return { ...existing, ...fields };
  }
  const row: PushSub = { id: crypto.randomUUID(), token: input.token, createdAt: now.toISOString(), lastOkAt: null, ...fields };
  const { error } = await sb.from("push_subscriptions").insert({ id: row.id, token: row.token, created_at: row.createdAt, ...write });
  if (error) throw new DbWriteError("push_subscriptions", error.message);
  await trimLive(input.familyId, input.memberId);
  return row;
}

function trimMem(familyId: string, memberId: string): void {
  const mine = Array.from(mem.values()).filter((s) => s.familyId === familyId && s.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const old of mine.slice(MAX_DEVICES)) mem.delete(old.token);
}

async function trimLive(familyId: string, memberId: string): Promise<void> {
  const sb = dbFor(familyId);
  if (!sb) return;
  const { data } = await sb.from("push_subscriptions").select("id").eq("family_id", familyId).eq("member_id", memberId).order("created_at", { ascending: false });
  const extra = ((data ?? []) as { id: string }[]).slice(MAX_DEVICES).map((r) => r.id);
  if (extra.length) await sb.from("push_subscriptions").delete().in("id", extra);
}

/** A person's devices, newest first. */
export async function listSubs(familyId: string, memberId: string): Promise<PushSub[]> {
  const sb = dbFor(familyId);
  if (!sb) return Array.from(mem.values()).filter((s) => s.familyId === familyId && s.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const { data, error } = await sb.from("push_subscriptions").select("*").eq("family_id", familyId).eq("member_id", memberId).order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(fromRow);
}

/** Sign-out or unsubscribe: remove this device, only if it is this member's in this family. */
export async function removeByToken(familyId: string, memberId: string, token: string): Promise<boolean> {
  const sb = dbFor(familyId);
  if (!sb) {
    const s = mem.get(token);
    if (!s || s.familyId !== familyId || s.memberId !== memberId) return false;
    return mem.delete(token);
  }
  const { data, error } = await sb.from("push_subscriptions").delete().eq("token", token).eq("family_id", familyId).eq("member_id", memberId).select("id");
  if (error) throw new DbWriteError("push_subscriptions", error.message);
  return (data ?? []).length > 0;
}

/** The push service said it is gone, or it kept failing: drop this row. */
export async function removeSub(sub: Pick<PushSub, "id" | "familyId" | "token">): Promise<void> {
  const sb = dbFor(sub.familyId);
  if (!sb) {
    mem.delete(sub.token);
    return;
  }
  await sb.from("push_subscriptions").delete().eq("id", sub.id).eq("family_id", sub.familyId);
}

/** Everything of a person's (leaving the family). The database cascades; memory does not. */
export async function removeAllForMember(familyId: string, memberId: string): Promise<void> {
  mem.forEach((s, token) => {
    if (s.familyId === familyId && s.memberId === memberId) mem.delete(token);
  });
  const sb = dbFor(familyId);
  if (sb) await sb.from("push_subscriptions").delete().eq("family_id", familyId).eq("member_id", memberId);
}

/** A send went through: note it and clear the failure count. */
export async function noteOk(sub: PushSub, now: Date = new Date()): Promise<void> {
  if (sub.failures === 0 && sub.lastOkAt && now.getTime() - Date.parse(sub.lastOkAt) < 3_600_000) return;
  const sb = dbFor(sub.familyId);
  const at = now.toISOString();
  if (!sb) {
    const s = mem.get(sub.token);
    if (s) mem.set(sub.token, { ...s, lastOkAt: at, failures: 0 });
    return;
  }
  await sb.from("push_subscriptions").update({ last_ok_at: at, failures: 0 }).eq("id", sub.id);
}

/** A send was refused: count it, and drop the row at MAX_FAILURES. Returns true when dropped. */
export async function noteFailure(sub: PushSub): Promise<boolean> {
  const failures = sub.failures + 1;
  if (failures >= MAX_FAILURES) {
    await removeSub(sub);
    return true;
  }
  const sb = dbFor(sub.familyId);
  if (!sb) {
    const s = mem.get(sub.token);
    if (s) mem.set(sub.token, { ...s, failures });
    return false;
  }
  await sb.from("push_subscriptions").update({ failures }).eq("id", sub.id);
  return false;
}
