// What happens when the last person who joined a habit has done it for the day:
// the family's lamps glow (the same lamp the window lights, so a habit is
// another real sign of contact, not a new indicator) and each of the others is
// told once, in words ("Everyone walked together"), under the usual nudge
// limits. Both are best effort: a failure is logged and never undoes the tick.
// Server only.
import { dbListMembers, dbListRelationships } from "./db";
import { getDoc, putDoc } from "./family-docs";
import { households } from "./households";
import type { Habit } from "./kinds";
import { tryNudge } from "./nudges";
import { doneVerb } from "./habits";

/** Light the lamp of every home that has someone in the habit. */
export async function lightHabitLamps(familyId: string, memberIds: string[], litBy: string, now: Date = new Date()): Promise<void> {
  const [members, relationships] = await Promise.all([dbListMembers(familyId), dbListRelationships(familyId)]);
  const at = now.toISOString();
  for (const home of households(members, relationships)) {
    if (!home.members.some((m) => memberIds.includes(m.id))) continue;
    const lamp = (await getDoc(familyId, "lamp", home.id)) ?? { id: home.id, litAt: null, litBy: null, beats: [], felt: {}, updatedAt: at };
    await putDoc(familyId, "lamp", { ...lamp, litAt: at, litBy, updatedAt: at });
  }
}

/** Everyone who joined has done it today: light the lamps and tell the others, once. */
export async function habitCompleted(familyId: string, habit: Pick<Habit, "name">, memberIds: string[], lastBy: string, now: Date = new Date()): Promise<void> {
  try {
    await lightHabitLamps(familyId, memberIds, lastBy, now);
  } catch (e) {
    console.error("[habits] lamp", String(e));
  }
  try {
    const text = doneVerb(habit.name) === "walked" ? "Everyone walked together" : "Everyone did it together";
    // One per person per week (the nudge id carries the week, kind and link); the one who finished it knows already.
    await tryNudge(
      familyId,
      memberIds.map((toMemberId) => ({ toMemberId, actorId: lastBy, kind: "shared" as const, text, href: "/home#habit" })),
    );
  } catch (e) {
    console.error("[habits] nudge", String(e));
  }
}
