import { requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { waitingNow } from "@/lib/waiting-server";

// What is waiting for you, newest first. The dock dot and the glance tile
// both read this one list (lib/glance.ts waitingItems); it is derived on every
// read, so acting on a thing (play, answer, reply, open) removes it.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const items = await waitingNow(auth.familyId, auth.memberId, new Date());
  return Response.json({ items, top: items[0] ?? null });
}

export const GET = guardWrites(getHandler);
