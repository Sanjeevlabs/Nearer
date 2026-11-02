import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { dbListCards } from "@/lib/db";
import { withDemoShelf } from "@/lib/demo";
import { getDoc, putDoc } from "@/lib/family-docs";
import { toggleStar } from "@/lib/stars";
import { defaultView } from "@/lib/window-server";
import { guardWrites } from "@/lib/api-guard";

// "My favourites": your own starred photos and voice memories. A star is
// yours alone (kept on your window_view doc), so nobody else's list changes.
//
// GET  → { starred: string[] }
// POST { cardId, on? } → { starred } (on omitted toggles)

const Body = z.object({ cardId: z.string().min(1).max(120), on: z.boolean().optional() });

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const mine = await getDoc(auth.familyId, "window_view", auth.memberId);
  return Response.json({ starred: mine?.starred ?? [] });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/stars")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-star" }, { status: 400 });
  const { cardId, on } = parsed.data;
  // Only this family's own photos, videos and voice memories.
  const card = withDemoShelf(await dbListCards(auth.familyId), auth.familyId).find((c) => c.id === cardId);
  if (!card) return Response.json({ error: "unknown-card" }, { status: 404 });
  const mine = await getDoc(auth.familyId, "window_view", auth.memberId);
  const base = mine ?? defaultView(auth.familyId, auth.memberId);
  const starred = toggleStar(base.starred ?? [], cardId, on);
  const view = await putDoc(auth.familyId, "window_view", { ...base, id: auth.memberId, memberId: auth.memberId, starred, updatedAt: mine?.updatedAt ?? new Date().toISOString() });
  return Response.json({ starred: view.starred });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
