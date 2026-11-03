import { afterEach, describe, expect, it, vi } from "vitest";
import { afterAuth, afterSignin, currentSession, entryHref, gateDecision, nextHref, parseNext, signinHref, verifyAccessToken, type SessionClient } from "@/lib/auth-session";

function fakeClient(session: { access_token: string; user?: { email?: string } } | null) {
  const signOut = vi.fn(async () => ({}));
  const sb: SessionClient = { auth: { getSession: async () => ({ data: { session } }), signOut } };
  return { sb, signOut };
}
function mockVerify(status: number, body: object) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("signed in, no family yet (Google)", () => {
  it("the callback keeps the Supabase session on no-family", async () => {
    mockVerify(404, { error: "no-family" });
    const { sb, signOut } = fakeClient({ access_token: "tok" });
    const out = await verifyAccessToken(sb, { accessToken: "tok" }, (e) => e === "no-family");
    expect(out).toEqual({ ok: false, error: "no-family" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("the callback still drops the session on success and on other failures", async () => {
    for (const [status, body] of [[200, { familyId: "f" }], [401, { error: "wrong-code" }], [500, {}]] as const) {
      mockVerify(status, body);
      const { sb, signOut } = fakeClient({ access_token: "tok" });
      await verifyAccessToken(sb, { accessToken: "tok" }, (e) => e === "no-family");
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    }
  });

  it("create details reuse the session: POST with the access token and a create intent, no email step", async () => {
    const fetchMock = mockVerify(200, { welcome: "hi" });
    const { sb, signOut } = fakeClient({ access_token: "fresh", user: { email: "a@b.co" } });
    const session = await currentSession(sb);
    expect(session).toEqual({ token: "fresh", email: "a@b.co" });
    const intent = { type: "create", familyName: "Iyers", firstName: "Asha" };
    const out = await verifyAccessToken(sb, { accessToken: session!.token, intent, tz: "UTC" }, (e) => e !== "wrong-code");
    expect(out).toEqual({ ok: true, welcome: "hi", status: undefined });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/verify");
    const sent = JSON.parse(init.body as string);
    expect(sent.accessToken).toBe("fresh");
    expect(sent.intent.type).toBe("create");
    expect(sent.mode).toBeUndefined();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("a bad invite code keeps the session so they can fix it; a rejected token drops it", async () => {
    mockVerify(403, { error: "invalid-invite" });
    const a = fakeClient({ access_token: "t" });
    await verifyAccessToken(a.sb, {}, (e) => e !== "wrong-code");
    expect(a.signOut).not.toHaveBeenCalled();
    mockVerify(401, { error: "wrong-code" });
    const b = fakeClient({ access_token: "t" });
    await verifyAccessToken(b.sb, {}, (e) => e !== "wrong-code");
    expect(b.signOut).toHaveBeenCalled();
  });

  it("no session: nothing to reuse, so the details step goes on to the email step as before", async () => {
    expect(await currentSession(fakeClient(null).sb)).toBeNull();
    expect(await currentSession({ auth: { getSession: async () => { throw new Error("x"); }, signOut: async () => ({}) } })).toBeNull();
  });
});

describe("identity first, then family", () => {
  it("reads ?next=create and ?next=join&code=, ignores anything else", () => {
    expect(parseNext("?next=create")).toEqual({ next: "create" });
    expect(parseNext("?next=join&code=AB12CD")).toEqual({ next: "join", code: "AB12CD" });
    expect(parseNext("?next=create&code=AB12CD")).toEqual({ next: "create" });
    expect(parseNext("?next=//evil.test")).toEqual({ next: null });
    expect(parseNext("")).toEqual({ next: null });
  });

  it("after auth with a next, go to the form and do not verify; without one, verify as sign-in", () => {
    expect(afterAuth({ next: "create" })).toEqual({ to: "/create", verify: false });
    expect(afterAuth({ next: "join", code: "A B" })).toEqual({ to: "/join?code=A%20B", verify: false });
    expect(afterAuth({ next: null })).toEqual({ verify: true });
    expect(nextHref({ next: null })).toBe("/");
  });

  it("sign-in result: family enters, no-family shows the chooser, the rest fail", () => {
    expect(afterSignin({ ok: true })).toEqual({ kind: "enter" });
    expect(afterSignin({ ok: false, error: "no-family" })).toEqual({ kind: "chooser" });
    expect(afterSignin({ ok: false, error: "too-many-attempts" })).toEqual({ kind: "failed", error: "too-many-attempts" });
  });

  it("the OTP path keeps the session on no-family, like the callback", async () => {
    mockVerify(404, { error: "no-family" });
    const { sb, signOut } = fakeClient({ access_token: "tok" });
    const out = await verifyAccessToken(sb, { accessToken: "tok", intent: { type: "signin" } }, (e) => e === "no-family");
    expect(afterSignin(out).kind).toBe("chooser");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("/create and /join need a session when sign-in is live, and do not in mock mode", () => {
    expect(gateDecision({ live: true, hasSession: false, kind: "create" })).toEqual({ stay: false, to: "/signin?next=create" });
    expect(gateDecision({ live: true, hasSession: false, kind: "join", code: "ab12cd" })).toEqual({ stay: false, to: "/signin?next=join&code=ab12cd" });
    expect(gateDecision({ live: true, hasSession: true, kind: "create" })).toEqual({ stay: true });
    expect(gateDecision({ live: false, hasSession: false, kind: "create" })).toEqual({ stay: true });
    expect(gateDecision({ live: true, hasSession: false, kind: "create", resume: true })).toEqual({ stay: true });
  });

  it("entry links go through /signin when live and straight to the form in mock mode", () => {
    expect(entryHref(true, "create")).toBe("/signin?next=create");
    expect(entryHref(true, "join", "XY12")).toBe("/signin?next=join&code=XY12");
    expect(entryHref(false, "create")).toBe("/create");
    expect(entryHref(false, "join")).toBe("/join");
    expect(signinHref("create", undefined, true)).toBe("/signin?next=create&expired=1");
  });
});
