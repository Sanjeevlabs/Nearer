// "For you": everything sent to the viewer in the last 30 days, newest first.
// Pure and client-safe: lib/inbox-server.ts loads (family-scoped, bounded), this
// decides. Words, never counts. "Waiting for you" = not yet played or answered;
// everything else is "Earlier". Only things that need MY action wait: an unplayed voice
// note to me, a question or kid ask to me, a Today answer waiting for mine. Receipts
// (heard, blessed, shared), lamps, reminders and occasions are Earlier, as plain lines.
import { clockInZone } from "./time-format";
import { z } from "zod";
import { addressees } from "./households";
import { askLine, openAsksFor } from "./kids";
import type { KidAsk, Question, TodayTask } from "./kinds";
import type { Card, Play, Reaction, Wish } from "./schemas";

export const INBOX_DAYS = 30;
export const INBOX_MAX = 60;

export const InboxItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["voice", "question", "kid", "reaction", "lamp", "wish", "nudge", "today"]),
  /** The small mark on the sender's avatar: what kind of thing this is. */
  badge: z.enum(["voice", "question", "blessing", "lamp", "occasion", "heart", "today"]).default("voice"),
  at: z.string(),
  text: z.string(),
  fromId: z.string().nullable(),
  cardId: z.string().nullable(),
  href: z.string(),
  /** Waiting for the viewer to play or answer. */
  waiting: z.boolean(),
  /** Play (a voice note, inline), Answer, or Open. */
  action: z.enum(["play", "answer", "open"]),
  /** A voice note the viewer has already played. */
  heard: z.boolean().default(false),
  /** Receipts, lamps, reminders and occasions: one plain line, no big button. */
  plain: z.boolean().default(false),
  /** Who "Reply by voice" is addressed to; null = no reply button. */
  replyTo: z.string().nullable(),
  nudgeId: z.string().nullable().default(null),
  /** "How to listen", in words ("just listen"): only on a note sent to the viewer. */
  listen: z.string().nullable().default(null),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;
export const InboxResponseSchema = z.object({ items: z.array(InboxItemSchema) });

const THING: Record<string, string> = { audio: "voice memory", photo: "photo", video: "video" };
const ASK: Record<string, string> = { story: "for a story", recipe: "for a recipe", wisdom: "for advice", blessing: "for a blessing", song: "for a song", place: "about a place" };
const ASK_HREF: Record<string, string> = { story: "/stories", recipe: "/kitchen", wisdom: "/advice", blessing: "/advice", song: "/", place: "/" };
const REACTION_WORD: Record<Reaction["kind"], string> = { love: "love", bless: "blessing", laugh: "smile" };

export interface InboxInput {
  viewerId: string;
  now: Date;
  names: Record<string, string>;
  cards: (Pick<Card, "id" | "type" | "authorId" | "addressedTo" | "takenAt"> & { listen?: string })[];
  plays: Pick<Play, "cardId" | "memberId">[];
  reactions: Pick<Reaction, "id" | "cardId" | "memberId" | "kind" | "createdAt">[];
  wishes: Pick<Wish, "id" | "cardId" | "memberId" | "kind" | "createdAt">[];
  questions: Pick<Question, "id" | "toMemberId" | "askedBy" | "topic" | "answeredCardId" | "createdAt">[];
  kidAsks: Pick<KidAsk, "id" | "fromMemberId" | "toMemberId" | "answeredCardId" | "askedAt" | "topic" | "cardId">[];
  guardians: Record<string, string[]>;
  /** Heartbeats sent to the viewer's home, and when the viewer last felt one. */
  beats: { from: string; at: string }[];
  felt: string | null;
  /** The lamp last lit in each other home: who, and when. A light is not a heartbeat; both can be here. */
  lights?: { from: string; at: string }[];
  /** The viewer's zone, for "8:10 PM" in a lamp line. */
  tz?: string;
  nudges: { id: string; kind: string; text: string; href: string; at: string; seen: boolean; from?: string | null; deliverAfter?: string }[];
  today?: Pick<TodayTask, "id" | "date" | "parents" | "children" | "answers" | "completedAt">[];
}

/** "8:10 PM" in the viewer's zone ("" when there is no zone to say it in). */
function clockIn(iso: string, tz: string | undefined): string {
  if (!tz) return "";
  try {
    return clockInZone(tz).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Nudges that are a person's receipt (someone heard, blessed or shared); the rest are reminders. */
const NUDGE_PERSON = new Set(["heard", "blessed", "shared"]);

export function buildInbox(i: InboxInput): InboxItem[] {
  const nowMs = i.now.getTime();
  const name = (id: string | null | undefined): string => (id && i.names[id]) || "Someone";
  const recent = (iso: string): boolean => {
    const t = Date.parse(iso);
    return t <= nowMs + 60_000 && nowMs - t <= INBOX_DAYS * 86_400_000;
  };
  const out: InboxItem[] = [];
  const base = { fromId: null, cardId: null, heard: false, replyTo: null, nudgeId: null, plain: false, listen: null } as const;

  const played = new Set(i.plays.filter((p) => p.memberId === i.viewerId).map((p) => p.cardId));
  const mine = i.cards.filter((c) => c.authorId === i.viewerId);
  const myIds = new Set(mine.map((c) => c.id));
  const askVoices = new Set(i.kidAsks.map((a) => a.cardId).filter(Boolean));

  for (const c of i.cards) {
    if (!c.authorId || c.authorId === i.viewerId || askVoices.has(c.id) || !recent(c.takenAt) || !addressees(c).includes(i.viewerId)) continue;
    const heard = played.has(c.id);
    const replied = mine.some((r) => r.takenAt > c.takenAt && (addressees(r).length === 0 || addressees(r).includes(c.authorId as string)));
    const thing = THING[c.type] ?? "card";
    out.push({ ...base, id: `card-${c.id}`, kind: "voice", badge: "voice", listen: c.listen ? `${name(c.authorId)}: ${c.listen}` : null, at: c.takenAt, text: `${name(c.authorId)} sent you a ${thing}`, fromId: c.authorId, cardId: c.id, href: `/lane?card=${encodeURIComponent(c.id)}`, waiting: c.type === "audio" && !heard && !replied, action: c.type === "audio" ? "play" : "open", heard, replyTo: c.authorId });
  }
  for (const q of i.questions) {
    if (q.toMemberId !== i.viewerId || !recent(q.createdAt)) continue;
    out.push({ ...base, id: `q-${q.id}`, kind: "question", badge: "question", at: q.createdAt, text: q.askedBy ? `${name(q.askedBy)} asked you ${ASK[q.topic] ?? ""}`.trim() : "A question for you", fromId: q.askedBy, href: ASK_HREF[q.topic] ?? "/", waiting: !q.answeredCardId, action: "answer", replyTo: q.askedBy });
  }
  const open = new Set(openAsksFor(i.kidAsks, i.viewerId, i.guardians).map((a) => a.id));
  for (const a of i.kidAsks) {
    if (!recent(a.askedAt) || a.fromMemberId === i.viewerId) continue;
    if (!open.has(a.id) && a.toMemberId !== i.viewerId) continue;
    out.push({ ...base, id: `kid-${a.id}`, kind: "kid", badge: "question", at: a.askedAt, text: askLine(name(a.fromMemberId), a.topic), fromId: a.fromMemberId, cardId: a.cardId, href: a.cardId ? `/lane?card=${encodeURIComponent(a.cardId)}` : "/", waiting: open.has(a.id), action: "answer", replyTo: a.fromMemberId });
  }
  for (const r of i.reactions) {
    if (r.memberId === i.viewerId || !myIds.has(r.cardId) || !recent(r.createdAt)) continue;
    const card = mine.find((c) => c.id === r.cardId);
    out.push({ ...base, id: `react-${r.id}`, kind: "reaction", badge: r.kind === "bless" ? "blessing" : "heart", plain: true, at: r.createdAt, text: `${name(r.memberId)} sent a ${REACTION_WORD[r.kind]} on your ${THING[card?.type ?? ""] ?? "card"}`, fromId: r.memberId, cardId: r.cardId, href: `/lane?card=${encodeURIComponent(r.cardId)}`, waiting: false, action: "open", replyTo: r.memberId });
  }
  for (const w of i.wishes) {
    if (w.memberId === i.viewerId || !w.cardId || !myIds.has(w.cardId) || !recent(w.createdAt)) continue;
    out.push({ ...base, id: `wish-${w.id}`, kind: "wish", badge: w.kind === "blessing" ? "blessing" : "heart", plain: true, at: w.createdAt, text: `${name(w.memberId)} sent a ${w.kind === "blessing" ? "blessing" : "wish"} for you`, fromId: w.memberId, cardId: w.cardId, href: `/lane?card=${encodeURIComponent(w.cardId)}`, waiting: false, action: "open", replyTo: w.memberId });
  }
  for (const b of i.beats) {
    if (b.from === i.viewerId || !recent(b.at)) continue;
    out.push({ ...base, id: `beat-${b.from}-${b.at}`, kind: "lamp", badge: "lamp", plain: true, at: b.at, text: `${name(b.from)} is thinking of you`, fromId: b.from, href: "/", waiting: false, action: "open", replyTo: b.from });
  }
  const beatKeys = new Set(i.beats.map((b) => `${b.from}|${b.at}`));
  for (const l of i.lights ?? []) {
    if (l.from === i.viewerId || !recent(l.at) || beatKeys.has(`${l.from}|${l.at}`)) continue;
    const clock = clockIn(l.at, i.tz);
    out.push({ ...base, id: `light-${l.from}-${l.at}`, kind: "lamp", badge: "lamp", plain: true, at: l.at, text: `${name(l.from)} lit the lamp for you${clock ? ` · ${clock}` : ""}`, fromId: l.from, href: "/", waiting: false, action: "open", replyTo: l.from });
  }
  for (const n of i.nudges) {
    // A reminder you set yourself shows on its day, not before (and only ever to you).
    if (n.kind === "reminder") {
      if (!n.deliverAfter || Date.parse(n.deliverAfter) > nowMs || !recent(n.deliverAfter)) continue;
      out.push({ ...base, id: `nudge-${n.id}`, kind: "nudge", badge: "question", plain: true, at: n.deliverAfter, text: n.text, href: n.href, waiting: !n.seen, action: "open", nudgeId: n.id });
      continue;
    }
    if (!recent(n.at)) continue;
    const person = NUDGE_PERSON.has(n.kind) && n.from && n.from !== i.viewerId ? n.from : null;
    out.push({ ...base, id: `nudge-${n.id}`, kind: "nudge", badge: n.kind === "blessed" ? "blessing" : person ? "heart" : "occasion", plain: true, at: n.at, text: n.text, fromId: person, href: n.href, waiting: false, action: "open", replyTo: person, nudgeId: n.id });
  }
  // A Today answer is sealed until mine: the other side has answered, I have not.
  const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
  for (const t of i.today ?? []) {
    if (t.completedAt || t.date < yesterday) continue;
    const side = t.parents.includes(i.viewerId) ? "parents" : t.children.includes(i.viewerId) ? "children" : null;
    if (!side || t.answers.some((a) => a.memberId === i.viewerId)) continue;
    const others = side === "parents" ? t.children : t.parents;
    const theirs = t.answers.filter((a) => others.includes(a.memberId) && recent(a.at)).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!theirs) continue;
    out.push({ ...base, id: `today-${t.id}`, kind: "today", badge: "today", at: theirs.at, text: `${name(theirs.memberId)} answered today's question`, fromId: theirs.memberId, href: "/", waiting: true, action: "answer", replyTo: theirs.memberId });
  }
  // Waiting first (newest first within), then Earlier; the cap never drops a waiting item for an old one.
  return out.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.at.localeCompare(a.at)).slice(0, INBOX_MAX);
}
