import { beforeEach, describe, expect, it } from "vitest";
import { GET as passGet, POST as passPost } from "@/app/api/session/pass/route";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { dbAddMember, dbCreateFamily } from "@/lib/db";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const post = (member: string, family: string, memberId: string) =>
  passPost(new Request("http://test/api/session/pass", { method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie(member, family) }, body: JSON.stringify({ memberId }) }));

describe("demo pass (see it from the other side)", () => {
  beforeEach(() => resetDemo());

  it("mints a pass for another member of the same demo family, and redeeming it signs in as them", async () => {
    const res = await post("arjun", "demo-family", "dadi");
    expect(res.status).toBe(200);
    const { path, name } = (await res.json()) as { path: string; name: string };
    expect(name).toBeTruthy();
    const back = await passGet(new Request(`http://test${path}`));
    expect(back.status).toBe(302);
    const cookie = back.headers.get("set-cookie") ?? "";
    const value = decodeURIComponent(cookie.split(";")[0].slice(SESSION_COOKIE.length + 1));
    expect(verifySession(value)?.memberId).toBe("dadi");
  });

  it("is demo only, and never crosses families", async () => {
    const familyId = await dbCreateFamily("Real");
    const a = await dbAddMember({ familyId, firstName: "A", displayName: "A", role: "adult", access: "admin", tz: "Asia/Kolkata" });
    const b = await dbAddMember({ familyId, firstName: "B", displayName: "B", role: "elder", access: "member", tz: "Asia/Kolkata" });
    expect((await post(a.id, familyId, b.id)).status).toBe(403);
    expect((await post("arjun", "demo-family", b.id)).status).toBe(404);
  });

  it("a bad or missing pass sets no cookie", async () => {
    const r = await passGet(new Request("http://test/api/session/pass?t=nope.nope"));
    expect(r.status).toBe(302);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});
