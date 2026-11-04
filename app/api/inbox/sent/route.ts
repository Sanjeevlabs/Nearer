import { guardWrites } from "@/lib/api-guard";
import { requireSession } from "@/lib/auth";
import { SentResponseSchema } from "@/lib/sent";
import { sentFor } from "@/lib/sent-server";

// "Sent": what you sent to particular people in the last 30 days, with where each one stands
// (waiting for someone to join, delivered, heard). Your own session only; derived on every read.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const items = await sentFor(auth.familyId, auth.memberId, new Date());
  return Response.json(SentResponseSchema.parse({ items }));
}

export const GET = guardWrites(getHandler);
