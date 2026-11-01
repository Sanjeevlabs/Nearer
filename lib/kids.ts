// Children in Aangan: who counts as a kid, whose grandparent or parent someone is,
// the bedtime-story rules and kid asks. Pure and client-safe (no fs, no db): the
// routes load, this decides.
import type { BedtimeStory, KidAsk } from "./kinds";
import { ageOf } from "./people";
import type { Card, Member, Relationship } from "./schemas";

const DAY = 86_400_000;

/** The fields that decide whether someone is a kid. `birthday` and `tz` are optional so narrow picks still compile; without a birth year the old rule applies. */
export type KidLike = Pick<Member, "access" | "role"> & Partial<Pick<Member, "birthday" | "tz">>;

/** Under this age a person is a kid (13 and over are teens). */
export const KID_UNDER = 13;

/**
 * A child's own view of the app (kid mode). One rule, used everywhere:
 * a known age decides (under 13 is a kid, 13 and over never is); with no birth year it is
 * a child account, or a child-generation profile with plain member access.
 */
export function isKid(m: KidLike | undefined | null, now: Date = new Date()): boolean {
  if (!m) return false;
  const age = ageOf(m, now);
  if (age !== null) return age < KID_UNDER;
  return m.access === "child" || (m.role === "child" && m.access === "member");
}

/** Something that belongs on the fridge: a kid shared it, or a grown-up added it for a kid (`forMemberId`). */
export function isKidCard(card: Pick<Card, "authorId"> & { forMemberId?: string | null }, members: (KidLike & { id: string })[]): boolean {
  const list = members;
  if (card.forMemberId && isKid(list.find((m) => m.id === card.forMemberId))) return true;
  if (!card.authorId) return false;
  return isKid(list.find((m) => m.id === card.authorId));
}

/** The kid a fridge card is about: who it was added for, else who shared it. */
export function fridgeKidId(card: Pick<Card, "authorId"> & { forMemberId?: string | null }): string | null {
  return card.forMemberId ?? card.authorId ?? null;
}

/** A grown-up put this on the fridge for a kid (so it says "Pinned by"). */
export function pinnedBy(card: Pick<Card, "authorId"> & { forMemberId?: string | null }): string | null {
  return card.forMemberId && card.authorId && card.authorId !== card.forMemberId ? card.authorId : null;
}

/** Voice notes that are a child's question (kid_ask), not something they shared: left off the fridge and the tile. */
export function askCardIds(asks: Pick<KidAsk, "cardId">[]): Set<string> {
  return new Set(asks.map((a) => a.cardId).filter((x): x is string => Boolean(x)));
}

/** The fridge: the kids' own cards and the ones grown-ups added for them, newest first. */
export function kidCards<C extends Pick<Card, "authorId" | "takenAt"> & { forMemberId?: string | null }>(cards: C[], members: (KidLike & { id: string })[]): C[] {
  return cards.filter((c) => isKidCard(c, members)).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/* ------------------------------------------------------------ who is whose */
function parentIds(childId: string, rels: Relationship[]): string[] {
  const out = new Set<string>();
  for (const r of rels) {
    if (r.memberId === childId && r.canonicalKind === "parent") out.add(r.relationMemberId);
    if (r.relationMemberId === childId && r.canonicalKind === "child") out.add(r.memberId);
  }
  return Array.from(out);
}

/** A child's parents and grandparents in the tree (both edge directions), never the child. */
export function guardiansOf(childId: string, rels: Relationship[]): string[] {
  const parents = parentIds(childId, rels);
  const out = new Set<string>(parents);
  for (const p of parents) for (const g of parentIds(p, rels)) out.add(g);
  out.delete(childId);
  return Array.from(out);
}

/** Child id -> their parents and grandparents, for every kid in the family. */
export function guardianMap(members: Member[], rels: Relationship[]): Record<string, string[]> {
  return Object.fromEntries(members.filter((m) => isKid(m)).map((k) => [k.id, guardiansOf(k.id, rels)]));
}

/** The kids this person is a parent or grandparent of. */
export function kidsOf(personId: string, members: Member[], rels: Relationship[]): Member[] {
  return members.filter((m) => isKid(m) && m.status !== "pending" && guardiansOf(m.id, rels).includes(personId));
}

/** The grandparents (parents' parents) of a kid, for the kid's own screen. */
export function grandparentsOf(childId: string, rels: Relationship[]): string[] {
  const out = new Set<string>();
  for (const p of parentIds(childId, rels)) for (const g of parentIds(p, rels)) out.add(g);
  out.delete(childId);
  return Array.from(out);
}

/* ----------------------------------------------------------------- bedtime */
/** Bedtime is the suggestion, not a lock: a recorded story plays whenever the child opens it. */
export const BEDTIME_HOUR = 19;

/** The viewer's calendar day (YYYY-MM-DD) in a zone. */
export function dayIn(tz: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Stories for one child that carry a voice, newest first (a "not now" row has no voice). */
export function storiesFor(childId: string, stories: BedtimeStory[]): (BedtimeStory & { cardId: string })[] {
  return stories
    .filter((s): s is BedtimeStory & { cardId: string } => s.forMemberId === childId && Boolean(s.cardId))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Stories on the shelf this long are still "tonight's"; older ones rest. */
export const STORY_FRESH_DAYS = 7;

/** What a child sees for tonight: the newest story from the last week, playable at any hour. */
export function tonightFor(child: Pick<Member, "id" | "tz">, stories: BedtimeStory[], now: Date): { story: BedtimeStory & { cardId: string }; open: true } | null {
  const fresh = storiesFor(child.id, stories).filter((s) => now.getTime() - Date.parse(s.at) < STORY_FRESH_DAYS * DAY && Date.parse(s.at) <= now.getTime() + 60_000);
  const story = fresh[0];
  if (!story) return null;
  return { story, open: true };
}

/**
 * The one "Tonight's story for <child>" prompt a grown-up may see today: none if they already
 * recorded or said "not now" today (their own day), else the child they have told the least recently.
 */
export function bedtimePrompt(viewer: Pick<Member, "id" | "tz">, kids: Pick<Member, "id" | "tz">[], stories: BedtimeStory[], now: Date): { childId: string } | null {
  if (kids.length === 0) return null;
  const today = dayIn(viewer.tz, now);
  const mine = stories.filter((s) => s.byMemberId === viewer.id);
  if (mine.some((s) => dayIn(viewer.tz, new Date(s.at)) === today)) return null;
  const last = (kidId: string): string => mine.filter((s) => s.forMemberId === kidId && s.cardId).sort((a, b) => b.at.localeCompare(a.at))[0]?.at ?? "";
  const pick = [...kids].sort((a, b) => last(a.id).localeCompare(last(b.id)) || a.id.localeCompare(b.id))[0];
  return { childId: pick.id };
}

/* --------------------------------------------------------------- kid asks */
/** Open asks (not yet answered) that are the viewer's to answer: addressed to them, or to any guardian of the child. */
export function openAsksFor<A extends Pick<KidAsk, "fromMemberId" | "toMemberId" | "answeredCardId">>(asks: A[], viewerId: string, guardians: Record<string, string[]>): A[] {
  return asks.filter((a) => {
    if (a.answeredCardId || a.fromMemberId === viewerId) return false;
    return a.toMemberId ? a.toMemberId === viewerId : (guardians[a.fromMemberId] ?? []).includes(viewerId);
  });
}

/** An ask's words for the waiting line and the courtyard card. */
export function askLine(name: string, topic: KidAsk["topic"]): string {
  return topic === "story" ? `${name} would like a story` : `${name} asked you something`;
}

/* ------------------------------------------------------ the kids' glance tile */
export interface KidsTile {
  text: string;
  href: string;
  /** New kid cards since the viewer's previous visit. */
  count: number;
}

/**
 * "From the kids": kid cards that arrived after `since` (the viewer's previous visit; a week back
 * if there was none), with the names of who shared. Null hides the tile.
 */
export function kidsTile(cards: (Pick<Card, "id" | "authorId" | "takenAt"> & { forMemberId?: string | null })[], members: Member[], viewerId: string, since: string | null, now: Date, skip: ReadonlySet<string> = new Set()): KidsTile | null {
  const from = since ?? new Date(now.getTime() - 7 * DAY).toISOString();
  const fresh = kidCards(cards, members).filter((c) => !skip.has(c.id) && c.authorId !== viewerId && c.takenAt > from && Date.parse(c.takenAt) <= now.getTime() + 60_000);
  if (fresh.length === 0) return null;
  const names: string[] = [];
  for (const c of fresh) {
    const m = members.find((x) => x.id === fridgeKidId(c));
    const n = m?.displayName || m?.firstName || "";
    if (n && !names.includes(n)) names.push(n);
  }
  const who = names.length <= 1 ? (names[0] ?? "the kids") : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} & others`;
  return { text: `New from ${who}`, href: "/bond/kids", count: fresh.length };
}
