// Never logged out: a session slides. A request in the second half of its lifetime re-issues the
// cookie (90 days for the elder generation, 14 for everyone else); membership is still re-checked on
// every request, so someone removed loses access at once and is never renewed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as lampGet } from "@/app/api/lamp/route";
import { ELDER_SESSION_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, renewalDue, sessionTtlFor, verifySession } from "@/lib/auth";
import { signedSession } from "./auth-helper";
import { dbRemoveMember } from "@/lib/db";
import { resetDemo } from "@/lib/store";

const KEY = "test-session-secret";
const D = 86_400_000;
const NOW = new Date("2026-11-02T09:00:00.000Z");

/** A request whose cookie has `leftMs` of life left. */
function reqWith(memberId: string, leftMs: number): Request {
  const { signed } = signedSession(memberId, "demo-family", leftMs);
  return new Request("http://t/api/lamp", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` } });
}

/** The session in the cookie a response set, or null when it set none. */
function renewed(res: Response): { session: NonNullable<ReturnType<typeof verifySession>>; maxAge: number } | null {
  const header = res.headers.get("set-cookie");
  if (!header) return null;
  const m = new RegExp(`^${SESSION_COOKIE}=([^;]+);.*Max-Age=(\\d+)`).exec(header);
  if (!m) return null;
  const session = verifySession(decodeURIComponent(m[1]), KEY);
  return session ? { session, maxAge: Number(m[2]) } : null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetDemo();
});
afterEach(() => vi.useRealTimers());

describe("the sliding rule (pure)", () => {
  it("renews only in the second half of the lifetime", () => {
    const now = NOW.getTime();
    expect(renewalDue({ exp: now + 14 * D }, SESSION_TTL_MS, now)).toBe(false);
    expect(renewalDue({ exp: now + 8 * D }, SESSION_TTL_MS, now)).toBe(false);
    expect(renewalDue({ exp: now + 6 * D }, SESSION_TTL_MS, now)).toBe(true);
    expect(renewalDue({ exp: now + 44 * D }, ELDER_SESSION_TTL_MS, now)).toBe(true);
    expect(renewalDue({ exp: now + 46 * D }, ELDER_SESSION_TTL_MS, now)).toBe(false);
  });
  it("elders get 90 days, everyone else 14", () => {
    expect(sessionTtlFor({ role: "elder" })).toBe(90 * D);
    expect(sessionTtlFor({ role: "adult" })).toBe(14 * D);
    expect(sessionTtlFor({ role: "child" })).toBe(14 * D);
    expect(sessionTtlFor(undefined)).toBe(14 * D);
  });
});

describe("a request slides the session", () => {
  it("a parent who signed in for 14 days is moved to a 90-day cookie on the next request", async () => {
    const res = await lampGet(reqWith("dadi", 13 * D));
    expect(res.status).toBe(200);
    const r = renewed(res);
    expect(r?.session).toMatchObject({ familyId: "demo-family", memberId: "dadi" });
    expect(r?.session.exp).toBe(NOW.getTime() + 90 * D);
    expect(r?.maxAge).toBe(90 * 86_400);
  });

  it("a parent with plenty left is left alone; with under 45 days left the cookie is renewed", async () => {
    expect(renewed(await lampGet(reqWith("dadi", 80 * D)))).toBeNull();
    expect(renewed(await lampGet(reqWith("dadi", 44 * D)))?.session.exp).toBe(NOW.getTime() + 90 * D);
  });

  it("everyone else keeps 14 days, sliding from the second half", async () => {
    expect(renewed(await lampGet(reqWith("arjun", 10 * D)))).toBeNull();
    const r = renewed(await lampGet(reqWith("arjun", 6 * D)));
    expect(r?.session.exp).toBe(NOW.getTime() + 14 * D);
    expect(r?.maxAge).toBe(14 * 86_400);
  });

  it("an expired or forged cookie is not renewed", async () => {
    expect((await lampGet(reqWith("arjun", -D))).status).toBe(401);
    const bad = new Request("http://t/api/lamp", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent("e30.deadbeef")}` } });
    const res = await lampGet(bad);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("someone removed from the family loses access at once and is never renewed", async () => {
    expect((await lampGet(reqWith("arjun", 6 * D))).status).toBe(200);
    await dbRemoveMember("arjun");
    const res = await lampGet(reqWith("arjun", 6 * D));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
