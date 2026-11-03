import { clearSessionCookieHeader, sessionCookieHeader, sessionFromRequest } from "@/lib/auth";
import { sessionCookie } from "./auth-helper";
import { createFetchGate } from "@/lib/net-gate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { afterSignin, callbackFailure, currentSession, legacySigninRedirect, signinShortcut, signOutEverywhere, suggestedNames, verifyAccessToken, type SessionClient } from "@/lib/auth-session";

function fakeClient(session: { access_token: string; user?: { email?: string; user_metadata?: Record<string, unknown> } } | null) {
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
    expect(session).toEqual({ token: "fresh", email: "a@b.co", name: "" });
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

describe("one door: sign in, then set up", () => {
  it("old ?next= links: join keeps its code and goes to the family's page; create is a plain sign-in", () => {
    expect(legacySigninRedirect("?next=join&code=AB12CD")).toBe("/join/AB12CD");
    expect(legacySigninRedirect("?next=join")).toBe("/join");
    expect(legacySigninRedirect("?next=create")).toBeNull();
    expect(legacySigninRedirect("?next=//evil.test")).toBeNull();
    expect(legacySigninRedirect("")).toBeNull();
  });

  it("sign-in result: family enters, no-family goes to the one setup screen, the rest fail", () => {
    expect(afterSignin({ ok: true })).toEqual({ kind: "enter" });
    expect(afterSignin({ ok: false, error: "no-family" })).toEqual({ kind: "setup" });
    expect(afterSignin({ ok: false, error: "too-many-attempts" })).toEqual({ kind: "failed", error: "too-many-attempts" });
  });

  it("plain sign-in with no family keeps the session for the setup screen", async () => {
    mockVerify(404, { error: "no-family" });
    const { sb, signOut } = fakeClient({ access_token: "tok" });
    const out = await verifyAccessToken(sb, { accessToken: "tok", intent: { type: "signin" } }, (e) => e === "no-family");
    expect(afterSignin(out).kind).toBe("setup");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("the setup screen starts with Google's name, or the email's first word", async () => {
    expect(suggestedNames("Asha Rao", "x@y.co")).toEqual({ firstName: "Asha", familyName: "The Rao family" });
    expect(suggestedNames("Asha", "x@y.co")).toEqual({ firstName: "Asha", familyName: "" });
    expect(suggestedNames("", "asha.rao@y.co")).toEqual({ firstName: "Asha", familyName: "" });
    expect(suggestedNames("", "12345@y.co")).toEqual({ firstName: "", familyName: "" });
    expect(suggestedNames("", "tel:+919876543210")).toEqual({ firstName: "", familyName: "" });
    const { sb } = fakeClient({ access_token: "t", user: { email: "a@b.co", user_metadata: { full_name: "Asha Rao" } } });
    expect((await currentSession(sb))?.name).toBe("Asha Rao");
  });
});

describe("sign out", () => {
  it("runs every step in order and ends with a full load, even when a step fails", async () => {
    const log: string[] = [];
    const step = (n: string, fail = false) => async () => {
      log.push(n);
      if (fail) throw new Error(n);
    };
    await signOutEverywhere(
      {
        stopPollers: () => void log.push("stop"),
        forgetPush: step("push", true),
        deleteSession: step("delete"),
        supabaseSignOut: step("supabase"),
        clearStorage: () => void log.push("storage"),
        clearCaches: () => void log.push("caches"),
        clearServiceWorker: () => void log.push("sw"),
        goTo: (p) => void log.push(`go:${p}`),
      },
      "/signin?next=create",
    );
    expect(log).toEqual(["stop", "push", "delete", "supabase", "storage", "caches", "sw", "go:/signin?next=create"]);
  });

  it("sign-out waits for the service worker caches to clear before the next page loads", async () => {
    const log: string[] = [];
    const noop = async () => undefined;
    await signOutEverywhere({
      stopPollers: () => undefined,
      forgetPush: noop,
      deleteSession: noop,
      supabaseSignOut: noop,
      clearStorage: () => undefined,
      clearCaches: () => undefined,
      clearServiceWorker: async () => {
        await new Promise((r) => setTimeout(r, 5));
        log.push("sw-cleared");
      },
      goTo: () => void log.push("go"),
    });
    expect(log).toEqual(["sw-cleared", "go"]);
  });

  it("the clearing cookie has the attributes of the session cookie, so it replaces it (production adds Secure)", async () => {
    const prev = process.env.NODE_ENV;
    for (const env of ["production", "development"]) {
      vi.stubEnv("NODE_ENV", env);
      const set = sessionCookieHeader("x");
      const clear = clearSessionCookieHeader();
      const attrs = (h: string) => h.split("; ").slice(1).filter((a) => !a.startsWith("Max-Age")).sort();
      expect(attrs(clear)).toEqual(attrs(set));
      expect(clear).toContain("Max-Age=0");
      expect(clear.includes("Secure")).toBe(env === "production");
    }
    vi.unstubAllEnvs();
    expect(process.env.NODE_ENV).toBe(prev);
  });

  it("after the gate closes, a poll in flight is aborted (its response never reaches the browser) and new ones are refused", async () => {
    const seen: string[] = [];
    const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/window") {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;
    const gate = createFetchGate(base);
    const poll = gate.fetch("/api/window");
    gate.close();
    await expect(poll).rejects.toMatchObject({ name: "AbortError" });
    await expect(gate.fetch("/api/courtyard")).rejects.toMatchObject({ name: "AbortError" });
    // Sign-out's own calls, and non-API requests, still go.
    expect((await gate.fetch("/api/session", { method: "DELETE" })).ok).toBe(true);
    expect((await gate.fetch("/api/push/register", { method: "DELETE" })).ok).toBe(true);
    expect((await gate.fetch("/sw.js")).ok).toBe(true);
    expect(seen).not.toContain("GET /api/courtyard");
    // A GET to /api/session is a poll, not the sign-out.
    await expect(gate.fetch("/api/session?family=1")).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("callback failures and the signed-in shortcut", () => {
  it("a magic link opened where it wasn't asked for says so; other failures stay generic", () => {
    expect(callbackFailure({ hasCode: true, hasVerifier: false })).toBe("other-device");
    expect(callbackFailure({ hasCode: true, hasVerifier: true, errorMessage: "invalid request: both auth code and code verifier should be non-empty" })).toBe("other-device");
    expect(callbackFailure({ hasCode: true, hasVerifier: true, errorMessage: "expired" })).toBe("failed");
    expect(callbackFailure({ hasCode: false, hasVerifier: false })).toBe("failed");
  });

  it("/signin goes home for a signed-in person, and stays otherwise", () => {
    expect(signinShortcut({ sessionOk: true, status: "active" })).toBe("home");
    expect(signinShortcut({ sessionOk: true, status: "pending" })).toBe("stay");
    expect(signinShortcut({ sessionOk: false })).toBe("stay");
  });
});

it("rechecks a memoized request when its session cookie changes", () => {
  const req = new Request("http://nearer.test/api/session", { headers: { cookie: sessionCookie("arjun") } });
  expect(sessionFromRequest(req)?.memberId).toBe("arjun");
  expect(sessionFromRequest(req)?.memberId).toBe("arjun");
  req.headers.set("cookie", sessionCookie("dadi"));
  expect(sessionFromRequest(req)?.memberId).toBe("dadi");
  req.headers.delete("cookie");
  expect(sessionFromRequest(req)).toBeNull();
});
