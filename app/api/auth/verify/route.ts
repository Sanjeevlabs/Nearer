import { z } from "zod";
import { issueSessionCookie } from "@/lib/auth";
import { lastUsedMember } from "@/lib/sessions";
import { dbAddMember, dbCreateFamily, dbFindMemberByEmail, dbGetMember, dbListSides } from "@/lib/db";
import { joinAsExisting, joinAsNew, validInvite } from "@/lib/join";
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
    z.object({ type: z.literal("join"), inviteCode: z.string().trim().min(4).max(64), firstName: Name.optional(), callName: Name.optional(), claimMemberId: z.string().min(1).max(80).optional() }),
  ]),
});

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
    // Say why the family name they just typed didn't make a new one.
    if (opensExisting) welcome = "You already have a family on Nearer, so we opened it.";
  } else if (intent.type === "join") {
    // A valid family link lets you straight in (lib/join.ts). Already in one Nearer, joining another
    // (my wife's family, say): the same person gets a place on both sides. Already in that one: it opens.
    const invite = await validInvite(intent.inviteCode);
    if (!invite) return Response.json({ error: "invalid-invite" }, { status: 403 });
    const ask = { email, invite, firstName: intent.firstName, callName: intent.callName, claimMemberId: intent.claimMemberId };
    const out = existing ? await joinAsExisting(existing, ask) : await joinAsNew({ ...ask, tz: validTz(parsed.data.tz), birthday: parsed.data.birthday, city: parsed.data.city });
    if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
    familyId = out.familyId;
    memberId = out.memberId;
    welcome = out.welcome;
  } else {
    // A new family: whoever starts it owns it.
    familyId = await dbCreateFamily(intent.familyName);
    const member = await dbAddMember({
      familyId,
      firstName: intent.firstName,
      displayName: intent.callName || intent.firstName,
      role: "adult",
      lang: "en",
      displayLang: "en",
      tz: validTz(parsed.data.tz),
      city: parsed.data.city ?? "",
      birthday: parsed.data.birthday ?? "",
      email,
      access: "owner",
      status: "active",
    });
    memberId = member.id;
  }

  // A device holds one session: whatever this request carried (another person, the demo) is revoked first.
  const cookie = await issueSessionCookie(req, { familyId, memberId }).catch(() => null);
  if (!cookie) return Response.json({ error: "session-unavailable" }, { status: 500 });
  const nowStatus = (await dbGetMember(memberId))?.status ?? "active";
  return Response.json({ familyId, memberId, status: nowStatus, ...(welcome ? { welcome } : {}), ...(opensExisting ? { existing: true } : {}) }, { headers: { "set-cookie": cookie } });
}

export const POST = guardApi(postHandler);
