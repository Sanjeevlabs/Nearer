import { z } from "zod";
import { isDemoFamily, issueSessionCookie, requireSession } from "@/lib/auth";
import { joinAsExisting, validInvite } from "@/lib/join";
import { allowAuthAttempt } from "@/lib/otp";
import { memberFor } from "@/lib/request-memo";
import { guardApi } from "@/lib/api-guard";

// Signed in to one family, opening another's link: "Join the Iyer family too?" Joins with the session
// you already have (no second sign-in) and moves the session there. Already in it: it just opens.
const Body = z.object({
  code: z.string().trim().min(4).max(64),
  claimMemberId: z.string().min(1).max(80).optional(),
  firstName: z.string().trim().min(1).max(40).optional(),
});

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  // Everyone in the shared demo is the same person: a family joined from it would be every visitor's.
  if (isDemoFamily(auth.familyId)) return Response.json({ error: "not-in-demo" }, { status: 403 });
  const me = await memberFor(req, auth.memberId);
  // Only a person with their own sign-in (not a profile a parent made) joins another family.
  if (!me || !me.email) return Response.json({ error: "sign-in-with-email" }, { status: 403 });
  if (!allowAuthAttempt(`accept:${me.id}`, 10)) return Response.json({ error: "too-many-attempts" }, { status: 429 });
  const invite = await validInvite(parsed.data.code);
  if (!invite) return Response.json({ error: "invalid-invite" }, { status: 403 });
  const out = await joinAsExisting(me, { email: me.email, invite, firstName: parsed.data.firstName, claimMemberId: parsed.data.claimMemberId });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  const cookie = await issueSessionCookie(req, { familyId: out.familyId, memberId: out.memberId }).catch(() => null);
  if (!cookie) return Response.json({ error: "session-unavailable" }, { status: 500 });
  return Response.json({ familyId: out.familyId, memberId: out.memberId, status: "active", welcome: out.welcome, ...(out.already ? { already: true } : {}) }, { headers: { "set-cookie": cookie } });
}

export const POST = guardApi(postHandler);
