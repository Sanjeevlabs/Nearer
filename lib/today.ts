// Today (SPEC §29.8): one small task a day for both homes, chosen by Muse.
// It is done only when *both* sides answer, so each side carries a small
// responsibility, and the reward is the other side's voice: you hear their
// answer after you give yours. Answers are voice notes, so they land in
// Memories on their own. Pure helpers (client + server).
import type { TodayTask } from "./kinds";

export interface TodayPrompt {
  id: string;
  /** What the parents are asked; {child} is the son's or daughter's name. */
  parents: string;
  /** What the children are asked; {parents} is "Maa & Papa". */
  children: string;
}

// Questions with an outcome: a memory kept, a feeling said aloud, a promise.
export const TODAY_PROMPTS: TodayPrompt[] = [
  { id: "best-day", parents: "The most wonderful day you remember with {child}", children: "The most wonderful day you remember with {parents}" },
  { id: "miss", parents: "One thing you miss about {child}", children: "One thing you miss about {parents}" },
  { id: "improve", parents: "One thing you'd gently like {child} to do better", children: "One thing you'd gently like {parents} to do better" },
  { id: "learnt", parents: "Something {child} taught you", children: "Something {parents} taught you that you still use" },
  { id: "smile", parents: "What made you smile today", children: "What made you smile today" },
  { id: "first-home", parents: "Describe your first home together", children: "Describe your room in the house you grew up in" },
  { id: "proud", parents: "A moment you were proud of {child}", children: "A moment you were proud of {parents}" },
  { id: "promise", parents: "One thing to do together on the next visit", children: "One thing to do together on the next visit" },
];

export const PROMPT_IDS = TODAY_PROMPTS.map((p) => p.id) as [string, ...string[]];

/**
 * A week before an occasion, Muse asks both homes for it instead: a memory in
 * your voice, and this year's photos for the occasion's album.
 */
export function occasionPrompt(title: string): TodayPrompt {
  return {
    id: "occasion",
    parents: `${title} is coming. Your favourite memory of it with {child}, and add a photo`,
    children: `${title} is coming. Your favourite memory of it with {parents}, and add a photo`,
  };
}

export function fill(text: string, child: string, parents: string): string {
  return text.replace(/\{child\}/g, child).replace(/\{parents\}/g, parents);
}

/** YYYY-MM-DD in a zone. */
export function dateIn(tz: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Deterministic fallback pick: not one used in the last week, rotating by date. */
export function fallbackPrompt(date: string, recent: string[]): TodayPrompt {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  for (let i = 0; i < TODAY_PROMPTS.length; i++) {
    const p = TODAY_PROMPTS[(day + i) % TODAY_PROMPTS.length];
    if (!recent.includes(p.id)) return p;
  }
  return TODAY_PROMPTS[day % TODAY_PROMPTS.length];
}

export type Side = "parents" | "children" | null;

export function sideOf(task: TodayTask, memberId: string): Side {
  if (task.parents.includes(memberId)) return "parents";
  if (task.children.includes(memberId)) return "children";
  return null;
}

export function answeredBy(task: TodayTask, side: Exclude<Side, null>): boolean {
  const ids = side === "parents" ? task.parents : task.children;
  return task.answers.some((a) => ids.includes(a.memberId));
}

export function isComplete(task: TodayTask): boolean {
  return answeredBy(task, "parents") && answeredBy(task, "children");
}

/**
 * What a viewer sees: every answer, from both homes, at once (past days too). Nothing is
 * sealed behind answering: an answer is never a price for hearing someone else's.
 */
export function viewFor(task: TodayTask, memberId: string): TodayTask & { side: Side; mine: boolean; theirs: boolean } {
  const side = sideOf(task, memberId);
  const mine = task.answers.some((a) => a.memberId === memberId) || (side !== null && answeredBy(task, side));
  const other = side === "parents" ? "children" : "parents";
  return { ...task, side, mine, theirs: answeredBy(task, other) };
}
