import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { dbGetMember, dbListCards, dbListMembers } from "@/lib/db";
import { deleteDoc, getDoc, listDocs, newId, putDoc } from "@/lib/family-docs";
import { COURSES, IngredientSchema, StepSchema } from "@/lib/kinds";
import { canChange } from "@/lib/permissions";
import { recipeFromVoice } from "@/lib/kitchen";
import { guardWrites } from "@/lib/api-guard";
import { pushAsk } from "@/lib/push/events";
import { nudgeShared } from "@/lib/nudge-producers";
import { seenBy } from "@/lib/card-privacy";

// The family Kitchen.
// GET  → every recipe and every attempt (who cooked what, and who blessed it).
// POST → teach (voice card → recipe via Muse), attempt ("I made this"),
//        bless (the cook, or anyone, blesses an attempt), ask (request a recipe
//        from an elder: becomes their weekly-question style prompt).

// Everything a typed recipe can carry (create and edit share it).
const Fields = {
  title: z.string().trim().min(1).max(80),
  memory: z.string().trim().max(240).default(""),
  serves: z.string().trim().max(40).default(""),
  course: z.enum(COURSES).default("main"),
  prepMins: z.number().int().min(0).max(1440).nullable().default(null),
  cookMins: z.number().int().min(0).max(1440).nullable().default(null),
  prepWork: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  outcome: z.string().trim().max(240).default(""),
  ingredients: z.array(IngredientSchema).min(1).max(40),
  steps: z.array(StepSchema).min(1).max(30),
  voiceCardId: z.string().nullable().optional(),
  videoCardId: z.string().nullable().optional(),
};

const Body = z.discriminatedUnion("action", [
  // Typed by hand: "my palak paneer", or writing down Maa's for her (cookId).
  // scanRef: the photo of the recipe card Muse read it from (kept on the recipe).
  z.object({ action: z.literal("create"), cookId: z.string().min(1).optional(), scanRef: z.string().min(1).max(512).nullable().optional(), ...Fields }),
  z.object({ action: z.literal("teach"), cardId: z.string().min(1), title: z.string().trim().max(80).optional(), questionId: z.string().optional() }),
  z.object({ action: z.literal("attempt"), recipeId: z.string().min(1), photoRef: z.string().max(512).nullable().optional(), note: z.string().trim().max(240).default("") }),
  z.object({ action: z.literal("bless"), attemptId: z.string().min(1) }),
  z.object({ action: z.literal("ask"), toMemberId: z.string().min(1), dish: z.string().trim().min(2).max(60) }),
  z.object({ action: z.literal("rename"), recipeId: z.string().min(1), title: z.string().trim().min(1).max(80), memory: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal("edit"), recipeId: z.string().min(1), ...Fields }),
  z.object({ action: z.literal("delete-recipe"), recipeId: z.string().min(1) }),
  z.object({ action: z.literal("delete-attempt"), attemptId: z.string().min(1) }),
  z.object({ action: z.literal("unbless"), attemptId: z.string().min(1) }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [recipes, attempts] = await Promise.all([listDocs(auth.familyId, "recipe"), listDocs(auth.familyId, "attempt")]);
  return Response.json({ recipes, attempts });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/kitchen")) return Response.json({ error: "rate-limited" }, { status: 429 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid-kitchen" }, { status: 400 });
  const body = parsed.data;
  const now = new Date().toISOString();

  if (body.action === "teach") {
    const card = seenBy(await dbListCards(auth.familyId), auth.memberId).find((c) => c.id === body.cardId);
    if (!card || card.type !== "audio") return Response.json({ error: "unknown-voice-note" }, { status: 404 });
    const cookId = card.authorId ?? auth.memberId;
    const cook = (await dbListMembers(auth.familyId)).find((m) => m.id === cookId);
    const transcript = card.transcript || card.caption;
    if (!transcript.trim()) return Response.json({ error: "nothing-said" }, { status: 422 });
    const { draft, source } = await recipeFromVoice({ familyId: auth.familyId, transcript, lang: card.transcriptLang || card.lang, cookName: cook?.displayName ?? "the cook", title: body.title });
    const recipe = await putDoc(auth.familyId, "recipe", {
      id: newId("recipe"),
      ...draft,
      cookId,
      voiceCardId: card.id,
      coverRef: null,
      lang: card.transcriptLang || card.lang,
      madeBy: source === "muse" ? "muse" : "family",
      createdAt: now,
    });
    if (body.questionId) {
      const q = await getDoc(auth.familyId, "question", body.questionId);
      if (q) await putDoc(auth.familyId, "question", { ...q, answeredCardId: card.id });
    }
    if (cookId === auth.memberId) await nudgeShared(auth.familyId, cookId, "recipe", `/kitchen/${recipe.id}`);
    return Response.json({ recipe }, { status: 201 });
  }

  if (body.action === "create") {
    const family = await dbListMembers(auth.familyId);
    const cookId = body.cookId ?? auth.memberId;
    if (!family.some((m) => m.id === cookId)) return Response.json({ error: "unknown-member" }, { status: 404 });
    const cards = body.voiceCardId || body.videoCardId ? seenBy(await dbListCards(auth.familyId), auth.memberId) : [];
    const own = (cardId: string | null | undefined, type: "audio" | "video") => !cardId || cards.some((c) => c.id === cardId && c.type === type);
    if (!own(body.voiceCardId, "audio") || !own(body.videoCardId, "video")) return Response.json({ error: "unknown-card" }, { status: 404 });
    const { action: _a, cookId: _c, scanRef: _s, ...fields } = body;
    void _a;
    void _c;
    void _s;
    const scanRef = body.scanRef && !/^(https?:)?\/\//i.test(body.scanRef) ? body.scanRef : null;
    const recipe = await putDoc(auth.familyId, "recipe", {
      id: newId("recipe"),
      ...fields,
      voiceCardId: body.voiceCardId ?? null,
      videoCardId: body.videoCardId ?? null,
      cookId,
      addedBy: cookId === auth.memberId ? null : auth.memberId,
      coverRef: scanRef,
      scanRef,
      lang: family.find((m) => m.id === auth.memberId)?.lang ?? "en",
      madeBy: scanRef ? "muse" : "family",
      createdAt: now,
    });
    if (cookId === auth.memberId) await nudgeShared(auth.familyId, cookId, "recipe", `/kitchen/${recipe.id}`);
    return Response.json({ recipe }, { status: 201 });
  }

  if (body.action === "attempt") {
    const recipe = await getDoc(auth.familyId, "recipe", body.recipeId);
    if (!recipe) return Response.json({ error: "unknown-recipe" }, { status: 404 });
    const attempt = await putDoc(auth.familyId, "attempt", { id: newId("cooked"), recipeId: recipe.id, memberId: auth.memberId, photoRef: body.photoRef ?? null, note: body.note, blessedBy: [], createdAt: now });
    return Response.json({ attempt }, { status: 201 });
  }

  if (body.action === "bless") {
    const attempt = await getDoc(auth.familyId, "attempt", body.attemptId);
    if (!attempt) return Response.json({ error: "unknown-attempt" }, { status: 404 });
    if (attempt.memberId === auth.memberId) return Response.json({ error: "own-attempt" }, { status: 409 });
    const blessedBy = attempt.blessedBy.includes(auth.memberId) ? attempt.blessedBy : [...attempt.blessedBy, auth.memberId];
    return Response.json({ attempt: await putDoc(auth.familyId, "attempt", { ...attempt, blessedBy }) });
  }

  const me = await dbGetMember(auth.memberId);
  if (body.action === "edit" || body.action === "delete-recipe") {
    const recipe = await getDoc(auth.familyId, "recipe", body.recipeId);
    if (!recipe) return Response.json({ error: "unknown-recipe" }, { status: 404 });
    // The cook owns their recipe (and whoever wrote it down for them); an admin may remove it.
    const mode = body.action === "edit" ? "edit" : "delete";
    if (!canChange(me, recipe.cookId, mode) && !(recipe.addedBy && canChange(me, recipe.addedBy, mode))) return Response.json({ error: "not-yours" }, { status: 403 });
    if (body.action === "delete-recipe") {
      await deleteDoc(auth.familyId, "recipe", recipe.id);
      for (const a of (await listDocs(auth.familyId, "attempt")).filter((x) => x.recipeId === recipe.id)) await deleteDoc(auth.familyId, "attempt", a.id);
      return Response.json({ deleted: recipe.id });
    }
    const { action: _a, recipeId: _r, ...fields } = body;
    void _a;
    void _r;
    return Response.json({ recipe: await putDoc(auth.familyId, "recipe", { ...recipe, ...fields, madeBy: "family" }) });
  }

  if (body.action === "delete-attempt" || body.action === "unbless") {
    const attempt = await getDoc(auth.familyId, "attempt", body.attemptId);
    if (!attempt) return Response.json({ error: "unknown-attempt" }, { status: 404 });
    if (body.action === "unbless") return Response.json({ attempt: await putDoc(auth.familyId, "attempt", { ...attempt, blessedBy: attempt.blessedBy.filter((x) => x !== auth.memberId) }) });
    if (!canChange(me, attempt.memberId)) return Response.json({ error: "not-yours" }, { status: 403 });
    await deleteDoc(auth.familyId, "attempt", attempt.id);
    return Response.json({ deleted: attempt.id });
  }

  if (body.action === "rename") {
    const recipe = await getDoc(auth.familyId, "recipe", body.recipeId);
    if (!recipe) return Response.json({ error: "unknown-recipe" }, { status: 404 });
    if (!canChange(me, recipe.cookId, "edit")) return Response.json({ error: "not-yours" }, { status: 403 });
    return Response.json({ recipe: await putDoc(auth.familyId, "recipe", { ...recipe, title: body.title, memory: body.memory ?? recipe.memory }) });
  }

  // ask: a grandchild asks an elder for a recipe; it waits on the elder's home.
  const to = (await dbListMembers(auth.familyId)).find((m) => m.id === body.toMemberId);
  if (!to) return Response.json({ error: "unknown-member" }, { status: 404 });
  const question = await putDoc(auth.familyId, "question", {
    id: newId("ask"),
    toMemberId: to.id,
    text: `How do you make your ${body.dish}?`,
    askedBy: auth.memberId,
    topic: "recipe",
    answeredCardId: null,
    madeBy: "family",
    createdAt: now,
  });
  pushAsk(auth.familyId, { fromId: auth.memberId, toIds: [to.id], topic: "recipe", tagId: `ask-${question.id}` });
  return Response.json({ question }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
