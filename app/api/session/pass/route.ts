import { z } from "zod";
import { isDemoFamily, issueSessionCookie, liveSession, signSession, verifySession } from "@/lib/auth";
import { newSid } from "@/lib/sessions";
import { dbGetMember } from "@/lib/db";
import { guardApi } from "@/lib/api-guard";

// Demo only: open the same demo family as another person on a second device
// ("see it from Dadi's side"). POST mints a short-lived pass for a member of
// YOUR demo family; GET redeems it and sets that person's cookie. Real
// families can't use it: it would let anyone act as anyone.
const PASS_TTL_MS = 30 * 60 * 1000;
const PassSchema = z.object({ memberId: z.string().min(1).max(64) });

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
  const parsed = PassSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-pass" }, { status: 400 });
  const member = await dbGetMember(parsed.data.memberId);
  if (!member || member.familyId !== session.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });
  const pass = signSession({ familyId: member.familyId, memberId: member.id, sid: newSid() }, PASS_TTL_MS);
  if (!pass) return Response.json({ error: "session-unavailable" }, { status: 500 });
  return Response.json({ path: `/api/session/pass?t=${encodeURIComponent(pass)}`, name: member.firstName });
}

async function getHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pass = verifySession(url.searchParams.get("t"));
  const home = new URL("/", url);
  if (!pass || !isDemoFamily(pass.familyId)) return Response.redirect(home, 302);
  const member = await dbGetMember(pass.memberId);
  if (!member || member.familyId !== pass.familyId) return Response.redirect(home, 302);
  const cookie = await issueSessionCookie(req, { familyId: member.familyId, memberId: member.id }).catch(() => null);
  if (!cookie) return Response.redirect(home, 302);
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie, "cache-control": "no-store" } });
}

export const POST = guardApi(postHandler);
export const GET = guardApi(getHandler);
