// Web Push for installed web apps (Android, desktop, iOS 16.4+ from the Home Screen).
// Written against WebCrypto only, so it runs on Cloudflare Workers (no Node crypto, no
// "web-push" package, which needs Node's http and crypto):
//  - VAPID (RFC 8292): an ES256 JWT in `Authorization: vapid t=<jwt>, k=<public key>`.
//  - Message encryption (RFC 8291) in the aes128gcm content coding (RFC 8188).
// tests/push-webpush.test.ts checks the encryption against the RFC 8291 Appendix A vector.
// Server only.
import { SERVICE_TIMEOUT_MS, fetchWithTimeout } from "../timeouts";
import type { PushMessage, PushSub, SendOutcome } from "./types";

// ---------------------------------------------------------------- base64url
export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(text: string): Uint8Array {
  const s = text.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// TypeScript's DOM lib wants an ArrayBuffer-backed view; ours always are.
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

// ---------------------------------------------------------------------- keys
/** A P-256 public key (65 bytes, 0x04 || X || Y) as a JWK, optionally with its private scalar. */
function ecJwk(publicKey: Uint8Array, privateScalar?: Uint8Array): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("push: public key must be an uncompressed P-256 point");
  return { kty: "EC", crv: "P-256", x: b64uEncode(publicKey.slice(1, 33)), y: b64uEncode(publicKey.slice(33, 65)), ...(privateScalar ? { d: b64uEncode(privateScalar) } : {}), ext: true };
}

export interface EphemeralKey {
  /** 32-byte private scalar, base64url. */
  privateKey: string;
  /** 65-byte uncompressed public point, base64url. */
  publicKey: string;
}

/** VAPID / sender key pair as printed by scripts/vapid-keys.mjs. */
export async function generateVapidKeys(): Promise<EphemeralKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const pub = concat(new Uint8Array([4]), b64uDecode(jwk.x as string), b64uDecode(jwk.y as string));
  return { privateKey: jwk.d as string, publicKey: b64uEncode(pub) };
}

// --------------------------------------------------------------------- VAPID
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The three VAPID_* variables, or null when any is missing or not a usable key pair. */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  try {
    if (b64uDecode(publicKey).length !== 65 || b64uDecode(privateKey).length !== 32) return null;
  } catch {
    return null;
  }
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:hello@nearer.site";
  return { publicKey, privateKey, subject };
}

/** Claims of a VAPID JWT: audience is the push service's origin; it may live 24 hours at most (we use 12). */
export function vapidClaims(endpoint: string, subject: string, nowSec: number): { aud: string; exp: number; sub: string } {
  return { aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject };
}

export async function signVapidJwt(endpoint: string, vapid: VapidConfig, nowSec: number): Promise<string> {
  const header = b64uEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(utf8(JSON.stringify(vapidClaims(endpoint, vapid.subject, nowSec))));
  const key = await crypto.subtle.importKey("jwk", ecJwk(b64uDecode(vapid.publicKey), b64uDecode(vapid.privateKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto's ECDSA output is already the raw r || s that JWS (ES256) wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, buf(utf8(`${header}.${claims}`))));
  return `${header}.${claims}.${b64uEncode(sig)}`;
}

export async function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowSec: number): Promise<string> {
  return `vapid t=${await signVapidJwt(endpoint, vapid, nowSec)}, k=${vapid.publicKey}`;
}

// ---------------------------------------------------------------- encryption
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, bytes * 8));
}

/** Record size in the header. One record only: a notification is far smaller. */
export const RECORD_SIZE = 4096;
/** Push services accept 4096 bytes of body: minus the 86-byte header, the 16-byte tag and the 1-byte delimiter. */
export const MAX_PLAINTEXT = 4096 - 86 - 16 - 1;

export interface EncryptOptions {
  /** 16 random bytes; fixed only by tests. */
  salt?: Uint8Array;
  /** The sender's one-time key pair; generated per message unless a test fixes it. */
  ephemeral?: EphemeralKey;
}

/**
 * RFC 8291 (aes128gcm). `p256dh` is the browser's public key and `auth` its 16-byte secret,
 * both base64url as PushSubscription.toJSON() gives them. Returns the request body:
 * salt(16) || record size(4) || key id length(1) || sender public key(65) || ciphertext.
 */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, auth: string, opts: EncryptOptions = {}): Promise<Uint8Array> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error("push: payload too large");
  const uaPublic = b64uDecode(p256dh);
  const authSecret = b64uDecode(auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;
  if (opts.ephemeral) {
    asPublic = b64uDecode(opts.ephemeral.publicKey);
    asPrivateKey = await crypto.subtle.importKey("jwk", ecJwk(asPublic, b64uDecode(opts.ephemeral.privateKey)), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    asPrivateKey = pair.privateKey;
  }
  const uaKey = await crypto.subtle.importKey("jwk", ecJwk(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivateKey, 256));
  // IKM = HKDF(salt = auth_secret, ikm = ecdh_secret, info = "WebPush: info" 0x00 || ua_public || as_public)
  const ikm = await hkdf(authSecret, ecdh, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  // The last (only) record ends with the 0x02 delimiter.
  const record = concat(plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, aes, buf(record)));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// ------------------------------------------------------------------- sending
export interface WebPushDeps {
  fetch?: typeof fetch;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

/** The push services we will POST to. A subscription is user-supplied, so anything else is refused (no SSRF). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function isPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const TTL: Record<PushMessage["urgency"], number> = { high: 3600, normal: 6 * 3600, low: 24 * 3600 };

/** The JSON the service worker's `push` handler reads (public/sw.js). */
export function webPayload(msg: PushMessage): string {
  return JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag });
}

/** A Topic header value: 32 characters of URL-safe base64 at most, so collapse works across retries. */
function topicOf(tag: string): string {
  return b64uEncode(utf8(tag)).slice(0, 32);
}

export async function sendWebPush(sub: Pick<PushSub, "token" | "p256dh" | "auth">, msg: PushMessage, deps: WebPushDeps = {}): Promise<SendOutcome> {
  const vapid = vapidFromEnv(deps.env ?? process.env);
  if (!vapid) return "skipped";
  if (!sub.p256dh || !sub.auth || !isPushEndpoint(sub.token)) return "gone";
  const doFetch = fetchWithTimeout(SERVICE_TIMEOUT_MS, deps.fetch ?? fetch);
  try {
    const nowSec = Math.floor((deps.now ?? Date.now)() / 1000);
    const body = await encryptPayload(utf8(webPayload(msg)), sub.p256dh, sub.auth);
    const res = await doFetch(sub.token, {
      method: "POST",
      headers: {
        authorization: await vapidAuthorization(sub.token, vapid, nowSec),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL[msg.urgency]),
        urgency: msg.urgency === "high" ? "high" : msg.urgency === "low" ? "very-low" : "normal",
        topic: topicOf(msg.tag),
      },
      body: buf(body),
    });
    if (res.ok) return "ok";
    if (res.status === 404 || res.status === 410) return "gone";
    if (res.status === 429 || res.status >= 500) return "transient";
    return "error";
  } catch (e) {
    console.error("[push] web push failed", String(e));
    return "transient";
  }
}
