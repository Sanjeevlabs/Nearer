import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/auth";
import { POST as exchangePOST } from "@/app/api/session/route";
import { GET as membersGET } from "@/app/api/members/route";
import { POST as translatePOST } from "@/app/api/translate/route";
import { GET as cronGET, POST as cronPOST } from "@/app/api/ritual-scan/route";
import { authedJson } from "./auth-helper";
import { resetDemo } from "@/lib/store";

const KEY = "test-session-secret";

function cookieFor(memberId = "dadi"): string {
  const signed = signSession({ familyId: "demo-family", memberId }, undefined, KEY);
  if (!signed) throw new Error("no test session");
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

describe("session cookies (HMAC)", () => {
  it("signs and verifies; rejects tampering and expiry", () => {
    const signed = signSession({ familyId: "demo-family", memberId: "leo" }, undefined, KEY);
    expect(signed).toBeTruthy();
    expect(verifySession(signed, KEY)).toMatchObject({ familyId: "demo-family", memberId: "leo" });
    expect(verifySession(`${signed}x`, KEY)).toBeNull();
    expect(verifySession(signed, "wrong-key")).toBeNull();
    const expired = signSession({ familyId: "demo-family", memberId: "leo" }, -1000, KEY);
    expect(verifySession(expired, KEY)).toBeNull();
  });

  it("exchange accepts the demo bootstrap code and rejects bad codes", async () => {
    resetDemo();
    const ok = await exchangePOST(
      new Request("http://test/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId: "leo" }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(ok.headers.get("set-cookie")).toContain("HttpOnly");

    const bad = await exchangePOST(
      new Request("http://test/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: "WRONG", memberId: "leo" }),
      }),
    );
    expect(bad.status).toBe(403);
  });
});

describe("route access control", () => {
  beforeEach(() => resetDemo());

  it("requires a session on every API route", async () => {
    expect((await membersGET(new Request("http://test/api/members"))).status).toBe(401);
    expect(
      (
        await translatePOST(
          new Request("http://test/api/translate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: "hi", targetLang: "en" }),
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("rate-limits model routes per session at 30/min", async () => {
    const cookie = cookieFor("dadi");
    for (let i = 0; i < 30; i++) {
      const res = await translatePOST(
        new Request("http://test/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ text: "Subah ki dua.", targetLang: "en" }),
        }),
      );
      expect(res.status).toBe(200);
    }
    const limited = await translatePOST(
      new Request("http://test/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ text: "Ek aur.", targetLang: "en" }),
      }),
    );
    expect(limited.status).toBe(429);
    // A different member still has budget.
    const other = await translatePOST(authedJson("http://test/api/translate", { text: "Namaste.", targetLang: "en" }, "leo"));
    expect(other.status).toBe(200);
  });

  it("cron route requires the bearer secret; session POST still works", async () => {
    expect((await cronGET(new Request("http://test/api/ritual-scan"))).status).toBe(401);
    const authed = await cronGET(
      new Request("http://test/api/ritual-scan", { headers: { authorization: "Bearer test-cron-secret" } }),
    );
    expect(authed.status).toBe(200);
    const manual = await cronPOST(authedJson("http://test/api/ritual-scan", {}));
    expect(manual.status).toBe(200);
  });
});
