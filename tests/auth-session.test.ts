import { afterEach, describe, expect, it, vi } from "vitest";
import { currentSession, verifyAccessToken, type SessionClient } from "@/lib/auth-session";

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
