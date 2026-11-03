import { pushCardActivity } from "@/lib/push/events";
import { inBackground } from "@/lib/push/background";
import { withDemoShelf } from "@/lib/demo";
import { z } from "zod";
import { CreateReactionRequestSchema } from "@/lib/schemas";
import { dbGetMember, dbListCards, dbListReactions, dbRemoveReaction, dbSetReaction } from "@/lib/db";
import { requireMember, requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { nudgeReacted } from "@/lib/nudge-producers";
import { canSeeCard, hiddenCardIds } from "@/lib/card-privacy";

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const { searchParams } = new URL(req.url);
  const [reactions, cards] = await Promise.all([dbListReactions(searchParams.get("cardId") ?? undefined, auth.familyId), dbListCards(auth.familyId)]);
  // Reactions on a note for someone else are theirs too.
  const hidden = hiddenCardIds(cards, auth.memberId);
  return Response.json({ reactions: hidden.size ? reactions.filter((r) => !hidden.has(r.cardId)) : reactions });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = CreateReactionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-reaction" }, { status: 400 });
  }
  const ownership = requireMember(auth, parsed.data.memberId);
  if (ownership) return ownership;
  const cards = withDemoShelf(await dbListCards(auth.familyId), auth.familyId);
  const card = cards.find((c) => c.id === parsed.data.cardId);
  if (!card || !canSeeCard(card, auth.memberId)) {
    return Response.json({ error: "unknown-card" }, { status: 404 });
  }
  if (!(await dbGetMember(parsed.data.memberId))) {
    return Response.json({ error: "unknown-member" }, { status: 404 });
  }
  // One per member per card: setReaction replaces the member's prior kind.
  const reaction = await dbSetReaction({ ...parsed.data, familyId: auth.familyId });
  inBackground(() => pushCardActivity(auth.familyId, card, auth.memberId, "reaction"));
  await nudgeReacted(auth.familyId, card, parsed.data.memberId, parsed.data.kind); // never throws
  return Response.json({ reaction }, { status: 201 });
}

// Take your reaction back (tap it again).
async function deleteHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = z.object({ cardId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-reaction" }, { status: 400 });
  await dbRemoveReaction(parsed.data.cardId, auth.memberId);
  return Response.json({ removed: true });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
export const DELETE = guardWrites(deleteHandler);
