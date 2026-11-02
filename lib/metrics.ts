// Three honest numbers about whether Nearer is doing its job, for a family's owners and admins.
// No vanity counts (no totals of notes, no streaks, no "users"): each is about the two generations
// reaching toward each other.
//
//  - Two-way week: of the last 7 days, on how many did BOTH a parent reached toward a child AND a
//    child reached toward a parent (a note addressed to someone, a reaction or wish on their note,
//    or a lit lamp)? A broadcast to "everyone" is not reaching toward anyone.
//  - Bids answered in 24 h: of a parent's voice notes (last 30 days), the share someone of the
//    younger generation answered within 24 hours (a note back to that parent, or a reaction or wish
//    on the note). Listening alone is not an answer. A note still inside its 24 hours and not yet
//    answered is not counted either way.
//  - Parent active days: of the last 30 days, the days each parent did anything (shared a moment,
//    sent or played a note, reacted, lit the lamp), and the typical (median) parent.
//
// A "parent" is the elder generation (role elder); a "child" is anyone else who can act. Days are
// the viewer's own days. Pure (client + server); lib/metrics-server.ts loads the bounded data.
import { addressees } from "./households";
import { localDay } from "./morning";
import type { Presence } from "./kinds";
import type { Card, Member, Play, Reaction, Wish } from "./schemas";

export const TWO_WAY_DAYS = 7;
export const BID_DAYS = 30;
export const BID_WINDOW_MS = 24 * 3_600_000;
export const ACTIVE_DAYS = 30;
/** The longest look-back any of the three needs. */
export const METRICS_LOOKBACK_DAYS = Math.max(TWO_WAY_DAYS, BID_DAYS, ACTIVE_DAYS) + 1;

export interface MetricsInput {
  now: Date;
  tz: string;
  members: Pick<Member, "id" | "role" | "status" | "displayName" | "firstName">[];
  cards: Pick<Card, "id" | "type" | "authorId" | "addressedTo" | "takenAt">[];
  reactions: Pick<Reaction, "cardId" | "memberId" | "createdAt">[];
  wishes: Pick<Wish, "cardId" | "memberId" | "createdAt">[];
  plays: Pick<Play, "memberId" | "playedAt">[];
  presence: Pick<Presence, "memberId" | "at">[];
  /** Lamps lit: who, when (only the latest light per home is kept, so this undercounts a busy day, never overcounts). */
  lights: { by: string; at: string }[];
}

export interface TwoWayWeek {
  days: number;
  of: number;
  /** 0..1 */
  share: number;
}
export interface Bids {
  answered: number;
  total: number;
  /** 0..1, or null when no parent voice note has had its 24 hours yet. */
  share: number | null;
}
export interface ParentDays {
  perParent: { id: string; name: string; days: number }[];
  /** The median parent's days, or null when the family has no parent in it. */
  typical: number | null;
  of: number;
}
export interface FamilyMetrics {
  twoWayWeek: TwoWayWeek;
  bidsAnswered: Bids;
  parentActiveDays: ParentDays;
}

interface Act {
  from: string;
  /** Who it was for; null = "the other home" (a lamp). */
  to: string | null;
  at: string;
}

const MS_DAY = 86_400_000;
const within = (iso: string, now: Date, days: number): boolean => {
  const age = now.getTime() - Date.parse(iso);
  return age >= -60_000 && age < days * MS_DAY;
};

function actsOf(i: MetricsInput): Act[] {
  const byId = new Map(i.cards.map((c) => [c.id, c]));
  const acts: Act[] = [];
  for (const c of i.cards) if (c.authorId) for (const to of addressees(c)) if (to !== c.authorId) acts.push({ from: c.authorId, to, at: c.takenAt });
  for (const r of [...i.reactions, ...i.wishes]) {
    const card = r.cardId ? byId.get(r.cardId) : undefined;
    if (card?.authorId && card.authorId !== r.memberId) acts.push({ from: r.memberId, to: card.authorId, at: r.createdAt });
  }
  for (const l of i.lights) acts.push({ from: l.by, to: null, at: l.at });
  return acts;
}

export function twoWayWeek(i: MetricsInput): TwoWayWeek {
  const isParent = new Set(i.members.filter((m) => m.role === "elder").map((m) => m.id));
  const known = new Set(i.members.map((m) => m.id));
  const parentReached = new Set<string>();
  const childReached = new Set<string>();
  for (const a of actsOf(i)) {
    if (!known.has(a.from) || !within(a.at, i.now, TWO_WAY_DAYS)) continue;
    const day = localDay(a.at, i.tz);
    if (isParent.has(a.from)) {
      if (a.to === null || (known.has(a.to) && !isParent.has(a.to))) parentReached.add(day);
    } else if (a.to === null || isParent.has(a.to)) {
      childReached.add(day);
    }
  }
  // Exactly the last 7 local days, today included (a day not yet over still counts if both have already happened).
  const days = Array.from({ length: TWO_WAY_DAYS }, (_, n) => localDay(new Date(i.now.getTime() - n * MS_DAY), i.tz));
  const both = days.filter((d) => parentReached.has(d) && childReached.has(d)).length;
  return { days: both, of: TWO_WAY_DAYS, share: Math.round((both / TWO_WAY_DAYS) * 100) / 100 };
}

export function bidsAnswered(i: MetricsInput): Bids {
  const isParent = new Set(i.members.filter((m) => m.role === "elder").map((m) => m.id));
  const known = new Set(i.members.map((m) => m.id));
  let answered = 0;
  let total = 0;
  for (const bid of i.cards) {
    if (bid.type !== "audio" || !bid.authorId || !isParent.has(bid.authorId) || !within(bid.takenAt, i.now, BID_DAYS)) continue;
    const start = Date.parse(bid.takenAt);
    const end = start + BID_WINDOW_MS;
    const inTime = (iso: string) => Date.parse(iso) > start && Date.parse(iso) <= end;
    const younger = (id: string) => known.has(id) && !isParent.has(id) && id !== bid.authorId;
    const replied =
      i.cards.some((c) => c.authorId && younger(c.authorId) && inTime(c.takenAt) && addressees(c).includes(bid.authorId as string)) ||
      [...i.reactions, ...i.wishes].some((r) => r.cardId === bid.id && younger(r.memberId) && inTime(r.createdAt));
    if (replied) {
      answered++;
      total++;
    } else if (end <= i.now.getTime()) {
      total++;
    }
  }
  return { answered, total, share: total === 0 ? null : Math.round((answered / total) * 100) / 100 };
}

export function parentActiveDays(i: MetricsInput): ParentDays {
  const parents = i.members.filter((m) => m.role === "elder" && m.status !== "pending");
  const stamps = new Map<string, Set<string>>(parents.map((p) => [p.id, new Set<string>()]));
  const note = (id: string | null | undefined, iso: string) => {
    if (id && stamps.has(id) && within(iso, i.now, ACTIVE_DAYS)) stamps.get(id)?.add(localDay(iso, i.tz));
  };
  for (const p of i.presence) note(p.memberId, p.at);
  for (const c of i.cards) note(c.authorId, c.takenAt);
  for (const p of i.plays) note(p.memberId, p.playedAt);
  for (const r of i.reactions) note(r.memberId, r.createdAt);
  for (const w of i.wishes) note(w.memberId, w.createdAt);
  for (const l of i.lights) note(l.by, l.at);
  const perParent = parents.map((p) => ({ id: p.id, name: p.displayName || p.firstName || "Parent", days: stamps.get(p.id)?.size ?? 0 })).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  const sorted = perParent.map((p) => p.days).sort((a, b) => a - b);
  const typical = sorted.length === 0 ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  return { perParent, typical, of: ACTIVE_DAYS };
}

export function familyMetrics(i: MetricsInput): FamilyMetrics {
  return { twoWayWeek: twoWayWeek(i), bidsAnswered: bidsAnswered(i), parentActiveDays: parentActiveDays(i) };
}
