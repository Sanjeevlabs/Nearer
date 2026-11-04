// Joining a family with its link (/join/<CODE>), shared by sign-in (/api/auth/verify) and by someone
// already signed in to another family (/api/invites/accept). A valid link lets you straight in: no
// waiting for an admin. Valid means unexpired (7 days), not revoked, and made by someone who is still
// an active member of that family. The tradeoff: a leaked link lets a stranger in until it expires or
// is revoked; owners and admins can remove anyone (DELETE /api/members/[id]).
import { dbAddMember, dbFindInvite, dbGetMember, dbListMembers, dbListSides, dbUpdateMemberProfile, type Invite } from "./db";
import { MAX_SIDES, isClaimable } from "./permissions";
import { familyFull, hostOf } from "./roles";
import { inBackground } from "./push/background";
import { pushFamilyJoined } from "./push/events";
import type { Member } from "./schemas";


export { MAX_SIDES };

/** The invite behind a link, if it still opens the family. */
export async function validInvite(code: string): Promise<Invite | undefined> {
  const invite = await dbFindInvite(code);
  if (!invite) return undefined;
  if (!invite.createdBy) return invite;
  const by = await dbGetMember(invite.createdBy);
  return by && by.familyId === invite.familyId && by.status !== "pending" ? invite : undefined;
}

/** A place the family made for someone who hasn't joined yet (no account, not a child, not an admin). */
export async function claimable(memberId: string | undefined, familyId: string): Promise<Member | undefined> {
  if (!memberId) return undefined;
  const m = await dbGetMember(memberId);
  return m && m.familyId === familyId && isClaimable(m) ? m : undefined;
}

/** "Welcome, Maa. Arjun's window is open." — shown once on the joiner's window. */
export async function welcomeLine(familyId: string, me: Member): Promise<string> {
  const others = (await dbListMembers(familyId)).filter((m) => m.id !== me.id && m.email);
  const host = hostOf(others) ?? others[0];
  const you = me.displayName || me.firstName;
  return host ? `Welcome, ${you}. ${host.firstName}'s window is open.` : `Welcome, ${you}. Your window is open.`;
}

export type JoinOutcome = { ok: true; familyId: string; memberId: string; welcome: string; already?: boolean } | { ok: false; error: string; status: number };

export interface JoinAsk {
  email: string;
  invite: Invite;
  firstName?: string;
  callName?: string;
  claimMemberId?: string;
  tz: string;
  birthday?: string;
  city?: string;
}

/**
 * Someone with no family yet joins: they take the place made for them ("I'm Maa") or get a new one.
 * Always active.
 */
export async function joinAsNew(ask: JoinAsk): Promise<JoinOutcome> {
  const familyId = ask.invite.familyId;
  const place = await claimable(ask.claimMemberId, familyId);
  if (!place && (await familyFull(familyId))) return { ok: false, error: "family-full", status: 409 };
  if (!place && !ask.firstName) return { ok: false, error: "invalid-request", status: 400 };
  const member = place
    ? ((await dbUpdateMemberProfile(place.id, { email: ask.email, tz: ask.tz, ...(ask.birthday ? { birthday: ask.birthday } : {}), ...(ask.city ? { city: ask.city } : {}) })) ?? place)
    : await dbAddMember({
        familyId,
        firstName: ask.firstName!,
        displayName: ask.callName || ask.firstName!,
        role: "adult",
        lang: "en",
        displayLang: "en",
        tz: ask.tz,
        city: ask.city ?? "",
        birthday: ask.birthday ?? "",
        email: ask.email,
        access: "member",
        status: "active",
      });
  inBackground(() => pushFamilyJoined(familyId, member.id));
  return { ok: true, familyId, memberId: member.id, welcome: await welcomeLine(familyId, member) };
}

/**
 * Already in one Nearer, joining another (my wife's family, say): the same person gets a place on both
 * sides, linked by personId. Already in that family: it just opens.
 */
export async function joinAsExisting(existing: Member, ask: Omit<JoinAsk, "tz" | "birthday" | "city">): Promise<JoinOutcome> {
  const { invite } = ask;
  const sides = await dbListSides(existing);
  const there = sides.find((m) => m.familyId === invite.familyId) ?? (existing.familyId === invite.familyId ? existing : undefined);
  if (there) return { ok: true, familyId: there.familyId, memberId: there.id, welcome: await welcomeLine(there.familyId, there), already: true };
  if (sides.length >= MAX_SIDES) return { ok: false, error: "too-many-sides", status: 409 };
  const place = await claimable(ask.claimMemberId, invite.familyId);
  if (!place && (await familyFull(invite.familyId))) return { ok: false, error: "family-full", status: 409 };
  const personId = existing.personId ?? `p-${crypto.randomUUID().slice(0, 16)}`;
  if (!existing.personId) await dbUpdateMemberProfile(existing.id, { personId });
  const name = ask.firstName || existing.firstName;
  const member = place
    ? ((await dbUpdateMemberProfile(place.id, { email: ask.email, personId, tz: existing.tz, ...(existing.birthday && !place.birthday ? { birthday: existing.birthday } : {}), ...(existing.city && !place.city ? { city: existing.city } : {}) })) ?? place)
    : await dbAddMember({
        familyId: invite.familyId,
        firstName: name,
        displayName: ask.callName || (ask.firstName ? ask.firstName : existing.displayName || name),
        role: existing.role === "child" ? "child" : "adult",
        lang: existing.lang,
        displayLang: existing.displayLang,
        tz: existing.tz,
        birthday: existing.birthday,
        city: existing.city,
        email: ask.email,
        access: "member",
        status: "active",
        personId,
      });
  inBackground(() => pushFamilyJoined(invite.familyId, member.id));
  return { ok: true, familyId: invite.familyId, memberId: member.id, welcome: await welcomeLine(invite.familyId, member) };
}
