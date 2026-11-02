import { guardWrites } from "@/lib/api-guard";
import { requireCan, requireSession } from "@/lib/auth";
import { metricsFor } from "@/lib/metrics-server";

// "How we're doing": three honest numbers about the family (lib/metrics.ts), for owners and admins.
// Computed here, from bounded queries; never sent anywhere.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const me = await requireCan(auth, "members.approve", req);
  if (me instanceof Response) return me;
  return Response.json(await metricsFor(auth.familyId, me.tz || "UTC"));
}

export const GET = guardWrites(getHandler);
