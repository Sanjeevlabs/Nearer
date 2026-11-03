import { z } from "zod";
import { issueSessionCookie } from "@/lib/auth";
import { lastUsedMember } from "@/lib/sessions";
import { dbAddMember, dbCreateFamily, dbFindMemberByEmail, dbFindInvite, dbGetMember, dbListMembers, dbListSides, dbUpdateMemberProfile } from "@/lib/db";
import type { Member } from "@/lib/schemas";
import { isAdmin, isClaimable } from "@/lib/permissions";
import { familyFull, hostOf } from "@/lib/roles";
import type { Invite } from "@/lib/db";
import { allowAuthAttempt, callerKey, identityFromToken, verifyCode } from "@/lib/otp";
import { guardApi } from "@/lib/api-guard";

const Name = z.string().trim().min(1).max(40);
const City = z.string().trim().max(60);
const VerifySchema = z.object({
  // Either an email + 6-digit code (mock and the server-sent code), or a
  // Supabase Auth session token (Google, magic link, phone) verified here.
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
  accessToken: z.string().min(20).max(4096).optional(),
  tz: z.string().max(64).default("UTC"),
  birthday: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
  /** Where they live, in their words: the other home sees its sky. */
  city: City.optional(),
  intent: z.discriminatedUnion("type", [
    z.object({ type: z.literal("signin") }),
    z.object({ type: z.literal("create"), familyName: Name, firstName: Name, callName: Name.optional() }),
    // claimMemberId: "I'm Maa" — take the place the family already made for you.
    z.object({ type: z.literal("join"), inviteCode: z.string().trim().min(4).max(64), firstName: Name, callName: Name.optional(), claimMemberId: z.string().min(1).max(80).optional() }),
  ]),
});

/** A place the family made for someone who hasn't joined yet (no account, not a child, not an admin). */
async function claimable(memberId: string | undefined, familyId: string): Promise<Member | undefined> {
  if (!memberId) return undefined;
  const m = await dbGetMember(memberId);
  return m && m.familyId === familyId && isClaimable(m) ? m : undefined;
}

/**
 * Joiners wait for an owner/admin, except when the family already made their
 * place (claimMemberId) or an owner/admin made the code they used.
 */
async function joinStatus(invite: Invite, claimed: boolean): Promise<Member["status"]> {
  if (claimed) return "active";
  const by = invite.createdBy ? await dbGetMember(invite.createdBy) : undefined;
  return by && by.familyId === invite.familyId && by.status !== "pending" && isAdmin(by) ? "active" : "pending";
}

/** "Welcome, Maa. Arjun's window is open." — shown once on the joiner's window. */
async function welcomeLine(familyId: string, me: Member): Promise<string> {
  const others = (await dbListMembers(familyId)).filter((m) => m.id !== me.id && m.email);
  const host = hostOf(others) ?? others[0];
  const you = me.displayName || me.firstName;
  return host ? `Welcome, ${you}. ${host.firstName}'s window is open.` : `Welcome, ${you}. Your window is open.`;
}

function validTz(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// Step 2: verify the code and, in the same request, sign in, create a family,
// or join one. Verification and account changes never happen separately, so a
// code can't be replayed into a different action.
async function postHandler(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  const { intent } = parsed.data;
  let email: string;
  if (parsed.data.accessToken) {
    const ip = callerKey(req) ?? "local";
    if (!allowAuthAttempt(`token:${ip}`, 20)) return Response.json({ error: "too-many-attempts" }, { status: 429 });
    const who = await identityFromToken(parsed.data.accessToken);
    if (!who) return Response.json({ error: "wrong-code" }, { status: 401 });
    email = who;
  } else {
    if (!parsed.data.email || !parsed.data.code) return Response.json({ error: "invalid-request" }, { status: 400 });
    email = parsed.data.email;
    if (!allowAuthAttempt(`verify:${email}`, 8)) return Response.json({ error: "too-many-attempts" }, { status: 429 });
    if (!(await verifyCode(email, parsed.data.code))) return Response.json({ error: "wrong-code" }, { status: 401 });
  }

  const existing = await dbFindMemberByEmail(email);
  let familyId: string;
  let memberId: string;
  let welcome: string | undefined;

  // "Start a family" by someone who already has one opens theirs: a second family is never made by
  // signing in again (Google remembers you, so the create form is easy to reach twice). Joining
  // another family (the other side of a marriage) is still a join with that family's invite code.
  const opensExisting = intent.type === "create" && Boolean(existing);
  if (intent.type === "signin" || opensExisting) {
    if (!existing) return Response.json({ error: "no-family" }, { status: 404 });
    // In several families? Open the one used last (never one still waiting for an admin, if another is open).
    const sides = await dbListSides(existing);
    const open = sides.filter((m) => m.status !== "pending");
    const pool = open.length ? open : [existing];
    const lastId = await lastUsedMember(pool.map((m) => m.id));
    const here = pool.find((m) => m.id === lastId) ?? pool[0];
    familyId = here.familyId;
    memberId = here.id;
  } else if (intent.type === "join" && existing) {
    // Already in one Nearer, joining another (my wife's family, say): the same
    // person gets a place on both sides, linked by personId.
    const invite = await dbFindInvite(intent.inviteCode);
    if (!invite) return Response.json({ error: "invalid-invite" }, { status: 403 });
    const sides = await dbListSides(existing);
    const there = sides.find((m) => m.familyId === invite.familyId) ?? (existing.familyId === invite.familyId ? existing : undefined);
    if (there) {
      familyId = there.familyId;
      memberId = there.id;
      welcome = await welcomeLine(familyId, there);
    } else {
      if (sides.length >= 4) return Response.json({ error: "too-many-sides" }, { status: 409 });
      const place = await claimable(intent.claimMemberId, invite.familyId);
      if (!place && (await familyFull(invite.familyId))) return Response.json({ error: "family-full" }, { status: 409 });
      const personId = existing.personId ?? `p-${crypto.randomUUID().slice(0, 16)}`;
      if (!existing.personId) await dbUpdateMemberProfile(existing.id, { personId });
      // Being active in your own first family doesn't open the second one:
      // you still wait there, unless its owner/admin made the code.
      const status = await joinStatus(invite, Boolean(place));
      const member = place
        ? ((await dbUpdateMemberProfile(place.id, { email, personId, tz: existing.tz, ...(existing.birthday && !place.birthday ? { birthday: existing.birthday } : {}), ...(existing.city && !place.city ? { city: existing.city } : {}) })) ?? place)
        : await dbAddMember({
        familyId: invite.familyId,
        firstName: intent.firstName,
        displayName: intent.callName || intent.firstName,
        role: existing.role === "child" ? "child" : "adult",
        lang: existing.lang,
        displayLang: existing.displayLang,
        tz: existing.tz,
        birthday: existing.birthday,
        city: existing.city,
        email,
        access: "member",
        status,
        personId,
      });
      familyId = invite.familyId;
      memberId = member.id;
      if (member.status !== "pending") welcome = await welcomeLine(familyId, member);
    }
  } else {
    if (existing) return Response.json({ error: "already-member" }, { status: 409 });
    let invite: Invite | undefined;
    if (intent.type === "create") {
      familyId = await dbCreateFamily(intent.familyName);
    } else {
      invite = await dbFindInvite(intent.inviteCode);
      if (!invite) return Response.json({ error: "invalid-invite" }, { status: 403 });
      familyId = invite.familyId;
    }
    const tz = validTz(parsed.data.tz);
    const place = intent.type === "join" ? await claimable(intent.claimMemberId, familyId) : undefined;
    if (invite && !place && (await familyFull(familyId))) return Response.json({ error: "family-full" }, { status: 409 });
    const status: Member["status"] = invite ? await joinStatus(invite, Boolean(place)) : "active";
    const member = place
      ? ((await dbUpdateMemberProfile(place.id, { email, tz, ...(parsed.data.birthday ? { birthday: parsed.data.birthday } : {}), ...(parsed.data.city ? { city: parsed.data.city } : {}) })) ?? place)
      : await dbAddMember({
          familyId,
          firstName: intent.firstName,
          displayName: intent.callName || intent.firstName,
          role: "adult",
          lang: "en",
          displayLang: "en",
          tz,
          city: parsed.data.city ?? "",
          birthday: parsed.data.birthday ?? "",
          email,
          // Whoever starts the family owns it; people who join are members
          // (and wait for an owner/admin unless one of them invited them).
          access: intent.type === "create" ? "owner" : "member",
          status,
        });
    memberId = member.id;
    if (intent.type === "join" && member.status !== "pending") welcome = await welcomeLine(familyId, member);
  }

  // A device holds one session: whatever this request carried (another person, the demo) is revoked first.
  const cookie = await issueSessionCookie(req, { familyId, memberId }).catch(() => null);
  if (!cookie) return Response.json({ error: "session-unavailable" }, { status: 500 });
  const nowStatus = (await dbGetMember(memberId))?.status ?? "active";
  return Response.json({ familyId, memberId, status: nowStatus, ...(welcome ? { welcome } : {}), ...(opensExisting ? { existing: true } : {}) }, { headers: { "set-cookie": cookie } });
}

export const POST = guardApi(postHandler);
