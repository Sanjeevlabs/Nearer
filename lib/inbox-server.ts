// Loads what the inbox needs, family-scoped and bounded to the last 30 days,
// then lib/inbox.ts decides. Reads only; nothing here changes what the lamp,
// nudges or cards store. Server only.
import { dbListCards, dbListMembers, dbListPlays, dbListReactions, dbListRelationships, dbListWishes } from "./db";
import { withDemoShelf } from "./demo";
import { listDocs } from "./family-docs";
import { buildInbox, INBOX_DAYS, type InboxItem } from "./inbox";
import { households } from "./households";
import { guardianMap } from "./kids";
import { renderNudgeText } from "./nudges";
import { LISTEN_WORDS, withListen } from "./listen";
import { callName } from "./people";
import { hiddenCardIds, seenBy } from "./card-privacy";

export async function inboxFor(familyId: string, viewerId: string, now: Date): Promise<InboxItem[]> {
  const since = new Date(now.getTime() - INBOX_DAYS * 86_400_000).toISOString();
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  const [members, rels, stored, plays, reactions, wishes, questions, kidAsks, lamps, nudges, tasks, care, listen] = await Promise.all([
    dbListMembers(familyId),
    safe(dbListRelationships(familyId), []),
    dbListCards(familyId, { since, limit: 400 }),
    safe(dbListPlays(undefined, familyId), []),
    safe(dbListReactions(undefined, familyId), []),
    safe(dbListWishes(undefined, familyId), []),
    safe(listDocs(familyId, "question"), []),
    safe(listDocs(familyId, "kid_ask"), []),
    safe(listDocs(familyId, "lamp"), []),
    safe(listDocs(familyId, "nudge"), []),
    safe(listDocs(familyId, "today_task", { sinceMs: 3 * 86_400_000 }), []),
    safe(listDocs(familyId, "care_settings"), []),
    safe(listDocs(familyId, "card_listen"), []),
  ]);
  // A note for particular people, and who heard or reacted to it, reaches only them and its author.
  const unseen = hiddenCardIds(stored, viewerId);
  const home = households(members, rels).find((h) => h.members.some((m) => m.id === viewerId));
  // Lamp heartbeats stay in the lamp doc after they are felt, so they are history too.
  const lamp = lamps.find((l) => l.id === home?.id);
  // Someone who turned off "Show my lamp and activity" lights nothing for anyone else.
  const hidden = new Set(care.filter((c) => c.shareVisits === false && c.memberId !== viewerId).map((c) => c.memberId));
  const lights = lamps.filter((l) => l.id !== home?.id && l.litAt && l.litBy && !hidden.has(l.litBy)).map((l) => ({ from: l.litBy as string, at: l.litAt as string }));
  return buildInbox({
    viewerId,
    now,
    names: Object.fromEntries(members.map((m) => [m.id, callName(m)])),
    // "How to listen" in words, only where the viewer is an addressee (lib/listen.ts).
    cards: withListen(seenBy(withDemoShelf(stored, familyId), viewerId), listen, viewerId).map((c) => (c.listen ? { ...c, listen: LISTEN_WORDS[c.listen] } : { ...c, listen: undefined })),
    plays: unseen.size ? plays.filter((p) => !unseen.has(p.cardId)) : plays,
    reactions: unseen.size ? reactions.filter((r) => !unseen.has(r.cardId)) : reactions,
    wishes: unseen.size ? wishes.filter((w) => !w.cardId || !unseen.has(w.cardId)) : wishes,
    questions,
    kidAsks,
    guardians: guardianMap(members, rels),
    beats: lamp?.beats ?? [],
    felt: lamp?.felt[viewerId] ?? null,
    lights,
    tz: members.find((m) => m.id === viewerId)?.tz,
    nudges: nudges.filter((n) => n.toMemberId === viewerId).map((n) => ({ id: n.id, kind: n.kind, text: renderNudgeText(n.text, members), href: n.href, at: n.at, seen: n.seenAt !== null, from: /\{m:([^}]+)\}/.exec(n.text)?.[1] ?? null, deliverAfter: n.deliverAfter })),
    today: tasks.slice(0, 4),
  });
}
