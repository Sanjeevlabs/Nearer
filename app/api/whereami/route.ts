import { getCloudflareContext } from "@opennextjs/cloudflare";
import { WhereAmISchema, whereAmIFromCf } from "@/lib/location";
import { allowAuthAttempt, callerKey } from "@/lib/otp";
import { guardApi } from "@/lib/api-guard";

// A coarse "where is this connection" from Cloudflare (request.cf). It only
// echoes the caller's own city back to them: no sign-in needed, nothing kept.
const HEADERS = { "cache-control": "private, no-store" };

async function getHandler(req: Request): Promise<Response> {
  const ip = callerKey(req);
  if (ip && !allowAuthAttempt(`whereami:${ip}`, 30)) return Response.json({ error: "rate-limited" }, { status: 429, headers: HEADERS });
  if (process.env.MOCK === "true") return Response.json({}, { headers: HEADERS });
  let cf: unknown = (req as { cf?: unknown }).cf;
  if (!cf) {
    try {
      cf = getCloudflareContext().cf;
    } catch {
      /* not running on Cloudflare */
    }
  }
  return Response.json(WhereAmISchema.parse(whereAmIFromCf(cf)), { headers: HEADERS });
}

export const GET = guardApi(getHandler);
