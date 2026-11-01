import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { docsFor } from "@/lib/request-data";
import { dbAddAgentRun, dbGetMember, dbListCards, dbListMembers } from "@/lib/db";
import { deleteDoc, getDoc, newId, putDoc } from "@/lib/family-docs";
import { AdviceCategoryId, adviceCategory } from "@/lib/advice";
import { can } from "@/lib/permissions";
import { askWeeklyQuestions } from "@/lib/keeper";
import { guardWrites } from "@/lib/api-guard";
import { pushAsk } from "@/lib/push/events";

// Questions for elders: the weekly one Muse asks, and the ones family ask.
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("weekly") }),
  z.object({ action: z.literal("answer"), questionId: z.string().min(1), cardId: z.string().min(1) }),
  // Advice & blessings: an optional shelf (data/advice-categories.json), validated against the data.
  z.object({ action: z.literal("ask"), toMemberId: z.string().min(1), text: z.string().trim().min(6).max(200), topic: z.enum(["wisdom", "blessing", "story"]).default("wisdom"), category: AdviceCategoryId.optional() }),
  // The person who asked withdraws it; the elder may skip any question.
  z.object({ action: z.literal("remove"), questionId: z.string().min(1) }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  // Every advice/blessing question carries its shelf: stored if present, else the deterministic fallback.
  const questions = (await docsFor(req, auth.familyId, "question")).map((q) => {
    const stored = (q as { category?: string | null }).category;
    return q.topic === "wisdom" || q.topic === "blessing" ? { ...q, category: adviceCategory({ text: q.text, topic: q.topic, category: stored }) } : q;
  });
  return Response.json({ questions });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/keeper")) return Response.json({ error: "rate-limited" }, { status: 429 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid-keeper" }, { status: 400 });
  const body = parsed.data;

  if (body.action === "weekly") {
    const created = await askWeeklyQuestions(auth.familyId, await dbListMembers(auth.familyId));
    if (created.length) await dbAddAgentRun({ goal: `Story keeper: asked ${created.length} weekly question${created.length > 1 ? "s" : ""}`, tools: ["muse-spark", "ask_elder_question"], familyId: auth.familyId });
    return Response.json({ created });
  }

  if (body.action === "remove") {
    const q = await getDoc(auth.familyId, "question", body.questionId);
    if (!q) return Response.json({ error: "unknown-question" }, { status: 404 });
    const me = await dbGetMember(auth.memberId);
    const mayRemove = q.toMemberId === auth.memberId || q.askedBy === auth.memberId || can(me, "content.moderate");
    if (!mayRemove) return Response.json({ error: "not-yours" }, { status: 403 });
    await deleteDoc(auth.familyId, "question", q.id);
    return Response.json({ removed: q.id });
  }

  if (body.action === "answer") {
    const q = await getDoc(auth.familyId, "question", body.questionId);
    if (!q) return Response.json({ error: "unknown-question" }, { status: 404 });
    if (q.toMemberId !== auth.memberId) return Response.json({ error: "not-yours" }, { status: 403 });
    const card = (await dbListCards(auth.familyId)).find((c) => c.id === body.cardId);
    if (!card) return Response.json({ error: "unknown-card" }, { status: 404 });
    return Response.json({ question: await putDoc(auth.familyId, "question", { ...q, answeredCardId: card.id }) });
  }

  const to = (await dbListMembers(auth.familyId)).find((m) => m.id === body.toMemberId);
  if (!to) return Response.json({ error: "unknown-member" }, { status: 404 });
  if (to.id === auth.memberId) return Response.json({ error: "ask-someone-else" }, { status: 400 });
  const question = await putDoc(auth.familyId, "question", {
    id: newId("ask"),
    toMemberId: to.id,
    text: body.text,
    lang: "en",
    askedBy: auth.memberId,
    topic: body.topic,
    // Kept once QuestionSchema carries `category`; until then the shelf is re-derived on read.
    ...(body.topic === "story" ? {} : { category: adviceCategory({ text: body.text, topic: body.topic, category: body.category }) }),
    answeredCardId: null,
    madeBy: "family",
    createdAt: new Date().toISOString(),
  });
  pushAsk(auth.familyId, { fromId: auth.memberId, toIds: [to.id], topic: question.topic, tagId: `ask-${question.id}` });
  return Response.json({ question }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
