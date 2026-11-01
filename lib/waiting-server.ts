// What is waiting for the viewer, loaded in one place for everything that
// shows it: the glance tile on the window and the dock dot (GET /api/waiting).
// The deciding is lib/glance.ts `waitingItems` (pure); this only loads.
// Server only.
import { dbListCards, dbListMembers, dbListPlays } from "./db";
import { withDemoShelf } from "./demo";
import { listDocs } from "./family-docs";
import { waitingItems, type WaitingItem } from "./glance";
import { renderNudgeText, unseenFor } from "./nudges";
import type { Member } from "./schemas";

type Cards = Awaited<ReturnType<typeof dbListCards>>;

export async function waitingNow(familyId: string, viewerId: string, now: Date, have: { members?: Member[]; cards?: Cards } = {}): Promise<WaitingItem[]> {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  const [members, cards, plays, questions, tasks, needs, nudges] = await Promise.all([
    have.members ? Promise.resolve(have.members) : dbListMembers(familyId),
    have.cards ? Promise.resolve(have.cards) : dbListCards(familyId),
    safe(dbListPlays(undefined, familyId), []),
    safe(listDocs(familyId, "question"), []),
    safe(listDocs(familyId, "today_task"), []),
    safe(listDocs(familyId, "need"), []),
    safe(unseenFor(familyId, viewerId, now), []),
  ]);
  const names = Object.fromEntries(members.map((m) => [m.id, m.displayName || m.firstName]));
  return waitingItems({
    viewerId,
    now,
    names,
    cards: withDemoShelf(cards, familyId),
    plays,
    questions,
    today: tasks.slice(0, 4),
    needs,
    nudges: nudges.map((n) => ({ id: n.id, kind: n.kind, text: renderNudgeText(n.text, members), href: n.href, at: n.at })),
  }).map((w) => {
    const { at, ...item } = w;
    void at;
    return item;
  });
}
