// Muse picks today's task for both homes. Server only.
import { z } from "zod";
import { dbListMembers, dbListRelationships } from "./db";
import { getDoc, listDocs, putDoc } from "./family-docs";
import { households } from "./households";
import type { TodayTask } from "./kinds";
import { museJson } from "./muse";
import type { Member, Relationship } from "./schemas";
import { nextOccasionFor } from "./occasions-server";
import { PROMPT_IDS, TODAY_PROMPTS, dateIn, fallbackPrompt, fill, occasionPrompt } from "./today";

const call = (m: Member) => m.displayName || m.firstName;
const join = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`);

/** The parents' home and their children (not grandchildren, not in-laws' parents). */
export function sidesFor(members: Member[], relationships: Parameters<typeof households>[1]): { parents: Member[]; children: Member[] } | null {
  const home = households(members, relationships).find((h) => h.elders);
  if (!home) return null;
  const parents = home.members.filter((m) => m.role === "elder");
  const pIds = new Set(parents.map((p) => p.id));
  const kids = new Set(
    relationships
      .filter((r) => (r.canonicalKind === "parent" && pIds.has(r.relationMemberId)) || (r.canonicalKind === "child" && pIds.has(r.memberId)))
      .map((r) => (r.canonicalKind === "parent" ? r.memberId : r.relationMemberId)),
  );
  const children = members.filter((m) => kids.has(m.id) && m.role === "adult");
  return children.length ? { parents, children } : null;
}

/** What a caller that already has it can hand in, so ensureToday does not read it again. */
export interface TodayPreloaded {
  members?: Member[];
  relationships?: Relationship[];
  /** The family's today_task documents, newest first. */
  tasks?: TodayTask[];
  holidays?: Parameters<typeof nextOccasionFor>[4];
}

/** Today's task, created on first look of the day (in the parents' zone). */
export async function ensureToday(familyId: string, now = new Date(), pre: TodayPreloaded = {}): Promise<TodayTask | null> {
  const [members, relationships] = await Promise.all([pre.members ?? dbListMembers(familyId), pre.relationships ?? dbListRelationships(familyId)]);
  const sides = sidesFor(members, relationships);
  if (!sides) return null;
  const date = dateIn(sides.parents[0].tz, now);
  const id = `today-${date}`;
  const existing = pre.tasks ? pre.tasks.find((t) => t.id === id) : await getDoc(familyId, "today_task", id);
  if (existing) return existing;
  const recent = (pre.tasks ?? (await listDocs(familyId, "today_task"))).slice(0, 7).map((t) => t.promptId);
  const fb = fallbackPrompt(date, recent);
  const childName = join(sides.children.map(call));
  const parentsName = join(sides.parents.map(call));
  // An occasion inside a week, not yet asked about: both homes gather for it.
  const occ = await nextOccasionFor(familyId, members, now, 7, pre.holidays);
  if (occ && !recent.includes("occasion")) {
    const p = occasionPrompt(occ.title);
    return putDoc(familyId, "today_task", {
      id,
      date,
      promptId: p.id,
      forParents: fill(p.parents, childName, parentsName),
      forChildren: fill(p.children, childName, parentsName),
      parents: sides.parents.map((m) => m.id),
      children: sides.children.map((m) => m.id),
      answers: [],
      completedAt: null,
      madeBy: "muse",
      createdAt: now.toISOString(),
    });
  }
  const picked = await museJson({
    familyId,
    purpose: `Chose today's task for ${parentsName} and ${childName}`,
    system:
      "You choose ONE prompt for a family's daily task from the given ids. Pick one not used recently, " +
      "and prefer one that fits the day. Reply with JSON {promptId}.",
    user: `Date: ${date}\nRecently used: ${recent.join(", ") || "none"}\nChoose from: ${PROMPT_IDS.join(", ")}`,
    schema: z.object({ promptId: z.enum(PROMPT_IDS) }),
    mock: () => ({ promptId: fb.id }),
    fallback: { promptId: fb.id },
    maxTokens: 60,
    accept: (d) => !recent.slice(0, 3).includes(d.promptId),
  });
  const prompt = TODAY_PROMPTS.find((p) => p.id === picked.data.promptId) ?? fb;
  return putDoc(familyId, "today_task", {
    id,
    date,
    promptId: prompt.id,
    forParents: fill(prompt.parents, childName, parentsName),
    forChildren: fill(prompt.children, childName, parentsName),
    parents: sides.parents.map((m) => m.id),
    children: sides.children.map((m) => m.id),
    answers: [],
    completedAt: null,
    madeBy: picked.source === "muse" ? "muse" : "family",
    createdAt: now.toISOString(),
  });
}
