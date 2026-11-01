// "Since you were here": a few plain sentences about what happened after the
// viewer's previous visit. Words, never counts. Pure: callers pass what they
// already loaded.
import { answeredAt } from "./safety";
import type { Card, Play, Reaction } from "./schemas";

export interface SinceInput {
  viewerId: string;
  /** The viewer's previous visit (ISO). */
  at: string;
  now: Date;
  /** First name or call name, by member id. */
  names: Record<string, string>;
  /** Members of the far home. */
  farIds: string[];
  cards: Pick<Card, "id" | "type" | "authorId" | "takenAt">[];
  plays: Pick<Play, "cardId" | "memberId" | "playedAt">[];
  reactions: Pick<Reaction, "cardId" | "memberId" | "kind" | "createdAt">[];
  checkins: { memberId: string; kind: string; at: string; closedAt: string | null; noReply?: boolean }[];
  limit?: number;
}

const THING: Record<string, string> = { audio: "voice note", photo: "photo", video: "video" };
const SENT: Record<string, string> = { audio: "sent a voice note", photo: "shared a photo", video: "shared a video" };

export function sinceLines(i: SinceInput): string[] {
  const from = Date.parse(i.at);
  const to = i.now.getTime();
  if (!Number.isFinite(from)) return [];
  const after = (iso: string): boolean => {
    const t = Date.parse(iso);
    return t > from && t <= to + 60_000;
  };
  const name = (id: string): string | null => i.names[id] ?? null;
  const mine = new Map(i.cards.filter((c) => c.authorId === i.viewerId).map((c) => [c.id, c]));
  const out: { at: string; text: string; key: string }[] = [];

  for (const p of i.plays) {
    const c = mine.get(p.cardId);
    const who = name(p.memberId);
    if (!c || !who || p.memberId === i.viewerId || !after(p.playedAt)) continue;
    out.push({ at: p.playedAt, key: `play:${p.memberId}:${p.cardId}`, text: `${who} ${c.type === "audio" ? "heard" : "saw"} your ${THING[c.type] ?? "card"}` });
  }
  for (const r of i.reactions) {
    const c = mine.get(r.cardId);
    const who = name(r.memberId);
    if (!c || !who || r.memberId === i.viewerId || !after(r.createdAt)) continue;
    const verb = r.kind === "bless" ? "blessed" : r.kind === "laugh" ? "smiled at" : "loved";
    out.push({ at: r.createdAt, key: `react:${r.memberId}:${r.cardId}`, text: `${who} ${verb} your ${THING[c.type] ?? "card"}` });
  }
  const far = new Set(i.farIds);
  for (const c of i.cards) {
    const who = c.authorId ? name(c.authorId) : null;
    if (!c.authorId || !who || !far.has(c.authorId) || !after(c.takenAt)) continue;
    out.push({ at: c.takenAt, key: `card:${c.id}`, text: `${who} ${SENT[c.type] ?? "shared something"}` });
  }
  for (const k of i.checkins) {
    const who = name(k.memberId);
    const when = answeredAt(k) ?? k.at;
    if (!who || !far.has(k.memberId) || !after(when)) continue;
    if (k.kind === "home-safe") out.push({ at: when, key: `safe:${k.memberId}:${when}`, text: `${who} checked in: home safe` });
    else if (answeredAt(k)) out.push({ at: when, key: `safe:${k.memberId}:${when}`, text: `${who} checked in: all well` });
  }

  const seen = new Set<string>();
  return out
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((l) => (seen.has(l.key) ? false : (seen.add(l.key), true)))
    .slice(0, i.limit ?? 3)
    .map((l) => l.text);
}

/** "Since this morning", "Since yesterday", "Since Tuesday", "Since last week". */
export function sinceLabel(at: string, now: Date, tz: string): string {
  const day = (d: Date): string => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };
  const t = new Date(at);
  const days = Math.round((Date.parse(day(now)) - Date.parse(day(t))) / 86_400_000);
  if (days <= 0) {
    let hour = t.getUTCHours();
    try {
      hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(t));
    } catch {
      /* keep UTC */
    }
    return hour < 12 ? "Since this morning" : hour < 17 ? "Since this afternoon" : "Since this evening";
  }
  if (days === 1) return "Since yesterday";
  if (days < 7) {
    try {
      return `Since ${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(t)}`;
    } catch {
      return "Since a few days ago";
    }
  }
  return "Since last week";
}
