// Loads what the three honest metrics need, family-scoped and bounded to the last 31 days
// (cards capped at 1500, presence at the 3000-row window), then lib/metrics.ts decides. Reads only.
// Server only.
import { dbListCards, dbListMembers, dbListPlays, dbListReactions, dbListWishes } from "./db";
import { listDocs } from "./family-docs";
import { familyMetrics, METRICS_LOOKBACK_DAYS, type FamilyMetrics } from "./metrics";

export async function metricsFor(familyId: string, tz: string, now: Date = new Date()): Promise<FamilyMetrics> {
  const sinceMs = METRICS_LOOKBACK_DAYS * 86_400_000;
  const since = new Date(now.getTime() - sinceMs).toISOString();
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  const [members, cards, reactions, wishes, plays, presence, lamps] = await Promise.all([
    dbListMembers(familyId),
    dbListCards(familyId, { since, limit: 1500 }),
    safe(dbListReactions(undefined, familyId, since), []),
    safe(dbListWishes(undefined, familyId, since), []),
    safe(dbListPlays(undefined, familyId, since), []),
    safe(listDocs(familyId, "presence", { sinceMs }), []),
    safe(listDocs(familyId, "lamp"), []),
  ]);
  const lights = lamps.flatMap((l) => (l.litAt && l.litBy ? [{ by: l.litBy, at: l.litAt }] : []));
  return familyMetrics({ now, tz, members, cards, reactions, wishes, plays, presence, lights });
}
