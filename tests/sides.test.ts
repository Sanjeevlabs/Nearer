import { beforeEach, describe, expect, it } from "vitest";
import { GET as membersGet } from "@/app/api/members/route";
import { POST as sessionPost } from "@/app/api/session/route";
import { POST as switchPost } from "@/app/api/session/switch/route";
import { GET as sidesGet, POST as sidesPost } from "@/app/api/sides/route";
import { circles } from "@/lib/circles";
import { dbAddMember, dbCreateFamily, dbCreateInvite, dbGetMember, dbLinkMembers, dbListMembers, dbListRelationships, dbUpdateMemberProfile } from "@/lib/db";
import type { Member } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { clearAuthAttempts } from "@/lib/otp";
import { sessionCookie } from "./auth-helper";

const req = (url: string, member: string, family = "demo-family", body?: unknown) =>
  new Request(`http://test${url}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: sessionCookie(member, family) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
type Sides = { current: string; sides: { familyId: string; memberId: string; name: string; people: number }[] };

/** A real (non-demo) family: Kavya, her husband Rahul, their daughter Anaya, and her mother. */
async function realFamily() {
  const familyId = await dbCreateFamily("Sharma");
  const add = (firstName: string, displayName: string, role: Member["role"], access: Member["access"]) => dbAddMember({ familyId, firstName, displayName, role, access, tz: "Asia/Kolkata" });
  const kavya = await add("Kavya", "Bua", "adult", "admin");
  const rahul = await add("Rahul", "Fufa", "adult", "member");
  const anaya = await add("Anaya", "Anaya", "child", "child");
  const mother = await add("Dadi", "Dadi", "elder", "member");
  await dbLinkMembers({ familyId, memberId: kavya.id, relationMemberId: rahul.id, relation: "husband" });
  await dbLinkMembers({ familyId, memberId: kavya.id, relationMemberId: anaya.id, relation: "daughter" });
  await dbLinkMembers({ familyId, memberId: kavya.id, relationMemberId: mother.id, relation: "mother" });
  return { familyId, kavya, rahul, anaya, mother };
}

beforeEach(() => {
  resetDemo();
  clearAuthAttempts();
});

describe("two courtyards, one door", () => {
  it("the couple and their children belong to both sides; the grandparents to one", async () => {
    const leo = await json<Sides>(sidesGet(req("/api/sides", "leo")));
    expect(leo.sides.map((s) => s.name).sort()).toEqual(["Iyer", "Sharma"]);
    expect((await json<Sides>(sidesGet(req("/api/sides", "dadi")))).sides).toHaveLength(1);
  });

  it("switching moves the session to the same person's place on the other side, and nothing leaks across", async () => {
    const res = await sidesPost(req("/api/sides", "priya", "demo-family", { action: "switch", familyId: "demo-iyer" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ familyId: "demo-iyer", memberId: "iyer-priya" });
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const iyer = await json<{ members: Member[] }>(membersGet(req("/api/members", "iyer-priya", "demo-iyer")));
    expect(iyer.members.map((m) => m.id)).toContain("iyer-nani");
    expect(iyer.members.some((m) => m.familyId !== "demo-iyer")).toBe(false);
    const sharma = await json<{ members: Member[] }>(membersGet(req("/api/members", "dadi")));
    expect(sharma.members.some((m) => m.id.startsWith("iyer-"))).toBe(false);
  });

  it("refuses a side you don't belong to", async () => {
    expect((await sidesPost(req("/api/sides", "dadi", "demo-family", { action: "switch", familyId: "demo-iyer" }))).status).toBe(403);
  });

  it("Add my family: a new family with only my own home inside it, and an invite for my parents", async () => {
    const f = await realFamily();
    expect((await sidesPost(req("/api/sides", f.kavya.id, f.familyId, { action: "create", familyName: "Verma", bring: [f.mother.id] }))).status).toBe(400);
    const out = await json<{ familyId: string; memberId: string; invite: { code: string } }>(sidesPost(req("/api/sides", f.kavya.id, f.familyId, { action: "create", familyName: "Verma", bring: [f.rahul.id, f.anaya.id] })));
    expect(out.invite.code).toBeTruthy();
    const there = await dbListMembers(out.familyId);
    expect(there.map((m) => m.displayName).sort()).toEqual(["Anaya", "Bua", "Fufa"]);
    expect(there.find((m) => m.id === out.memberId)?.access).toBe("owner");
    expect(there.find((m) => m.displayName === "Anaya")?.access).toBe("child");
    expect(await dbListRelationships(out.familyId)).toHaveLength(2);
    const kavya = await dbGetMember(f.kavya.id);
    expect(kavya?.personId).toBeTruthy();
    const sides = await json<Sides>(sidesGet(req("/api/sides", out.memberId, out.familyId)));
    expect(sides.sides.map((s) => s.name).sort()).toEqual(["Sharma", "Verma"]);
  });

  it("never from a shared demo family: every visitor is the same person there", async () => {
    expect((await sidesPost(req("/api/sides", "arjun", "demo-family", { action: "create", familyName: "X", bring: [] }))).status).toBe(403);
  });

  it("children can't create a side", async () => {
    expect((await sidesPost(req("/api/sides", "leo", "demo-family", { action: "create", familyName: "X", bring: [] }))).status).toBe(403);
  });

  it("puts in-laws and cousins in the wider circle", async () => {
    const c = circles(await dbListMembers("demo-family"), await dbListRelationships("demo-family"), "priya");
    const ids = (xs: { member: Member }[]) => xs.map((p) => p.member.id).sort();
    expect(ids(c.home)).toEqual(["aria", "arjun", "leo"]); // one Bengaluru home
    expect(ids(c.wider)).toEqual(expect.arrayContaining(["dadi", "dada", "kavya", "anaya", "kabir"]));
    expect(c.wider.find((p) => p.member.id === "kabir")?.label).toMatch(/nephew|son/i);
  });
});

describe("session hardening", () => {
  it("the persona switcher works only in demo families", async () => {
    const f = await realFamily();
    const out = await json<{ familyId: string; memberId: string }>(sidesPost(req("/api/sides", f.kavya.id, f.familyId, { action: "create", familyName: "Verma", bring: [] })));
    const r = new Request("http://test/api/session/switch", { method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie(out.memberId, out.familyId) }, body: JSON.stringify({ memberId: out.memberId }) });
    expect((await switchPost(r)).status).toBe(403);
  });

  it("an invite code never opens an admin or someone with their own account", async () => {
    const f = await realFamily();
    const out = await json<{ familyId: string; memberId: string; invite: { code: string } }>(sidesPost(req("/api/sides", f.kavya.id, f.familyId, { action: "create", familyName: "Verma", bring: [f.rahul.id] })));
    const claim = (memberId: string, code: string) => sessionPost(new Request("http://test/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteCode: code, memberId }) }));
    expect((await claim(out.memberId, out.invite.code)).status).toBe(403);
    const rahul = (await dbListMembers(out.familyId)).find((m) => m.displayName === "Fufa");
    expect((await claim(rahul!.id, out.invite.code)).status).toBe(200);
    await dbUpdateMemberProfile(rahul!.id, { email: "rahul@example.test" });
    const fresh = await dbCreateInvite(out.familyId);
    expect((await claim(rahul!.id, fresh.code)).status).toBe(403);
  });

  it("other people's emails and the cross-family link never reach the browser", async () => {
    await dbUpdateMemberProfile("kavya", { email: "kavya@example.test" });
    const seen = await json<{ members: Member[] }>(membersGet(req("/api/members", "leo")));
    expect(seen.members.find((m) => m.id === "kavya")?.email).toBe("account");
    expect(seen.members.every((m) => m.personId === null)).toBe(true);
    const own = await json<{ members: Member[] }>(membersGet(req("/api/members", "kavya")));
    expect(own.members.find((m) => m.id === "kavya")?.email).toBe("kavya@example.test");
  });
});
