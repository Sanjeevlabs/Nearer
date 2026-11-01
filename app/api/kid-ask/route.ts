import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { docsFor, membersFor, relationshipsFor } from "@/lib/request-data";
import { dbListCards } from "@/lib/db";
import { getDoc, newId, putDoc } from "@/lib/family-docs";
import { guardianMap, guardiansOf, isKid, openAsksFor } from "@/lib/kids";
import { callName } from "@/lib/people";
import { guardWrites } from "@/lib/api-guard";

// "Ask Dadi": a child's question or "another story" (voice or a few words) waits for a
// grandparent (or parent) to answer by voice. The answer is a voice card AND a Story, titled
// with the question, so it lands in Stories for everyone.
// GET  -> a child: their own asks; anyone else: the open asks that are theirs to answer.
// POST -> ask (children only) · answer (the grown-up the ask is for).

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ask"),
    topic: z.enum(["question", "story"]).default("question"),
    cardId: z.string().min(1).max(80).optional(),
    text: z.string().trim().max(200).default(""),
    toMemberId: z.string().min(1).max(80).nullable().optional(),
  }),
  z.object({ action: z.literal("answer"), askId: z.string().min(1).max(80), cardId: z.string().min(1).max(80) }),
]);

const OPEN_MAX = 5;
const KEEP_ANSWERED_MS = 3 * 86_400_000;

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [asks, members, rels] = await Promise.all([docsFor(req, auth.familyId, "kid_ask"), membersFor(req, auth.familyId), relationshipsFor(req, auth.familyId)]);
  const me = members.find((m) => m.id === auth.memberId);
  const now = Date.now();
  const list = isKid(me)
    ? asks.filter((a) => a.fromMemberId === auth.memberId && (!a.answeredAt || now - Date.parse(a.answeredAt) < KEEP_ANSWERED_MS))
    : openAsksFor(asks, auth.memberId, guardianMap(members, rels));
  return Response.json({ asks: [...list].sort((a, b) => b.askedAt.localeCompare(a.askedAt)) });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/kid-ask")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-ask" }, { status: 400 });
  const body = parsed.data;
  const [members, rels, cards] = await Promise.all([membersFor(req, auth.familyId), relationshipsFor(req, auth.familyId), dbListCards(auth.familyId)]);
  const me = members.find((m) => m.id === auth.memberId);
  const now = new Date().toISOString();

  if (body.action === "ask") {
    if (!isKid(me)) return Response.json({ error: "not-allowed" }, { status: 403 });
    const card = body.cardId ? cards.find((c) => c.id === body.cardId) : undefined;
    if (body.cardId && (!card || card.type !== "audio" || card.authorId !== auth.memberId)) return Response.json({ error: "unknown-card" }, { status: 404 });
    if (!card && !body.text) return Response.json({ error: "invalid-ask" }, { status: 400 });
    // Only to one of their own grandparents or parents, else to any of them.
    const to = body.toMemberId && guardiansOf(auth.memberId, rels).includes(body.toMemberId) ? body.toMemberId : null;
    const open = (await docsFor(req, auth.familyId, "kid_ask")).filter((a) => a.fromMemberId === auth.memberId && !a.answeredCardId);
    // "Another one?" tapped twice is one ask.
    const twin = open.find((a) => a.topic === body.topic && a.text === body.text && a.cardId === (card?.id ?? null) && a.toMemberId === to);
    if (twin) return Response.json({ ask: twin }, { status: 200 });
    if (open.length >= OPEN_MAX) return Response.json({ error: "too-many-open" }, { status: 409 });
    const ask = await putDoc(auth.familyId, "kid_ask", { id: newId("ask"), fromMemberId: auth.memberId, toMemberId: to, cardId: card?.id ?? null, text: body.text, askedAt: now, answeredCardId: null, answeredAt: null, topic: body.topic });
    return Response.json({ ask }, { status: 201 });
  }

  // answer
  const ask = await getDoc(auth.familyId, "kid_ask", body.askId);
  if (!ask) return Response.json({ error: "unknown-ask" }, { status: 404 });
  if (ask.answeredCardId) return Response.json({ error: "already-answered" }, { status: 409 });
  if (openAsksFor([ask], auth.memberId, guardianMap(members, rels)).length === 0) return Response.json({ error: "not-yours" }, { status: 403 });
  const voice = cards.find((c) => c.id === body.cardId);
  if (!voice || voice.type !== "audio" || voice.authorId !== auth.memberId) return Response.json({ error: "unknown-voice-note" }, { status: 404 });
  const kid = members.find((m) => m.id === ask.fromMemberId);
  const question = ask.text || cards.find((c) => c.id === ask.cardId)?.transcript.trim() || "";
  const title = (ask.topic === "story" ? `A story for ${callName(kid)}` : question || `${callName(kid)}'s question`).slice(0, 80);
  const lang = voice.transcriptLang || voice.lang;
  const story = await putDoc(auth.familyId, "story", { id: newId("story"), tellerId: auth.memberId, cardId: voice.id, title, theme: "other", ages: "all", summary: "", lang, questionId: null, madeBy: "family", createdAt: now });
  const answered = await putDoc(auth.familyId, "kid_ask", { ...ask, answeredCardId: voice.id, answeredAt: now });
  return Response.json({ ask: answered, story });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
