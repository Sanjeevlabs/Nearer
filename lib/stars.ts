// "My favourites" and search for Memory Lane. Client-safe, pure.
//
// A star is personal: each person keeps their own list of starred photos and
// voice memories (on their own window_view doc, so no new table). Starred
// memories always come first in their row.
//
// Search matches only what Muse and the family already keep on a memory:
// the caption, the transcript, the summary, the note, the place, who shared
// it and who it was for, and its date. No model call at search time.
import type { Card, Member } from "./schemas";

export const MAX_STARS = 500;

/** Star or unstar one card; the newest star goes first. */
export function toggleStar(list: readonly string[], cardId: string, on?: boolean): string[] {
  const has = list.includes(cardId);
  const want = on ?? !has;
  const rest = list.filter((id) => id !== cardId);
  return want ? [cardId, ...rest].slice(0, MAX_STARS) : rest;
}

/** Starred first (in the order starred), then the rest in their own order. */
export function starredFirst<T extends { id: string }>(cards: T[], starred: readonly string[]): T[] {
  if (!starred.length) return cards;
  const rank = new Map(starred.map((id, i) => [id, i]));
  const top = cards.filter((c) => rank.has(c.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...top, ...cards.filter((c) => !rank.has(c.id))];
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "");

type Who = Pick<Member, "id" | "firstName" | "displayName">;

/** Everything a memory already carries, as one lowercase string to search. */
export function searchText(card: Card, members: Who[]): string {
  const name = (id: string | null | undefined) => {
    const m = id ? members.find((x) => x.id === id) : undefined;
    return m ? `${m.displayName} ${m.firstName}` : "";
  };
  const d = new Date(card.takenAt);
  const when = Number.isNaN(d.getTime())
    ? ""
    : `${d.toLocaleDateString("en-US", { month: "long" })} ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getFullYear()} ${d.toISOString().slice(0, 10)}`;
  return fold(
    [card.caption, card.transcript, card.segments.map((s) => s.text).join(" "), card.summary, card.note, card.place, name(card.authorId), name(card.addressedTo), when, card.type === "audio" ? "voice memory" : card.type].join(" "),
  );
}

/** Every word of the query is somewhere in the memory (any order). An empty query matches all. */
export function matchesSearch(card: Card, query: string, members: Who[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(card, members);
  return words.every((w) => hay.includes(w));
}
