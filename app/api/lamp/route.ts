import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { dbListMembers, dbListRelationships } from "@/lib/db";
import { getDoc, listDocs, listDocsMany, newId, putDoc } from "@/lib/family-docs";
import { households } from "@/lib/households";
import { BEAT_TTL_MS, LAMP_PUSH_GAP_MS, glowFrom, LIGHT_COOLDOWN_MS, lampPushedRecently, lampView, lightCooldownLeft, trimStamps } from "@/lib/lamp";
import { todayFor } from "@/lib/presence";
import { guardWrites } from "@/lib/api-guard";
import type { Lamp } from "@/lib/kinds";
import { pushBeat, pushLightInBackground } from "@/lib/push/events";

// The light in the window (SPEC §30.1, §30.4). One lamp per home.
// GET: every home's lamp + heartbeats waiting for you. Bounded: the lamp and
// care-settings documents only (one per home / per person), never the cards.
// A lamp is lit only by a tap (light) or a heartbeat (beat), never by a card.
// POST light: light your home's lamp. beat: send a heartbeat to another home
// (played on their next open). felt: you've felt the waiting heartbeats.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("light") }),
  z.object({ action: z.literal("beat"), toMemberId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("felt") }),
]);

async function homesOf(familyId: string) {
  const [members, relationships] = await Promise.all([dbListMembers(familyId), dbListRelationships(familyId)]);
  return { members, homes: households(members, relationships) };
}

/**
 * A parent's lamp is their day's "I'm okay": the first one each (their) day is recorded as a
 * presence moment ("is thinking of you"), which is what the morning sweep and the quiet-day
 * note read. Only for grown-ups of the elder generation; best effort.
 */
async function markMorningLamp(familyId: string, memberId: string, now: Date): Promise<void> {
  try {
    const me = (await dbListMembers(familyId)).find((m) => m.id === memberId);
    if (!me || me.role !== "elder") return;
    const recent = await listDocs(familyId, "presence", { sinceMs: 3 * 86_400_000 });
    if (todayFor(memberId, recent, me.tz, now).length > 0) return;
    await putDoc(familyId, "presence", { id: newId("presence"), memberId, moment: "thinking", note: "", at: now.toISOString() });
  } catch (e) {
    console.error("[lamp] morning mark failed", String(e));
  }
}

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [{ homes }, docs] = await Promise.all([homesOf(auth.familyId), listDocsMany(auth.familyId, ["lamp", "care_settings"] as const)]);
  const hidden = new Set(docs.care_settings.filter((s) => s.shareVisits === false && s.memberId !== auth.memberId).map((s) => s.memberId));
  return Response.json(lampView(homes, docs.lamp, auth.memberId, hidden, Date.now()));
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-lamp" }, { status: 400 });
  const { homes } = await homesOf(auth.familyId);
  const nowIso = new Date().toISOString();
  const mine = homes.find((h) => h.members.some((m) => m.id === auth.memberId));
  if (!mine) return Response.json({ error: "no-home" }, { status: 404 });
  const blank = (id: string): Lamp => ({ id, litAt: null, litBy: null, beats: [], felt: {}, lit: {}, pushed: {}, updatedAt: nowIso });

  if (parsed.data.action === "light") {
    const lamp = (await getDoc(auth.familyId, "lamp", mine.id)) ?? blank(mine.id);
    const nowMs = Date.now();
    // One light per person per 10 minutes: a second tap shows the lamp as it is.
    const wait = lightCooldownLeft(lamp.lit, auth.memberId, nowMs);
    if (wait > 0) {
      const glow = glowFrom(lamp.litAt, nowMs);
      return Response.json({ lamp: { homeKey: mine.id, litAt: lamp.litAt, litBy: lamp.litBy, glow }, throttled: true, retryInSeconds: Math.ceil(wait / 1000) });
    }
    // "Arjun is thinking of you" goes to the other homes, one push per pair per 2 hours.
    const others = homes.filter((h) => h.id !== mine.id).flatMap((h) => h.members).filter((m) => m.role !== "child");
    const due = others.filter((m) => !lampPushedRecently(lamp.pushed, auth.memberId, m.id, nowMs));
    const pushed = { ...trimStamps(lamp.pushed, LAMP_PUSH_GAP_MS, nowMs), ...Object.fromEntries(due.map((m) => [`${auth.memberId}>${m.id}`, nowIso])) };
    const lit = { ...trimStamps(lamp.lit, LIGHT_COOLDOWN_MS, nowMs), [auth.memberId]: nowIso };
    const saved = await putDoc(auth.familyId, "lamp", { ...lamp, litAt: nowIso, litBy: auth.memberId, lit, pushed, updatedAt: nowIso });
    pushLightInBackground(auth.familyId, auth.memberId, due.map((m) => m.id));
    await markMorningLamp(auth.familyId, auth.memberId, new Date(nowMs));
    return Response.json({ lamp: { homeKey: mine.id, litAt: saved.litAt, litBy: saved.litBy, glow: 1 } });
  }

  if (parsed.data.action === "beat") {
    const to = homes.find((h) => h.members.some((m) => m.id === (parsed.data as { toMemberId: string }).toMemberId));
    if (!to) return Response.json({ error: "unknown-member" }, { status: 404 });
    if (to.id === mine.id) return Response.json({ error: "same-home" }, { status: 400 });
    const lamp = (await getDoc(auth.familyId, "lamp", to.id)) ?? blank(to.id);
    const now = Date.now();
    // Keep it gentle: at most one heartbeat a minute from the same person.
    if (lamp.beats.some((b) => b.from === auth.memberId && now - Date.parse(b.at) < 60_000)) return Response.json({ ok: true, throttled: true });
    const beats = [...lamp.beats.filter((b) => now - Date.parse(b.at) < BEAT_TTL_MS), { from: auth.memberId, at: nowIso }].slice(-20);
    await putDoc(auth.familyId, "lamp", { ...lamp, beats, updatedAt: nowIso });
    // Sending one also lights your own lamp.
    const own = (await getDoc(auth.familyId, "lamp", mine.id)) ?? blank(mine.id);
    const toId = (parsed.data as { toMemberId: string }).toMemberId;
    // At most one lamp push from one person to another every 2 hours.
    const pushDue = !lampPushedRecently(own.pushed, auth.memberId, toId, now);
    const pushed = pushDue ? { ...trimStamps(own.pushed, LAMP_PUSH_GAP_MS, now), [`${auth.memberId}>${toId}`]: nowIso } : own.pushed;
    await putDoc(auth.familyId, "lamp", { ...own, litAt: nowIso, litBy: auth.memberId, pushed, updatedAt: nowIso });
    if (pushDue) pushBeat(auth.familyId, auth.memberId, toId);
    await markMorningLamp(auth.familyId, auth.memberId, new Date(now));
    return Response.json({ ok: true });
  }

  const lamp = (await getDoc(auth.familyId, "lamp", mine.id)) ?? blank(mine.id);
  await putDoc(auth.familyId, "lamp", { ...lamp, felt: { ...lamp.felt, [auth.memberId]: nowIso }, updatedAt: nowIso });
  return Response.json({ ok: true });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
