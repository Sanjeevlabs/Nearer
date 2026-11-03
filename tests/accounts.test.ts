import { beforeEach, describe, expect, it } from "vitest";
import { POST as startAuth } from "@/app/api/auth/start/route";
import { POST as verifyAuth } from "@/app/api/auth/verify/route";
import { GET as getCards } from "@/app/api/cards/route";
import { GET as getMembers } from "@/app/api/members/route";
import { GET as getRelationships } from "@/app/api/relationships/route";
import { POST as createInvite } from "@/app/api/invites/route";
import { PATCH as patchProfile } from "@/app/api/members/profile/route";
import { clearAuthAttempts, MOCK_OTP } from "@/lib/otp";
import { ritualRunId } from "@/lib/rituals";
import { resetDemo } from "@/lib/store";
import { authedGet } from "./auth-helper";

let seq = 0;
const email = () => `person${++seq}-${Date.now()}@example.com`;

function post(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
function get(url: string, cookie: string): Request {
  return new Request(url, { headers: { cookie } });
}
function cookieOf(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function createFamily(addr: string) {
  const res = await verifyAuth(
    post("http://test/api/auth/verify", { email: addr, code: MOCK_OTP, tz: "Asia/Kolkata", birthday: "03-14", intent: { type: "create", familyName: "The Mehtas", firstName: "Sanjeev", callName: "Papa" } }),
  );
  return { res, cookie: cookieOf(res), body: (await res.json()) as { familyId: string; memberId: string } };
}

describe("accounts: email code sign-up and sign-in", () => {
  beforeEach(() => {
    resetDemo();
    clearAuthAttempts();
  });

  it("start accepts a valid email (mock sends nothing) and rejects a bad one", async () => {
    expect((await startAuth(post("http://test/api/auth/start", { email: email() }))).status).toBe(200);
    expect((await startAuth(post("http://test/api/auth/start", { email: "not-an-email" }))).status).toBe(400);
  });

  it("starting a family again with the same email opens the first one instead of making a second", async () => {
    const addr = email();
    const first = await createFamily(addr);
    expect(first.res.status).toBe(200);
    clearAuthAttempts();
    const again = await verifyAuth(
      post("http://test/api/auth/verify", { email: addr.toUpperCase(), code: MOCK_OTP, intent: { type: "create", familyName: "Singh", firstName: "Sanjeev" } }),
    );
    expect(again.status).toBe(200);
    const body = (await again.json()) as { familyId: string; memberId: string; existing?: boolean };
    expect(body).toMatchObject({ familyId: first.body.familyId, memberId: first.body.memberId, existing: true });
  });

  it("a wrong code never creates anything", async () => {
    const res = await verifyAuth(post("http://test/api/auth/verify", { email: email(), code: "123456", intent: { type: "create", familyName: "X", firstName: "Y" } }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("create makes a new family whose first member is the signer, with a session", async () => {
    const { res, cookie, body } = await createFamily(email());
    expect(res.status).toBe(200);
    expect(body.familyId).not.toBe("demo-family");
    expect(cookie).toContain("aangan_session=");
    const members = (await (await getMembers(get("http://test/api/members", cookie))).json()) as { members: { id: string; displayName: string; tz: string; birthday: string }[] };
    expect(members.members).toHaveLength(1);
    expect(members.members[0]).toMatchObject({ id: body.memberId, displayName: "Papa", tz: "Asia/Kolkata", birthday: "03-14" });
  });

  it("signing in again finds the same member; an unknown email gets no-family", async () => {
    const addr = email();
    const created = await createFamily(addr);
    const again = await verifyAuth(post("http://test/api/auth/verify", { email: addr.toUpperCase(), code: MOCK_OTP, intent: { type: "signin" } }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { memberId: string }).memberId).toBe(created.body.memberId);
    const nobody = await verifyAuth(post("http://test/api/auth/verify", { email: email(), code: MOCK_OTP, intent: { type: "signin" } }));
    expect(nobody.status).toBe(404);
  });

  it("another side (up to four) comes only by joining with that family's invite code", async () => {
    const addr = email();
    const first = await createFamily(addr);
    const sides = [first.body.familyId];
    const joinOther = async () => {
      const other = await createFamily(email());
      const inv = (await (await createInvite(post("http://test/api/invites", {}, other.cookie))).json()) as { invite: { code: string } };
      return verifyAuth(post("http://test/api/auth/verify", { email: addr, code: MOCK_OTP, intent: { type: "join", inviteCode: inv.invite.code, firstName: "Sanjeev" } }));
    };
    for (let i = 0; i < 3; i++) {
      clearAuthAttempts();
      const joined = await joinOther();
      expect(joined.status).toBe(200);
      sides.push(((await joined.json()) as { familyId: string }).familyId);
    }
    expect(new Set(sides).size).toBe(4);
    clearAuthAttempts();
    expect((await joinOther()).status).toBe(409);
  });

  it("join with a live invite adds the person to that family only", async () => {
    const owner = await createFamily(email());
    const inv = (await (await createInvite(post("http://test/api/invites", {}, owner.cookie))).json()) as { invite: { code: string } };
    const joined = await verifyAuth(post("http://test/api/auth/verify", { email: email(), code: MOCK_OTP, birthday: "07-01", intent: { type: "join", inviteCode: inv.invite.code.toLowerCase(), firstName: "Meera", callName: "Maa" } }));
    expect(joined.status).toBe(200);
    expect(((await joined.json()) as { familyId: string }).familyId).toBe(owner.body.familyId);
    const members = (await (await getMembers(get("http://test/api/members", owner.cookie))).json()) as { members: { displayName: string }[] };
    expect(members.members.map((m) => m.displayName).sort()).toEqual(["Maa", "Papa"]);
  });

  it("a bad invite code is refused", async () => {
    const res = await verifyAuth(post("http://test/api/auth/verify", { email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: "NOPE-123", firstName: "Z" } }));
    expect(res.status).toBe(403);
  });

  it("repeated wrong codes are rate limited", async () => {
    const addr = email();
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await verifyAuth(post("http://test/api/auth/verify", { email: addr, code: "111111", intent: { type: "signin" } }))).status;
    expect(last).toBe(429);
  });
});

describe("tenancy: a new family never sees another family's data", () => {
  beforeEach(() => {
    resetDemo();
    clearAuthAttempts();
  });

  it("cards, members and relationships are scoped to the session family", async () => {
    const { cookie } = await createFamily(email());
    const cards = (await (await getCards(get("http://test/api/cards", cookie))).json()) as { cards: unknown[]; familyId: string };
    expect(cards.cards).toHaveLength(0);
    const members = (await (await getMembers(get("http://test/api/members", cookie))).json()) as { members: { familyId: string }[] };
    expect(members.members.every((m) => m.familyId !== "demo-family")).toBe(true);
    const rels = (await (await getRelationships(get("http://test/api/relationships", cookie))).json()) as { relationships: unknown[] };
    expect(rels.relationships).toHaveLength(0);
  });

  it("the demo family still sees its own data", async () => {
    const cards = (await (await getCards(authedGet("http://test/api/cards"))).json()) as { cards: unknown[] };
    expect(cards.cards.length).toBeGreaterThan(0);
  });

  it("profile edits apply only to the session member", async () => {
    const { cookie, body } = await createFamily(email());
    const res = await patchProfile(new Request("http://test/api/members/profile", { method: "PATCH", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ tz: "Europe/London", firstName: "S" }) }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { member: { id: string; tz: string } }).member).toMatchObject({ id: body.memberId, tz: "Europe/London" });
    const bad = await patchProfile(new Request("http://test/api/members/profile", { method: "PATCH", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ tz: "Mars/Olympus" }) }));
    expect(bad.status).toBe(400);
  });

  it("ritual run ids are family-scoped (demo keeps its short form)", () => {
    expect(ritualRunId("demo-family", "birthday", "2026-11-09")).toBe("birthday:2026-11-09");
    expect(ritualRunId("fam-1", "birthday", "2026-11-09")).toBe("fam-1:birthday:2026-11-09");
  });
});
