import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { docsFor } from "@/lib/request-data";
import { dbListMembers } from "@/lib/db";
import { deleteDoc, getDoc, listDocs, newId, putDoc } from "@/lib/family-docs";
import { SITTING_REASONS, VENUE_IDS } from "@/lib/kinds";
import { MAX_SIT_INVITES } from "@/lib/kind-values";
import { guardWrites } from "@/lib/api-guard";
import { ACTIVITIES, DEFAULT_DOOR_MINUTES, visibleKnocks } from "@/lib/doors";
import { inBackground } from "@/lib/push/background";
import { pushDoor, pushDoorJoined, pushSittingInvite } from "@/lib/push/events";

// Sit together: planned sittings with a reason, and "come sit" knocks.
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sit"),
    reason: z.enum(SITTING_REASONS),
    title: z.string().trim().min(2).max(80),
    startsAt: z.string().datetime(),
    invites: z.array(z.string().min(1).max(80)).max(MAX_SIT_INVITES).default([]),
    recipeId: z.string().nullable().optional(),
    note: z.string().trim().max(200).default(""),
    venue: z.enum(VENUE_IDS).default("courtyard"),
  }),
  z.object({ action: z.literal("cancel"), sittingId: z.string().min(1) }),
  z.object({ action: z.literal("rsvp"), sittingId: z.string().min(1), answer: z.enum(["going", "cant", "clear"]) }),
  z.object({ action: z.literal("reschedule"), sittingId: z.string().min(1), startsAt: z.string().datetime(), title: z.string().trim().min(2).max(80).optional() }),
  z.object({
    action: z.literal("knock"),
    minutes: z.number().int().min(15).max(180).default(DEFAULT_DOOR_MINUTES),
    note: z.string().trim().max(80).default(""),
    venue: z.enum(VENUE_IDS).default("courtyard"),
    activity: z.enum(ACTIVITIES).optional(),
    /** Empty or absent: the whole family. */
    invites: z.array(z.string().min(1).max(80)).max(MAX_SIT_INVITES).default([]),
  }),
  z.object({ action: z.literal("unknock") }),
  z.object({ action: z.literal("joined"), id: z.string().min(1).max(100) }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const now = Date.now();
  const [sittings, knocks] = await Promise.all([docsFor(req, auth.familyId, "sitting"), docsFor(req, auth.familyId, "knock")]);
  return Response.json({
    // Keep sittings visible until 3 hours after they start (so "Join" works late).
    sittings: sittings.filter((s) => Date.parse(s.startsAt) > now - 3 * 3_600_000).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    // Only the doors this person may see: their own, family-wide ones, and ones they were invited to.
    knocks: visibleKnocks(knocks, auth.memberId, now),
  });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-sitting" }, { status: 400 });
  const body = parsed.data;
  const now = new Date();

  if (body.action === "joined") {
    const [knock, sitting] = await Promise.all([getDoc(auth.familyId, "knock", body.id), getDoc(auth.familyId, "sitting", body.id)]);
    const hostId = knock && visibleKnocks([knock], auth.memberId, now.getTime()).length
      ? knock.memberId
      : sitting && Date.parse(sitting.startsAt) > now.getTime() - 3 * 3_600_000 &&
        (!sitting.invites.length || sitting.invites.includes(auth.memberId) || sitting.hostId === auth.memberId)
        ? sitting.hostId : null;
    if (!hostId) return Response.json({ error: "unknown-sitting" }, { status: 404 });
    inBackground(() => pushDoorJoined(auth.familyId, { id: body.id, hostId }, auth.memberId, now));
    return Response.json({ ok: true });
  }
  if (body.action === "sit") {
    if (Date.parse(body.startsAt) < now.getTime() - 5 * 60_000) return Response.json({ error: "in-the-past" }, { status: 400 });
    const family = new Set((await dbListMembers(auth.familyId)).map((m) => m.id));
    const invites = Array.from(new Set(body.invites.filter((id) => family.has(id) && id !== auth.memberId)));
    const sitting = await putDoc(auth.familyId, "sitting", { id: newId("sit"), reason: body.reason, title: body.title, hostId: auth.memberId, startsAt: new Date(body.startsAt).toISOString(), invites, recipeId: body.recipeId ?? null, note: body.note, venue: body.venue, keptCardId: null, createdAt: now.toISOString() });
    if (sitting.invites.length) inBackground(() => pushSittingInvite(auth.familyId, sitting, now));
    return Response.json({ sitting }, { status: 201 });
  }
  if (body.action === "rsvp" || body.action === "reschedule") {
    const s = await getDoc(auth.familyId, "sitting", body.sittingId);
    if (!s) return Response.json({ error: "unknown-sitting" }, { status: 404 });
    if (body.action === "rsvp") {
      const me = auth.memberId;
      const going = s.going.filter((x) => x !== me);
      const cantMake = s.cantMake.filter((x) => x !== me);
      if (body.answer === "going") going.push(me);
      if (body.answer === "cant") cantMake.push(me);
      return Response.json({ sitting: await putDoc(auth.familyId, "sitting", { ...s, going, cantMake }) });
    }
    if (s.hostId !== auth.memberId) return Response.json({ error: "not-host" }, { status: 403 });
    if (Date.parse(body.startsAt) < now.getTime() - 5 * 60_000) return Response.json({ error: "in-the-past" }, { status: 400 });
    // A new time resets RSVPs: everyone answers again for the new time.
    return Response.json({ sitting: await putDoc(auth.familyId, "sitting", { ...s, startsAt: new Date(body.startsAt).toISOString(), title: body.title ?? s.title, going: [], cantMake: [] }) });
  }

  if (body.action === "cancel") {
    const s = await getDoc(auth.familyId, "sitting", body.sittingId);
    if (!s) return Response.json({ error: "unknown-sitting" }, { status: 404 });
    if (s.hostId !== auth.memberId) return Response.json({ error: "not-host" }, { status: 403 });
    await deleteDoc(auth.familyId, "sitting", s.id);
    return Response.json({ cancelled: s.id });
  }
  // One open knock per person: a new one replaces the old.
  const mine = (await listDocs(auth.familyId, "knock")).filter((k) => k.memberId === auth.memberId);
  for (const k of mine) await deleteDoc(auth.familyId, "knock", k.id);
  if (body.action === "unknock") return Response.json({ closed: mine.length });
  const family = new Set((await dbListMembers(auth.familyId)).map((m) => m.id));
  const invites = Array.from(new Set(body.invites.filter((id) => family.has(id) && id !== auth.memberId)));
  // Invited people who are no longer in the family leave nobody: the door is not opened to everyone by mistake.
  if (body.invites.length > 0 && invites.length === 0) return Response.json({ error: "no-one-invited" }, { status: 400 });
  const knock = await putDoc(auth.familyId, "knock", {
    id: newId("knock"),
    memberId: auth.memberId,
    note: body.note,
    venue: body.venue,
    at: now.toISOString(),
    until: new Date(now.getTime() + body.minutes * 60_000).toISOString(),
    ...(body.activity ? { activity: body.activity } : {}),
    ...(invites.length ? { invites } : {}),
  });
  // Only explicitly invited people get an alert.
  if (invites.length > 0) pushDoor(auth.familyId, knock);
  return Response.json({ knock }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
