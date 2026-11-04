import { z } from "zod";
import { can, isAdmin } from "@/lib/permissions";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { dbListMembers } from "@/lib/db";
import { memberFor } from "@/lib/request-memo";
import { eventsFor, holidaysOf, membersFor } from "@/lib/request-data";
import { EVENT_TYPES, eventTitle, lockedStart, markNone, occasionEventKey, participants, proposeSlots, slotToLock, templateFor, toggleVote, type FamilyEvent } from "@/lib/events";
import { deleteDoc, newId, putDoc } from "@/lib/family-docs";
import { draftPlan } from "@/lib/gather-plan";
import { buildPrompts, upcomingOccasion, type UpcomingOccasion } from "@/lib/gather-prompts";
import { dismiss, getEvent, listEvents, putEvent } from "@/lib/gather-store";
import { SITTING_REASONS, VENUE_IDS } from "@/lib/kinds";
import type { VenueId } from "@/lib/venues";
import { addDays, cleanTitle, daysBetween, occasionsInRange } from "@/lib/occasion-calendar";
import { familyHolidays } from "@/lib/occasions-server";
import { callName } from "@/lib/people";
import type { Member } from "@/lib/schemas";
import { guardWrites } from "@/lib/api-guard";
import { orUnlessRead } from "@/lib/family-db";

// Family events: Muse plans the gathering (run of show, tasks, playlist),
// proposes three times that work in every home, each person taps what works,
// and the most-picked slot locks into a gathering session (a sitting with
// its own video room).

const today = () => new Date().toISOString().slice(0, 10);

async function upcoming(familyId: string, members: Member[], within = 60, holidays?: ReturnType<typeof familyHolidays>): Promise<UpcomingOccasion[]> {
  const fam = await (holidays ?? familyHolidays(familyId, members)).catch(orUnlessRead(null));
  const festivals = (fam?.visible ?? []).filter((h) => h.kind === "festival").map((h) => ({ ...h, title: cleanTitle(h.title) }));
  const t = today();
  const nameOf = (id: string) => callName(members.find((m) => m.id === id));
  return occasionsInRange(members, festivals, t, addDays(t, within)).map((o) => upcomingOccasion(o, daysBetween(t, o.date), nameOf));
}

function visible(events: FamilyEvent[], now = Date.now()): FamilyEvent[] {
  return events.filter((e) => {
    if (e.status === "cancelled") return false;
    const start = lockedStart(e);
    if (start) return start.getTime() > now - 3 * 3_600_000;
    return e.date >= addDays(today(), -1);
  });
}

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const holidays = holidaysOf(req, auth.familyId);
  holidays.catch(() => undefined);
  const [members, me, { events: all, dismissed }] = await Promise.all([membersFor(req, auth.familyId), memberFor(req, auth.memberId), eventsFor(req, auth.familyId, auth.memberId)]);
  const events = visible(all);
  const occasions = await upcoming(auth.familyId, members, 60, holidays);
  const canPlan = Boolean(me && can(me, "events.plan") && me.role !== "child");
  const prompts = buildPrompts({ viewerId: auth.memberId, canPlan, events, occasions, dismissed });
  return Response.json({ events, occasions, prompts, canPlan, viewerId: auth.memberId });
}

const Id = z.string().min(1).max(64);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    type: z.enum(EVENT_TYPES),
    title: z.string().trim().min(2).max(80).optional(),
    occasionKey: z.string().min(1).max(60).nullable().default(null),
    forMemberId: Id.nullable().default(null),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    invites: z.array(Id).max(40).optional(),
    minutes: z.number().int().min(30).max(60).optional(),
    /** Also plan a cake, flowers or sweets. Owner and admins only. */
    extras: z.boolean().default(false),
  }),
  z.object({ action: z.literal("vote"), eventId: Id, slotId: Id, venue: z.enum(VENUE_IDS).optional() }),
  z.object({ action: z.literal("none"), eventId: Id }),
  z.object({ action: z.literal("lock"), eventId: Id, slotId: Id, venue: z.enum(VENUE_IDS).default("courtyard") }),
  z.object({ action: z.literal("task"), eventId: Id, taskId: Id, ownerId: Id.nullable().optional(), done: z.boolean().optional() }),
  z.object({ action: z.literal("cancel"), eventId: Id }),
  z.object({ action: z.literal("dismiss"), key: z.string().min(1).max(160) }),
]);

/** Lock a slot: create the gathering session (a sitting with its video room) in the chosen venue. */
async function lock(familyId: string, e: FamilyEvent, slotId: string, venue: VenueId = "courtyard"): Promise<FamilyEvent> {
  const slot = e.slots.find((s) => s.id === slotId);
  if (!slot) return e;
  const reason = (SITTING_REASONS as readonly string[]).includes(templateFor(e.type).sittingReason) ? (templateFor(e.type).sittingReason as (typeof SITTING_REASONS)[number]) : "just-sit";
  const going = (e.votes[slot.id] ?? []).filter((id) => id !== e.hostId);
  const sitting = await putDoc(familyId, "sitting", {
    id: e.sittingId ?? newId("sit"),
    gatherEventId: e.id,
    reason,
    title: e.title,
    hostId: e.hostId,
    startsAt: slot.startsAt,
    invites: e.invites,
    note: e.plan.runOfShow.map((s) => s.title).join(" · ").slice(0, 200),
    venue,
    going,
    cantMake: [],
    createdAt: new Date().toISOString(),
  });
  return putEvent(familyId, { ...e, status: "locked", lockedSlotId: slot.id, sittingId: sitting.id });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-event" }, { status: 400 });
  const body = parsed.data;
  const members = await dbListMembers(auth.familyId);
  const inFamily = (id: string) => members.some((m) => m.id === id);
  const me = members.find((m) => m.id === auth.memberId);
  if (!me) return Response.json({ error: "unknown-member" }, { status: 404 });

  if (body.action === "dismiss") {
    await dismiss(auth.familyId, auth.memberId, body.key);
    return Response.json({ dismissed: body.key });
  }

  if (body.action === "create") {
    if (!can(me, "events.plan") || me.role === "child") return Response.json({ error: "grown-ups-only" }, { status: 403 });
    if (body.extras && !isAdmin(me)) return Response.json({ error: "admins-only" }, { status: 403 });
    if (!checkRateLimit(auth, "/api/gather")) return Response.json({ error: "rate-limited" }, { status: 429 });
    const t = today();
    if (body.date < addDays(t, -1) || body.date > addDays(t, 366)) return Response.json({ error: "bad-date" }, { status: 400 });
    if (body.forMemberId && !inFamily(body.forMemberId)) return Response.json({ error: "unknown-member" }, { status: 400 });
    // One event per occasion per date: a second tap opens the same one.
    const existing = (await listEvents(auth.familyId)).find((e) => e.status !== "cancelled" && body.occasionKey && occasionEventKey(e.occasionKey, e.date, e.forMemberId) === occasionEventKey(body.occasionKey, body.date, body.forMemberId));
    if (existing) return Response.json({ event: existing });

    const honoree = members.find((m) => m.id === body.forMemberId);
    const occ = body.occasionKey && body.occasionKey !== "birthday" ? (await upcoming(auth.familyId, members, 366)).find((o) => o.slug === body.occasionKey && o.date === body.date) : undefined;
    const title = body.title ?? eventTitle(body.type, occ?.label ?? (honoree ? callName(honoree) : "Family evening"));
    const invites = Array.from(new Set((body.invites ?? members.map((m) => m.id)).filter((id) => inFamily(id) && id !== auth.memberId)));
    const minutes = body.minutes ?? templateFor(body.type).minutes;
    const zones = members.filter((m) => m.id === auth.memberId || invites.includes(m.id)).map((m) => m.tz);
    const slots = proposeSlots({ zones, hostTz: me.tz, date: body.date, minutes }).map((d, i) => ({ id: `s${i + 1}`, startsAt: d.toISOString() }));
    const { plan, source } = await draftPlan({
      familyId: auth.familyId,
      type: body.type,
      title,
      hostId: auth.memberId,
      honoreeId: body.forMemberId,
      minutes,
      members: members.filter((m) => m.id === auth.memberId || invites.includes(m.id)),
      occasionNote: occ?.label,
      extras: body.extras,
    });
    const event = await putEvent(auth.familyId, {
      id: newId("event"),
      type: body.type,
      title,
      forMemberId: body.forMemberId,
      occasionKey: body.occasionKey,
      date: body.date,
      hostId: auth.memberId,
      invites,
      minutes,
      slots,
      votes: {},
      answered: [],
      status: "voting",
      lockedSlotId: null,
      sittingId: null,
      plan,
      planSource: source,
      extras: body.extras,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ event }, { status: 201 });
  }

  const e = await getEvent(auth.familyId, body.eventId);
  if (!e || e.status === "cancelled") return Response.json({ error: "unknown-event" }, { status: 404 });
  const isHost = e.hostId === auth.memberId;
  if (!participants(e).includes(auth.memberId)) return Response.json({ error: "not-invited" }, { status: 403 });

  if (body.action === "vote" || body.action === "none") {
    if (e.status !== "voting") return Response.json({ error: "already-locked", event: e }, { status: 409 });
    if (body.action === "vote" && !e.slots.some((s) => s.id === body.slotId)) return Response.json({ error: "unknown-slot" }, { status: 400 });
    let next = body.action === "vote" ? toggleVote(e, body.slotId, auth.memberId) : markNone(e, auth.memberId);
    next = await putEvent(auth.familyId, next);
    // When most can make it, Muse locks the slot and opens the session.
    // The planner's venue rides along when their own vote locks it.
    const ready = slotToLock(next);
    if (ready) next = await lock(auth.familyId, next, ready.id, body.action === "vote" && isHost ? body.venue : undefined);
    return Response.json({ event: next, locked: next.status === "locked" });
  }
  if (body.action === "lock") {
    if (!isHost) return Response.json({ error: "not-host" }, { status: 403 });
    if (!e.slots.some((s) => s.id === body.slotId)) return Response.json({ error: "unknown-slot" }, { status: 400 });
    return Response.json({ event: await lock(auth.familyId, e, body.slotId, body.venue), locked: true });
  }
  if (body.action === "task") {
    if (body.ownerId && !inFamily(body.ownerId)) return Response.json({ error: "unknown-member" }, { status: 400 });
    if (!e.plan.tasks.some((t) => t.id === body.taskId)) return Response.json({ error: "unknown-task" }, { status: 404 });
    const tasks = e.plan.tasks.map((t) => (t.id === body.taskId ? { ...t, ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}), ...(body.done !== undefined ? { done: body.done } : {}) } : t));
    return Response.json({ event: await putEvent(auth.familyId, { ...e, plan: { ...e.plan, tasks } }) });
  }
  // cancel
  if (!isHost) return Response.json({ error: "not-host" }, { status: 403 });
  if (e.sittingId) await deleteDoc(auth.familyId, "sitting", e.sittingId);
  return Response.json({ event: await putEvent(auth.familyId, { ...e, status: "cancelled" }) });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
