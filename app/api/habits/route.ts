import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { DEFAULT_HABIT, HABIT_NAME_MAX, activeHabit, appendHabitEvent, dayIn, habitCan, habitData, habitDays, tickId, timeLabel, todaysTicks, everyoneDone } from "@/lib/habits";
import type { Habit, HabitEvent } from "@/lib/kinds";
import { habitCompleted } from "@/lib/habits-server";
import { getDoc, listDocs, newId, putDoc, saveHabitAction } from "@/lib/family-docs";
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
  const historyId = new URL(req.url).searchParams.get("history");
  if (historyId !== null) {
    const [members, habit] = await Promise.all([
      membersFor(req, auth.familyId), getDoc(auth.familyId, "habit", historyId),
    ]);
    if (!members.some((member) => member.id === auth.memberId && member.status !== "pending")) {
      return Response.json({ error: "not-allowed" }, { status: 403 });
    }
    if (!habit) return Response.json({ error: "unknown-habit" }, { status: 404 });
    const ticks = await listDocs(auth.familyId, "habit_tick", { sinceMs: 50 * 86_400_000 }); // one bounded query: the calendar shows 49 days
    const habitTicks = ticks.filter((tick) => tick.habitId === habit.id);
    const people = new Set([...habit.members, ...habitTicks.map((tick) => tick.memberId), ...(habit.history ?? []).map((event) => event.memberId)]);
    return Response.json({
      calendars: members.filter((member) => people.has(member.id) && member.status !== "pending").map((member) => {
        const done = new Set(habitTicks.filter((tick) => tick.memberId === member.id).map((tick) => tick.day));
        return { memberId: member.id, days: habitDays(dayIn(member.tz), 49).map((day) => ({ day, done: done.has(day) })) };
      }),
      events: [...(habit.history ?? [])].reverse(),
    });
  }
  const [members, habits, ticks] = await Promise.all([membersFor(req, auth.familyId), docsFor(req, auth.familyId, "habit"), docsFor(req, auth.familyId, "habit_tick")]);
  const archived = habits.filter((habit) => habit.archivedAt).map(({ id, name }) => ({ id, name }));
  return Response.json({ ...habitData(habits, ticks, members, auth.memberId), archived });
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
  const day = dayIn(me.tz, now);
  const event: HabitEvent = { id: newId("event"), action: body.action, memberId: me.id, day, at: now.toISOString(), zone: me.tz || "UTC" };
  const withEvent = (habit: Habit, details?: Pick<HabitEvent, "before" | "after">) =>
    ({ ...habit, history: appendHabitEvent(habit, { ...event, ...details }) });
  const save = async (habit: Habit, details?: Pick<HabitEvent, "before" | "after">) => {
    const next = withEvent(habit, details);
    return await saveHabitAction(auth.familyId, next, habit.history?.at(-1)?.id ?? null)
      ? Response.json({ habit: next }) : conflict();
  };
  const conflict = () => Response.json({ error: "habit-changed" }, { status: 409 });
  const [members, habits] = await Promise.all([membersFor(req, auth.familyId), docsFor(req, auth.familyId, "habit")]);

  if (body.action === "create") {
    if (activeHabit(habits)) return Response.json({ error: "have-one" }, { status: 409 });
    const habit = await putDoc(auth.familyId, "habit", withEvent({ id: newId("habit"), name: body.name, hour: body.hour, minute: body.minute, createdBy: me.id, createdAt: now.toISOString(), members: [me.id], archivedAt: null }));
    return Response.json({ habit }, { status: 201 });
  }

  const habit = habits.find((h) => h.id === body.habitId && !h.archivedAt);
  if (!habit) return Response.json({ error: "unknown-habit" }, { status: 404 });

  if (body.action === "archive") {
    if (!habitCan("archive", me, habit)) return Response.json({ error: "not-allowed" }, { status: 403 });
    return save({ ...habit, archivedAt: now.toISOString() });
  }
  if (body.action === "join") {
    if (habit.members.includes(me.id)) return Response.json({ habit });
    return save({ ...habit, members: [...habit.members, me.id] });
  }
  if (body.action === "leave") {
    if (!habit.members.includes(me.id)) return Response.json({ habit });
    return save({ ...habit, members: habit.members.filter((id) => id !== me.id) });
  }
  if (body.action === "rename") return save({ ...habit, name: body.name }, { before: habit.name, after: body.name });
  if (body.action === "retime") return save({ ...habit, hour: body.hour, minute: body.minute }, { before: timeLabel(habit.hour, habit.minute), after: timeLabel(body.hour, body.minute) });

  // tick / untick: yourself only, on your own local day.
  const id = tickId(habit.id, me.id, day);
  if (body.action === "tick" && !habit.members.includes(me.id)) return Response.json({ error: "not-joined" }, { status: 409 });
  const saved = await saveHabitAction(auth.familyId, withEvent(habit), habit.history?.at(-1)?.id ?? null, {
    mode: body.action, value: { id, habitId: habit.id, memberId: me.id, day, at: now.toISOString() },
  });
  if (!saved) return conflict();
  if (body.action === "tick") {
    // The family's glow: this was the last one in. (Reads fresh: the ticks of the others are already written.)
    const ticks = await listDocs(auth.familyId, "habit_tick");
    const inIds = habit.members.filter((m) => members.some((x) => x.id === m && x.status !== "pending"));
    const done = todaysTicks({ id: habit.id, members: inIds }, ticks, members, now).map((t) => t.memberId);
    if (everyoneDone(inIds, done)) await habitCompleted(auth.familyId, habit, inIds, me.id, now);
  }
  return Response.json({ ok: true, ticked: body.action === "tick", day });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
