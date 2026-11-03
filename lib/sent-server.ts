// Loads what "Sent" needs, family-scoped and bounded to the last 30 days; lib/sent.ts decides.
// Reads only. Server only.
import { dbListCards, dbListMembers, dbListPlays } from "./db";
import { withDemoShelf } from "./demo";
import { listDocs } from "./family-docs";
import { buildSent, SENT_DAYS, type SentItem } from "./sent";
import { seenBy } from "./card-privacy";

export async function sentFor(familyId: string, viewerId: string, now: Date): Promise<SentItem[]> {
  const since = new Date(now.getTime() - SENT_DAYS * 86_400_000).toISOString();
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  const [members, stored, plays, letters] = await Promise.all([
    dbListMembers(familyId),
    dbListCards(familyId, { since, limit: 400 }),
    safe(dbListPlays(undefined, familyId, since), []),
    safe(listDocs(familyId, "chitthi"), []),
  ]);
  return buildSent({
    viewerId,
    now,
    members,
    cards: seenBy(withDemoShelf(stored, familyId), viewerId),
    plays,
    deliverAt: Object.fromEntries(letters.filter((l) => l.authorId === viewerId).map((l) => [l.id, l.deliverAt])),
  });
}
