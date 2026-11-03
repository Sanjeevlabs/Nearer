import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { ASK_MAX_CHARS, askFamily, askRateOk } from "@/lib/archive-ask";
import { guardApi } from "@/lib/api-guard";

// POST /api/ask { question } -> an answer written only from this family's own
// voice notes, recipes and stories, each claim with its clip; or "no one has
// said that yet" with someone to ask. Family-scoped by the session.
const Body = z.object({ question: z.string().trim().min(3).max(ASK_MAX_CHARS) });

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!askRateOk(auth.memberId)) return Response.json({ error: "rate-limited" }, { status: 429 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid-ask" }, { status: 400 });
  try {
    return Response.json(await askFamily({ familyId: auth.familyId, viewerId: auth.memberId, question: parsed.data.question }));
  } catch (e) {
    console.error("[ask] failed", String(e));
    return Response.json({ error: "ask-failed" }, { status: 500 });
  }
}

export const POST = guardApi(postHandler);
