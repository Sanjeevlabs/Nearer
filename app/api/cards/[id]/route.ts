import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { dbDeleteCard, dbGetMember, dbListCards, dbUpdateCard } from "@/lib/db";
import { canChange } from "@/lib/permissions";
import { guardWrites } from "@/lib/api-guard";
import { canSeeCard } from "@/lib/card-privacy";

// One voice note, photo or video: the author can fix the caption or delete
// it; an admin can delete anything (moderation). Deleting removes its plays,
// reactions and wishes too.

async function load(req: Request, id: string) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [cards, me] = await Promise.all([dbListCards(auth.familyId), dbGetMember(auth.memberId)]);
  const card = cards.find((c) => c.id === id);
  // A note for someone else is not there at all for this viewer.
  if (!card || !me || !canSeeCard(card, auth.memberId)) return Response.json({ error: "unknown-card" }, { status: 404 });
  return { auth, card, me };
}

async function patchHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const t = await load(req, params.id);
  if (t instanceof Response) return t;
  if (!canChange(t.me, t.card.authorId, "edit")) return Response.json({ error: "not-yours" }, { status: 403 });
  const parsed = z.object({ caption: z.string().trim().min(1).max(280) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-card" }, { status: 400 });
  // A voice note shows its transcript: fixing the words updates both, and the
  // old timestamps are dropped so the lyrics re-time from the new text.
  const patch = t.card.type === "audio" ? { caption: parsed.data.caption, transcript: parsed.data.caption, segments: [] } : parsed.data;
  const card = await dbUpdateCard(t.card.id, t.auth.familyId, patch);
  return card ? Response.json({ card }) : Response.json({ error: "update-failed" }, { status: 500 });
}

async function deleteHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const t = await load(req, params.id);
  if (t instanceof Response) return t;
  if (!canChange(t.me, t.card.authorId, "delete")) return Response.json({ error: "not-yours" }, { status: 403 });
  const ok = await dbDeleteCard(t.card.id, t.auth.familyId);
  return ok ? Response.json({ deleted: t.card.id }) : Response.json({ error: "delete-failed" }, { status: 500 });
}

export const PATCH = guardWrites(patchHandler);
export const DELETE = guardWrites(deleteHandler);
