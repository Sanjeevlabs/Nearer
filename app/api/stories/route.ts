import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { cardsFor, docsFor } from "@/lib/request-data";
import { dbDeleteCard, dbGetMember, dbListCards, dbListMembers } from "@/lib/db";
import { deleteDoc, getDoc, newId, putDoc } from "@/lib/family-docs";
import { STORY_AGES, STORY_THEMES } from "@/lib/kinds";
import { canChange } from "@/lib/permissions";
import { labelStory } from "@/lib/stories";
import { ideaFor } from "@/lib/story-ideas";
import { guardWrites } from "@/lib/api-guard";
import { pushAsk } from "@/lib/push/events";
import { nudgeShared } from "@/lib/nudge-producers";
import { canSeeCard, hiddenCardIds } from "@/lib/card-privacy";

// Stories, the kids' corner.
// GET  → stories + open story requests
// POST → tell (a voice/video card becomes a story; Muse labels it) · edit ·
//        delete (optionally the voice too) · request (anyone, kids included,
//        asks a teller for a story; it waits on their courtyard) · withdraw.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tell"), cardId: z.string().min(1), title: z.string().trim().max(80).optional(), questionId: z.string().optional() }),
  z.object({ action: z.literal("edit"), storyId: z.string().min(1), title: z.string().trim().min(1).max(80), theme: z.enum(STORY_THEMES), ages: z.enum(STORY_AGES), summary: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("delete"), storyId: z.string().min(1), withVoice: z.boolean().default(false) }),
  z.object({ action: z.literal("request"), toMemberId: z.string().min(1), about: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("withdraw"), questionId: z.string().min(1) }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [all, questions, cards] = await Promise.all([docsFor(req, auth.familyId, "story"), docsFor(req, auth.familyId, "question"), cardsFor(req, auth.familyId)]);
  // A story told from a note for particular people stays theirs.
  const unseen = hiddenCardIds(cards, auth.memberId);
  const stories = unseen.size ? all.filter((s) => !unseen.has(s.cardId)) : all;
  // A known tale to retell in your own voice, quietly picked for the day.
  const idea = ideaFor(new Date().toISOString().slice(0, 10), stories.map((s) => s.title));
  return Response.json({ stories, requests: questions.filter((q) => q.topic === "story" && q.askedBy && !q.answeredCardId), idea });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/stories")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-story" }, { status: 400 });
  const body = parsed.data;
  const now = new Date().toISOString();
  const me = await dbGetMember(auth.memberId);

  if (body.action === "tell") {
    const card = (await dbListCards(auth.familyId)).find((c) => c.id === body.cardId);
    if (!card || (card.type !== "audio" && card.type !== "video") || !canSeeCard(card, auth.memberId)) return Response.json({ error: "unknown-voice-note" }, { status: 404 });
    const tellerId = card.authorId ?? auth.memberId;
    if (!canChange(me, tellerId, "edit")) return Response.json({ error: "not-yours" }, { status: 403 });
    const teller = (await dbListMembers(auth.familyId)).find((m) => m.id === tellerId);
    const lang = card.transcriptLang || card.lang;
    const { label, source } = await labelStory({ familyId: auth.familyId, transcript: card.transcript || card.caption, lang, tellerName: teller?.displayName ?? "the teller", title: body.title });
    const story = await putDoc(auth.familyId, "story", { id: newId("story"), tellerId, cardId: card.id, ...label, lang, questionId: body.questionId ?? null, madeBy: source === "muse" ? "muse" : "family", createdAt: now });
    if (body.questionId) {
      const q = await getDoc(auth.familyId, "question", body.questionId);
      if (q) await putDoc(auth.familyId, "question", { ...q, answeredCardId: card.id });
    }
    if (tellerId === auth.memberId) await nudgeShared(auth.familyId, tellerId, "story", "/stories");
    return Response.json({ story }, { status: 201 });
  }

  if (body.action === "edit" || body.action === "delete") {
    const story = await getDoc(auth.familyId, "story", body.storyId);
    if (!story) return Response.json({ error: "unknown-story" }, { status: 404 });
    if (!canChange(me, story.tellerId, body.action === "edit" ? "edit" : "delete")) return Response.json({ error: "not-yours" }, { status: 403 });
    if (body.action === "edit") {
      return Response.json({ story: await putDoc(auth.familyId, "story", { ...story, title: body.title, theme: body.theme, ages: body.ages, summary: body.summary, madeBy: "family" }) });
    }
    await deleteDoc(auth.familyId, "story", story.id);
    if (body.withVoice) await dbDeleteCard(story.cardId, auth.familyId);
    return Response.json({ deleted: story.id });
  }

  if (body.action === "withdraw") {
    const q = await getDoc(auth.familyId, "question", body.questionId);
    if (!q || q.topic !== "story") return Response.json({ error: "unknown-request" }, { status: 404 });
    if (!canChange(me, q.askedBy) && q.toMemberId !== auth.memberId) return Response.json({ error: "not-yours" }, { status: 403 });
    await deleteDoc(auth.familyId, "question", q.id);
    return Response.json({ deleted: q.id });
  }

  // request: "Dada, tell me a story about elephants" — kids can ask.
  const to = (await dbListMembers(auth.familyId)).find((m) => m.id === body.toMemberId);
  if (!to || to.id === auth.memberId) return Response.json({ error: "unknown-member" }, { status: 404 });
  const question = await putDoc(auth.familyId, "question", {
    id: newId("tellme"),
    toMemberId: to.id,
    text: `Tell me a story about ${body.about.replace(/^(a|an|the)\s+/i, (m) => m.toLowerCase())}`,
    lang: me?.lang ?? "en",
    askedBy: auth.memberId,
    topic: "story",
    answeredCardId: null,
    madeBy: "family",
    createdAt: now,
  });
  pushAsk(auth.familyId, { fromId: auth.memberId, toIds: [to.id], topic: "story", tagId: `ask-${question.id}` });
  return Response.json({ question }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
