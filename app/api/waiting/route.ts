import { requireSession, sessionFromRequest } from "@/lib/auth";
import { membersFor, preloadSessionMember } from "@/lib/request-data";
import { guardWrites } from "@/lib/api-guard";
import { waitingNow } from "@/lib/waiting-server";

// What is waiting for you, newest first. The dock dot and the glance tile
// both read this one list (lib/glance.ts waitingItems); it is derived on every
// read, so acting on a thing (play, answer, reply, open) removes it.
async function getHandler(req: Request): Promise<Response> {
  // Everything starts with the session check (the member's row comes out of the family list);
  // a refused request throws it away.
  const claimed = sessionFromRequest(req);
  if (claimed) preloadSessionMember(req, claimed);
  const early = claimed ? waitingNow(claimed.familyId, claimed.memberId, new Date(), { members: membersFor(req, claimed.familyId) }) : null;
  early?.catch(() => undefined);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const items = await (early && claimed?.familyId === auth.familyId && claimed.memberId === auth.memberId ? early : waitingNow(auth.familyId, auth.memberId, new Date()));
  return Response.json({ items, top: items[0] ?? null });
}

export const GET = guardWrites(getHandler);
