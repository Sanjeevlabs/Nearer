// Together habits: one shared family habit ("Morning walk · 7 AM"), ticked once
// a day by each person who joined. The family sees words, never a score, a
// streak or a count of days, and never one person set against another. Pure
// helpers (client + server); the route is app/api/habits/route.ts.
import { dateInZone } from "./time-format";
import type { Habit, HabitTick } from "./kinds";
import { isAdmin } from "./permissions";
import type { Member } from "./schemas";

export const DEFAULT_HABIT = { name: "Morning walk", hour: 7, minute: 0 } as const;
export const HABIT_NAME_MAX = 40;
/** Ticks older than this are deleted by the daily scan (lib/purge.ts). */
export const HABIT_TICK_KEEP_DAYS = 60;

/** The wall-clock day (YYYY-MM-DD) in a zone; UTC when the zone is unknown. */
export function dayIn(tz: string, at: Date = new Date()): string {
  try {
    return dateInZone(tz || "UTC").format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The tick row's id: the same person and day always make the same id, so a double tap is one tick. */
export function tickId(habitId: string, memberId: string, day: string): string {
  return `${habitId}:${memberId}:${day}`;
}

/** "7 AM", "7:30 AM", "12 PM". */
export function timeLabel(hour: number, minute = 0): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Morning walk · 7 AM". */
export function habitTitle(h: Pick<Habit, "name" | "hour" | "minute">): string {
  return `${h.name} · ${timeLabel(h.hour, h.minute)}`;
}

const isWalk = (name: string) => /\bwalk/i.test(name);

/** What the person did, past tense: a walk is "walked"; any other habit the family named is "did it". */
export function doneVerb(name: string): string {
  return isWalk(name) ? "walked" : "did it";
}

/** The viewer's button once they have done it today. */
export function doneLabel(name: string): string {
  return isWalk(name) ? "Walked today ✓" : "Done today ✓";
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export interface HabitLineInput {
  habitName: string;
  viewerId: string;
  /** Everyone who joined and is still in the family, in the order to show them, with the word the viewer uses for each. */
  joined: { id: string; name: string }[];
  /** Of those, who has done it today (their own local day). */
  tickedIds: string[];
}

/**
 * The one line under the habit, in words. Never a number of days, never a
 * streak, never who is behind. Examples: "Maa and Priya walked today",
 * "Just you so far today", "Nobody yet today", "All five of you walked today".
 */
export function habitLine(i: HabitLineInput): string {
  const verb = doneVerb(i.habitName);
  const ticked = new Set(i.tickedIds);
  const did = i.joined.filter((j) => ticked.has(j.id));
  if (did.length === 0) return "Nobody yet today";
  const viewerIn = i.joined.some((j) => j.id === i.viewerId);
  if (did.length === i.joined.length && did.length >= 2) {
    if (!viewerIn) return `Everyone ${verb} today`;
    if (did.length === 2) return `Both of you ${verb} today`;
    const n = NUMBER_WORDS[did.length];
    return n ? `All ${n} of you ${verb} today` : `All of you ${verb} today`;
  }
  const names = [...did.filter((j) => j.id === i.viewerId).map(() => "You"), ...did.filter((j) => j.id !== i.viewerId).map((j) => j.name)];
  if (names.length === 1 && names[0] === "You") return "Just you so far today";
  if (names.length === 1) return `${names[0]} ${verb} today`;
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb} today`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} ${verb} today`;
  return `${names[0]}, ${names[1]} and others ${verb} today`;
}

/* ------------------------------------------------------------ permissions */

export type HabitAction = "create" | "join" | "leave" | "rename" | "retime" | "archive" | "tick" | "untick";

type Who = Pick<Member, "id" | "role" | "access" | "status">;

/**
 * Who may do what. Any active person can join, leave, tick and untick (children
 * included); a grown-up (adult or elder) can start the habit and rename or
 * re-time it; only whoever started it, or an admin, can archive it.
 */
export function habitCan(action: HabitAction, who: Who | undefined | null, habit?: Pick<Habit, "createdBy"> | null): boolean {
  if (!who || who.status === "pending") return false;
  switch (action) {
    case "join":
    case "leave":
    case "tick":
    case "untick":
      return true;
    case "create":
    case "rename":
    case "retime":
      return who.role !== "child";
    case "archive":
      return Boolean(habit) && (habit?.createdBy === who.id || isAdmin(who));
  }
}

/* ------------------------------------------------------------- the day's state */

/** The family's habit: the oldest one not archived, so two people who start one at once end up with the same. */
export function activeHabit(habits: Habit[]): Habit | undefined {
  return habits.filter((h) => !h.archivedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

export interface TodayTick {
  memberId: string;
  /** Their own local day. */
  day: string;
  at: string;
}

/**
 * Who has done it on their own "today": a tick counts when its day is the
 * ticker's local day right now, so a member in New York and one in India are
 * each ticking their own morning. Only people who joined and are still in.
 */
export function todaysTicks(habit: Pick<Habit, "id" | "members">, ticks: Pick<HabitTick, "habitId" | "memberId" | "day" | "at">[], members: Pick<Member, "id" | "tz" | "status">[], now: Date = new Date()): TodayTick[] {
  const out: TodayTick[] = [];
  for (const m of members) {
    if (m.status === "pending" || !habit.members.includes(m.id)) continue;
    const today = dayIn(m.tz, now);
    const t = ticks.find((x) => x.habitId === habit.id && x.memberId === m.id && x.day === today);
    if (t) out.push({ memberId: m.id, day: t.day, at: t.at });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Everyone who joined (two or more) has done it today. */
export function everyoneDone(joinedIds: string[], tickedIds: string[]): boolean {
  return joinedIds.length >= 2 && joinedIds.every((id) => tickedIds.includes(id));
}

/* -------------------------------------------------------------- weekly letter */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Words for the weekly letter's facts: who walked most mornings, and a day the
 * whole family did it together. Never a count of days; the threshold below is
 * only what "most" means. `days` is the week's local days, YYYY-MM-DD.
 */
export function habitWeekFacts(habit: Pick<Habit, "id" | "name" | "members">, ticks: Pick<HabitTick, "habitId" | "memberId" | "day">[], names: Record<string, string>, days: string[]): { day: string; text: string }[] {
  const mine = ticks.filter((t) => t.habitId === habit.id && days.includes(t.day) && habit.members.includes(t.memberId) && names[t.memberId]);
  const verb = isWalk(habit.name) ? "walked" : `did ${habit.name.toLowerCase()}`;
  const most = isWalk(habit.name) ? "most mornings" : "most days";
  const out: { day: string; text: string }[] = [];
  const last = days[days.length - 1];
  for (const id of habit.members) {
    const n = new Set(mine.filter((t) => t.memberId === id).map((t) => t.day)).size;
    if (names[id] && n >= Math.ceil(days.length / 2)) out.push({ day: last, text: `${names[id]} ${verb} ${most}` });
  }
  const present = habit.members.filter((id) => names[id]);
  if (present.length >= 2) {
    for (const d of days) {
      if (present.every((id) => mine.some((t) => t.memberId === id && t.day === d))) {
        out.push({ day: d, text: `The whole family ${verb} together on ${WEEKDAY_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()]}` });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------- the API's answer */

/** What GET /api/habits answers (and the courtyard's "habits" slice carries). */
export interface HabitData {
  habit: { id: string; name: string; hour: number; minute: number; createdBy: string; members: string[] } | null;
  /** Who has done it on their own today. */
  today: TodayTick[];
  me: { joined: boolean; ticked: boolean };
  can: { create: boolean; edit: boolean; archive: boolean };
  /** Everyone who joined (two or more) has done it today: the family's lamp glows. */
  everyone: boolean;
}

/** The answer for one viewer. Members who left or are still pending are not shown. */
export function habitData(habits: Habit[], ticks: HabitTick[], members: Member[], viewerId: string, now: Date = new Date()): HabitData {
  const viewer = members.find((m) => m.id === viewerId);
  const habit = activeHabit(habits);
  const can = { create: habitCan("create", viewer) && !habit, edit: habitCan("rename", viewer), archive: habitCan("archive", viewer, habit) };
  if (!habit) return { habit: null, today: [], me: { joined: false, ticked: false }, can, everyone: false };
  const inIds = habit.members.filter((id) => members.some((m) => m.id === id && m.status !== "pending"));
  const today = todaysTicks({ id: habit.id, members: inIds }, ticks, members, now);
  const tickedIds = today.map((t) => t.memberId);
  return {
    habit: { id: habit.id, name: habit.name, hour: habit.hour, minute: habit.minute, createdBy: habit.createdBy, members: inIds },
    today,
    me: { joined: inIds.includes(viewerId), ticked: tickedIds.includes(viewerId) },
    can,
    everyone: everyoneDone(inIds, tickedIds),
  };
}
