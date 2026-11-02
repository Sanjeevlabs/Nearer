import { guardWrites } from "@/lib/api-guard";
import { requireSession } from "@/lib/auth";
import { InboxResponseSchema } from "@/lib/inbox";
import { inboxFor } from "@/lib/inbox-server";

// "For you": what was sent to you in the last 30 days, newest first (lib/inbox.ts).
// Your own session only; derived on every read, so playing or answering moves a thing to Earlier.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const items = await inboxFor(auth.familyId, auth.memberId, new Date());
  return Response.json(InboxResponseSchema.parse({ items }));
}

export const GET = guardWrites(getHandler);
