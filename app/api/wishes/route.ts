import { CreateWishRequestSchema } from "@/lib/schemas";
import { dbAddWish, dbGetMember, dbListCards, dbListRitualRuns, dbListWishes } from "@/lib/db";
import { requireMember, requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { seenBy } from "@/lib/card-privacy";

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const { searchParams } = new URL(req.url);
  return Response.json({ wishes: await dbListWishes(searchParams.get("runId") ?? undefined, auth.familyId) });
}

// Record a wish/blessing, optionally linked to a voice card. The wish must
// be the session member's own (replies post as the viewer).
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = CreateWishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-wish" }, { status: 400 });
  }
  const ownership = requireMember(auth, parsed.data.memberId);
  if (ownership) return ownership;
  if (!(await dbGetMember(parsed.data.memberId))) {
    return Response.json({ error: "unknown-member" }, { status: 404 });
  }
  // The card and the occasion must be this family's own.
  if (parsed.data.cardId && !seenBy(await dbListCards(auth.familyId), auth.memberId).some((c) => c.id === parsed.data.cardId)) return Response.json({ error: "unknown-card" }, { status: 404 });
  if (parsed.data.ritualRunId && !(await dbListRitualRuns(auth.familyId)).some((r) => r.id === parsed.data.ritualRunId)) return Response.json({ error: "unknown-run" }, { status: 404 });
  const wish = await dbAddWish({ ...parsed.data, familyId: auth.familyId });
  return Response.json({ wish }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
