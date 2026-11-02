import { z } from "zod";
import { isDemoFamily, requireSession, sessionCookieHeader, sessionFromRequest, signSession } from "@/lib/auth";
import { dbLive } from "@/lib/family-db";
import { isSeedFamily } from "@/lib/family";
import { dbAddMember, dbCreateFamily, dbCreateInvite, dbGetFamilyName, dbListCards, dbLinkMembers, dbListMembers, dbListRelationships, dbListSides, dbListSidesNamed, dbUpdateMemberProfile } from "@/lib/db";
import { allowAuthAttempt } from "@/lib/otp";
import type { Member } from "@/lib/schemas";
import { isAdmin, isGrownUp } from "@/lib/permissions";
import { recordTeenConsent } from "@/lib/roles";
import { guardWrites } from "@/lib/api-guard";
import { memberFor } from "@/lib/request-memo";
import { cardsFor, familyNameFor, membersFor } from "@/lib/request-data";

// Two courtyards, one door. Each family keeps its own Nearer; a married couple
// and their children belong to both. Nothing crosses between homes: this
// route only lists the homes *you* are in and moves your session between them.
//
// GET  → your sides
// POST → switch {familyId} · create {familyName, bring[]} ("Add my family")

const id = z.string().min(1).max(80);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), familyId: id }),
  z.object({ action: z.literal("create"), familyName: z.string().trim().min(1).max(40), bring: z.array(id).max(8).default([]) }),
]);

const MAX_SIDES = 4;

const WEEK_MS = 7 * 86_400_000;

/**
 * Each family this person is in: its name, how many people, who started it
 * ("added by"), and how many things others shared there this week. Only
 * counts and a call name cross over — never the other family's tree.
 */
async function sidesOf(me: Member, req?: Request) {
  const since = Date.now() - WEEK_MS;
  // The other homes' names, people and this week's cards come with the sides query itself (one round trip).
  const rows = await dbListSidesNamed(me, { since: new Date(since).toISOString() });
  return Promise.all(
    rows.map(async ({ member: m, familyName, people: theirPeople, recent }) => {
      // Only this week's cards are counted, so the other homes are asked for just those.
      // The viewer's own Nearer is shared with the other courtyard slices when there is a request to share it on.
      const own = req && m.familyId === me.familyId;
      const [name, people, cards] = await Promise.all([
        own ? familyNameFor(req, m.familyId) : familyName !== null ? familyName : dbGetFamilyName(m.familyId),
        own ? membersFor(req, m.familyId) : theirPeople ? theirPeople.filter((p) => p.status !== "pending") : dbListMembers(m.familyId),
        own ? cardsFor(req, m.familyId) : recent ?? dbListCards(m.familyId, { since: new Date(since).toISOString() }),
      ]);
      const host = people.find((p) => p.access === "owner" && p.id !== m.id && p.email) ?? people.find((p) => isAdmin(p) && p.id !== m.id && p.email) ?? null;
      return {
        familyId: m.familyId,
        memberId: m.id,
        name: name.replace(/^the\s+/i, "").replace(/\s+family$/i, "") || "Family",
        people: people.length,
        addedBy: m.access === "owner" ? null : host ? host.displayName || host.firstName : null,
        fresh: cards.filter((c) => c.authorId && c.authorId !== m.id && Date.parse(c.takenAt) > since && Date.parse(c.takenAt) <= Date.now()).length,
      };
    }),
  );
}

function newPersonId(): string {
  return `p-${crypto.randomUUID().slice(0, 16)}`;
}

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const me = await memberFor(req, auth.memberId);
  if (!me || me.familyId !== auth.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });
  return Response.json({ current: auth.familyId, sides: await sidesOf(me, req) });
}

async function postHandler(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const claimed = sessionFromRequest(req);
  // A switch reads the target home's people in the same wave as the session check (one round trip, not three).
  const targetPeople = claimed && parsed.success && parsed.data.action === "switch" && !(dbLive() && isSeedFamily(parsed.data.familyId)) ? dbListMembers(parsed.data.familyId, { includePending: true }) : null;
  targetPeople?.catch(() => undefined);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!parsed.success) return Response.json({ error: "invalid-sides" }, { status: 400 });
  const body = parsed.data;
  const me = await memberFor(req, auth.memberId);
  if (!me || me.familyId !== auth.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });

  if (body.action === "switch") {
    // Only to a home where this same person already has a place: their own row there (same person id).
    const target = body.familyId === me.familyId ? me : me.personId && targetPeople ? (await targetPeople).find((m) => m.personId === me.personId) : undefined;
    if (!target) return Response.json({ error: "not-your-family" }, { status: 403 });
    const signed = signSession({ familyId: target.familyId, memberId: target.id });
    if (!signed) return Response.json({ error: "session-unavailable" }, { status: 500 });
    return Response.json({ familyId: target.familyId, memberId: target.id }, { headers: { "set-cookie": sessionCookieHeader(signed) } });
  }

  // "Add my family": a new Nearer for my parents' side, with my home inside it.
  // Never from a shared demo family: everyone who opens the demo is the same
  // person there, so a side made from it would be open to every visitor.
  if (isDemoFamily(auth.familyId)) return Response.json({ error: "not-in-demo" }, { status: 403 });
  if (!isGrownUp(me) || me.role === "child") return Response.json({ error: "grown-ups-only" }, { status: 403 });
  if (!allowAuthAttempt(`side-create:${me.id}`, 3, 24 * 3_600_000)) return Response.json({ error: "too-many" }, { status: 429 });
  if ((await dbListSides(me)).length >= MAX_SIDES) return Response.json({ error: "too-many-sides" }, { status: 409 });

  // Only my own home comes with me: my spouse and my children, by the family's own tree.
  const rels = await dbListRelationships(auth.familyId);
  const members = await dbListMembers(auth.familyId);
  const mine = new Set<string>();
  for (const r of rels) {
    const other = r.memberId === me.id ? r.relationMemberId : r.relationMemberId === me.id ? r.memberId : null;
    if (!other) continue;
    const kind = r.memberId === me.id ? r.canonicalKind : r.canonicalKind === "parent" ? "child" : r.canonicalKind === "child" ? "parent" : r.canonicalKind;
    if (kind === "spouse" || kind === "child") mine.add(other);
  }
  if (!body.bring.every((b) => mine.has(b))) return Response.json({ error: "only-your-home" }, { status: 400 });

  const familyId = await dbCreateFamily(body.familyName);
  const copy = async (m: Member, access: Member["access"]): Promise<Member> => {
    let personId = m.personId;
    if (!personId) {
      personId = newPersonId();
      await dbUpdateMemberProfile(m.id, { personId });
    }
    return dbAddMember({
      familyId,
      firstName: m.firstName,
      displayName: m.displayName,
      role: m.role,
      lang: m.lang,
      displayLang: m.displayLang,
      tz: m.tz,
      birthday: m.birthday,
      photoRef: m.photoRef,
      // Only my own email travels with me: it's how I sign in to both sides.
      email: m.id === me.id ? m.email : null,
      access,
      personId,
    });
  };
  // Whoever starts the family owns it.
  const self = await copy(me, "owner");
  const brought = new Map<string, Member>();
  for (const b of body.bring) {
    const src = members.find((m) => m.id === b);
    if (!src) continue;
    const access: Member["access"] = src.access === "child" || src.access === "teen" ? src.access : "member";
    const row = await copy(src, access);
    // A teen comes with their parent's say-so (only my spouse and children come).
    if (access === "teen") await recordTeenConsent(familyId, row.id, self.id);
    brought.set(src.id, row);
  }
  // Rebuild the relationships inside my home, nothing else.
  for (const [srcId, row] of Array.from(brought)) {
    const r = rels.find((x) => (x.memberId === me.id && x.relationMemberId === srcId) || (x.relationMemberId === me.id && x.memberId === srcId));
    if (!r) continue;
    const asMine = r.memberId === me.id;
    await dbLinkMembers({ familyId, memberId: asMine ? self.id : row.id, relationMemberId: asMine ? row.id : self.id, relation: r.relation });
  }
  const invite = await dbCreateInvite(familyId, self.id);
  const signed = signSession({ familyId, memberId: self.id });
  if (!signed) return Response.json({ error: "session-unavailable" }, { status: 500 });
  return Response.json({ familyId, memberId: self.id, invite }, { headers: { "set-cookie": sessionCookieHeader(signed) } });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
