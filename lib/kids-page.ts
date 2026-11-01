// What the Kids page (/bond/kids, grown-ups only) shows, from lists already loaded: no
// queries here. The /api/kids route loads, this decides. Pure and client-safe.
import { askCardIds, guardianMap, isKid, kidCards, openAsksFor } from "./kids";
import type { BedtimeStory, HeightMark, KidAsk } from "./kinds";
import type { Card, Member, Relationship } from "./schemas";

/** Answered asks and bedtime stories shown on the page: the newest few, not the whole history. */
export const KIDS_PAGE_ANSWERED = 12;
export const KIDS_PAGE_STORIES = 20;

export interface KidsPage {
  /** The kids (not pending), in the order the family lists them. */
  kids: string[];
  /** Their own cards, newest first, with the spoken questions left out (the fridge). */
  fridge: Card[];
  /** Voice notes the page plays: the kids' spoken questions and the recorded bedtime stories. */
  voices: Card[];
  /** Open asks that are the viewer's to answer, then answered ones for the viewer's kids; newest first within each. */
  asks: KidAsk[];
  /** Answered ask id -> the Story its answer became. */
  askStory: Record<string, string>;
  stories: BedtimeStory[];
  marks: HeightMark[];
}

/** `cards` must already leave out anything sealed for the viewer. `tales` are the family's Stories (id and cardId are read). */
export function kidsPage(i: {
  viewerId: string;
  members: Member[];
  rels: Relationship[];
  cards: Card[];
  asks: KidAsk[];
  stories: BedtimeStory[];
  marks: HeightMark[];
  tales: { id: string; cardId: string }[];
}): KidsPage {
  const kids = i.members.filter((m) => isKid(m) && m.status !== "pending");
  const kidIds = new Set(kids.map((k) => k.id));
  const guardians = guardianMap(i.members, i.rels);
  const skip = askCardIds(i.asks);
  const fridge = kidCards(i.cards, kids).filter((c) => !skip.has(c.id));
  const open = openAsksFor(i.asks, i.viewerId, guardians).sort((a, b) => b.askedAt.localeCompare(a.askedAt));
  const answered = i.asks
    .filter((a) => a.answeredCardId && kidIds.has(a.fromMemberId) && (guardians[a.fromMemberId] ?? []).includes(i.viewerId))
    .sort((a, b) => (b.answeredAt ?? b.askedAt).localeCompare(a.answeredAt ?? a.askedAt))
    .slice(0, KIDS_PAGE_ANSWERED);
  const asks = [...open, ...answered];
  const askStory: Record<string, string> = {};
  for (const a of answered) {
    const tale = i.tales.find((t) => t.cardId === a.answeredCardId);
    if (tale) askStory[a.id] = tale.id;
  }
  const stories = i.stories
    .filter((s) => s.cardId && kidIds.has(s.forMemberId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, KIDS_PAGE_STORIES);
  const voiceIds = new Set<string>([...asks.map((a) => a.cardId), ...stories.map((s) => s.cardId)].filter((x): x is string => Boolean(x)));
  return {
    kids: kids.map((k) => k.id),
    fridge,
    voices: i.cards.filter((c) => voiceIds.has(c.id)),
    asks,
    askStory,
    stories,
    marks: i.marks.filter((m) => kidIds.has(m.memberId)),
  };
}
