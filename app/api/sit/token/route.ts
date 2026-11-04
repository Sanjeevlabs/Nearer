import { requireSession } from "@/lib/auth";
import { docsFor } from "@/lib/request-data";
import { dbListMembers } from "@/lib/db";
import { JAAS_DOMAIN, jaasConfig, mintJaasToken, roomName } from "@/lib/jaas";
import { jitsiHash } from "@/lib/call-gate";
import { callName } from "@/lib/people";
import { guardWrites } from "@/lib/api-guard";
import { visibleKnocks } from "@/lib/doors";

// How to open the video room for one live knock or sitting of the caller's family.
// JaaS (8x8) when configured, else public Jitsi. Moderator = whoever opened the door.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const params = new URL(req.url).searchParams;
  const id = params.get("id") ?? "";
  const browserMedia = params.get("open");
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (browserMedia !== null && browserMedia !== "audio" && browserMedia !== "video") {
    return Response.json({ error: "invalid-media-choice" }, { status: 400, headers });
  }
  const now = Date.now();
  const [sittings, knocks] = await Promise.all([docsFor(req, auth.familyId, "sitting"), docsFor(req, auth.familyId, "knock")]);
  // Same windows as GET /api/sit: sittings until 3 h after start, knocks until `until`.
  const sitting = sittings.find((s) => s.id === id && Date.parse(s.startsAt) > now - 3 * 3_600_000);
  // A knock only for the people it was opened to (lib/doors.ts): anyone else gets the same 404 as a closed door.
  const knock = visibleKnocks(knocks, auth.memberId, now).find((k) => k.id === id);
  const hostId = sitting?.hostId ?? knock?.memberId;
  if (!hostId) return Response.json({ error: "unknown-sitting" }, { status: 404, headers });

  const room = roomName(id);
  const cfg = jaasConfig();
  if (!cfg && !browserMedia) return Response.json({ provider: "jitsi", domain: "meet.jit.si", room }, { headers });
  const me = (await dbListMembers(auth.familyId)).find((m) => m.id === auth.memberId);
  const name = callName(me);
  let jwt: string | undefined;
  if (cfg) {
    try {
      jwt = await mintJaasToken({ room, user: { id: auth.memberId, name, moderator: hostId === auth.memberId } });
    } catch {
      return Response.json({ error: "call-provider-unavailable" }, { status: 503, headers });
    }
  }
  if (browserMedia) {
    const url = new URL(cfg ? `https://${JAAS_DOMAIN}/${encodeURIComponent(cfg.appId)}/${room}` : `https://meet.jit.si/${room}`);
    if (jwt) url.searchParams.set("jwt", jwt);
    url.hash = jitsiHash(browserMedia, name);
    return new Response(null, { status: 303, headers: { ...headers, location: url.href } });
  }
  return Response.json({ provider: "jaas", domain: JAAS_DOMAIN, appId: cfg?.appId, room, jwt }, { headers });
}

export const GET = guardWrites(getHandler);
