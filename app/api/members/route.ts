import { requireSession, sessionFromRequest } from "@/lib/auth";
import { membersPayload } from "@/lib/members-payload";
import { familyNameFor, preloadSessionMember } from "@/lib/request-data";
import { guardApi } from "@/lib/api-guard";

async function getHandler(req: Request): Promise<Response> {
  // The family list starts with the session check and answers it (lib/request-data.ts): one round trip.
  const claimed = sessionFromRequest(req);
  if (claimed) {
    preloadSessionMember(req, claimed);
    void familyNameFor(req, claimed.familyId).catch(() => undefined);
  }
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  return Response.json(await membersPayload(req, auth));
}

export const GET = guardApi(getHandler);
