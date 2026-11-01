import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { docsFor } from "@/lib/request-data";
import { dbListCards } from "@/lib/db";
import { putDoc } from "@/lib/family-docs";
import { guardWrites } from "@/lib/api-guard";

// Morning letter (SPEC §30.4): a voice note that arrives at their morning.
// The card is stored as usual; GET /api/cards hides it from everyone but its
// author until deliverAt.

const Body = z.object({ cardId: z.string().min(1).max(80), deliverAt: z.string().datetime() });
const MAX_AHEAD = 36 * 3_600_000;

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const all = await docsFor(req, auth.familyId, "chitthi");
  const letters = all.filter((l) => l.kind !== "letter" && l.authorId === auth.memberId && Date.parse(l.deliverAt) > Date.now());
  // Written letters to the whole family (A letter from the courtyard), newest first.
  const written = all.filter((l) => l.kind === "letter" && Date.parse(l.deliverAt) <= Date.now()).slice(0, 5);
  return Response.json({ letters, written });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-letter" }, { status: 400 });
  const at = Date.parse(parsed.data.deliverAt);
  if (at <= Date.now() || at - Date.now() > MAX_AHEAD) return Response.json({ error: "invalid-time" }, { status: 400 });
  const card = (await dbListCards(auth.familyId)).find((c) => c.id === parsed.data.cardId);
  if (!card || card.authorId !== auth.memberId) return Response.json({ error: "unknown-card" }, { status: 404 });
  const letter = await putDoc(auth.familyId, "chitthi", { id: card.id, deliverAt: parsed.data.deliverAt, authorId: auth.memberId, createdAt: new Date().toISOString() });
  return Response.json({ letter });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
