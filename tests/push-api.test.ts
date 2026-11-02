import { beforeEach, describe, expect, it } from "vitest";
import { DELETE as unregister, POST as register } from "@/app/api/push/register/route";
import { GET as vapid } from "@/app/api/push/vapid/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/push/settings/route";
import { POST as testPush } from "@/app/api/push/test/route";
import { clearRateLimits } from "@/lib/auth";
import { dbAddMember, dbRemoveMember } from "@/lib/db";
import { clearOutbox, outbox } from "@/lib/push/send";
import { listSubs, resetPushStore } from "@/lib/push/store";
import { generateVapidKeys } from "@/lib/push/webpush";
import { resetDemo } from "@/lib/store";
import { sessionCookie } from "./auth-helper";

const FAM = "demo-family";
const IYER = "demo-iyer";
const FCM = "fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B64_65 = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const B64_16 = "BTBZMqHH6r4Tts7J_aSIgg";
const WEB = { kind: "webpush", subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: B64_65, auth: B64_16 } } };

const call = (method: string, member: string, body?: unknown, family = FAM, path = "register") =>
  new Request(`http://test/api/push/${path}`, { method, headers: { "content-type": "application/json", cookie: sessionCookie(member, family) }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;

let ravi = "";
beforeEach(async () => {
  resetDemo();
  resetPushStore();
  clearOutbox();
  clearRateLimits();
  ravi = (await dbAddMember({ familyId: IYER, firstName: "Ravi", displayName: "Ravi", role: "adult", tz: "UTC" })).id;
});

describe("POST /api/push/register", () => {
  it("needs a session", async () => {
    const res = await register(new Request("http://test/api/push/register", { method: "POST", body: JSON.stringify({ kind: "fcm", token: FCM }) }));
    expect(res.status).toBe(401);
  });

  it("saves an app token and a browser subscription for the signed-in person, whatever the body says", async () => {
    expect((await register(call("POST", "arjun", { kind: "fcm", token: FCM, platform: "android", memberId: "dadi", familyId: IYER }))).status).toBe(201);
    expect((await register(call("POST", "arjun", WEB))).status).toBe(201);
    const mine = await listSubs(FAM, "arjun");
    expect(mine.map((s) => s.kind).sort()).toEqual(["fcm", "webpush"]);
    expect(mine.find((s) => s.kind === "webpush")).toMatchObject({ token: WEB.subscription.endpoint, p256dh: B64_65, auth: B64_16 });
    expect(await listSubs(FAM, "dadi")).toEqual([]);
    expect(await listSubs(IYER, "arjun")).toEqual([]);
  });

  it("dedupes on the token and re-binds the device to whoever registers it now", async () => {
    await register(call("POST", "arjun", { kind: "fcm", token: FCM }));
    await register(call("POST", "arjun", { kind: "fcm", token: FCM }));
    expect(await listSubs(FAM, "arjun")).toHaveLength(1);
    // The same phone, signed in as someone else in another family.
    const res = await register(call("POST", ravi, { kind: "fcm", token: FCM, platform: "ios" }, IYER));
    expect(res.status).toBe(201);
    expect(await listSubs(FAM, "arjun")).toEqual([]);
    expect(await listSubs(IYER, ravi)).toMatchObject([{ token: FCM, platform: "ios", failures: 0 }]);
  });

  it("refuses bad bodies: short tokens, endpoints that are not push services, wrong key sizes", async () => {
    for (const body of [
      { kind: "fcm", token: "short" },
      { kind: "fcm" },
      { kind: "other", token: FCM },
      { ...WEB, subscription: { ...WEB.subscription, endpoint: "https://evil.example/x" } },
      { ...WEB, subscription: { ...WEB.subscription, endpoint: "http://fcm.googleapis.com/x" } },
      { ...WEB, subscription: { ...WEB.subscription, keys: { p256dh: "AAAA", auth: B64_16 } } },
      { ...WEB, subscription: { ...WEB.subscription, keys: { p256dh: B64_65, auth: "AAAA" } } },
    ]) {
      expect((await register(call("POST", "arjun", body))).status).toBe(400);
    }
    expect(await listSubs(FAM, "arjun")).toEqual([]);
  });

  it("is rate limited", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await register(call("POST", "arjun", { kind: "fcm", token: `${FCM}${i}` }))).status;
    expect(last).toBe(429);
  });

  it("keeps at most ten devices per person", async () => {
    for (let i = 0; i < 10; i++) await register(call("POST", "arjun", { kind: "fcm", token: `${FCM}-${i}` }));
    clearRateLimits();
    for (let i = 10; i < 13; i++) await register(call("POST", "arjun", { kind: "fcm", token: `${FCM}-${i}` }));
    expect(await listSubs(FAM, "arjun")).toHaveLength(10);
  });
});

describe("DELETE /api/push/register", () => {
  it("forgets this person's own device", async () => {
    await register(call("POST", "arjun", { kind: "fcm", token: FCM }));
    const res = await unregister(call("DELETE", "arjun", { token: FCM }));
    expect(await json(res)).toEqual({ ok: true, removed: true });
    expect(await listSubs(FAM, "arjun")).toEqual([]);
  });

  it("cannot remove another family's device, or another member's", async () => {
    await register(call("POST", ravi, { kind: "fcm", token: FCM }, IYER));
    await register(call("POST", "dadi", { kind: "fcm", token: `${FCM}-dadi` }));
    // Arjun (family A) knows Ravi's token: nothing happens.
    expect(await json(await unregister(call("DELETE", "arjun", { token: FCM })))).toEqual({ ok: true, removed: false });
    // Arjun, same family as Dadi: still not his.
    expect(await json(await unregister(call("DELETE", "arjun", { token: `${FCM}-dadi` })))).toEqual({ ok: true, removed: false });
    expect(await listSubs(IYER, ravi)).toHaveLength(1);
    expect(await listSubs(FAM, "dadi")).toHaveLength(1);
  });

  it("needs a session and a token", async () => {
    expect((await unregister(new Request("http://test/api/push/register", { method: "DELETE", body: JSON.stringify({ token: FCM }) }))).status).toBe(401);
    expect((await unregister(call("DELETE", "arjun", {}))).status).toBe(400);
  });

  it("a member leaving the family takes their devices with them", async () => {
    await register(call("POST", "dadi", { kind: "fcm", token: FCM }));
    expect(await dbRemoveMember("dadi")).toBe(true);
    expect(await listSubs(FAM, "dadi")).toEqual([]);
  });
});

describe("GET /api/push/vapid", () => {
  it("is the public key for signed-in people, 404 when the server has none", async () => {
    expect((await vapid(call("GET", "arjun"))).status).toBe(404);
    const keys = await generateVapidKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    try {
      expect(await json(await vapid(call("GET", "arjun")))).toEqual({ key: keys.publicKey });
      expect((await vapid(new Request("http://test/api/push/vapid"))).status).toBe(401);
    } finally {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    }
  });
});

describe("settings and the test button", () => {
  it("everything is on until you switch it off; your switches are yours", async () => {
    const first = await json<{ settings: Record<string, boolean>; devices: number; configured: { app: boolean; web: boolean } }>(await settingsGET(call("GET", "arjun", undefined, FAM, "settings")));
    expect(first.settings).toEqual({ voice: true, lamp: true, asks: true, digest: true, safety: true });
    expect(first.configured).toEqual({ app: false, web: false });
    const put = await settingsPUT(call("PUT", "arjun", { voice: false, lamp: true, asks: true, digest: false, safety: true }, FAM, "settings"));
    expect((await json<{ settings: Record<string, boolean> }>(put)).settings).toMatchObject({ voice: false, digest: false });
    expect((await json<{ settings: Record<string, boolean> }>(await settingsGET(call("GET", "dadi", undefined, FAM, "settings")))).settings.voice).toBe(true);
    expect((await settingsPUT(call("PUT", "arjun", { voice: "yes" }, FAM, "settings"))).status).toBe(400);
  });

  it("'Send me a test' pushes to your own devices only (mock mode records it)", async () => {
    await register(call("POST", "arjun", { kind: "fcm", token: FCM }));
    const res = await json<{ devices: number; sent: number }>(await testPush(call("POST", "arjun", {}, FAM, "test")));
    expect(res).toMatchObject({ devices: 1, sent: 1 });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ familyId: FAM, memberId: "arjun", msg: { title: "Nearer", url: "/", tag: "test" } });
    expect((await testPush(new Request("http://test/api/push/test", { method: "POST" }))).status).toBe(401);
  });
});
