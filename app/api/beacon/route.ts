import { guardWrites } from "@/lib/api-guard";
import { requireCan, requireSession } from "@/lib/auth";
import { BEACON_MAX_BYTES, cleanReport, listClientErrors, recordClientError } from "@/lib/client-errors";
import { allowAuthAttempt } from "@/lib/otp";

// The error beacon. POST: the app tells us it hit an error (signed-in people only, so nothing
// anonymous can fill the table). A report is at most 2 KB, is cleaned of anything personal on
// arrival (lib/client-errors.ts) and is rate limited per person and per family.
// GET: the last 50 for this family, for an owner or admin only.
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  // Per person 6 a minute, per family 40 an hour: one broken page must not become a flood.
  if (!allowAuthAttempt(`beacon:${auth.memberId}`, 6, 60_000) || !allowAuthAttempt(`beacon-family:${auth.familyId}`, 40, 3_600_000)) return Response.json({ error: "rate-limited" }, { status: 429 });
  const text = await req.text().catch(() => "");
  if (text.length > BEACON_MAX_BYTES || new TextEncoder().encode(text).length > BEACON_MAX_BYTES) return Response.json({ error: "too-large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid-beacon" }, { status: 400 });
  }
  const report = cleanReport(raw, req.headers.get("user-agent"));
  if (!report) return Response.json({ error: "invalid-beacon" }, { status: 400 });
  await recordClientError(auth.familyId, report);
  return new Response(null, { status: 204 });
}

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const me = await requireCan(auth, "members.approve", req);
  if (me instanceof Response) return me;
  return Response.json({ errors: await listClientErrors(auth.familyId) });
}

export const POST = guardWrites(postHandler);
export const GET = guardWrites(getHandler);
