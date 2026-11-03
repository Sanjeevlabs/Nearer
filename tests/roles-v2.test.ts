// Roles v2: owner / admin / member / teen / child, joiners who wait,
// caps, handing the family over, teen consent, and admins' privacy limits.
import { beforeEach, describe, expect, it } from "vitest";
import { POST as verifyAuth } from "@/app/api/auth/verify/route";
import { GET as cardsGet } from "@/app/api/cards/route";
import { POST as carePost } from "@/app/api/care/route";
import { POST as invitePost } from "@/app/api/invites/route";
import { POST as letterPost } from "@/app/api/letters/route";
import { GET as membersGet } from "@/app/api/members/route";
import { DELETE as memberDelete, PATCH as memberPatch } from "@/app/api/members/[id]/route";
import { POST as approvePost } from "@/app/api/members/[id]/approve/route";
import { POST as ownerPost } from "@/app/api/members/[id]/owner/route";
import { GET as partnersGet } from "@/app/api/partners/route";
import { POST as orderPost } from "@/app/api/partners/order/route";
import { POST as suggestPost } from "@/app/api/partners/suggest/route";
import { POST as addRelative } from "@/app/api/relationships/route";
import { GET as safetyGet, POST as safetyPost } from "@/app/api/safety/route";
import { GET as sessionGet } from "@/app/api/session/route";
import { POST as windowPost } from "@/app/api/window/route";
import { dbAddCard, dbAddMember, dbGetMember, dbListConsents, dbListMembers, dbRemoveMember } from "@/lib/db";
import { clearAuthAttempts, MOCK_OTP } from "@/lib/otp";
import { resetOrders } from "@/lib/partners/orders";
import { memoryTokenStore, resetTokens, saveToken, setTokenStore } from "@/lib/partners/tokens";
import { can, MAX_PEOPLE, type Action } from "@/lib/permissions";
import type { Member } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const F = "demo-family";
const req = (url: string, member: string, body?: unknown, method = body === undefined ? "GET" : "POST", familyId = F) =>
  new Request(`http://test${url}`, { method, headers: { "content-type": "application/json", cookie: sessionCookie(member, familyId) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const id = (x: string) => ({ params: Promise.resolve({ id: x }) });
const setRole = (actor: string, who: string, access: Member["access"]) => memberPatch(req(`/api/members/${who}`, actor, { access }, "PATCH"), id(who));
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
let seq = 0;
const email = () => `roles${++seq}-${Date.now()}@example.com`;
const verify = (body: unknown) => verifyAuth(new Request("http://test/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const join = async (code: string, addr = email(), extra: Record<string, unknown> = {}) => {
  const res = await verify({ email: addr, code: MOCK_OTP, intent: { type: "join", inviteCode: code, firstName: "Ravi", ...extra } });
  return { res, cookie: cookieOf(res), ...(await json<{ memberId: string; familyId: string; status: string; welcome?: string }>(res.clone())) };
};
const inviteBy = async (member: string) => (await json<{ invite: { code: string } }>(invitePost(req("/api/invites", member, {})))).invite.code;
/** Someone still waiting from before links let people straight in (an older pending row). */
const waiter = async () => {
  const m = await dbAddMember({ familyId: F, firstName: "Ravi", displayName: "Ravi", role: "adult", email: email(), access: "member", status: "pending" });
  return { memberId: m.id, cookie: sessionCookie(m.id, F) };
};

beforeEach(() => {
  resetDemo();
  clearAuthAttempts();
  resetTokens();
  resetOrders();
});

describe("the table, row by row", () => {
  const rows: Record<Member["access"], { yes: Action[]; no: Action[] }> = {
    owner: { yes: ["owner.transfer", "family.delete", "billing.manage", "members.approve", "roles.assign", "tree.remove-account", "content.moderate", "care.manage"], no: [] },
    admin: { yes: ["members.approve", "roles.assign", "tree.remove-account", "tree.edit", "content.moderate", "care.manage", "invite.revoke"], no: ["owner.transfer", "family.delete", "billing.manage"] },
    member: { yes: ["invite.create", "care.manage", "care.write", "events.plan", "partners.order", "window.at", "tree.add"], no: ["roles.assign", "members.approve", "tree.remove-account", "content.moderate"] },
    teen: { yes: [], no: ["care.manage", "care.write", "partners.order", "window.at", "tree.add", "invite.create", "events.plan", "roles.assign"] },
    child: { yes: [], no: ["care.write", "invite.create", "tree.add", "partners.order", "window.at"] },
  };
  for (const [access, { yes, no }] of Object.entries(rows) as [Member["access"], { yes: Action[]; no: Action[] }][]) {
    it(`${access}`, () => {
      for (const a of yes) expect(can({ access }, a), `${access} ${a}`).toBe(true);
      for (const a of no) expect(can({ access }, a), `${access} ${a}`).toBe(false);
    });
  }

  it("a pending person can do nothing, whatever their role", () => {
    expect(can({ access: "admin", status: "pending" }, "members.approve")).toBe(false);
    expect(can({ access: "member", status: "pending" }, "invite.create")).toBe(false);
  });

  it("the creator owns a new family; the demo family is Arjun's", async () => {
    const res = await verify({ email: email(), code: MOCK_OTP, intent: { type: "create", familyName: "Rao", firstName: "Asha" } });
    const out = await json<{ memberId: string; status: string }>(res);
    expect(out.status).toBe("active");
    expect((await dbGetMember(out.memberId))?.access).toBe("owner");
    expect((await dbGetMember("arjun"))?.access).toBe("owner");
    expect((await dbListMembers(F)).filter((m) => m.access === "owner")).toHaveLength(1);
  });

  it("a member invites; an admin removes people with accounts; a member can't", async () => {
    expect((await invitePost(req("/api/invites", "priya", {}))).status).toBe(201);
    expect((await setRole("priya", "rahul", "admin")).status).toBe(403);
    await dbAddMember({ familyId: F, firstName: "Neha", displayName: "Neha", role: "adult", email: "neha@example.com" });
    const neha = (await dbListMembers(F)).find((m) => m.firstName === "Neha")!;
    expect((await memberDelete(req(`/api/members/${neha.id}`, "priya", undefined, "DELETE"), id(neha.id))).status).toBe(403);
    expect((await setRole("arjun", "kavya", "admin")).status).toBe(200);
    expect((await memberDelete(req(`/api/members/${neha.id}`, "kavya", undefined, "DELETE"), id(neha.id))).status).toBe(200);
    // Nobody removes the owner.
    expect((await memberDelete(req("/api/members/arjun", "kavya", undefined, "DELETE"), id("arjun"))).status).toBe(409);
  });

  it("a child is a profile only: they can't be given an account's role if they have one", async () => {
    await dbAddMember({ familyId: F, firstName: "Ira", displayName: "Ira", role: "adult", email: "ira@example.com" });
    const ira = (await dbListMembers(F)).find((m) => m.firstName === "Ira")!;
    expect(await json(setRole("arjun", ira.id, "child"))).toMatchObject({ error: "has-account" });
  });
});

describe("caps", () => {
  it("up to 3 admins, the owner included", async () => {
    expect((await setRole("arjun", "priya", "admin")).status).toBe(200);
    expect((await setRole("arjun", "kavya", "admin")).status).toBe(200);
    const r = await setRole("arjun", "rahul", "admin");
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({ error: "admins-full" });
    // Nobody is made owner through a role change.
    expect((await setRole("arjun", "rahul", "owner")).status).toBe(409);
  });

  it("up to 50 people per family: joining and letting in stop at the cap", async () => {
    const code = await inviteBy("priya");
    const waiting = await waiter();
    // The family fills up while they wait (50 in, 1 at the door).
    const have = (await dbListMembers(F)).length;
    for (let i = have; i < MAX_PEOPLE; i++) await dbAddMember({ familyId: F, firstName: `P${i}`, displayName: `P${i}`, role: "adult" });
    expect(await json((await join(code)).res)).toMatchObject({ error: "family-full" });
    expect(await json(approvePost(req(`/api/members/${waiting.memberId}/approve`, "arjun", { decision: "approve" }), id(waiting.memberId)))).toMatchObject({ error: "family-full" });
    expect((await addRelative(req("/api/relationships", "arjun", { memberId: "arjun", newMemberName: "One more", relation: "cousin" }))).status).toBe(409);
  });
});

describe("joining with a link, and older joiners who wait", () => {
  it("anyone's valid link lets you straight in, with a welcome line", async () => {
    for (const by of ["priya", "arjun"]) {
      const j = await join(await inviteBy(by));
      expect(j.status).toBe("active");
      expect(j.welcome).toMatch(/^Welcome, Ravi\./);
      expect((await cardsGet(new Request("http://test/api/cards", { headers: { cookie: j.cookie } }))).status).toBe(200);
    }
    const code = await inviteBy("priya");
    const place = await dbAddMember({ familyId: F, firstName: "Nani", displayName: "Nani", role: "elder" });
    expect(await join(code, email(), { claimMemberId: place.id })).toMatchObject({ memberId: place.id, status: "active" });
  });

  it("a link stops working once revoked, or once whoever made it has left", async () => {
    const code = await inviteBy("priya");
    await dbRemoveMember("priya");
    expect(await json((await join(code)).res)).toMatchObject({ error: "invalid-invite" });
  });

  it("an older waiting joiner's session opens only GET /api/session", async () => {
    const j = await waiter();
    const s = await json<{ status: string; waitingFor: string }>(sessionGet(new Request("http://test/api/session", { headers: { cookie: j.cookie } })));
    expect(s).toMatchObject({ status: "pending", waitingFor: "Arjun" });
    for (const r of [await cardsGet(new Request("http://test/api/cards", { headers: { cookie: j.cookie } })), await membersGet(new Request("http://test/api/members", { headers: { cookie: j.cookie } })), await invitePost(new Request("http://test/api/invites", { method: "POST", headers: { cookie: j.cookie }, body: "{}" }))]) {
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "pending" });
    }
    const forPriya = await json<{ members: Member[]; pending: Member[] }>(membersGet(req("/api/members", "priya")));
    expect(forPriya.members.some((m) => m.id === j.memberId)).toBe(false);
    expect(forPriya.pending).toEqual([]);
    const forArjun = await json<{ pending: Member[] }>(membersGet(req("/api/members", "arjun")));
    expect(forArjun.pending.map((m) => m.id)).toEqual([j.memberId]);
  });

  it("active in your own family, a second family's link lets you in there too", async () => {
    const addr = email();
    const mine = await verify({ email: addr, code: MOCK_OTP, intent: { type: "create", familyName: "Rao", firstName: "Asha" } });
    const own = await json<{ familyId: string; status: string }>(mine);
    expect(own.status).toBe("active");
    const second = await join(await inviteBy("priya"), addr);
    expect(second).toMatchObject({ familyId: F, status: "active" });
    // Signing in again opens the one used last; both stay theirs.
    const back = await json<{ familyId: string; status: string }>(verify({ email: addr, code: MOCK_OTP, intent: { type: "signin" } }));
    expect(back.status).toBe("active");
    expect([own.familyId, F]).toContain(back.familyId);
  });

  it("an admin approves or declines an older waiting joiner; a member can't", async () => {
    const a = await waiter();
    const b = await waiter();
    expect((await approvePost(req(`/api/members/${a.memberId}/approve`, "priya", { decision: "approve" }), id(a.memberId))).status).toBe(403);
    expect((await approvePost(req(`/api/members/${a.memberId}/approve`, "arjun", { decision: "approve" }), id(a.memberId))).status).toBe(200);
    expect((await dbGetMember(a.memberId))?.status).toBe("active");
    expect((await cardsGet(new Request("http://test/api/cards", { headers: { cookie: a.cookie } }))).status).toBe(200);
    expect((await approvePost(req(`/api/members/${a.memberId}/approve`, "arjun", { decision: "approve" }), id(a.memberId))).status).toBe(409);
    expect((await approvePost(req(`/api/members/${b.memberId}/approve`, "arjun", { decision: "decline" }), id(b.memberId))).status).toBe(200);
    expect(await dbGetMember(b.memberId)).toBeUndefined();
  });

  it("an owner/admin can still remove someone who came in by link", async () => {
    const j = await join(await inviteBy("priya"));
    expect((await memberDelete(req(`/api/members/${j.memberId}`, "priya", undefined, "DELETE"), id(j.memberId))).status).toBe(403);
    expect((await memberDelete(req(`/api/members/${j.memberId}`, "arjun", undefined, "DELETE"), id(j.memberId))).status).toBe(200);
    expect((await cardsGet(new Request("http://test/api/cards", { headers: { cookie: j.cookie } }))).status).toBe(401);
  });
});

describe("handing the family over", () => {
  it("owner only; the old owner becomes an admin; one owner always", async () => {
    expect((await setRole("arjun", "kavya", "admin")).status).toBe(200);
    expect((await ownerPost(req("/api/members/priya/owner", "kavya", {}), id("priya"))).status).toBe(403);
    expect((await ownerPost(req("/api/members/aria/owner", "arjun", {}), id("aria"))).status).toBe(409);
    const out = await json<{ owner: Member; previous: Member }>(ownerPost(req("/api/members/kavya/owner", "arjun", {}), id("kavya")));
    expect(out.owner).toMatchObject({ id: "kavya", access: "owner" });
    expect(out.previous).toMatchObject({ id: "arjun", access: "admin" });
    expect((await dbListMembers(F)).filter((m) => m.access === "owner").map((m) => m.id)).toEqual(["kavya"]);
    expect((await ownerPost(req("/api/members/priya/owner", "arjun", {}), id("priya"))).status).toBe(403);
  });

  it("respects the admin cap", async () => {
    await setRole("arjun", "kavya", "admin");
    await setRole("arjun", "priya", "admin");
    // Rahul becoming owner would leave 4: Rahul, Arjun, Kavya, Priya.
    expect(await json(ownerPost(req("/api/members/rahul/owner", "arjun", {}), id("rahul")))).toMatchObject({ error: "admins-full" });
    expect((await ownerPost(req("/api/members/priya/owner", "arjun", {}), id("priya"))).status).toBe(200);
  });
});

describe("teens", () => {
  it("only their parent (an owner/admin) can make a teen account, and it records consent", async () => {
    expect((await setRole("dadi", "leo", "teen")).status).toBe(403);
    await setRole("arjun", "kavya", "admin");
    expect(await json(setRole("kavya", "leo", "teen"))).toMatchObject({ error: "needs-parent" });
    const out = await json<{ member: Member; consent: { kind: string; method: string; parentMemberId: string } }>(setRole("arjun", "leo", "teen"));
    expect(out.member.access).toBe("teen");
    expect(out.consent).toMatchObject({ kind: "teen-account", method: "parent-session-code", parentMemberId: "arjun" });
    expect((await dbListConsents(F)).map((c) => c.memberId)).toEqual(["leo"]);
  });

  it("with no parent linked, any owner/admin can", async () => {
    await setRole("arjun", "kavya", "admin");
    expect((await setRole("kavya", "rahul", "teen")).status).toBe(200);
    expect((await dbListConsents(F))[0]).toMatchObject({ memberId: "rahul", parentMemberId: "kavya" });
  });

  it("a waiting joiner can be let in as a teen, with consent", async () => {
    const j = await waiter();
    const out = await json<{ member: Member; consent: { memberId: string } }>(approvePost(req(`/api/members/${j.memberId}/approve`, "arjun", { decision: "approve", access: "teen" }), id(j.memberId)));
    expect(out.member).toMatchObject({ access: "teen", status: "active" });
    expect(out.consent.memberId).toBe(j.memberId);
  });

  it("teens can't run care, Trusted nearby, Send something, or be at a window", async () => {
    await setRole("arjun", "leo", "teen");
    expect((await carePost(req("/api/care", "leo", { action: "need", forMemberId: "leo", title: "New school shoes" }))).status).toBe(403);
    expect((await carePost(req("/api/care", "leo", { action: "helper", forMemberId: "leo", name: "Sam", phone: "+1 617 555 0100", emergency: true, consent: true }))).status).toBe(403);
    expect((await orderPost(req("/api/partners/order", "leo", { action: "preview", suggestionId: "x", forMemberId: "dadi" }))).status).toBe(403);
    expect((await windowPost(req("/api/window", "dadi", { action: "people", people: ["leo"] }))).status).toBe(403);
    expect((await windowPost(req("/api/window", "dadi", { action: "people", people: ["arjun"] }))).status).toBe(200);
    // Still shares and sees the family.
    expect((await cardsGet(req("/api/cards", "leo"))).status).toBe(200);
  });
});

describe("admins can't read others' private things", () => {
  it("a morning letter stays sealed until its morning, even for the owner and admins", async () => {
    await setRole("arjun", "kavya", "admin");
    const card = await dbAddCard({ familyId: F, type: "audio", caption: "Good morning, beta", lang: "en", takenAt: new Date().toISOString(), authorId: "dadi" });
    expect((await letterPost(req("/api/letters", "dadi", { cardId: card.id, deliverAt: new Date(Date.now() + 6 * 3_600_000).toISOString() }))).status).toBe(200);
    const ids = async (who: string) => (await json<{ cards: { id: string }[] }>(cardsGet(req("/api/cards", who)))).cards.map((c) => c.id);
    expect(await ids("arjun")).not.toContain(card.id);
    expect(await ids("kavya")).not.toContain(card.id);
    expect(await ids("dadi")).toContain(card.id);
  });

  it("partner tokens and orders stay with their member", async () => {
    setTokenStore(memoryTokenStore());
    await saveToken(F, "priya", "swiggy", { accessToken: "priya-access", refreshToken: "priya-refresh", sample: true });
    const forArjun = await json<{ accounts: { id: string; connected: boolean }[] }>(partnersGet(req("/api/partners", "arjun")));
    expect(JSON.stringify(forArjun)).not.toContain("priya-access");
    expect(forArjun.accounts.every((a) => !a.connected)).toBe(true);
    const { suggestions } = await json<{ suggestions: { id: string; kind: string }[] }>(suggestPost(req("/api/partners/suggest", "priya", { forMemberId: "dadi", occasion: "Diwali" })));
    const gift = suggestions.find((s) => s.kind === "gifts")!;
    const pv = await json<{ preview: { id: string } }>(orderPost(req("/api/partners/order", "priya", { action: "preview", suggestionId: gift.id, forMemberId: "dadi" })));
    // Owner can't confirm or even use Priya's preview or suggestion.
    expect((await orderPost(req("/api/partners/order", "arjun", { action: "confirm", previewId: pv.preview.id, confirm: true }))).status).toBe(404);
    expect((await orderPost(req("/api/partners/order", "arjun", { action: "preview", suggestionId: gift.id, forMemberId: "dadi" }))).status).toBe(410);
  });

  it("safety check-ins reach only the people she chose", async () => {
    await setRole("arjun", "kavya", "admin");
    expect((await safetyPost(req("/api/safety", "priya", { action: "settings", enabled: true, watchers: ["dadi"] }))).status).toBe(200);
    expect((await safetyPost(req("/api/safety", "priya", { action: "checkin", kind: "home-safe" }))).status).toBe(201);
    type S = { checkins: { memberId: string }[]; sharing: string[] };
    const seen = async (who: string) => json<S>(safetyGet(req("/api/safety", who)));
    expect((await seen("dadi")).checkins.some((c) => c.memberId === "priya")).toBe(true);
    for (const admin of ["arjun", "kavya"]) {
      const s = await seen(admin);
      expect(s.checkins.some((c) => c.memberId === "priya")).toBe(false);
      expect(s.sharing).not.toContain("priya");
    }
  });
});
