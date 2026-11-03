import { dbListRitualRuns } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { guardApi } from "@/lib/api-guard";

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  return Response.json({ runs: await dbListRitualRuns(auth.familyId) });
}

export const GET = guardApi(getHandler);
