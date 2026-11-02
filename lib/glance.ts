// The glance strip on the window: four 3-second answers about the whole
// family. Pure and client-safe (no fs, no db): the server loads, this decides.
// Words, never counts: no "3 unread", only names, times and dates.
import { addressees } from "./households";
import { askLine, openAsksFor, type KidsTile } from "./kids";
import type { KidAsk, Need, Question, TodayTask, WeeklyCall } from "./kinds";
import { cleanTitle, type CalOccasion } from "./occasion-calendar";
import type { Card, Member, Play } from "./schemas";
import { isAwake, placeFromTz } from "./zones";
import { dateIn } from "./today";

export type WaitingKind = "voice" | "question" | "today" | "care" | "nudge" | "kid";

/** One thing waiting for the viewer. `fromId` = who is waiting (a voice note, a question); `nudgeId` = the stored nudge to mark seen when it is opened. */
export interface WaitingItem {
  kind: WaitingKind;
  text: string;
  href: string;
  fromId?: string;
  nudgeId?: string;
}

export interface Glance {
  /** Everyone awake now (7 AM to 10 PM their time), grown-ups and teens, not you. */
  awake: { id: string; city: string }[];
  /** The one thing waiting for you; null hides the tile. */
  waiting: WaitingItem | null;
  /** The next kept occasion or planned event; null = nothing coming. `date` is its calendar day. */
  next: { text: string; href: string; date?: string } | null;
  /** New things the kids shared since your last visit ("From the kids"); null hides the tile. */
  kids?: KidsTile | null;
  /** The fixed weekly call, in both zones; `set` false = a nudge to set one. */
  call: { text: string; href: string; set: boolean };
}

/* ------------------------------------------------------------- awake now */
type Person = Pick<Member, "id" | "role" | "tz" | "city" | "status"> & { personId?: string | null };

/** Awake now: 7 AM to 10 PM local, active, not a child profile, not the viewer. One entry per real person. */
export function awakeNow(members: Person[], viewerId: string, now: Date, lastSeen: (id: string) => string | null = () => null): Glance["awake"] {
  const seen = new Set<string>();
  const out: Glance["awake"] = [];
  const me = members.find((m) => m.id === viewerId);
  if (me?.personId) seen.add(me.personId);
  for (const m of members) {
    if (m.id === viewerId || m.role === "child" || m.status === "pending") continue;
    if (m.personId) {
      if (seen.has(m.personId)) continue;
      seen.add(m.personId);
    }
    // Daytime where they are, or a sign of life in the last half hour (a late night counts).
    const last = lastSeen(m.id);
    const recent = last !== null && now.getTime() - Date.parse(last) < 30 * 60_000;
    if (!isAwake(m.tz, now) && !recent) continue;
    out.push({ id: m.id, city: m.city.trim() || placeFromTz(m.tz) });
  }
  return out;
}

/** "Bengaluru · Amritsar": the distinct cities, at most three. */
export function awakeCities(awake: Glance["awake"]): string {
  return Array.from(new Set(awake.map((a) => a.city).filter(Boolean)))
    .slice(0, 3)
    .join(" · ");
}

/* ------------------------------------------------------ waiting for you */
export interface WaitingInput {
  viewerId: string;
  now: Date;
  /** Call name by member id. */
  names: Record<string, string>;
  cards: Pick<Card, "id" | "type" | "authorId" | "addressedTo" | "takenAt">[];
  plays: Pick<Play, "cardId" | "memberId">[];
  questions: Pick<Question, "id" | "toMemberId" | "askedBy" | "topic" | "answeredCardId" | "createdAt">[];
  /** Today's task(s); only an unfinished one from today or yesterday counts. */
  today: Pick<TodayTask, "id" | "date" | "parents" | "children" | "answers" | "completedAt">[];
  needs: Pick<Need, "id" | "title" | "claimedBy" | "status" | "doneAt" | "createdAt">[];
  /** The viewer's own nudges with their words already resolved (lib/nudges.ts `unseenFor`). */
  nudges?: { id: string; kind: string; text: string; href: string; at: string }[];
  /** Children's asks, with each child's parents and grandparents (lib/kids.ts guardianMap). */
  kidAsks?: Pick<KidAsk, "id" | "fromMemberId" | "toMemberId" | "answeredCardId" | "askedAt" | "topic" | "cardId">[];
  guardians?: Record<string, string[]>;
}

const THING: Record<string, string> = { audio: "voice memory", photo: "photo", video: "video" };
/** What a question asks for, to follow "asked you". */
const ASK: Record<string, string> = { story: "for a story", recipe: "for a recipe", wisdom: "for advice", blessing: "for a blessing", song: "for a song", place: "about a place" };
const ASK_HREF: Record<string, string> = { story: "/stories", recipe: "/kitchen", wisdom: "/advice", blessing: "/advice", song: "/", place: "/" };
/** Tie-break when two things arrived at the same moment: people before chores. */
const RANK: Record<WaitingKind, number> = { voice: 0, question: 1, kid: 1, today: 2, care: 3, nudge: 4 };
const CARD_DAYS = 30;
const NEED_DAYS = 30;

/**
 * Everything addressed to or about the viewer that they haven't acted on,
 * newest first. THE one source for the dock dot, the glance tile and
 * GET /api/waiting; each entry clears itself when it is acted on:
 *  - a voice note, photo or video sent to you: until you play it or answer the
 *    sender (a card of yours to them, sent after theirs);
 *  - a question asked of you: until a card answers it;
 *  - a child's ask for you (or for any of their grandparents or parents): until someone answers it by voice;
 *  - a Today answer sealed until yours: until you answer (or it is done);
 *  - a care need you took on: until it is done;
 *  - a nudge for you: until you open it (seen), or it ages out.
 */
export function waitingItems(i: WaitingInput): (WaitingItem & { at: string })[] {
  const nowMs = i.now.getTime();
  const name = (id: string | null | undefined): string => (id && i.names[id]) || "Someone";
  const past = (iso: string): boolean => Date.parse(iso) <= nowMs + 60_000;
  const found: (WaitingItem & { at: string })[] = [];

  const played = new Set(i.plays.filter((p) => p.memberId === i.viewerId).map((p) => p.cardId));
  const mine = i.cards.filter((c) => c.authorId === i.viewerId);
  // A child's spoken question waits as "<name> asked you something", not also as a voice note.
  const askVoices = new Set((i.kidAsks ?? []).map((a) => a.cardId).filter(Boolean));
  for (const c of i.cards) {
    if (!c.authorId || c.authorId === i.viewerId || played.has(c.id) || !past(c.takenAt) || askVoices.has(c.id)) continue;
    if (!addressees(c).includes(i.viewerId) || nowMs - Date.parse(c.takenAt) > CARD_DAYS * 86_400_000) continue;
    // Answering the sender is acting on it: something of yours to them (or to everyone) since.
    const replied = mine.some((r) => r.takenAt > c.takenAt && past(r.takenAt) && (addressees(r).length === 0 || addressees(r).includes(c.authorId as string)));
    if (replied) continue;
    found.push({ at: c.takenAt, kind: "voice", text: `${name(c.authorId)}'s ${THING[c.type] ?? "card"}`, href: `/lane?card=${encodeURIComponent(c.id)}`, fromId: c.authorId });
  }
  for (const q of i.questions) {
    if (q.toMemberId !== i.viewerId || q.answeredCardId || !past(q.createdAt)) continue;
    const text = q.askedBy ? `${name(q.askedBy)} asked you ${ASK[q.topic] ?? ""}`.trim() : "A question for you";
    found.push({ at: q.createdAt, kind: "question", text, href: ASK_HREF[q.topic] ?? "/", ...(q.askedBy ? { fromId: q.askedBy } : {}) });
  }
  for (const a of openAsksFor(i.kidAsks ?? [], i.viewerId, i.guardians ?? {})) {
    if (!past(a.askedAt)) continue;
    found.push({ at: a.askedAt, kind: "kid", text: askLine(name(a.fromMemberId), a.topic), href: "/", fromId: a.fromMemberId });
  }
  const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
  for (const t of i.today) {
    if (t.completedAt || t.date < yesterday) continue;
    const side = t.parents.includes(i.viewerId) ? "parents" : t.children.includes(i.viewerId) ? "children" : null;
    if (!side || t.answers.some((a) => a.memberId === i.viewerId)) continue;
    const others = side === "parents" ? t.children : t.parents;
    const theirs = t.answers.filter((a) => others.includes(a.memberId) && past(a.at)).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (theirs) found.push({ at: theirs.at, kind: "today", text: `${name(theirs.memberId)} answered today's question`, href: "/", fromId: theirs.memberId });
  }
  for (const n of i.needs) {
    if (n.claimedBy !== i.viewerId || n.doneAt || (n.status !== "claimed" && n.status !== "progress")) continue;
    // A need nobody has closed in a month stops nagging from the tile (it stays on the care board).
    if (nowMs - Date.parse(n.createdAt) > NEED_DAYS * 86_400_000) continue;
    found.push({ at: n.createdAt, kind: "care", text: n.title, href: "/care" });
  }
  for (const n of i.nudges ?? []) found.push({ at: n.at, kind: "nudge", text: n.text, href: n.href, nudgeId: n.id });

  return found.sort((a, b) => b.at.localeCompare(a.at) || RANK[a.kind] - RANK[b.kind]);
}

/** The one thing to show on the glance tile (newest); null hides the tile. */
export function waitingForYou(i: WaitingInput): Glance["waiting"] {
  const top = waitingItems(i)[0];
  if (!top) return null;
  const { at, ...item } = top;
  void at;
  return item;
}

/* ------------------------------------------------------------------ next */
export interface NextEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  status: "voting" | "locked" | "cancelled";
  occasionKey: string | null;
  forMemberId: string | null;
  /** The locked time, when there is one. */
  startsAt: string | null;
}

const DAY = 86_400_000;
const iso2ms = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** "Sun 8 Nov" for a calendar day (no zone maths: the date is already a date). */
export function dayWords(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
}

/** "7 PM", "8:30 AM": whole hours drop the minutes. */
export function clockWords(tz: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at).replace(":00", "").replace(/\s/g, " ");
  } catch {
    return "";
  }
}

function weekdayIn(tz: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
  } catch {
    return "";
  }
}

/** "today", "tomorrow", "in 9 days" while it is close, else "Sun 8 Nov". */
function whenWords(days: number, iso: string, closeDays: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return days <= closeDays ? `in ${days} days` : dayWords(iso);
}

export interface NextInput {
  /** The viewer's calendar day. */
  today: string;
  now: Date;
  tz: string;
  events: NextEvent[];
  occasions: Pick<CalOccasion, "slug" | "kind" | "date" | "title" | "memberId">[];
  names: Record<string, string>;
  viewerId: string;
}

/**
 * The next kept occasion or planned event. Earliest day wins; on the same day
 * a planned event with a time beats one without, which beats a calendar entry.
 * An event already stands in for the occasion it was made from.
 */
export function nextUp(i: NextInput): Glance["next"] {
  type Cand = { date: string; rank: number; text: string };
  const cands: Cand[] = [];
  const live = i.events.filter((e) => e.status !== "cancelled" && e.date >= i.today);
  for (const e of live) {
    const timed = e.status === "locked" && e.startsAt && Date.parse(e.startsAt) >= i.now.getTime() - 3_600_000 ? new Date(e.startsAt) : null;
    const days = Math.round((iso2ms(e.date) - iso2ms(i.today)) / DAY);
    const when = timed ? `${dayWords(e.date)}, ${clockWords(i.tz, timed)}` : whenWords(days, e.date, 30);
    cands.push({ date: e.date, rank: timed ? 0 : 1, text: `${e.title} · ${when}` });
  }
  for (const o of i.occasions) {
    if (o.date < i.today) continue;
    if (live.some((e) => e.occasionKey === o.slug && e.date === o.date && (o.kind !== "birthday" || e.forMemberId === o.memberId))) continue;
    const days = Math.round((iso2ms(o.date) - iso2ms(i.today)) / DAY);
    if (o.kind === "birthday") {
      const who = o.memberId === i.viewerId ? "Your" : `${(o.memberId && i.names[o.memberId]) || "Someone"}'s`;
      cands.push({ date: o.date, rank: 2, text: `${who} birthday · ${whenWords(days, o.date, 30)}` });
    } else {
      cands.push({ date: o.date, rank: 2, text: `${cleanTitle(o.title)} · ${days <= 0 ? "today" : days === 1 ? "tomorrow" : dayWords(o.date)}` });
    }
  }
  cands.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank || a.text.localeCompare(b.text));
  return cands[0] ? { text: cands[0].text, href: "/gather", date: cands[0].date } : null;
}

/* ------------------------------------------------------------- our call */
function wallMs(tz: string, at: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(at);
  const g = (t: string): number => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
}

/** The instant a wall-clock time falls on in a zone (DST-safe by one correction). */
export function zonedInstant(y: number, m0: number, d: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(y, m0, d, hour, minute);
  let at = guess - (wallMs(tz, new Date(guess)) - guess);
  at = guess - (wallMs(tz, new Date(at)) - at);
  return new Date(at);
}

/** The next time the weekly call happens (strictly after `now`), as an instant; null on a bad zone. */
export function nextCallAt(call: Pick<WeeklyCall, "weekday" | "hour" | "minute" | "tz">, now: Date): Date | null {
  try {
    for (let d = 0; d <= 8; d++) {
      const day = new Date(now.getTime() + d * DAY);
      const w = wallMs(call.tz, day);
      const wall = new Date(w);
      if (wall.getUTCDay() !== call.weekday) continue;
      const at = zonedInstant(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), call.hour, call.minute, call.tz);
      if (at.getTime() > now.getTime()) return at;
    }
  } catch {
    /* bad zone */
  }
  return null;
}

/**
 * "Sun 7 PM yours · 8:30 AM theirs": the next call in both zones. A weekday
 * shows on the second half only when the two homes are on different days; one
 * shared clock collapses to "Sun 7 PM · yours and theirs".
 */
export function callBothZones(call: Pick<WeeklyCall, "weekday" | "hour" | "minute" | "tz">, myTz: string, theirTz: string, now: Date): string | null {
  const at = nextCallAt(call, now);
  if (!at) return null;
  const mine = `${weekdayIn(myTz, at)} ${clockWords(myTz, at)}`;
  const theirClock = clockWords(theirTz, at);
  if (!theirClock || clockWords(myTz, at) === theirClock && weekdayIn(myTz, at) === weekdayIn(theirTz, at)) return `${mine} · yours and theirs`;
  const theirDay = weekdayIn(theirTz, at);
  return `${mine} yours · ${theirDay !== weekdayIn(myTz, at) ? `${theirDay} ` : ""}${theirClock} theirs`;
}

/**
 * The window's one "Next" line: the weekly call (in both zones) or the next
 * occasion / planned visit, whichever comes first. Null when neither is set.
 */
export function nextLine(i: { call: Pick<WeeklyCall, "weekday" | "hour" | "minute" | "tz"> | undefined; myTz: string; theirTz: string | null; next: { text: string; href: string; date?: string } | null; now: Date; today: string }): { text: string; href: string } | null {
  const callAt = i.call ? nextCallAt(i.call, i.now) : null;
  const callText = i.call && callAt ? callBothZones(i.call, i.myTz, i.theirTz ?? i.call.tz, i.now) : null;
  const call = callText && callAt ? { text: `Weekly call · ${callText}`, href: "/gather", day: dateIn(i.myTz, callAt) } : null;
  const next = i.next ? { text: i.next.text, href: i.next.href, day: i.next.date ?? "9999-12-31" } : null;
  if (call && next) return next.day < call.day ? { text: next.text, href: next.href } : { text: call.text, href: call.href };
  return call ? { text: call.text, href: call.href } : next ? { text: next.text, href: next.href } : null;
}

export function callTile(call: Pick<WeeklyCall, "id" | "weekday" | "hour" | "minute" | "tz" | "hostId"> | undefined, myTz: string, theirTz: string | null, now: Date): Glance["call"] {
  const text = call ? callBothZones(call, myTz, theirTz ?? call.tz, now) : null;
  return text ? { text, href: "/gather", set: true } : { text: "Set a weekly call", href: "/gather", set: false };
}
