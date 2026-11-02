// The nudge queue. People under-initiate contact, so Nearer lends a little
// push, in one gentle batch: at most 3 event nudges a week per person plus the
// weekly letter, delivered together at their next 8 AM local. Reply loops
// ("she heard your note") are welcome; there are no streaks, no counts and no
// "x days since". Server only.
import { dbGetMember } from "./db";
import { getDoc, listDocs, putDoc } from "./family-docs";
import type { Nudge, NudgeKind, NudgeSettings } from "./kinds";
import type { Member } from "./schemas";
import { callName } from "./people";
import { weekStartOf } from "./week";

export const MAX_EVENT_NUDGES_PER_WEEK = 3;
export const DELIVERY_HOUR = 8;

export interface NudgeInput {
  toMemberId: string;
  kind: NudgeKind;
  text: string;
  href: string;
  /** Whoever caused the event: never told about their own action. */
  actorId?: string | null;
}

/** Offset (ms) of a zone from UTC at an instant: local = utc + offset. */
function offsetMs(tz: string, at: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(at / 1000) * 1000;
}

/** The next 8 AM on the recipient's wall clock, strictly after `now` (UTC if the zone is unknown). */
export function next8amLocal(tz: string, now: Date = new Date()): string {
  let zone = tz || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const t = now.getTime();
  const local = new Date(t + offsetMs(zone, t));
  for (let add = 0; add < 3; add++) {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, DELIVERY_HOUR);
    // Correct a UTC guess by the zone's offset at that instant (twice, to land across a DST change).
    let at = wall - offsetMs(zone, wall);
    at = wall - offsetMs(zone, at);
    if (at > t) return new Date(at).toISOString();
  }
  return new Date(t + 86_400_000).toISOString();
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Per-member preferences; with no saved doc: mail on when they have an address, up to 3 a week. */
export async function nudgeSettingsFor(familyId: string, memberId: string, member?: Pick<Member, "email">): Promise<NudgeSettings> {
  const saved = await getDoc(familyId, "nudge_settings", memberId);
  if (saved) return saved;
  return { id: memberId, email: Boolean(member?.email), maxPerWeek: MAX_EVENT_NUDGES_PER_WEEK };
}

/**
 * Queue one nudge. Returns null when it is left out: the person caused the
 * event, it is a repeat this week (same kind, link and person), they asked for
 * fewer, or they already have three event nudges this week (the letter is
 * outside that count).
 */
export async function enqueueNudge(familyId: string, input: NudgeInput, now: Date = new Date()): Promise<Nudge | null> {
  if (input.actorId && input.actorId === input.toMemberId) return null;
  const to = await dbGetMember(input.toMemberId);
  if (!to || to.familyId !== familyId || to.status === "pending") return null;
  const week = weekStartOf(now);
  const id = `nudge-${hash(`${week}|${input.kind}:${input.href}:${input.toMemberId}`)}`;
  const mine = (await listDocs(familyId, "nudge")).filter((n) => n.toMemberId === input.toMemberId && weekStartOf(new Date(n.at)) === week);
  if (mine.some((n) => n.id === id)) return null;
  // "This week in your family" comes once a week, outside the event count, and only for people who haven't asked for fewer nudges (0 a week = none).
  if (input.kind === "digest") {
    const settings = await nudgeSettingsFor(familyId, to.id, to);
    if (settings.maxPerWeek === 0 || mine.some((n) => n.kind === "digest")) return null;
  } else if (input.kind !== "letter") {
    const settings = await nudgeSettingsFor(familyId, to.id, to);
    const cap = Math.min(MAX_EVENT_NUDGES_PER_WEEK, settings.maxPerWeek);
    if (mine.filter((n) => n.kind !== "letter" && n.kind !== "digest").length >= cap) return null;
  }
  return putDoc(familyId, "nudge", {
    id,
    toMemberId: to.id,
    kind: input.kind,
    text: input.text.slice(0, 120),
    href: input.href,
    at: now.toISOString(),
    deliverAfter: next8amLocal(to.tz, now),
    deliveredAt: null,
    channel: null,
    seenAt: null,
  });
}

/**
 * What a route calls (awaited: a Worker may stop unawaited work once the
 * response is sent). A failed nudge is logged and never breaks the action
 * that caused it.
 */
export async function tryNudge(familyId: string, input: NudgeInput | NudgeInput[]): Promise<void> {
  for (const n of Array.isArray(input) ? input : [input]) {
    await enqueueNudge(familyId, n).catch((e: unknown) => console.error("[nudges] enqueue failed", String(e)));
  }
}

/** Waiting for this person, newest first (the "Waiting for you" tile reads this). */
export async function pendingFor(familyId: string, memberId: string): Promise<Nudge[]> {
  return (await listDocs(familyId, "nudge")).filter((n) => n.toMemberId === memberId && n.deliveredAt === null).sort((a, b) => b.at.localeCompare(a.at));
}

/** How long an unopened nudge keeps waiting once it is due: "the call is tomorrow" is stale in two days. */
export const WAIT_MS: Record<NudgeKind, number> = { heard: 7 * 86_400_000, blessed: 7 * 86_400_000, shared: 7 * 86_400_000, letter: 7 * 86_400_000, digest: 7 * 86_400_000, occasion: 2 * 86_400_000, call: 2 * 86_400_000, reminder: 7 * 86_400_000 };

/**
 * What is waiting for this person to open: due (their 8 AM has come), not yet
 * seen, and not older than its kind's wait. The dock dot and the glance tile
 * read this (through lib/waiting-server.ts); markSeen clears it.
 */
export async function unseenFor(familyId: string, memberId: string, now: Date = new Date()): Promise<Nudge[]> {
  const t = now.getTime();
  return (await listDocs(familyId, "nudge"))
    .filter((n) => n.toMemberId === memberId && n.seenAt === null && Date.parse(n.deliverAfter) <= t && t - Date.parse(n.deliverAfter) <= WAIT_MS[n.kind])
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** This person's list: still waiting, or delivered since Monday. */
export async function listFor(familyId: string, memberId: string, now: Date = new Date()): Promise<Nudge[]> {
  const week = weekStartOf(now);
  return (await listDocs(familyId, "nudge"))
    .filter((n) => n.toMemberId === memberId && (n.deliveredAt === null || weekStartOf(new Date(n.deliveredAt)) === week))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export interface NudgeBatch {
  memberId: string;
  nudges: Nudge[];
}

/** Everything due by `now` (8 AM has come where they are), grouped by recipient. Reads only. */
export async function drain(familyId: string, now: Date = new Date()): Promise<NudgeBatch[]> {
  const by = new Map<string, Nudge[]>();
  for (const n of await listDocs(familyId, "nudge")) {
    // A reminder is never emailed or pushed: it waits in For you on its day, for its owner only.
    if (n.kind === "reminder") continue;
    if (n.deliveredAt !== null || Date.parse(n.deliverAfter) > now.getTime()) continue;
    by.set(n.toMemberId, [...(by.get(n.toMemberId) ?? []), n]);
  }
  return Array.from(by, ([memberId, nudges]) => ({ memberId, nudges: nudges.sort((a, b) => a.at.localeCompare(b.at)) }));
}

export async function markDelivered(familyId: string, nudges: Nudge[], channel: "email" | "inapp", now: Date = new Date()): Promise<void> {
  for (const n of nudges) await putDoc(familyId, "nudge", { ...n, deliveredAt: now.toISOString(), channel });
}

export async function markSeen(familyId: string, memberId: string, ids: string[] | "all", now: Date = new Date()): Promise<number> {
  let done = 0;
  for (const n of await listDocs(familyId, "nudge")) {
    if (n.toMemberId !== memberId || n.seenAt !== null || (ids !== "all" && !ids.includes(n.id))) continue;
    await putDoc(familyId, "nudge", { ...n, seenAt: now.toISOString() });
    done++;
  }
  return done;
}

/**
 * The person opened the thing a nudge points at (played the card, answered):
 * its nudges are seen. `match` is tested against the stored link.
 */
export async function markSeenWhere(familyId: string, memberId: string, match: (href: string) => boolean, now: Date = new Date()): Promise<number> {
  let done = 0;
  for (const n of await listDocs(familyId, "nudge")) {
    if (n.toMemberId !== memberId || n.seenAt !== null || !match(n.href)) continue;
    await putDoc(familyId, "nudge", { ...n, seenAt: now.toISOString() });
    done++;
  }
  return done;
}

/** `{m:id}` becomes the word this family uses for that person. */
export function renderNudgeText(text: string, members: Pick<Member, "id" | "displayName" | "firstName">[]): string {
  return text.replace(/\{m:([^}]+)\}/g, (_, id: string) => callName(members.find((m) => m.id === id) as Member | undefined));
}

// ---------------------------------------------------------------- reminders
/** "Remind me to ask": tomorrow, in 3 days, or next week. */
export const REMIND_DAYS = [1, 3, 7] as const;

/** 8 AM on the person's own clock, `days` local days from today. */
export function reminderAt(tz: string, days: number, now: Date = new Date()): string {
  const target = new Date(now.getTime() + days * 86_400_000);
  const dayOf = (d: Date) => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };
  const want = dayOf(target);
  let at = next8amLocal(tz, now);
  for (let i = 0; i < 10 && dayOf(new Date(at)) < want; i++) at = next8amLocal(tz, new Date(Date.parse(at) + 60_000));
  return at;
}

/** The words of a reminder: "Ask {m:dada}: how did the interview go?" or "Ask {m:dada} about Diwali lunch". */
export function reminderText(aboutId: string, what: string, note: string): string {
  const n = note.trim();
  const w = what.trim();
  return (n ? `Ask {m:${aboutId}}: ${n}` : w ? `Ask {m:${aboutId}} about ${w}` : `Ask {m:${aboutId}} how it went`).slice(0, 120);
}

/** A person's own reminders (to themselves), soonest first. Nobody else's list ever includes them. */
export async function remindersOf(familyId: string, memberId: string): Promise<Nudge[]> {
  return (await listDocs(familyId, "nudge")).filter((n) => n.kind === "reminder" && n.toMemberId === memberId).sort((a, b) => a.deliverAfter.localeCompare(b.deliverAfter));
}
