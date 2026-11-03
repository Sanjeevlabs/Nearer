import { z } from "zod";
import { isDemoFamily, issueSessionCookie, liveSession } from "@/lib/auth";
import { dbGetMember } from "@/lib/db";
import { guardApi } from "@/lib/api-guard";

const SwitchSchema = z.object({ memberId: z.string().min(1).max(64) });

// Demo persona switcher: mint a cookie for another member of the SAME demo
// family. Real families can't use it: it would let anyone act as anyone.
async function postHandler(req: Request): Promise<Response> {
  const session = await liveSession(req).catch(() => null);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isDemoFamily(session.familyId)) return Response.json({ error: "demo-only" }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = SwitchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-switch" }, { status: 400 });
  const current = await dbGetMember(session.memberId);
  if (current?.status === "pending") return Response.json({ error: "pending" }, { status: 403 });
  const member = await dbGetMember(parsed.data.memberId);
  if (!member || member.familyId !== session.familyId) {
    return Response.json({ error: "unknown-member" }, { status: 404 });
  }
  const cookie = await issueSessionCookie(req, { familyId: member.familyId, memberId: member.id }).catch(() => null);
  if (!cookie) return Response.json({ error: "session-unavailable" }, { status: 500 });
  return Response.json({ familyId: member.familyId, memberId: member.id }, { headers: { "set-cookie": cookie } });
}

export const POST = guardApi(postHandler);
