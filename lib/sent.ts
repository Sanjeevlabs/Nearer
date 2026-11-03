// "Sent": what the viewer sent to particular people in the last 30 days, with a plain status line
// per note ("Waiting for Maa to join", "Delivered", "Heard by Maa"). Pure and client-safe;
// lib/sent-server.ts loads. A note addressed to someone who has not joined stays addressed to
// their place (member id); when they claim it the same row is reused, so it is theirs to hear.
import { z } from "zod";
import { addressees } from "./households";
import { isClaimable } from "./permissions";
import { callName } from "./people";
import type { Card, Member, Play } from "./schemas";

export const SENT_DAYS = 30;
export const SENT_MAX = 60;

export const SentItemSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  type: z.enum(["audio", "photo", "video"]),
  at: z.string(),
  /** Who it was sent to, by name. */
  to: z.array(z.string()),
  toIds: z.array(z.string()),
  /** Waiting (someone has not joined) comes before scheduled, delivered and heard. */
  status: z.enum(["waiting", "scheduled", "delivered", "heard"]),
  /** The plain line shown under the note. */
  line: z.string(),
  /** A short transcript or caption, if any. */
  text: z.string(),
  href: z.string(),
});
export type SentItem = z.infer<typeof SentItemSchema>;
export const SentResponseSchema = z.object({ items: z.array(SentItemSchema) });

export interface SentInput {
  viewerId: string;
  now: Date;
  members: Member[];
  cards: Pick<Card, "id" | "type" | "authorId" | "addressedTo" | "takenAt" | "caption" | "transcript">[];
  plays: Pick<Play, "cardId" | "memberId">[];
  /** Morning letters: card id -> the time it opens for the people it is for. */
  deliverAt?: Record<string, string>;
  /** Members known to have done something in Nearer (the cards and plays given also count). */
  activeIds?: Iterable<string>;
}

/**
 * A place nobody has claimed yet (no account, no activity), or one still waiting to be let in:
 * a note to it waits. The demo family has no emails, so activity counts as having joined.
 */
export function notJoined(m: Member, active: ReadonlySet<string>): "unclaimed" | "pending" | null {
  if (m.status === "pending") return "pending";
  return isClaimable(m) && !active.has(m.id) ? "unclaimed" : null;
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function buildSent(i: SentInput): SentItem[] {
  const nowMs = i.now.getTime();
  const active = new Set<string>([...(i.activeIds ?? []), ...i.cards.flatMap((c) => (c.authorId ? [c.authorId] : [])), ...i.plays.map((p) => p.memberId)]);
  const byId = new Map(i.members.map((m) => [m.id, m]));
  const played = new Set(i.plays.map((p) => `${p.cardId}|${p.memberId}`));
  const out: SentItem[] = [];
  for (const c of i.cards) {
    if (c.authorId !== i.viewerId) continue;
    const t = Date.parse(c.takenAt);
    if (!(t <= nowMs + 60_000 && nowMs - t <= SENT_DAYS * 86_400_000)) continue;
    const toIds = addressees(c).filter((id) => id !== i.viewerId);
    if (toIds.length === 0) continue;
    const heard: string[] = [];
    const delivered: string[] = [];
    const waiting: string[] = [];
    const letting: string[] = [];
    for (const id of toIds) {
      const m = byId.get(id);
      const name = m ? callName(m) : "Someone";
      const why = m ? notJoined(m, active) : null;
      if (why === "unclaimed") waiting.push(name);
      else if (why === "pending") letting.push(name);
      else if (c.type === "audio" && played.has(`${c.id}|${id}`)) heard.push(name);
      else delivered.push(name);
    }
    const opens = i.deliverAt?.[c.id];
    const scheduled = Boolean(opens && Date.parse(opens) > nowMs);
    const parts: string[] = [];
    if (heard.length) parts.push(`Heard by ${nameList(heard)}`);
    if (scheduled && delivered.length) parts.push(`Arrives in the morning for ${nameList(delivered)}`);
    else if (delivered.length) parts.push(`Delivered to ${nameList(delivered)}`);
    if (waiting.length) parts.push(`Waiting for ${nameList(waiting)} to join. They'll get it when they do`);
    if (letting.length) parts.push(`Waiting for ${nameList(letting)} to be let in`);
    const status: SentItem["status"] = waiting.length || letting.length ? "waiting" : scheduled && delivered.length ? "scheduled" : delivered.length ? "delivered" : "heard";
    out.push({
      id: `sent-${c.id}`,
      cardId: c.id,
      type: c.type as SentItem["type"],
      at: c.takenAt,
      to: toIds.map((id) => (byId.get(id) ? callName(byId.get(id)) : "Someone")),
      toIds,
      status,
      line: parts.join(" · "),
      text: (c.caption || c.transcript || "").slice(0, 160),
      href: `/lane?card=${encodeURIComponent(c.id)}`,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, SENT_MAX);
}
