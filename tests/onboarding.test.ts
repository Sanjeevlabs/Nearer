import { beforeEach, describe, expect, it } from "vitest";
import { POST as verifyAuth } from "@/app/api/auth/verify/route";
import { GET as peekInvite } from "@/app/api/invites/peek/route";
import { GET as listInvites, POST as createInvite } from "@/app/api/invites/route";
import { GET as getMembers } from "@/app/api/members/route";
import { POST as addOtherSide } from "@/app/api/members/other-side/route";
import { GET as sidesGet } from "@/app/api/sides/route";
import { dbListRelationships } from "@/lib/db";
import { joinLink, whatsappInvite } from "@/lib/invite-link";
import { clearAuthAttempts, MOCK_OTP } from "@/lib/otp";
import type { Member } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

let seq = 0;
const email = () => `onb${++seq}-${Date.now()}@example.com`;
const post = (url: string, body: unknown, cookie?: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (url: string, cookie?: string) => new Request(url, { headers: cookie ? { cookie } : {} });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

async function create(addr = email()) {
  const res = await verifyAuth(post("http://test/api/auth/verify", { email: addr, code: MOCK_OTP, tz: "America/New_York", birthday: "03-14", city: "Boston", intent: { type: "create", familyName: "Sharma", firstName: "Arjun" } }));
  const body = (await res.json()) as { familyId: string; memberId: string; welcome?: string };
  return { cookie: cookieOf(res), ...body };
}
const members = async (cookie: string) => ((await (await getMembers(get("http://test/api/members", cookie))).json()) as { members: Member[] }).members;

beforeEach(() => {
  resetDemo();
  clearAuthAttempts();
});

describe("onboarding: whose window is this?", () => {
  it("create stores the creator's city; no welcome line for the creator", async () => {
    const me = await create();
    expect(me.welcome).toBeUndefined();
    expect((await members(me.cookie))[0]).toMatchObject({ city: "Boston", tz: "America/New_York", access: "owner" });
  });

  it("adds any people on the other side, no roles assumed, each with a city; they share one home", async () => {
    const me = await create();
    const res = await addOtherSide(post("http://test/api/members/other-side", { they: "parents", people: [{ callName: "Maa", city: "Kanpur" }, { callName: "Papa", city: "Kanpur" }], tz: "Asia/Kolkata" }, me.cookie));
    expect(res.status).toBe(201);
    const all = await members(me.cookie);
    expect(all.filter((m) => m.role === "elder").map((m) => [m.displayName, m.city, m.tz, m.email])).toEqual([
      ["Maa", "Kanpur", "Asia/Kolkata", null],
      ["Papa", "Kanpur", "Asia/Kolkata", null],
    ]);
    const rels = await dbListRelationships(me.familyId);
    expect(rels.some((r) => r.canonicalKind === "spouse")).toBe(true);
    // A single guardian works the same way.
    const one = await addOtherSide(post("http://test/api/members/other-side", { they: "other", people: [{ callName: "Mausi", city: "Pune" }] }, me.cookie));
    expect(one.status).toBe(201);
    expect((await addOtherSide(post("http://test/api/members/other-side", { they: "parents", people: [{ callName: "Maa" }] }, me.cookie))).status).toBe(409);
    expect((await addOtherSide(post("http://test/api/members/other-side", { they: "parents", people: [] }, me.cookie))).status).toBe(400);
  });

  it("never in the demo family", async () => {
    expect((await addOtherSide(post("http://test/api/members/other-side", { they: "parents", people: [{ callName: "X" }] }, sessionCookie("arjun")))).status).toBe(403);
  });

  it("the joiner takes the place made for them, lands with a welcome line, and the invite link carries the code", async () => {
    const me = await create();
    await addOtherSide(post("http://test/api/members/other-side", { they: "parents", people: [{ callName: "Maa", city: "Kanpur" }] }, me.cookie));
    const { invite } = (await (await createInvite(post("http://test/api/invites", {}, me.cookie))).json()) as { invite: { code: string } };
    expect(((await (await listInvites(get("http://test/api/invites", me.cookie))).json()) as { invites: { code: string }[] }).invites.map((i) => i.code)).toContain(invite.code);
    expect(joinLink("https://a.test", invite.code)).toBe(`https://a.test/join/${invite.code}`);
    expect(decodeURIComponent(whatsappInvite("https://a.test", invite.code, "Arjun"))).toContain(`Arjun has opened a window between our homes on Nearer. Join here: https://a.test/join/${invite.code}`);

    const peek = (await (await peekInvite(get(`http://test/api/invites/peek?code=${invite.code.toLowerCase()}`))).json()) as { family: string; host: string; places: { id: string; callName: string }[] };
    expect(peek).toMatchObject({ family: "Sharma", host: "Arjun" });
    expect(peek.places.map((p) => p.callName)).toEqual(["Maa"]);
    expect(JSON.stringify(peek)).not.toContain("Kanpur");
    expect((await peekInvite(get("http://test/api/invites/peek?code=NOPE123"))).status).toBe(404);

    const before = (await members(me.cookie)).length;
    const joined = await verifyAuth(post("http://test/api/auth/verify", { email: email(), code: MOCK_OTP, tz: "Asia/Kolkata", intent: { type: "join", inviteCode: invite.code, firstName: "Maa", claimMemberId: peek.places[0].id } }));
    const out = (await joined.json()) as { memberId: string; welcome: string };
    expect(out.memberId).toBe(peek.places[0].id);
    expect(out.welcome).toBe("Welcome, Maa. Arjun's window is open.");
    const after = await members(me.cookie);
    expect(after).toHaveLength(before);
    expect(after.find((m) => m.id === out.memberId)).toMatchObject({ email: "account", city: "Kanpur" });
  });

  it("a code can't claim an admin, a child, or someone who already joined", async () => {
    const me = await create();
    const { invite } = (await (await createInvite(post("http://test/api/invites", {}, me.cookie))).json()) as { invite: { code: string } };
    const joined = await verifyAuth(post("http://test/api/auth/verify", { email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: invite.code, firstName: "Sneaky", claimMemberId: me.memberId } }));
    const out = (await joined.json()) as { memberId: string };
    expect(out.memberId).not.toBe(me.memberId);
  });
});

describe("several families", () => {
  it("the same email joins another family; the card says who added you, never their tree", async () => {
    const mine = await create();
    const wife = await create();
    const addr = email();
    // I'm in my family…
    const inv1 = (await (await createInvite(post("http://test/api/invites", {}, mine.cookie))).json()) as { invite: { code: string } };
    await verifyAuth(post("http://test/api/auth/verify", { email: addr, code: MOCK_OTP, city: "Delhi", intent: { type: "join", inviteCode: inv1.invite.code, firstName: "Ravi" } }));
    // …and my wife's family adds me with the same email.
    const inv2 = (await (await createInvite(post("http://test/api/invites", {}, wife.cookie))).json()) as { invite: { code: string } };
    const second = await verifyAuth(post("http://test/api/auth/verify", { email: addr, code: MOCK_OTP, intent: { type: "join", inviteCode: inv2.invite.code, firstName: "Ravi", callName: "Jiju" } }));
    expect(second.status).toBe(200);
    const sides = (await (await sidesGet(get("http://test/api/sides", cookieOf(second)))).json()) as { sides: { familyId: string; addedBy: string | null; fresh: number; people: number }[] };
    expect(sides.sides).toHaveLength(2);
    expect(sides.sides.map((s) => s.addedBy)).toEqual(["Arjun", "Arjun"]);
    expect(sides.sides.every((s) => typeof s.fresh === "number")).toBe(true);
    expect(JSON.stringify(sides)).not.toContain("email");
  });

  it("the demo couple sees both families with counts", async () => {
    const d = (await (await sidesGet(get("http://test/api/sides", sessionCookie("leo")))).json()) as { sides: { name: string; fresh: number }[] };
    expect(d.sides.map((s) => s.name).sort()).toEqual(["Iyer", "Sharma"]);
  });
});
