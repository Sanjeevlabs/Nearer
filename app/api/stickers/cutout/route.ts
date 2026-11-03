import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { dbGetMember, dbListCards } from "@/lib/db";
import { withDemoShelf } from "@/lib/demo";
import { getDoc } from "@/lib/family-docs";
import { decodePhoto, mayCutOut, samConfigured, samMask, takeCutoutSlot } from "@/lib/stickers-server";
import { guardApi } from "@/lib/api-guard";

// GET  → { available }: whether a SAM cut-out can be made here (no SAM, or mock: false).
// POST → { source, image, point } → the cut-out mask as a PNG (white = keep).
//        When SAM isn't there (or fails, or the spend cap is reached) the answer
//        is JSON { mask: null, fallback: "crop" } and the phone draws a clean crop.
// Only your own photos (as a grown-up) or a recipe's dish; 6 a minute per person.

const Body = z.object({
  source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("card"), id: z.string().min(1).max(80) }), z.object({ kind: z.literal("recipe"), id: z.string().min(1).max(80) })]),
  image: z.string().min(32).max(2_100_000),
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
});

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  return Response.json({ available: samConfigured() });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!takeCutoutSlot(auth.memberId)) return Response.json({ error: "rate-limited" }, { status: 429 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-cutout" }, { status: 400 });
  const me = await dbGetMember(auth.memberId);
  if (!me) return Response.json({ error: "unknown-member" }, { status: 404 });
  const { source } = body.data;
  const card = source.kind === "card" ? (withDemoShelf(await dbListCards(auth.familyId), auth.familyId).find((c) => c.id === source.id) ?? null) : null;
  const recipeExists = source.kind === "recipe" ? Boolean(await getDoc(auth.familyId, "recipe", source.id)) : false;
  if (!mayCutOut(me, source, { card, recipeExists })) return Response.json({ error: "not-allowed" }, { status: 403 });
  const photo = decodePhoto(body.data.image);
  if (!photo) return Response.json({ error: "invalid-image" }, { status: 400 });
  if (!samConfigured()) return Response.json({ mask: null, fallback: "crop", reason: "no-sam" });
  const out = await samMask(photo, body.data.point);
  if ("error" in out) return Response.json({ mask: null, fallback: "crop", reason: out.error });
  return new Response(out.png as unknown as BodyInit, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}

export const GET = guardApi(getHandler);
export const POST = guardApi(postHandler);
