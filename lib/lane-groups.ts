// Memory Lane grouping: same kind of thing together (photos, videos,
// voices), newest first, each with a small timeline cue. Memory Lane is the
// family's everyday photos and voices only: a card another tab owns
// (Occasions, Stories, The Book, Advice) stays there (laneElsewhere).
// Client-safe.
import type { Question, Story, TodayTask } from "./kinds";
import type { Card } from "./schemas";

export type LaneKind = "photo" | "video" | "audio";

export const LANE_ROWS: { kind: LaneKind; title: string; one: string; many: string }[] = [
  { kind: "photo", title: "Photos", one: "photo", many: "photos" },
  { kind: "video", title: "Videos", one: "video", many: "videos" },
  { kind: "audio", title: "Voice memories", one: "voice memory", many: "voice memories" },
];

function valid(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 26" on a tile. */
export function monthChip(iso: string): string {
  const d = valid(iso);
  if (!d) return "Undated";
  return `${d.toLocaleDateString("en-US", { month: "short" })} ’${String(d.getFullYear()).slice(2)}`;
}

/** "Oct 2026 → 2019" for a row (cards newest first). */
export function rangeLabel(cards: Pick<Card, "takenAt">[]): string {
  const dates = cards.map((c) => valid(c.takenAt)).filter((d): d is Date => d !== null);
  if (!dates.length) return "";
  const newest = dates.reduce((a, b) => (b > a ? b : a));
  const oldest = dates.reduce((a, b) => (b < a ? b : a));
  const head = newest.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  if (newest.getFullYear() === oldest.getFullYear()) {
    const tail = oldest.toLocaleDateString("en-US", { month: "short" });
    return tail === newest.toLocaleDateString("en-US", { month: "short" }) ? head : `${head} → ${tail}`;
  }
  return `${head} → ${oldest.getFullYear()}`;
}

/**
 * Cards another tab already shows, so Memory Lane leaves them out: what
 * Occasions claims (claimedByOccasions), every story's voice (Stories), each
 * answered question's voice (Advice, and the story or recipe it became), and
 * every elder's own answer to the daily question (The Book).
 */
export function laneElsewhere(input: {
  occasions: Iterable<string>;
  stories: Pick<Story, "cardId">[];
  questions: Pick<Question, "answeredCardId">[];
  tasks: Pick<TodayTask, "answers">[];
  /** Whose answers The Book shows: the elders. */
  bookIds: string[];
  cards: Pick<Card, "id" | "authorId">[];
}): Set<string> {
  const out = new Set(input.occasions);
  for (const s of input.stories) if (s.cardId) out.add(s.cardId);
  for (const q of input.questions) if (q.answeredCardId) out.add(q.answeredCardId);
  const author = new Map(input.cards.map((c) => [c.id, c.authorId]));
  for (const t of input.tasks) for (const a of t.answers) if (input.bookIds.includes(a.memberId) && author.get(a.cardId) === a.memberId) out.add(a.cardId);
  return out;
}

/** Cards split by kind, newest first, optionally only one person's; `skip` holds cards another tab shows. */
export function laneGroups(cards: Card[], who: string | null, skip?: Set<string>): Record<LaneKind, Card[]> {
  const out: Record<LaneKind, Card[]> = { photo: [], video: [], audio: [] };
  const list = [...cards].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  for (const c of list) {
    if (who && c.authorId !== who) continue;
    if (skip?.has(c.id)) continue;
    out[c.type].push(c);
  }
  return out;
}
