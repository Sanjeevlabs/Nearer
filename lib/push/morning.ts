// The quiet-morning invitation (part of the 15-minute sweep). A parent's first lamp or moment each
// day is their "I'm okay". If it has not come by their usual time plus two hours, the far child gets
// ONE invitation: "Papa's been quiet this morning. Send a voice note?". Never an alarm, never at night
// (8:00 to 21:00 where the child is, else it waits for a later sweep), at most once a day per pair.
// Server only.
import { dbListMembers, dbListRelationships } from "../db";
import { claimDoc, listDocs } from "../family-docs";
import { households } from "../households";
import { callName } from "../people";
import { decentHour, localDay, morningCheck, RHYTHM_DAYS } from "../morning";
import { parentsOf } from "../roles";
import type { Member, Relationship } from "../schemas";
import { routePush } from "./events";
import type { SendDeps } from "./send";

/** Who hears that this parent is quiet: the one person they chose, else their children in other homes. */
export function whoHears(parent: Member, members: Member[], rels: Relationship[], chosen: string | null): string[] {
  const active = members.filter((m) => m.status !== "pending" && m.id !== parent.id);
  if (chosen) return active.some((m) => m.id === chosen) ? [chosen] : [];
  const homes = households(members, rels);
  const homeOf = (id: string) => homes.find((h) => h.members.some((m) => m.id === id))?.id;
  const mine = homeOf(parent.id);
  return active.filter((m) => m.role !== "child" && parentsOf(m.id, rels).includes(parent.id) && homeOf(m.id) !== mine).map((m) => m.id).slice(0, 4);
}

/** Returns how many invitations were sent. Idempotent: a repeat sweep the same day sends nothing. */
export async function sweepQuietMornings(familyId: string, now: Date = new Date(), deps: SendDeps = {}): Promise<number> {
  const [members, rels, presence, care, lamps] = await Promise.all([
    dbListMembers(familyId),
    dbListRelationships(familyId).catch(() => []),
    listDocs(familyId, "presence", { sinceMs: (RHYTHM_DAYS + 1) * 86_400_000 }),
    listDocs(familyId, "care_settings"),
    listDocs(familyId, "lamp"),
  ]);
  const homes = households(members, rels);
  let told = 0;
  for (const parent of members) {
    if (parent.role !== "elder" || parent.status === "pending") continue;
    const settings = care.find((c) => c.memberId === parent.id);
    const lamp = lamps.find((l) => l.id === homes.find((h) => h.members.some((m) => m.id === parent.id))?.id);
    const signals = lamp?.litBy === parent.id && lamp.litAt ? [lamp.litAt] : [];
    const check = morningCheck({ parentId: parent.id, tz: parent.tz, presence, signals, shareVisits: settings?.shareVisits !== false, now });
    if (check.verdict !== "quiet") continue;
    const chosen = settings?.quietAlert ? settings.tellMemberId : null;
    for (const toId of whoHears(parent, members, rels, chosen)) {
      const to = members.find((m) => m.id === toId);
      if (!to || !decentHour(to.tz, now)) continue;
      // Claimed before sending: a second sweep (or a second Worker) cannot tell them again today.
      const day = localDay(now, parent.tz);
      const fresh = await claimDoc(familyId, "sweep_mark", { id: `quiet-${parent.id}-${to.id}-${day}`, day, at: now.toISOString() });
      if (!fresh) continue;
      const sent = await routePush(familyId, to, "lamp", (w) => ({ body: w.quiet(callName(parent)), url: "/", tag: `quiet-${parent.id}`, urgency: "normal" }), now, deps, { dropIfHeld: true });
      if (sent === "sent") told++;
    }
  }
  return told;
}
