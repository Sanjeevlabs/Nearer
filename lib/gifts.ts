import type { Attempt, Question, Recipe, Story } from "./kinds";
import type { Card, Play } from "./schemas";

// "Your gifts this week": proof that what a parent gave landed. Built only
// from what really happened (someone cooked their recipe, listened to their
// story, heard their advice). Words, never counts or scores (SPEC §28).

export interface Gift {
  id: string;
  /** Who used it. */
  byId: string;
  at: string;
  /** "cooked your Dal tadka", "listened to your story about the elephant". */
  text: string;
  href: string;
}

const WEEK = 7 * 86_400_000;

export function giftsFor(
  giverId: string,
  data: { cards: Card[]; plays: Play[]; recipes: Recipe[]; attempts: Attempt[]; stories: Story[]; questions: Question[] },
  now = Date.now(),
  limit = 6,
): Gift[] {
  const since = now - WEEK;
  const recent = (iso: string) => Date.parse(iso) >= since && Date.parse(iso) <= now + 60_000;
  const out: Gift[] = [];

  // Someone cooked their recipe.
  const mine = new Map(data.recipes.filter((r) => r.cookId === giverId).map((r) => [r.id, r]));
  for (const a of data.attempts) {
    const r = mine.get(a.recipeId);
    if (!r || a.memberId === giverId || !recent(a.createdAt)) continue;
    out.push({ id: `cooked-${a.id}`, byId: a.memberId, at: a.createdAt, text: `cooked your ${r.title}`, href: `/kitchen/${r.id}` });
  }

  // Someone listened to something they said: a story, an answer, a voice note.
  const cards = new Map(data.cards.filter((c) => c.authorId === giverId).map((c) => [c.id, c]));
  const storyOf = new Map(data.stories.filter((s) => s.tellerId === giverId).map((s) => [s.cardId, s]));
  const answerOf = new Map(data.questions.filter((q) => q.toMemberId === giverId && q.answeredCardId).map((q) => [q.answeredCardId as string, q]));
  const recipeOf = new Map(data.recipes.filter((r) => r.cookId === giverId && r.voiceCardId).map((r) => [r.voiceCardId as string, r]));
  const seen = new Set<string>();
  for (const p of [...data.plays].sort((a, b) => b.playedAt.localeCompare(a.playedAt))) {
    const card = cards.get(p.cardId);
    if (!card || p.memberId === giverId || !recent(p.playedAt)) continue;
    const key = `${p.memberId}:${p.cardId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const story = storyOf.get(card.id);
    const answer = answerOf.get(card.id);
    const recipe = recipeOf.get(card.id);
    const text = story
      ? `listened to your story, “${story.title}”`
      : answer
        ? answer.topic === "blessing"
          ? "heard your blessing"
          : `heard your advice on “${answer.text.replace(/\?$/, "")}”`
        : recipe
          ? `listened to how you make ${recipe.title}`
          : "heard your voice memory";
    out.push({ id: `heard-${p.id}`, byId: p.memberId, at: p.playedAt, text, href: story ? "/stories" : answer ? "/advice" : recipe ? `/kitchen/${recipe.id}` : "/lane" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
