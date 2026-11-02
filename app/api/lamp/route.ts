import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { dbListMembers, dbListRelationships } from "@/lib/db";
import { getDoc, listDocsMany, putDoc } from "@/lib/family-docs";
import { households } from "@/lib/households";
import { BEAT_TTL_MS, lampView } from "@/lib/lamp";
import { guardWrites } from "@/lib/api-guard";
import { pushBeat } from "@/lib/push/events";

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
  const blank = (id: string) => ({ id, litAt: null, litBy: null, beats: [], felt: {}, updatedAt: nowIso });

  if (parsed.data.action === "light") {
    const lamp = (await getDoc(auth.familyId, "lamp", mine.id)) ?? blank(mine.id);
    const saved = await putDoc(auth.familyId, "lamp", { ...lamp, litAt: nowIso, litBy: auth.memberId, updatedAt: nowIso });
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
    await putDoc(auth.familyId, "lamp", { ...own, litAt: nowIso, litBy: auth.memberId, updatedAt: nowIso });
    pushBeat(auth.familyId, auth.memberId, (parsed.data as { toMemberId: string }).toMemberId);
    return Response.json({ ok: true });
  }

  const lamp = (await getDoc(auth.familyId, "lamp", mine.id)) ?? blank(mine.id);
  await putDoc(auth.familyId, "lamp", { ...lamp, felt: { ...lamp.felt, [auth.memberId]: nowIso }, updatedAt: nowIso });
  return Response.json({ ok: true });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
