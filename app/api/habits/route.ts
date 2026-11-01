import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { DEFAULT_HABIT, HABIT_NAME_MAX, activeHabit, dayIn, habitCan, habitData, tickId, todaysTicks, everyoneDone } from "@/lib/habits";
import { habitCompleted } from "@/lib/habits-server";
import { claimDoc, deleteDoc, listDocs, newId, putDoc } from "@/lib/family-docs";
import { docsFor, membersFor } from "@/lib/request-data";
import { memberFor } from "@/lib/request-memo";

// Together habits: one shared family habit ("Morning walk · 7 AM"), each person
// who joined ticks it once a day, and the family sees words, never scores.
//   GET  → { habit, today, me, can, everyone }  (also the courtyard's "habits" slice)
//   POST → { action: create | join | leave | rename | retime | archive | tick | untick, … }
// One write per action. The tick's day is the TICKER's local day, worked out
// here from their zone, never sent by the client; its id is
// "<habit>:<member>:<day>", written with claimDoc, so a double tap is one tick.

const Name = z.string().trim().min(1).max(HABIT_NAME_MAX);
const Hour = z.number().int().min(0).max(23);
const Minute = z.number().int().min(0).max(59);
const HabitId = z.string().min(1).max(80);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: Name.default(DEFAULT_HABIT.name), hour: Hour.default(DEFAULT_HABIT.hour), minute: Minute.default(DEFAULT_HABIT.minute) }),
  z.object({ action: z.literal("join"), habitId: HabitId }),
  z.object({ action: z.literal("leave"), habitId: HabitId }),
  z.object({ action: z.literal("rename"), habitId: HabitId, name: Name }),
  z.object({ action: z.literal("retime"), habitId: HabitId, hour: Hour, minute: Minute.default(0) }),
  z.object({ action: z.literal("archive"), habitId: HabitId }),
  z.object({ action: z.literal("tick"), habitId: HabitId }),
  z.object({ action: z.literal("untick"), habitId: HabitId }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [members, habits, ticks] = await Promise.all([membersFor(req, auth.familyId), docsFor(req, auth.familyId, "habit"), docsFor(req, auth.familyId, "habit_tick")]);
  return Response.json(habitData(habits, ticks, members, auth.memberId));
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-habit" }, { status: 400 });
  const body = parsed.data;
  const me = await memberFor(req, auth.memberId);
  if (!me) return Response.json({ error: "unknown-member" }, { status: 404 });
  if (body.action !== "archive" && !habitCan(body.action, me)) return Response.json({ error: "not-allowed" }, { status: 403 });
  const now = new Date();
  const [members, habits] = await Promise.all([membersFor(req, auth.familyId), docsFor(req, auth.familyId, "habit")]);

  if (body.action === "create") {
    if (activeHabit(habits)) return Response.json({ error: "have-one" }, { status: 409 });
    const habit = await putDoc(auth.familyId, "habit", { id: newId("habit"), name: body.name, hour: body.hour, minute: body.minute, createdBy: me.id, createdAt: now.toISOString(), members: [me.id], archivedAt: null });
    return Response.json({ habit }, { status: 201 });
  }

  const habit = habits.find((h) => h.id === body.habitId && !h.archivedAt);
  if (!habit) return Response.json({ error: "unknown-habit" }, { status: 404 });

  if (body.action === "archive") {
    if (!habitCan("archive", me, habit)) return Response.json({ error: "not-allowed" }, { status: 403 });
    return Response.json({ habit: await putDoc(auth.familyId, "habit", { ...habit, archivedAt: now.toISOString() }) });
  }
  if (body.action === "join") {
    if (habit.members.includes(me.id)) return Response.json({ habit });
    return Response.json({ habit: await putDoc(auth.familyId, "habit", { ...habit, members: [...habit.members, me.id] }) });
  }
  if (body.action === "leave") {
    if (!habit.members.includes(me.id)) return Response.json({ habit });
    return Response.json({ habit: await putDoc(auth.familyId, "habit", { ...habit, members: habit.members.filter((id) => id !== me.id) }) });
  }
  if (body.action === "rename") return Response.json({ habit: await putDoc(auth.familyId, "habit", { ...habit, name: body.name }) });
  if (body.action === "retime") return Response.json({ habit: await putDoc(auth.familyId, "habit", { ...habit, hour: body.hour, minute: body.minute }) });

  // tick / untick: yourself only, on your own local day.
  const day = dayIn(me.tz, now);
  const id = tickId(habit.id, me.id, day);
  if (body.action === "untick") {
    await deleteDoc(auth.familyId, "habit_tick", id);
    return Response.json({ ok: true, ticked: false, day });
  }
  if (!habit.members.includes(me.id)) return Response.json({ error: "not-joined" }, { status: 409 });
  const created = await claimDoc(auth.familyId, "habit_tick", { id, habitId: habit.id, memberId: me.id, day, at: now.toISOString() });
  if (created) {
    // The family's glow: this was the last one in. (Reads fresh: the ticks of the others are already written.)
    const ticks = await listDocs(auth.familyId, "habit_tick");
    const inIds = habit.members.filter((m) => members.some((x) => x.id === m && x.status !== "pending"));
    const done = todaysTicks({ id: habit.id, members: inIds }, ticks, members, now).map((t) => t.memberId);
    if (everyoneDone(inIds, done)) await habitCompleted(auth.familyId, habit, inIds, me.id, now);
  }
  return Response.json({ ok: true, ticked: true, day });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
