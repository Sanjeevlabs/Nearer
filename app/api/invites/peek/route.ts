import { isDemoFamily, requireSession } from "@/lib/auth";
import { dbFindInvite, dbGetFamilyName, dbListMembers, dbListSides } from "@/lib/db";
import { MAX_SIDES, validInvite } from "@/lib/join";
import { allowAuthAttempt, callerKey } from "@/lib/otp";
import { isClaimable } from "@/lib/permissions";
import { familyFull, hostOf } from "@/lib/roles";
import { memberFor } from "@/lib/request-memo";
import type { Member } from "@/lib/schemas";
import { guardApi } from "@/lib/api-guard";

// Before joining: what does this link open? The family's name, who invited you, the places already
// made for people who haven't joined ("I'm Maa"), and whether it is full. Only call names; never
// emails, cities or anything else. A dead link (expired, revoked, unknown) answers 404 with the
// host's first name when the code is only expired, so the page can say whom to ask.
// Signed in to Nearer already (not the demo)? `you` says who, and whether that person is already in
// this family, so the page can open it, or ask "Join this one too?". Rate-limited per address so
// codes can't be guessed through it.

const short = (name: string) => name.replace(/^the\s+/i, "").replace(/\s+family$/i, "") || "Family";
const hostName = (members: Member[]) => (hostOf(members.filter((m) => m.email)) ?? members.find((m) => m.email))?.firstName ?? null;

async function you(req: Request, familyId: string) {
  if (!req.headers.get("cookie")) return null;
  const auth = await requireSession(req).catch(() => null);
  if (!auth || auth instanceof Response || isDemoFamily(auth.familyId)) return null;
  const me = await memberFor(req, auth.memberId);
  if (!me) return null;
  const [sides, current] = await Promise.all([dbListSides(me).catch(() => [me]), dbGetFamilyName(auth.familyId)]);
  const there = sides.find((m) => m.familyId === familyId);
  return {
    name: me.displayName || me.firstName,
    email: me.email && !me.email.startsWith("tel:") ? me.email : null,
    current: short(current),
    inFamily: Boolean(there),
    ...(there ? { familyId } : {}),
    sides: Math.max(1, sides.length),
    maxSides: MAX_SIDES,
    // A profile a parent made (no own sign-in) can't join another family by itself.
    canJoin: Boolean(me.email),
  };
}

async function getHandler(req: Request): Promise<Response> {
  const ip = callerKey(req) ?? "local";
  if (!allowAuthAttempt(`peek:${ip}`, 20)) return Response.json({ error: "too-many-attempts" }, { status: 429 });
  const code = (new URL(req.url).searchParams.get("code") ?? "").trim().toUpperCase();
  if (code.length < 4 || code.length > 64) return Response.json({ error: "invalid-invite" }, { status: 400 });
  const invite = await validInvite(code);
  if (!invite) {
    const old = await dbFindInvite(code, { expired: true });
    if (!old) return Response.json({ error: "invalid-invite", host: null }, { status: 404 });
    const [members, name] = await Promise.all([dbListMembers(old.familyId), dbGetFamilyName(old.familyId)]);
    return Response.json({ error: "invalid-invite", host: hostName(members), family: short(name) }, { status: 404 });
  }
  const [members, name, full, who] = await Promise.all([dbListMembers(invite.familyId), dbGetFamilyName(invite.familyId), familyFull(invite.familyId), you(req, invite.familyId)]);
  const places = members.filter(isClaimable).map((m) => ({ id: m.id, callName: m.displayName || m.firstName }));
  return Response.json({ family: short(name), host: hostName(members), places, full, ...(who ? { you: who } : {}) });
}

export const GET = guardApi(getHandler);
