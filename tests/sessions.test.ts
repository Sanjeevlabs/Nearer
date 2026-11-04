// Server-side sessions: issue, verify, revoke, renew; and the sign-in combinations that depend on them.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as verifyAuth } from "@/app/api/auth/verify/route";
import { GET as getMembers } from "@/app/api/members/route";
import { DELETE as signOut, GET as whoami } from "@/app/api/session/route";
import { POST as sidesPost } from "@/app/api/sides/route";
import { POST as switchPerson } from "@/app/api/session/switch/route";
import { POST as exchange } from "@/app/api/session/route";
import { SESSION_COOKIE, clearSessionCookieHeader, sessionCookieHeader, verifySession } from "@/lib/auth";
import { dbAddMember, dbRemoveMember } from "@/lib/db";
import { clearAuthAttempts, MOCK_OTP } from "@/lib/otp";
import { memoryInsert, newSid, purgeSessions, renewSessionRow, resetSessionStore, revokeSid, sessionActive } from "@/lib/sessions";
import { resetDemo } from "@/lib/store";
import { signedSession } from "./auth-helper";

let seq = 0;
const email = () => `s${++seq}-${Date.now()}@example.com`;
const post = (url: string, body: unknown, cookie?: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const sidOf = (cookie: string) => verifySession(decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)))!.sid;
const members = (cookie: string) => getMembers(new Request("http://test/api/members", { headers: { cookie } }));
const me = (cookie: string) => whoami(new Request("http://test/api/session", { headers: { cookie } }));

function verify(addr: string, intent: unknown, cookie?: string) {
  return verifyAuth(post("http://test/api/auth/verify", { email: addr, code: MOCK_OTP, tz: "Asia/Kolkata", birthday: "03-14", intent }, cookie));
}
const create = (addr: string, cookie?: string) => verify(addr, { type: "create", familyName: "The Rao", firstName: "Asha", callName: "Asha" }, cookie);
const signin = (addr: string, cookie?: string) => verify(addr, { type: "signin" }, cookie);
const del = (cookie: string, q = "") => signOut(new Request(`http://test/api/session${q}`, { method: "DELETE", headers: { cookie } }));

beforeEach(() => {
  resetDemo();
  resetSessionStore();
  clearAuthAttempts();
});

describe("session rows", () => {
  it("a session is live until revoked, and a copied cookie dies with it", async () => {
    const res = await create(email());
    const cookie = cookieOf(res);
    expect((await members(cookie)).status).toBe(200);
    const out = await del(cookie);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await members(cookie)).status).toBe(401); // same cookie value, replayed
    expect((await me(cookie)).status).toBe(401);
  });

  it("two tabs: signing out in one signs the other out on its next request", async () => {
    const cookie = cookieOf(await create(email()));
    await del(cookie);
    expect((await members(cookie)).status).toBe(401);
  });

  it("a cookie without a session id is signed out", () => {
    expect(verifySession("e30.deadbeef")).toBeNull();
  });

  it("an expired row is signed out", async () => {
    const { signed } = signedSession("dadi", "demo-family", -1000);
    expect(verifySession(signed, "test-session-secret")).toBeNull();
    const { sid } = signedSession("dadi", "demo-family", 5);
    expect(await sessionActive(sid, Date.now() + 60_000)).toBe(false);
  });

  it("renewal moves the expiry but never revives a revoked session or creates one", async () => {
    const { sid } = signedSession("dadi", "demo-family", 1000);
    await renewSessionRow(sid, Date.now() + 10 * 86_400_000);
    expect(await sessionActive(sid, Date.now() + 5 * 86_400_000)).toBe(true);
    await revokeSid(sid);
    await renewSessionRow(sid, Date.now() + 10 * 86_400_000);
    expect(await sessionActive(sid)).toBe(false);
    await renewSessionRow("never-existed-0123456789", Date.now() + 1000);
    expect(await sessionActive("never-existed-0123456789")).toBe(false);
  });

  it("the clearing cookie matches the set cookie's attributes", () => {
    const attrs = (h: string) => h.split("; ").slice(1).filter((a) => !a.startsWith("Max-Age")).sort();
    expect(attrs(clearSessionCookieHeader())).toEqual(attrs(sessionCookieHeader("x")));
  });
});

describe("one live session per device, and per sign-out", () => {
  it("signing in as B while A's cookie is present revokes A", async () => {
    const a = cookieOf(await create(email()));
    const b = cookieOf(await create(email(), a));
    expect((await members(a)).status).toBe(401);
    expect((await members(b)).status).toBe(200);
  });

  it("the demo session is revoked when a real sign-in follows", async () => {
    const demo = await exchange(post("http://test/api/session", { inviteCode: "NEARER-DEMO", memberId: "arjun" }));
    const dcookie = cookieOf(demo);
    expect((await members(dcookie)).status).toBe(200);
    const real = cookieOf(await create(email(), dcookie));
    expect((await members(dcookie)).status).toBe(401);
    expect((await members(real)).status).toBe(200);
  });

  it("the demo persona switch replaces the old session", async () => {
    const first = cookieOf(await exchange(post("http://test/api/session", { inviteCode: "NEARER-DEMO", memberId: "arjun" })));
    const sw = await switchPerson(post("http://test/api/session/switch", { memberId: "dadi" }, first));
    expect(sw.status).toBe(200);
    expect((await members(first)).status).toBe(401);
    expect((await members(cookieOf(sw))).status).toBe(200);
  });

  it("sign out of all devices ends every session of the person, across their families", async () => {
    const addr = email();
    const phone = cookieOf(await create(addr));
    const laptop = cookieOf(await signin(addr));
    // the laptop's sign-in did not carry the phone cookie, so both are live
    expect(sidOf(phone)).not.toBe(sidOf(laptop));
    expect((await members(phone)).status).toBe(200);
    const out = await del(laptop, "?all=1");
    expect(out.status).toBe(200);
    expect((await members(phone)).status).toBe(401);
    expect((await members(laptop)).status).toBe(401);
  });

  it("a child's profile can't sign anyone out of anything", async () => {
    const cookie = cookieOf(await create(email()));
    const mine = (await (await members(cookie)).json()) as { members: { id: string; familyId: string }[] };
    const kid = await dbAddMember({ familyId: mine.members[0].familyId, firstName: "Kiki", displayName: "Kiki", role: "child", lang: "en", displayLang: "en", tz: "UTC", birthday: "", city: "", email: "kid@example.com", access: "member", status: "active" });
    const { signed } = signedSession(kid.id, kid.familyId);
    const kidCookie = `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
    expect((await del(kidCookie, "?all=1")).status).toBe(403);
    expect((await members(cookie)).status).toBe(200);
  });

  it("someone removed from the family loses their cookie at once", async () => {
    const owner = cookieOf(await create(email()));
    const joinerAddr = email();
    const inviteRes = await (await import("@/app/api/invites/route")).POST(post("http://test/api/invites", {}, owner));
    const code = ((await inviteRes.json()) as { invite: { code: string } }).invite.code;
    const joined = await verify(joinerAddr, { type: "join", inviteCode: code, firstName: "Meera" });
    const jc = cookieOf(joined);
    const jid = ((await joined.json()) as { memberId: string }).memberId;
    expect((await me(jc)).status).toBe(200);
    await dbRemoveMember(jid);
    expect((await me(jc)).status).toBe(401);
    expect(await sessionActive(sidOf(jc))).toBe(false);
  });
});

describe("identity to person", () => {
  it("the same email in any case is the same person: no duplicate member", async () => {
    const a = await create("Mixed.Case@Example.com");
    const { memberId } = (await a.json()) as { memberId: string };
    const b = await signin("mixed.case@EXAMPLE.com");
    expect(b.status).toBe(200);
    expect(((await b.json()) as { memberId: string }).memberId).toBe(memberId);
    const again = await create("MIXED.CASE@example.com");
    // "Start a family" again opens the one they have: never a second account or a second family
    const body = (await again.json()) as { familyId: string; memberId: string; existing?: boolean };
    expect(body.memberId).toBe(memberId);
    expect(body.existing).toBe(true);
  });

  it("with two sides, sign-in lands on the one used last, and a switch moves 'last' with it", async () => {
    const addr = email();
    const first = await create(addr);
    const f1 = (await first.json()) as { familyId: string; memberId: string };
    // The second side: someone else's family, joined with its invite code.
    const host = await create(email());
    const inviteRes = await (await import("@/app/api/invites/route")).POST(post("http://test/api/invites", {}, cookieOf(host)));
    const code = ((await inviteRes.json()) as { invite: { code: string } }).invite.code;
    const second = await verify(addr, { type: "join", inviteCode: code, firstName: "Asha" });
    const f2 = (await second.json()) as { familyId: string; memberId: string };
    expect(f2.familyId).not.toBe(f1.familyId);
    expect(((await (await signin(addr)).json()) as { familyId: string }).familyId).toBe(f2.familyId);
    const sw = await sidesPost(post("http://test/api/sides", { action: "switch", familyId: f1.familyId }, cookieOf(second)));
    expect(sw.status).toBe(200);
    expect(((await (await signin(addr)).json()) as { familyId: string }).familyId).toBe(f1.familyId);
  });

  it("joining a family you're already in opens it; it adds no second place", async () => {
    const addr = email();
    const owner = await create(addr);
    const { familyId } = (await owner.json()) as { familyId: string };
    const inviteRes = await (await import("@/app/api/invites/route")).POST(post("http://test/api/invites", {}, cookieOf(owner)));
    const code = ((await inviteRes.json()) as { invite: { code: string } }).invite.code;
    const again = await verify(addr, { type: "join", inviteCode: code, firstName: "Asha" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { familyId: string }).familyId).toBe(familyId);
    const list = (await (await members(cookieOf(again))).json()) as { members: unknown[] };
    expect(list.members).toHaveLength(1);
  });

  it("a code that doesn't exist (expired, revoked) is refused for someone who already has an account", async () => {
    const addr = email();
    await create(addr);
    const res = await verify(addr, { type: "join", inviteCode: "GONE-1234", firstName: "Asha" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("invalid-invite");
  });

  it("signing in with no account says no-family (the app keeps the sign-in and shows the chooser)", async () => {
    const res = await signin(email());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("no-family");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("in-app join another family (existing account)", () => {
  it("an account with a family joins a second with a code: same person on both sides, then 'last used' is the new one", async () => {
    const addr = email();
    const mine = await create(addr);
    const first = (await mine.json()) as { familyId: string; memberId: string };
    const owner = await create(email());
    const inviteRes = await (await import("@/app/api/invites/route")).POST(post("http://test/api/invites", {}, cookieOf(owner)));
    const code = ((await inviteRes.json()) as { invite: { code: string } }).invite.code;
    const joined = await verify(addr, { type: "join", inviteCode: code, firstName: "Asha" }, cookieOf(mine));
    expect(joined.status).toBe(200);
    const j = (await joined.json()) as { familyId: string; memberId: string };
    expect(j.familyId).not.toBe(first.familyId);
    expect(j.memberId).not.toBe(first.memberId);
    // the old cookie was on the request, so it is revoked; the new one is live
    expect((await members(cookieOf(mine))).status).toBe(401);
    expect((await members(cookieOf(joined))).status).toBe(200);
  });

  it("a code for a family that doesn't exist is refused and changes nothing", async () => {
    const addr = email();
    const mine = await create(addr);
    const res = await verify(addr, { type: "join", inviteCode: "NOPE-9999", firstName: "Asha" }, cookieOf(mine));
    expect(res.status).toBe(403);
    expect((await members(cookieOf(mine))).status).toBe(200);
  });
});

describe("session clean-up", () => {
  const DAY = 86_400_000;
  const row = (over: Partial<{ expiresAt: number; revokedAt: number | null }>) => {
    const id = newSid();
    const now = Date.now();
    memoryInsert({ id, memberId: "m", familyId: "f", createdAt: now - 30 * DAY, expiresAt: now + DAY, revokedAt: null, kind: "demo", ...over });
    return id;
  };
  it("drops sessions a week past expiry or revocation, keeps live and recent ones", async () => {
    const now = Date.now();
    const oldExpired = row({ expiresAt: now - 8 * DAY });
    const oldRevoked = row({ revokedAt: now - 8 * DAY });
    const recentRevoked = row({ revokedAt: now - 2 * DAY });
    const live = row({});
    expect(await purgeSessions(now)).toBe(2);
    expect(await sessionActive(live)).toBe(true);
    expect(await sessionActive(oldExpired)).toBe(false);
    expect(await sessionActive(oldRevoked)).toBe(false);
    await revokeSid(recentRevoked); // still there: a second purge finds nothing more
    expect(await purgeSessions(now)).toBe(0);
  });
});
