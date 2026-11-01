import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { docsFor, membersFor, relationshipsFor } from "@/lib/request-data";
import { dbListCards } from "@/lib/db";
import { newId, putDoc } from "@/lib/family-docs";
import { bedtimePrompt, dayIn, guardiansOf, isKid, kidsOf, tonightFor } from "@/lib/kids";
import { guardWrites } from "@/lib/api-guard";

// Bedtime stories. A grandparent (or parent) records a story for a child; it plays on the
// child's screen whenever they open it. One prompt a day for the grown-up: recording
// one, or "Not now", ends it for their day.
// GET  -> a child: tonight's story (the voice only once it is open); a grown-up: the
//         prompt for today (or null) and the kids they can tell.
// POST -> create {forMemberId, cardId, title?} · not-now.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), forMemberId: z.string().min(1).max(80), cardId: z.string().min(1).max(80), title: z.string().trim().max(80).default("") }),
  z.object({ action: z.literal("not-now") }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [stories, members, rels] = await Promise.all([docsFor(req, auth.familyId, "bedtime_story"), membersFor(req, auth.familyId), relationshipsFor(req, auth.familyId)]);
  const me = members.find((m) => m.id === auth.memberId);
  if (!me) return Response.json({ error: "unknown-member" }, { status: 404 });
  const now = new Date();
  if (isKid(me)) {
    const tonight = tonightFor(me, stories, now);
    if (!tonight) return Response.json({ tonight: null, open: true });
    return Response.json({ tonight: tonight.story, open: true });
  }
  const kids = kidsOf(me.id, members, rels);
  const prompt = bedtimePrompt(me, kids, stories, now);
  return Response.json({ prompt, kids: kids.map((k) => k.id) });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/bedtime")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-story" }, { status: 400 });
  const body = parsed.data;
  const [members, rels] = await Promise.all([membersFor(req, auth.familyId), relationshipsFor(req, auth.familyId)]);
  const me = members.find((m) => m.id === auth.memberId);
  if (!me || isKid(me)) return Response.json({ error: "not-allowed" }, { status: 403 });
  const now = new Date();

  if (body.action === "not-now") {
    // One "not now" per person per day (their own day): saying it twice is the same row.
    const stories = await docsFor(req, auth.familyId, "bedtime_story");
    const kids = kidsOf(me.id, members, rels);
    const prompt = bedtimePrompt(me, kids, stories, now);
    const forId = prompt?.childId ?? kids[0]?.id;
    if (!forId) return Response.json({ error: "no-child" }, { status: 404 });
    const row = await putDoc(auth.familyId, "bedtime_story", { id: `skip-${me.id}-${dayIn(me.tz, now)}`, forMemberId: forId, byMemberId: me.id, cardId: null, at: now.toISOString(), title: "" });
    return Response.json({ dismissed: row.id });
  }

  const kid = members.find((m) => m.id === body.forMemberId);
  if (!kid || !isKid(kid) || !guardiansOf(kid.id, rels).includes(me.id)) return Response.json({ error: "not-yours" }, { status: 403 });
  const card = (await dbListCards(auth.familyId)).find((c) => c.id === body.cardId);
  if (!card || card.type !== "audio" || card.authorId !== me.id) return Response.json({ error: "unknown-voice-note" }, { status: 404 });
  const story = await putDoc(auth.familyId, "bedtime_story", { id: newId("bed"), forMemberId: kid.id, byMemberId: me.id, cardId: card.id, at: now.toISOString(), title: body.title });
  return Response.json({ story }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
