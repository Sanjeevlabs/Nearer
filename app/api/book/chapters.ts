// The Book of Maa & Papa (SPEC §30.4): every answer a person gave to the
// daily question becomes a chapter in their own voice. Answers to advice and
// blessing asks live on Advice, not here, so nothing shows twice. Pure: the
// route feeds it docs and cards.
import type { TodayTask } from "@/lib/kinds";
import type { Card, Member } from "@/lib/schemas";
import { TODAY_PROMPTS, fill } from "@/lib/today";

export interface Chapter {
  id: string;
  title: string;
  source: "today";
  at: string;
  year: number;
  card: Card;
}

const call = (m: Member | undefined) => (m ? m.displayName || m.firstName : "");
const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`);

/** The question as this person heard it. Older tasks may only carry the prompt id. */
function taskTitle(task: TodayTask, memberId: string, members: Member[]): string {
  const asParent = task.parents.includes(memberId);
  const stored = asParent ? task.forParents : task.forChildren;
  if (/\s/.test(stored)) return stored;
  const p = TODAY_PROMPTS.find((x) => x.id === task.promptId);
  if (!p) return "Today's question";
  const names = (ids: string[]) => join(ids.map((id) => call(members.find((m) => m.id === id))).filter(Boolean));
  return fill(asParent ? p.parents : p.children, names(task.children), names(task.parents));
}

/**
 * Chapters for `memberId`, newest first: every answer is open to every viewer
 * (nothing is sealed), and only the person's own voice notes count (a chapter is always in their voice).
 */
export function bookChapters({ memberId, viewerId, tasks, cards, members }: { memberId: string; viewerId: string; tasks: TodayTask[]; cards: Card[]; members: Member[] }): Chapter[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Chapter[] = [];
  const add = (id: string, title: string, source: Chapter["source"], cardId: string) => {
    const card = byId.get(cardId);
    if (!card || seen.has(cardId) || card.authorId !== memberId) return;
    seen.add(cardId);
    out.push({ id, title, source, at: card.takenAt, year: new Date(card.takenAt).getFullYear(), card });
  };
  for (const t of tasks) for (const a of t.answers) if (a.memberId === memberId) add(`${t.id}-${memberId}`, taskTitle(t, memberId, members), "today", a.cardId);
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Chapters grouped by year, newest year first. */
export function byYear(chapters: Chapter[]): { year: number; chapters: Chapter[] }[] {
  const map = new Map<number, Chapter[]>();
  for (const c of chapters) map.set(c.year, [...(map.get(c.year) ?? []), c]);
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, chapters: list }));
}
