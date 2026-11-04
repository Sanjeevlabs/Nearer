// What is waiting for the viewer, loaded in one place for everything that
// shows it: the glance tile on the window and the dock dot (GET /api/waiting).
// The deciding is lib/glance.ts `waitingItems` (pure); this only loads.
// Server only.
import { dbListCards, dbListMembers, dbListPlays, dbListRelationships } from "./db";
import { withDemoShelf } from "./demo";
import { listDocsMany } from "./family-docs";
import { waitingItems, type WaitingItem } from "./glance";
import { guardianMap } from "./kids";
import { renderNudgeText, unseenFor } from "./nudges";
import type { Member } from "./schemas";
import { hiddenCardIds, seenBy } from "./card-privacy";

type Cards = Awaited<ReturnType<typeof dbListCards>>;

const KINDS = ["question", "today_task", "need", "kid_ask"] as const;

export async function waitingNow(familyId: string, viewerId: string, now: Date, have: { members?: Member[] | Promise<Member[]>; cards?: Cards } = {}): Promise<WaitingItem[]> {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  // The four document kinds in one query: six reads at once, inside a Worker's six open connections.
  const none = { question: [], today_task: [], need: [], kid_ask: [] };
  const [members, cards, plays, docs, nudges, rels] = await Promise.all([
    have.members ?? dbListMembers(familyId),
    have.cards ? Promise.resolve(have.cards) : dbListCards(familyId),
    safe(dbListPlays(undefined, familyId), []),
    safe(listDocsMany(familyId, KINDS), none),
    safe(unseenFor(familyId, viewerId, now), []),
    safe(dbListRelationships(familyId), []),
  ]);
  const { question: questions, today_task: tasks, need: needs, kid_ask: kidAsks } = docs;
  const unseen = hiddenCardIds(cards, viewerId);
  const names = Object.fromEntries(members.map((m) => [m.id, m.displayName || m.firstName]));
  return waitingItems({
    viewerId,
    now,
    names,
    cards: seenBy(withDemoShelf(cards, familyId), viewerId),
    plays: plays.filter((p) => !unseen.has(p.cardId)),
    questions,
    today: tasks.slice(0, 4),
    needs,
    kidAsks,
    guardians: guardianMap(members, rels),
    nudges: nudges.map((n) => ({ id: n.id, kind: n.kind, text: renderNudgeText(n.text, members), href: n.href, at: n.at })),
  }).map((w) => {
    const { at, ...item } = w;
    void at;
    return item;
  });
}
