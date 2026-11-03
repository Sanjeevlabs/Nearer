import { z } from "zod";
import { DEMO_INVITE_CODE, clearSessionCookieHeader, isDemoFamily, requireSession, sessionCookieHeader, sessionFromRequest, signSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { membersPayload } from "@/lib/members-payload";
import { memberFor } from "@/lib/request-memo";
import { familyNameFor, preloadSessionMember, relationshipsFor } from "@/lib/request-data";
import { dbFindInvite, dbGetMember, dbListMembers } from "@/lib/db";
import { isAdmin, isClaimable } from "@/lib/permissions";
import { hostOf } from "@/lib/roles";
import { allowAuthAttempt, callerKey } from "@/lib/otp";
import { dbFor, dbLive } from "@/lib/family-db";
import { createSandbox, sandboxId, seedMemberOf, visitorOf } from "@/lib/demo-sandbox";
import type { Member } from "@/lib/schemas";

const ExchangeSchema = z.object({
  inviteCode: z.string().min(1).max(64),
  memberId: z.string().min(1).max(64),
});

// The demo code before the rename to Nearer; old links and bookmarks still carry it.
const LEGACY_DEMO_CODE = "AANGAN-DEMO";

// Invite code -> httpOnly signed session cookie. The code must be a live,
// unexpired family invite (Privacy page) for the member's family — or the
// documented NEARER-DEMO bootstrap code for the synthetic demo families.
// Members with their own account, and admins, must use the email code.
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  // Slow down guessing: per caller address and per target member.
  const ip = callerKey(req) ?? "local";
  const claimed = (body as { memberId?: unknown } | null)?.memberId;
  const sent = (body as { inviteCode?: unknown } | null)?.inviteCode;
  const demoCode = sent === DEMO_INVITE_CODE || sent === LEGACY_DEMO_CODE;
  // The per-member limit slows invite-code guessing; the public demo code has
  // nothing to guess, and every demo visitor asks for the same seed member.
  // The public demo has its own, roomier allowance: a room of judges on one office network
  // must all get in. Real invite codes keep the tight per-address limit.
  const perAddress = demoCode ? allowAuthAttempt(`session-demo:${ip}`, 200) : allowAuthAttempt(`session:${ip}`, 20);
  if (!perAddress || (!demoCode && typeof claimed === "string" && !allowAuthAttempt(`session-member:${claimed}`, 10))) return Response.json({ error: "too-many-attempts" }, { status: 429 });
  const parsed = ExchangeSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-session" }, { status: 400 });
  const trimmed = parsed.data.inviteCode.trim();
  const code = trimmed === LEGACY_DEMO_CODE ? DEMO_INVITE_CODE : trimmed;
  if (code === DEMO_INVITE_CODE && dbLive()) return enterDemo(req, parsed.data.memberId);
  const member = await dbGetMember(parsed.data.memberId);
  if (!member) return Response.json({ error: "unknown-member" }, { status: 404 });

  let ok = false;
  if (code === DEMO_INVITE_CODE && isDemoFamily(member.familyId)) {
    ok = true;
  } else if (member.email || isAdmin(member)) {
    // An invite code lets someone take a place the family made for them. It
    // never opens a person who has their own account, or an admin: they sign
    // in with their email code.
    return Response.json({ error: "sign-in-with-email" }, { status: 403 });
  } else if (!isClaimable(member)) {
    // Same rule as joining by email: a code opens only a grown-up's open
    // place, never a child's or teen's profile.
    return Response.json({ error: "not-claimable" }, { status: 403 });
  } else {
    // Codes are stored upper-case; typing them any case works.
    const invite = await dbFindInvite(code);
    ok = Boolean(invite && invite.familyId === member.familyId);
  }
  if (!ok) return Response.json({ error: "invalid-invite" }, { status: 403 });

  const signed = signSession({ familyId: member.familyId, memberId: member.id });
  if (!signed) return Response.json({ error: "session-unavailable" }, { status: 500 });
  return Response.json(
    { familyId: member.familyId, memberId: member.id },
    { headers: { "set-cookie": sessionCookieHeader(signed) } },
  );
}

// The public demo with the database live: each visitor gets their own copy of
// the seed (lib/demo-sandbox.ts), reused while their cookie lasts, so what
// they add survives reloads and nobody sees anyone else's uploads.
async function enterDemo(req: Request, seedMemberId: string): Promise<Response> {
  // The seed lives in memory (the copy is made from it), so finding the seed member costs no round trip.
  const seedMember = seedMemberOf(seedMemberId);
  if (!seedMember) return Response.json({ error: "unknown-member" }, { status: 404 });
  let member: Member | undefined;
  const current = sessionFromRequest(req);
  const vid = current ? visitorOf(current.familyId) : null;
  if (vid) {
    const again = await dbGetMember(sandboxId(seedMemberId, vid));
    if (again && visitorOf(again.familyId) === vid) member = again;
  }
  if (!member) {
    const sb = dbFor(null);
    if (!sb) return Response.json({ error: "session-unavailable" }, { status: 503 });
    const made = await createSandbox(sb, callerKey(req));
    if (!made.ok) return Response.json({ error: made.error === "busy" ? "demo-busy" : "demo-unavailable" }, { status: 503 });
    // The copy's own row, as just written: no read back.
    const id = made.idMap.get(seedMemberId);
    member = made.members.find((m) => m.id === id);
  }
  if (!member) return Response.json({ error: "demo-unavailable" }, { status: 503 });
  const signed = signSession({ familyId: member.familyId, memberId: member.id });
  if (!signed) return Response.json({ error: "session-unavailable" }, { status: 500 });
  return Response.json({ familyId: member.familyId, memberId: member.id }, { headers: { "set-cookie": sessionCookieHeader(signed) } });
}

// Current session (who am I). The one route a joiner who is still waiting
// for an admin can use: it says whom they're waiting for (a first name only).
// With ?family=1 an active member's answer also carries the family (as GET /api/members) and its
// relationships (as GET /api/relationships): the first screen asks once, and the three reads go
// out together with the session check (one round trip; the member's row comes out of the family list).
async function getHandler(req: Request): Promise<Response> {
  const session = sessionFromRequest(req);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const withFamily = new URL(req.url).searchParams.get("family") === "1";
  if (withFamily) {
    preloadSessionMember(req, session);
    void familyNameFor(req, session.familyId).catch(() => undefined);
    void relationshipsFor(req, session.familyId).catch(() => undefined);
  }
  const me = await memberFor(req, session.memberId);
  if (!me || me.familyId !== session.familyId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (me.status !== "pending") {
    const base = { familyId: session.familyId, memberId: session.memberId, status: "active" as const };
    if (!withFamily) return Response.json(base);
    // The same check (and sliding renewal) the members route makes; the member is already loaded.
    const auth = await requireSession(req);
    if (auth instanceof Response) return auth;
    const [family, relationships] = await Promise.all([membersPayload(req, auth), relationshipsFor(req, auth.familyId)]);
    return Response.json({ ...base, ...family, relationships });
  }
  const host = hostOf(await dbListMembers(session.familyId));
  return Response.json({ familyId: session.familyId, memberId: session.memberId, status: "pending", waitingFor: host ? host.firstName : null });
}

export const GET = guardWrites(getHandler);

// Log out: clear the cookie.
export async function DELETE(): Promise<Response> {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookieHeader() } });
}
