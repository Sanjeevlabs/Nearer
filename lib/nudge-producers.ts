// What causes a nudge, one call per route. Each is awaited and never throws,
// so the action it follows is never broken. The person who acted is never
// told about their own action. Server only.
import { dbListRelationships } from "./db";
import { getDoc } from "./family-docs";
import type { Card } from "./schemas";
import { tryNudge } from "./nudges";

const what = (c: Pick<Card, "type">) => (c.type === "audio" ? "voice memory" : c.type === "video" ? "video" : "photo");

/** Someone listened to the card: its author hears "Maa heard your voice note". */
export async function nudgeHeard(familyId: string, card: Pick<Card, "id" | "type" | "authorId">, actorId: string): Promise<void> {
  try {
    if (!card.authorId || card.authorId === actorId) return;
    // A parent who keeps their activity private is not reported on, even kindly.
    if ((await getDoc(familyId, "care_settings", actorId))?.shareVisits === false) return;
    await tryNudge(familyId, { toMemberId: card.authorId, actorId, kind: "heard", text: `{m:${actorId}} heard your ${what(card)}`, href: `/home?card=${encodeURIComponent(card.id)}` });
  } catch (e) {
    console.error("[nudges] heard", String(e));
  }
}

/** A blessing or love on the card. Laughs stay between the eyes that saw them. */
export async function nudgeReacted(familyId: string, card: Pick<Card, "id" | "type" | "authorId">, actorId: string, reaction: "love" | "laugh" | "bless"): Promise<void> {
  try {
    if (reaction === "laugh" || !card.authorId || card.authorId === actorId) return;
    const verb = reaction === "bless" ? "blessed" : "sent love to";
    await tryNudge(familyId, { toMemberId: card.authorId, actorId, kind: "blessed", text: `{m:${actorId}} ${verb} your ${what(card)}`, href: `/home?card=${encodeURIComponent(card.id)}` });
  } catch (e) {
    console.error("[nudges] reacted", String(e));
  }
}

/** A parent shared a recipe, story or advice: their children hear of it. */
export async function nudgeShared(familyId: string, authorId: string, noun: "recipe" | "story" | "piece of advice", href: string): Promise<void> {
  try {
    const rels = await dbListRelationships(familyId);
    const children = new Set<string>();
    for (const r of rels) {
      if (r.memberId === authorId && r.canonicalKind === "child") children.add(r.relationMemberId);
      if (r.relationMemberId === authorId && r.canonicalKind === "parent") children.add(r.memberId);
    }
    await tryNudge(familyId, Array.from(children, (toMemberId) => ({ toMemberId, actorId: authorId, kind: "shared" as const, text: `{m:${authorId}} shared a ${noun}`, href })));
  } catch (e) {
    console.error("[nudges] shared", String(e));
  }
}
