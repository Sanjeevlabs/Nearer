// One door: sign in once, set up in one step, join with one link. Every combination of person and
// link (the matrix in the PR): new or already a member, with or without a link, the family's own
// link, another family's, four families, a dead link, a full family, places already taken.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as verifyAuth } from "@/app/api/auth/verify/route";
import { POST as accept } from "@/app/api/invites/accept/route";
import { GET as peekRoute } from "@/app/api/invites/peek/route";
import { DELETE as revoke, POST as createInvite } from "@/app/api/invites/route";
import { POST as addOtherSide } from "@/app/api/members/other-side/route";
import { GET as sidesGet, POST as sidesPost } from "@/app/api/sides/route";
import { dbAddMember, dbGetMember } from "@/lib/db";
import { codeFromInput, joinLink, whatsappInvite } from "@/lib/invite-link";
import { clearAuthAttempts, MOCK_OTP } from "@/lib/otp";
import { MAX_PEOPLE, MAX_SIDES } from "@/lib/permissions";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

let seq = 0;
const email = () => `door${++seq}-${Date.now()}@example.com`;
const post = (url: string, body: unknown, cookie?: string, method = "POST") => new Request(`http://test${url}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (url: string, cookie?: string) => new Request(`http://test${url}`, { headers: cookie ? { cookie } : {} });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const verify = (body: unknown) => verifyAuth(post("/api/auth/verify", body));

/** A new person makes a family (the setup screen: name, family name, no birthday). */
async function family(name = "Rao", addr = email()) {
  const res = await verify({ email: addr, code: MOCK_OTP, tz: "UTC", intent: { type: "create", familyName: `The ${name} family`, firstName: "Asha" } });
  const out = await json<{ familyId: string; memberId: string; status: string }>(res.clone());
  return { ...out, cookie: cookieOf(res), email: addr };
}
const linkOf = async (cookie: string) => (await json<{ invite: { code: string } }>(createInvite(post("/api/invites", {}, cookie)))).invite.code;
type Peek = { family: string; host: string | null; places: { id: string; callName: string }[]; full: boolean; you?: { inFamily: boolean; sides: number; current: string; email: string | null; canJoin: boolean } };
const peek = (code: string, cookie?: string) => peekRoute(get(`/api/invites/peek?code=${code}`, cookie));

beforeEach(() => {
  resetDemo();
  clearAuthAttempts();
});
afterEach(() => vi.useRealTimers());

describe("1. new, no link: sign in, then one setup screen", () => {
  it("plain sign-in with no family says no-family (the setup screen), then create needs no birthday", async () => {
    const addr = email();
    const first = await verify({ email: addr, code: MOCK_OTP, intent: { type: "signin" } });
    expect(first.status).toBe(404);
    expect(await json(first)).toEqual({ error: "no-family" });
    const made = await verify({ email: addr, code: MOCK_OTP, tz: "UTC", intent: { type: "create", familyName: "The Rao family", firstName: "Asha" } });
    expect(made.status).toBe(200);
    const out = await json<{ memberId: string; status: string }>(made);
    expect(out.status).toBe("active");
    expect(await dbGetMember(out.memberId)).toMatchObject({ access: "owner", birthday: "" });
  });

  it("the other-side step is skippable: a family with nobody else still works", async () => {
    const me = await family();
    const sides = await json<{ sides: unknown[] }>(sidesGet(get("/api/sides", me.cookie)));
    expect(sides.sides).toHaveLength(1);
  });
});

describe("2. new, with a link: /join/<CODE>, sign in there, pick, in", () => {
  it("the share is one link to /join/<CODE>; a pasted link, an old ?code= link or the bare code all read back", () => {
    expect(joinLink("https://nearer.site", "AB12CD")).toBe("https://nearer.site/join/AB12CD");
    expect(decodeURIComponent(whatsappInvite("https://nearer.site", "AB12CD", "Arjun"))).toContain("Join here: https://nearer.site/join/AB12CD");
    expect(decodeURIComponent(whatsappInvite("https://nearer.site", "AB12CD"))).not.toContain("your code");
    expect(codeFromInput("https://nearer.site/join/ab12cd")).toBe("AB12CD");
    expect(codeFromInput("Join here: https://nearer.site/join/AB12CD please")).toBe("AB12CD");
    expect(codeFromInput("https://nearer.site/join?code=ab12cd")).toBe("AB12CD");
    expect(codeFromInput(" ab12cd ")).toBe("AB12CD");
    expect(codeFromInput("not a link at all")).toBeNull();
    expect(codeFromInput("")).toBeNull();
  });

  it("the /join/<CODE> route exists and hands its code to the one page", () => {
    const page = readFileSync("app/join/[code]/page.tsx", "utf8");
    expect(page).toContain("<AuthFlow join code={code} />");
    expect(readFileSync("app/join/page.tsx", "utf8")).toContain("<AuthFlow join />");
  });

  it("join link with a claim: active at once, in the place made for them", async () => {
    const host = await family("Sharma");
    await addOtherSide(post("/api/members/other-side", { they: "parents", people: [{ callName: "Maa", city: "Kanpur" }] }, host.cookie));
    const code = await linkOf(host.cookie);
    const p = await json<Peek>(peek(code));
    expect(p).toMatchObject({ family: "Sharma", host: "Asha", full: false });
    expect(p.you).toBeUndefined();
    const res = await verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: code, claimMemberId: p.places[0].id } });
    const out = await json<{ memberId: string; status: string; welcome: string }>(res);
    expect(out).toMatchObject({ memberId: p.places[0].id, status: "active" });
    expect(out.welcome).toBe("Welcome, Maa. Asha's window is open.");
  });

  it("join link without a claim: active, no waiting for anyone (even a plain member's link)", async () => {
    const host = await family("Sharma");
    const sib = await verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: await linkOf(host.cookie), firstName: "Ravi" } });
    const sibCookie = cookieOf(sib);
    expect((await dbGetMember((await json<{ memberId: string }>(sib)).memberId))?.access).toBe("member");
    const res = await verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: await linkOf(sibCookie), firstName: "Meera" } });
    expect(await json(res)).toMatchObject({ status: "active" });
    // No name and no place: the page asks for a name first.
    expect((await verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: await linkOf(host.cookie) } })).status).toBe(400);
  });
});

describe("3–5. already a member", () => {
  it("3. no link: sign in opens your family", async () => {
    const me = await family();
    const out = await json<{ familyId: string; status: string }>(verify({ email: me.email, code: MOCK_OTP, intent: { type: "signin" } }));
    expect(out).toMatchObject({ familyId: me.familyId, status: "active" });
  });

  it("4. a link to a family you're already in just opens it", async () => {
    const me = await family();
    const code = await linkOf(me.cookie);
    const p = await json<Peek>(peek(code, me.cookie));
    expect(p.you).toMatchObject({ inFamily: true, sides: 1, email: me.email });
    const res = await accept(post("/api/invites/accept", { code }, me.cookie));
    expect(await json(res)).toMatchObject({ familyId: me.familyId, memberId: me.memberId, already: true });
    // Signing in through the link (no session yet) opens it the same way.
    const again = await json<{ memberId: string }>(verify({ email: me.email, code: MOCK_OTP, intent: { type: "join", inviteCode: code, firstName: "Asha" } }));
    expect(again.memberId).toBe(me.memberId);
  });

  it("5. a link to another family: one confirm, then in, and both are in the switcher", async () => {
    const me = await family("Rao");
    const wife = await family("Iyer");
    const code = await linkOf(wife.cookie);
    const p = await json<Peek>(peek(code, me.cookie));
    expect(p).toMatchObject({ family: "Iyer", you: { inFamily: false, current: "Rao", sides: 1, canJoin: true } });
    const res = await accept(post("/api/invites/accept", { code }, me.cookie));
    expect(res.status).toBe(200);
    const out = await json<{ familyId: string; status: string }>(res.clone());
    expect(out).toMatchObject({ familyId: wife.familyId, status: "active" });
    const sides = await json<{ current: string; sides: { familyId: string }[] }>(sidesGet(get("/api/sides", cookieOf(res))));
    expect(sides.current).toBe(wife.familyId);
    expect(sides.sides.map((s) => s.familyId).sort()).toEqual([me.familyId, wife.familyId].sort());
  });

  it("the demo is nobody's own account: no `you`, and no joining from it", async () => {
    const host = await family();
    const code = await linkOf(host.cookie);
    expect((await json<Peek>(peek(code, sessionCookie("arjun")))).you).toBeUndefined();
    expect((await accept(post("/api/invites/accept", { code }, sessionCookie("arjun")))).status).toBe(403);
  });
});

describe("6–7, 12. more families, up to four", () => {
  it(`7. at ${MAX_SIDES} families: the link says so and joining a fifth is refused`, async () => {
    const me = await family("Mine");
    let cookie = me.cookie;
    for (let i = 1; i < MAX_SIDES; i++) {
      const other = await family(`Other${i}`);
      const res = await accept(post("/api/invites/accept", { code: await linkOf(other.cookie) }, cookie));
      expect(res.status).toBe(200);
      cookie = cookieOf(res);
    }
    const fifth = await family("Fifth");
    const code = await linkOf(fifth.cookie);
    expect((await json<Peek>(peek(code, cookie))).you).toMatchObject({ sides: MAX_SIDES, inFamily: false });
    expect(await json(accept(post("/api/invites/accept", { code }, cookie)))).toEqual({ error: "too-many-sides" });
  });

  it("6, 7, 12. the profile menu lists your families, starts or joins another, says when it's four, never offers a child a new family", () => {
    const src = readFileSync("components/profile-menu.tsx", "utf8");
    expect(src).toContain("Your families");
    expect(src).toContain('data-profile="start-family"');
    expect(src).toContain('data-profile="join-link"');
    expect(src).toContain("AddSideSheet");
    expect(src).toMatch(/the most Nearer allows/);
    expect(src).toMatch(/!demo && !atLimit && !kid &&/);
    expect(src).toMatch(/const kid = viewer\.role === "child"/);
  });

  it("12. a child can't start another family, whatever the screen shows", async () => {
    const host = await family();
    const kid = await dbAddMember({ familyId: host.familyId, firstName: "Ira", displayName: "Ira", role: "child", access: "child" });
    const res = await sidesPost(post("/api/sides", { action: "create", familyName: "Mine", bring: [] }, sessionCookie(kid.id, host.familyId)));
    expect(res.status).toBe(403);
  });
});

describe("9–11. dead links, full families, places already taken", () => {
  it("9. expired: 404 naming whom to ask; revoked or unknown: 404 with nobody named", async () => {
    const host = await family();
    const code = await linkOf(host.cookie);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * 86_400_000);
    const expired = await peek(code);
    expect(expired.status).toBe(404);
    expect(await json(expired)).toMatchObject({ error: "invalid-invite", host: "Asha", family: "Rao" });
    expect((await verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: code, firstName: "X" } })).status).toBe(403);
    vi.useRealTimers();
    const code2 = await linkOf(host.cookie);
    expect((await revoke(post("/api/invites", { code: code2 }, host.cookie, "DELETE"))).status).toBe(200);
    expect(await json(peek(code2))).toEqual({ error: "invalid-invite", host: null });
    expect(await json(peek("NOPE123"))).toEqual({ error: "invalid-invite", host: null });
  });

  it("10. a full family says so before sign-in, and joining is refused with family-full", async () => {
    const host = await family("Full");
    const code = await linkOf(host.cookie);
    for (let i = 1; i < MAX_PEOPLE; i++) await dbAddMember({ familyId: host.familyId, firstName: `P${i}`, displayName: `P${i}`, role: "adult", email: `p${i}-${seq}@example.com` });
    expect(await json<Peek>(peek(code))).toMatchObject({ family: "Full", full: true, places: [] });
    expect(await json(verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: code, firstName: "X" } }))).toEqual({ error: "family-full" });
  });

  it("11. a place someone already took is not offered again", async () => {
    const host = await family();
    await addOtherSide(post("/api/members/other-side", { they: "parents", people: [{ callName: "Maa" }, { callName: "Papa" }] }, host.cookie));
    const code = await linkOf(host.cookie);
    const before = await json<Peek>(peek(code));
    expect(before.places.map((p) => p.callName).sort()).toEqual(["Maa", "Papa"]);
    const maa = before.places.find((p) => p.callName === "Maa")!;
    await verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: code, claimMemberId: maa.id } });
    expect((await json<Peek>(peek(code))).places.map((p) => p.callName)).toEqual(["Papa"]);
    // Claiming it again makes a new place instead of taking hers.
    const second = await json<{ memberId: string }>(verify({ email: email(), code: MOCK_OTP, intent: { type: "join", inviteCode: code, claimMemberId: maa.id, firstName: "Sneaky" } }));
    expect(second.memberId).not.toBe(maa.id);
  });
});

describe("landing: one way in", () => {
  it("the landing and the home page offer Sign in and the demo, nothing to create or join", () => {
    for (const f of ["components/welcome.tsx", "components/home-site.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/Start your family|Join with a code|landing\.create|landing\.join|entryHref/);
      expect(src, f).toMatch(/href="\/signin"/);
    }
    expect(readFileSync("components/home-site.tsx", "utf8")).toContain("Try the demo family");
  });

  it("the sign-in page has no separate sign-up wording", () => {
    const src = readFileSync("components/auth-flow.tsx", "utf8");
    expect(src).not.toMatch(/titleSignUp|emailSubSignup|newToNearer|haveFamily|nofamily/);
    expect(src).toContain('t("auth.welcomeSub")');
  });
});
