import { CreatePlayRequestSchema } from "@/lib/schemas";
import { dbAddPlay, dbGetMember, dbListCards, dbListPlays } from "@/lib/db";
import { requireMember, requireSession } from "@/lib/auth";
import { withDemoShelf } from "@/lib/demo";
import { guardWrites } from "@/lib/api-guard";
import { nudgeHeard } from "@/lib/nudge-producers";
import { markSeenWhere } from "@/lib/nudges";

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const { searchParams } = new URL(req.url);
  return Response.json({ plays: await dbListPlays(searchParams.get("cardId") ?? undefined, auth.familyId) });
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
  const parsed = CreatePlayRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-play" }, { status: 400 });
  }
  const ownership = requireMember(auth, parsed.data.memberId);
  if (ownership) return ownership;
  // The demo family's synthetic shelf voices can be heard (and counted as heard) too.
  const cards = withDemoShelf(await dbListCards(auth.familyId), auth.familyId);
  const card = cards.find((c) => c.id === parsed.data.cardId);
  if (!card) {
    return Response.json({ error: "unknown-card" }, { status: 404 });
  }
  if (!(await dbGetMember(parsed.data.memberId))) {
    return Response.json({ error: "unknown-member" }, { status: 404 });
  }
  const play = await dbAddPlay({ ...parsed.data, familyId: auth.familyId });
  await nudgeHeard(auth.familyId, card, parsed.data.memberId); // never throws
  // Opening the card is seeing the nudges that point at it ("Maa heard your voice note").
  await markSeenWhere(auth.familyId, auth.memberId, (href) => href.includes(`card=${encodeURIComponent(card.id)}`)).catch(() => 0);
  return Response.json({ play }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
