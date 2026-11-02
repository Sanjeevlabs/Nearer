// This week in your family: the one moment worth a second look. Pure.
// A voice note scores for who listened to it and who blessed it this week; a
// recipe scores when someone cooked it. The best one becomes a single gentle
// nudge ("This week in your family: ..."), never a count and never a ranking
// anyone sees. Nothing happened, nothing is sent.
import type { Attempt, Recipe, Story, TodayTask, Chitthi } from "./kinds";
import type { Card, Member, Play, Reaction } from "./schemas";

const DAY = 86_400_000;
export const DIGEST_WINDOW_DAYS = 7;
/** Below this the week was too quiet to make something of. */
export const MIN_SCORE = 3;

export interface Moment {
  kind: "story" | "voice" | "recipe";
  /** The card to open (null for a recipe nobody recorded). */
  cardId: string | null;
  authorId: string;
  score: number;
  href: string;
  /** Final nudge words; `{m:<id>}` is a person, resolved per reader. */
  text: string;
}

export interface MomentInput {
  now: Date;
  members: Pick<Member, "id" | "status">[];
  cards: Card[];
  plays: Play[];
  reactions: Reaction[];
  recipes: Recipe[];
  attempts: Attempt[];
  stories: Story[];
  tasks: TodayTask[];
  letters: Pick<Chitthi, "id" | "deliverAt">[];
}

const within = (iso: string, from: number, to: number) => {
  const t = Date.parse(iso);
  return t > from && t <= to;
};

const PREFIX = "This week in your family: ";
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The week's best moment, or null when nothing was heard, blessed or cooked. */
export function pickWeekMoment(i: MomentInput): Moment | null {
  const to = i.now.getTime();
  const from = to - DIGEST_WINDOW_DAYS * DAY;
  const active = new Set(i.members.filter((m) => m.status !== "pending").map((m) => m.id));

  // Not for everyone yet: unfinished daily answers (the other side hasn't heard them) and letters still in the envelope.
  const held = new Set<string>();
  for (const t of i.tasks) if (!t.completedAt) for (const a of t.answers) held.add(a.cardId);
  for (const l of i.letters) if (Date.parse(l.deliverAt) > to) held.add(l.id);

  const found: (Moment & { at: string })[] = [];

  // Voice notes: other people's listens and blessings this week.
  for (const c of i.cards) {
    if (c.type !== "audio" || !c.authorId || !active.has(c.authorId) || c.addressedTo || held.has(c.id) || c.source.startsWith("muse") || Date.parse(c.takenAt) > to) continue;
    const listeners = new Set(i.plays.filter((p) => p.cardId === c.id && p.memberId !== c.authorId && within(p.playedAt, from, to)).map((p) => p.memberId));
    const mine = i.reactions.filter((r) => r.cardId === c.id && r.memberId !== c.authorId && within(r.createdAt, from, to));
    const score = listeners.size * 2 + mine.filter((r) => r.kind === "bless").length * 3 + mine.filter((r) => r.kind === "love").length;
    if (score < MIN_SCORE) continue;
    const story = i.stories.find((s) => s.cardId === c.id);
    const what = story ? `story, ${clip(oneLine(story.title), 60)}` : c.caption.trim() && c.caption.length <= 60 ? `voice note, ${oneLine(c.caption)}` : "voice note";
    found.push({ kind: story ? "story" : "voice", cardId: c.id, authorId: c.authorId, score, at: c.takenAt, href: `/home?card=${encodeURIComponent(c.id)}`, text: `${PREFIX}{m:${c.authorId}}'s ${what}` });
  }

  // Recipes someone cooked this week.
  const byId = new Map(i.recipes.map((r) => [r.id, r]));
  for (const a of i.attempts) {
    const r = byId.get(a.recipeId);
    if (!r || !active.has(r.cookId) || !within(a.createdAt, from, to) || (r.voiceCardId && held.has(r.voiceCardId))) continue;
    const score = 4 + a.blessedBy.length * 2;
    const by = a.memberId === r.cookId ? "" : `, cooked by {m:${a.memberId}}`;
    found.push({ kind: "recipe", cardId: r.voiceCardId, authorId: r.cookId, score, at: a.createdAt, href: "/kitchen", text: `${PREFIX}{m:${r.cookId}}'s ${clip(oneLine(r.title), 50)}${by}` });
  }

  found.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at));
  const best = found[0];
  if (!best) return null;
  const { at: _at, ...moment } = best;
  void _at;
  return { ...moment, text: clip(moment.text, 120) };
}
