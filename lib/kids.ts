// Children in Aangan: who counts as a kid, whose grandparent or parent someone is,
// the bedtime-story rules, kid asks and the doorframe's "grew" line. Pure and
// client-safe (no fs, no db): the routes load, this decides.
// No advice, no percentiles, no health words anywhere in here: a height is a
// number and a date, nothing more.
import type { BedtimeStory, HeightMark, KidAsk } from "./kinds";
import type { Card, Member, Relationship } from "./schemas";
import { hourIn } from "./zones";

const DAY = 86_400_000;

/**
 * A child's own view of the app (kid mode): a child account, or a child-generation
 * profile with plain member access. Teens and grown-ups never are.
 */
export function isKid(m: Pick<Member, "access" | "role"> | undefined | null): boolean {
  if (!m) return false;
  return m.access === "child" || (m.role === "child" && m.access === "member");
}

/** Something a child shared: its author is a kid. The only marker; nothing extra is stored. */
export function isKidCard(card: Pick<Card, "authorId">, members: Pick<Member, "id" | "access" | "role">[]): boolean {
  if (!card.authorId) return false;
  return isKid(members.find((m) => m.id === card.authorId));
}

/** Voice notes that are a child's question (kid_ask), not something they shared: left off the fridge and the tile. */
export function askCardIds(asks: Pick<KidAsk, "cardId">[]): Set<string> {
  return new Set(asks.map((a) => a.cardId).filter((x): x is string => Boolean(x)));
}

/** The kids' own cards, newest first. */
export function kidCards<C extends Pick<Card, "authorId" | "takenAt">>(cards: C[], members: Pick<Member, "id" | "access" | "role">[]): C[] {
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
  return Object.fromEntries(members.filter(isKid).map((k) => [k.id, guardiansOf(k.id, rels)]));
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
/** Bedtime stories open at 7 PM where the child is. */
export const BEDTIME_HOUR = 19;

export function bedtimeOpen(tz: string, now: Date): boolean {
  return hourIn(tz, now) >= BEDTIME_HOUR;
}

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

/**
 * What a child sees for tonight: the newest recent story, and whether it is open yet.
 * Before 7 PM their time it is `waiting`, not playable.
 */
export function tonightFor(child: Pick<Member, "id" | "tz">, stories: BedtimeStory[], now: Date): { story: BedtimeStory & { cardId: string }; open: boolean } | null {
  const fresh = storiesFor(child.id, stories).filter((s) => now.getTime() - Date.parse(s.at) < STORY_FRESH_DAYS * DAY && Date.parse(s.at) <= now.getTime() + 60_000);
  const story = fresh[0];
  if (!story) return null;
  return { story, open: bedtimeOpen(child.tz, now) };
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

/* ---------------------------------------------------------- the kids' wall */
/** Marks for one child, oldest first. */
export function marksFor(childId: string, marks: HeightMark[]): HeightMark[] {
  return marks.filter((m) => m.memberId === childId).sort((a, b) => a.at.localeCompare(b.at));
}

/** "3 Mar" or "3 Mar 2025" when it is not this year. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const same = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(same ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** A new mark lands: how long it stays a news line. */
export const GREW_DAYS = 7;

export interface Grew {
  memberId: string;
  cm: number;
  /** Centimetres since the mark before. */
  by: number;
  since: string;
  at: string;
}

/**
 * "Vihaan grew 2 cm since 3 Mar": the newest mark of each child, when it is under a week old
 * and there is an earlier mark to measure from. Nothing else: no advice, no comparison.
 */
export function recentGrowth(marks: HeightMark[], now: Date): Grew[] {
  const out: Grew[] = [];
  for (const id of Array.from(new Set(marks.map((m) => m.memberId)))) {
    const list = marksFor(id, marks).filter((m) => Date.parse(m.at) <= now.getTime() + 60_000);
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    if (!last || !prev || now.getTime() - Date.parse(last.at) > GREW_DAYS * DAY) continue;
    const by = Math.round((last.cm - prev.cm) * 10) / 10;
    if (by <= 0) continue;
    out.push({ memberId: id, cm: last.cm, by, since: prev.at, at: last.at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function growLine(name: string, g: Pick<Grew, "by" | "since">, now: Date = new Date()): string {
  return `${name} grew ${Number.isInteger(g.by) ? g.by : g.by.toFixed(1)} cm since ${shortDate(g.since, now)}`;
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
export function kidsTile(cards: Pick<Card, "id" | "authorId" | "takenAt">[], members: Member[], viewerId: string, since: string | null, now: Date, skip: ReadonlySet<string> = new Set()): KidsTile | null {
  const from = since ?? new Date(now.getTime() - 7 * DAY).toISOString();
  const fresh = kidCards(cards, members).filter((c) => !skip.has(c.id) && c.authorId !== viewerId && c.takenAt > from && Date.parse(c.takenAt) <= now.getTime() + 60_000);
  if (fresh.length === 0) return null;
  const names: string[] = [];
  for (const c of fresh) {
    const m = members.find((x) => x.id === c.authorId);
    const n = m?.displayName || m?.firstName || "";
    if (n && !names.includes(n)) names.push(n);
  }
  const who = names.length <= 1 ? (names[0] ?? "the kids") : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} & others`;
  return { text: `New from ${who}`, href: "/bond/kids", count: fresh.length };
}
