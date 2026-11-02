import { requireSession } from "@/lib/auth";
import { docsFor } from "@/lib/request-data";
import { JAAS_DOMAIN, jaasConfig } from "@/lib/jaas";
import { roomUrl } from "@/lib/overlap";
import { guardWrites } from "@/lib/api-guard";
import { visibleKnocks } from "@/lib/doors";

// The public room link for one live knock or sitting of the caller's family
// (for calendar entries). Follows the configured provider like the token
// route, but never carries a JWT: a calendar file is shared and long-lived.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const now = Date.now();
  const [sittings, knocks] = await Promise.all([docsFor(req, auth.familyId, "sitting"), docsFor(req, auth.familyId, "knock")]);
  // Same windows as GET /api/sit/token: sittings until 3 h after start, knocks until `until`.
  const sitting = sittings.find((s) => s.id === id && Date.parse(s.startsAt) > now - 3 * 3_600_000);
  // A knock only for the people it was opened to (lib/doors.ts): anyone else gets the same 404 as a closed door.
  const knock = visibleKnocks(knocks, auth.memberId, now).find((k) => k.id === id);
  const headers = { "cache-control": "no-store" };
  if (!sitting && !knock) return Response.json({ error: "unknown-sitting" }, { status: 404, headers });

  const cfg = jaasConfig();
  const url = roomUrl(id, cfg ? { provider: "jaas", domain: JAAS_DOMAIN, appId: cfg.appId } : undefined);
  return Response.json({ url }, { headers });
}

export const GET = guardWrites(getHandler);
