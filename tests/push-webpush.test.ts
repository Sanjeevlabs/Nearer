import { describe, expect, it } from "vitest";
import { b64uDecode, b64uEncode, encryptPayload, generateVapidKeys, isPushEndpoint, sendWebPush, signVapidJwt, vapidAuthorization, vapidClaims, vapidFromEnv } from "@/lib/push/webpush";
import type { PushMessage } from "@/lib/push/types";

// RFC 8291, Appendix A: the example message, byte for byte.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
const enc = (s: string) => new TextEncoder().encode(s);
const msg: PushMessage = { title: "Nearer", body: "Dadi sent you a voice note", url: "/lane?card=c1", tag: "voice-c1", urgency: "high" };

describe("Web Push encryption (RFC 8291, aes128gcm)", () => {
  it("reproduces the RFC 8291 Appendix A message exactly", async () => {
    const body = await encryptPayload(enc(RFC.plaintext), RFC.uaPublic, RFC.auth, { salt: b64uDecode(RFC.salt), ephemeral: { privateKey: RFC.asPrivate, publicKey: RFC.asPublic } });
    expect(b64uEncode(body)).toBe(RFC.body);
    expect(body.length).toBe(86 + RFC.plaintext.length + 1 + 16);
  });

  it("round-trips: the browser's private key opens what we sealed, with fresh keys", async () => {
    const body = await encryptPayload(enc("Hello, family"), RFC.uaPublic, RFC.auth);
    // Header: salt(16) rs(4) idlen(1) keyid(65).
    expect(body[20]).toBe(65);
    const asPublic = body.slice(21, 86);
    const salt = body.slice(0, 16);
    const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: string, n: number) =>
      new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s as unknown as BufferSource, info: enc(info) }, await crypto.subtle.importKey("raw", ikm as unknown as BufferSource, "HKDF", false, ["deriveBits"]), n * 8));
    const jwk = (pub: Uint8Array, d?: string): JsonWebKey => ({ kty: "EC", crv: "P-256", x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ...(d ? { d } : {}) });
    const uaPub = b64uDecode(RFC.uaPublic);
    const uaPriv = await crypto.subtle.importKey("jwk", jwk(uaPub, RFC.uaPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const asPub = await crypto.subtle.importKey("jwk", jwk(asPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asPub }, uaPriv, 256));
    const keyInfo = new Uint8Array([...enc("WebPush: info\0"), ...uaPub, ...asPublic]);
    const ikm = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: b64uDecode(RFC.auth) as unknown as BufferSource, info: keyInfo }, await crypto.subtle.importKey("raw", ecdh as unknown as BufferSource, "HKDF", false, ["deriveBits"]), 256));
    const cek = await hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16);
    const nonce = await hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);
    const aes = await crypto.subtle.importKey("raw", cek as unknown as BufferSource, "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as unknown as BufferSource }, aes, body.slice(86) as unknown as BufferSource));
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe("Hello, family");
    expect(plain[plain.length - 1]).toBe(2);
  });

  it("refuses a payload that cannot fit in one record", async () => {
    await expect(encryptPayload(new Uint8Array(4000), RFC.uaPublic, RFC.auth)).rejects.toThrow(/too large/);
  });
});

describe("VAPID (RFC 8292)", () => {
  it("claims name the push service's origin, expire within 24 hours, and carry the subject", () => {
    expect(vapidClaims("https://fcm.googleapis.com/fcm/send/abc", "mailto:hello@nearer.site", 1_000)).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_000 + 12 * 3600, sub: "mailto:hello@nearer.site" });
  });

  it("signs an ES256 JWT that verifies with the public key, and builds the Authorization header", async () => {
    const keys = await generateVapidKeys();
    const vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:hello@nearer.site" };
    const endpoint = "https://updates.push.services.mozilla.com/wpush/v2/xyz";
    const jwt = await signVapidJwt(endpoint, vapid, 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64uDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64uDecode(c)))).toEqual({ aud: "https://updates.push.services.mozilla.com", exp: 1_700_000_000 + 43_200, sub: "mailto:hello@nearer.site" });
    expect(b64uDecode(s).length).toBe(64);
    const pub = b64uDecode(keys.publicKey);
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)) }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64uDecode(s) as unknown as BufferSource, enc(`${h}.${c}`) as unknown as BufferSource)).toBe(true);
    const header = await vapidAuthorization(endpoint, vapid, 1_700_000_000);
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
  });

  it("reads the keys from the environment, or says there are none", async () => {
    const keys = await generateVapidKeys();
    expect(vapidFromEnv({})).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey })).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY: "short" })).toBeNull();
    expect(vapidFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey })?.subject).toBe("mailto:hello@nearer.site");
  });
});

describe("push endpoints are only the browsers' own push services", () => {
  it("accepts the real ones and refuses anything else (a subscription is user-supplied)", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });
});

describe("sendWebPush", () => {
  const sub = { token: "https://fcm.googleapis.com/fcm/send/abc", p256dh: RFC.uaPublic, auth: RFC.auth };

  it("does nothing without VAPID keys (no request at all)", async () => {
    let called = 0;
    const out = await sendWebPush(sub, msg, { env: {}, fetch: (async () => (called++, new Response(null, { status: 201 }))) as typeof fetch });
    expect(out).toBe("skipped");
    expect(called).toBe(0);
  });

  it("posts an encrypted body with VAPID, TTL, urgency and topic", async () => {
    const keys = await generateVapidKeys();
    const seen: { url: string; init: RequestInit }[] = [];
    const out = await sendWebPush(sub, msg, {
      env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey },
      fetch: (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(null, { status: 201 }))) as unknown as typeof fetch,
    });
    expect(out).toBe("ok");
    const h = seen[0].init.headers as Record<string, string>;
    expect(seen[0].url).toBe(sub.token);
    expect(h["content-encoding"]).toBe("aes128gcm");
    expect(h.authorization).toMatch(/^vapid t=/);
    expect(h.urgency).toBe("high");
    expect(Number(h.ttl)).toBeGreaterThan(0);
    expect(h.topic.length).toBeLessThanOrEqual(32);
    expect((seen[0].init.body as Uint8Array).length).toBeGreaterThan(86 + 16);
  });

  it("sorts results: 404 and 410 are gone, 4xx an error, 429 and 5xx and no network transient", async () => {
    const keys = await generateVapidKeys();
    const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
    const status = (code: number) => sendWebPush(sub, msg, { env, fetch: (async () => new Response(null, { status: code })) as unknown as typeof fetch });
    expect(await status(404)).toBe("gone");
    expect(await status(410)).toBe("gone");
    expect(await status(400)).toBe("error");
    expect(await status(403)).toBe("error");
    expect(await status(429)).toBe("transient");
    expect(await status(503)).toBe("transient");
    expect(await sendWebPush(sub, msg, { env, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch })).toBe("transient");
  });

  it("a subscription without keys, or pointing somewhere else, is gone, not fetched", async () => {
    const keys = await generateVapidKeys();
    const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
    let called = 0;
    const f = (async () => (called++, new Response(null, { status: 201 }))) as unknown as typeof fetch;
    expect(await sendWebPush({ token: "https://evil.example/x", p256dh: RFC.uaPublic, auth: RFC.auth }, msg, { env, fetch: f })).toBe("gone");
    expect(await sendWebPush({ token: sub.token, p256dh: null, auth: null }, msg, { env, fetch: f })).toBe("gone");
    expect(called).toBe(0);
  });
});
