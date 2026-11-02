import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accessToken, fcmBody, jwtClaims, resetFcmToken, sendFcm, serviceAccountFromEnv, signServiceJwt } from "@/lib/push/fcm";
import { b64uDecode } from "@/lib/push/webpush";
import type { PushMessage } from "@/lib/push/types";

const msg: PushMessage = { title: "Nearer", body: "Dadi sent you a voice memory", url: "/lane?card=c1", tag: "voice-c1", urgency: "high" };
let pem = "";
let publicKey: CryptoKey;
let env: Record<string, string>;

function toPem(der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  pem = toPem(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  publicKey = pair.publicKey;
  env = { FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: "nearer-test", client_email: "push@nearer-test.iam.example", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" }) };
});
beforeEach(() => resetFcmToken());

/** A fake Google: the token endpoint answers 200 once, FCM answers `fcm`. */
function google(fcm: { status: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "ya29.test-token", expires_in: 3600 });
    return new Response(JSON.stringify(fcm.body ?? {}), { status: fcm.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("FCM service account", () => {
  it("reads the JSON from FCM_SERVICE_ACCOUNT, or is not configured", () => {
    expect(serviceAccountFromEnv({})).toBeNull();
    expect(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT: "not json" })).toBeNull();
    expect(serviceAccountFromEnv({ FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: "x" }) })).toBeNull();
    expect(serviceAccountFromEnv(env)).toMatchObject({ projectId: "nearer-test", clientEmail: "push@nearer-test.iam.example" });
  });

  it("the JWT assertion has Google's claims and an RS256 signature that verifies", async () => {
    expect(jwtClaims({ clientEmail: "a@b", tokenUri: "https://oauth2.googleapis.com/token" }, 1_000)).toEqual({
      iss: "a@b",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_000,
      exp: 4_600,
    });
    const jwt = await signServiceJwt(serviceAccountFromEnv(env)!, 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    const dec = (x: string) => JSON.parse(new TextDecoder().decode(b64uDecode(x)));
    expect(dec(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(dec(c)).toMatchObject({ iss: "push@nearer-test.iam.example", scope: "https://www.googleapis.com/auth/firebase.messaging", iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, b64uDecode(s) as unknown as BufferSource, new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });
});

describe("FCM access token", () => {
  it("is exchanged once and kept for about 55 minutes", async () => {
    const { f, calls } = google({ status: 200 });
    const sa = serviceAccountFromEnv(env)!;
    let t = 1_700_000_000_000;
    const deps = { fetch: f, now: () => t };
    expect(await accessToken(sa, deps)).toBe("ya29.test-token");
    t += 54 * 60_000;
    expect(await accessToken(sa, deps)).toBe("ya29.test-token");
    expect(calls.length).toBe(1);
    t += 2 * 60_000;
    await accessToken(sa, deps);
    expect(calls.length).toBe(2);
    expect(String(calls[0].init.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
  });
});

describe("sendFcm", () => {
  it("posts a v1 message to the project, with the family channel and a deep link", async () => {
    const { f, calls } = google({ status: 200, body: { name: "projects/nearer-test/messages/1" } });
    expect(await sendFcm({ token: "device-token-0123456789" }, msg, { env, fetch: f })).toBe("ok");
    const send = calls.find((c) => c.url.includes("/messages:send"))!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/nearer-test/messages:send");
    expect((send.init.headers as Record<string, string>).authorization).toBe("Bearer ya29.test-token");
    const body = JSON.parse(String(send.init.body)) as ReturnType<typeof fcmBody>;
    expect(body.message).toMatchObject({
      token: "device-token-0123456789",
      notification: { title: "Nearer", body: "Dadi sent you a voice memory" },
      data: { url: "/lane?card=c1", tag: "voice-c1" },
      android: { priority: "HIGH", collapse_key: "voice-c1", notification: { channel_id: "family", tag: "voice-c1" } },
    });
    for (const v of Object.values((body.message as { data: Record<string, unknown> }).data)) expect(typeof v).toBe("string");
  });

  it("404 and UNREGISTERED mean the device is gone", async () => {
    expect(await sendFcm({ token: "t" }, msg, { env, fetch: google({ status: 404, body: { error: { status: "NOT_FOUND" } } }).f })).toBe("gone");
    resetFcmToken();
    expect(await sendFcm({ token: "t" }, msg, { env, fetch: google({ status: 400, body: { error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "UNREGISTERED" }] } } }).f })).toBe("gone");
  });

  it("other refusals count against the device; our own credentials and Google's outages do not", async () => {
    expect(await sendFcm({ token: "t" }, msg, { env, fetch: google({ status: 400, body: { error: { status: "INVALID_ARGUMENT" } } }).f })).toBe("error");
    expect(await sendFcm({ token: "t" }, msg, { env, fetch: google({ status: 403 }).f })).toBe("skipped");
    expect(await sendFcm({ token: "t" }, msg, { env, fetch: google({ status: 503 }).f })).toBe("transient");
    expect(await sendFcm({ token: "t" }, msg, { env, fetch: google({ status: 429 }).f })).toBe("transient");
  });

  it("does nothing without FCM_SERVICE_ACCOUNT (no request at all)", async () => {
    let called = 0;
    const out = await sendFcm({ token: "t" }, msg, { env: {}, fetch: (async () => (called++, new Response("{}"))) as unknown as typeof fetch });
    expect(out).toBe("skipped");
    expect(called).toBe(0);
  });

  it("a refused token request (bad service account) is skipped, not blamed on the device", async () => {
    const f = (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch;
    expect(await sendFcm({ token: "t" }, msg, { env, fetch: f })).toBe("skipped");
  });
});
