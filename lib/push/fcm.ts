// Push to the native apps through Firebase Cloud Messaging HTTP v1 (Android directly;
// iOS through FCM's APNs bridge once an APNs key is uploaded to Firebase).
// Auth is a Google service account: a short RS256 JWT, signed with WebCrypto, is
// exchanged at the token endpoint for an access token that lives an hour; we keep it
// ~55 minutes. No Google SDK (they need Node), so this runs on Cloudflare Workers.
// Server only.
import { b64uEncode } from "./webpush";
import type { PushMessage, PushSub, SendOutcome } from "./types";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Renew a little before Google's one hour is up. */
const TOKEN_KEEP_MS = 55 * 60_000;

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  /** PEM, PKCS#8. */
  privateKey: string;
  tokenUri: string;
}

/** FCM_SERVICE_ACCOUNT is the downloaded service-account JSON, as one string. Null when absent or unusable. */
export function serviceAccountFromEnv(env: Record<string, string | undefined> = process.env): ServiceAccount | null {
  const raw = env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const projectId = typeof j.project_id === "string" ? j.project_id : "";
    const clientEmail = typeof j.client_email === "string" ? j.client_email : "";
    const privateKey = typeof j.private_key === "string" ? j.private_key.replace(/\\n/g, "\n") : "";
    if (!projectId || !clientEmail || !privateKey.includes("BEGIN PRIVATE KEY")) return null;
    // Only Google's own token endpoint ever gets the signed assertion.
    const tokenUri = typeof j.token_uri === "string" && j.token_uri === TOKEN_URI ? j.token_uri : TOKEN_URI;
    return { projectId, clientEmail, privateKey, tokenUri };
  } catch {
    return null;
  }
}

/** The claims Google wants in the JWT assertion. */
export function jwtClaims(sa: Pick<ServiceAccount, "clientEmail" | "tokenUri">, nowSec: number): { iss: string; scope: string; aud: string; iat: number; exp: number } {
  return { iss: sa.clientEmail, scope: SCOPE, aud: sa.tokenUri, iat: nowSec, exp: nowSec + 3600 };
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function signServiceJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const enc = new TextEncoder();
  const header = b64uEncode(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64uEncode(enc.encode(JSON.stringify(jwtClaims(sa, nowSec))));
  const der = pemToDer(sa.privateKey);
  const key = await crypto.subtle.importKey("pkcs8", der as unknown as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64uEncode(sig)}`;
}

export interface FcmDeps {
  fetch?: typeof fetch;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

// One token per isolate; a Worker isolate is short-lived, so at worst we mint one per isolate.
let cached: { key: string; token: string; until: number } | null = null;

/** Test hook. */
export function resetFcmToken(): void {
  cached = null;
}

/** An OAuth access token for the service account, or null when Google refused (credentials wrong). */
export async function accessToken(sa: ServiceAccount, deps: FcmDeps = {}): Promise<string | null> {
  const now = (deps.now ?? Date.now)();
  const key = `${sa.clientEmail}|${sa.projectId}`;
  if (cached && cached.key === key && cached.until > now) return cached.token;
  const doFetch = deps.fetch ?? fetch;
  try {
    const assertion = await signServiceJwt(sa, Math.floor(now / 1000));
    const res = await doFetch(sa.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!res.ok) {
      console.error("[push] FCM token request refused", res.status);
      return null;
    }
    const j = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (typeof j?.access_token !== "string") return null;
    cached = { key, token: j.access_token, until: now + TOKEN_KEEP_MS };
    return j.access_token;
  } catch (e) {
    console.error("[push] FCM token request failed", String(e));
    return null;
  }
}

/** The FCM v1 message. `data` values must be strings. */
export function fcmBody(token: string, msg: PushMessage): { message: Record<string, unknown> } {
  return {
    message: {
      token,
      notification: { title: msg.title, body: msg.body },
      data: { url: msg.url, tag: msg.tag },
      android: {
        priority: msg.urgency === "high" ? "HIGH" : "NORMAL",
        collapse_key: msg.tag,
        ttl: msg.urgency === "low" ? "86400s" : msg.urgency === "high" ? "3600s" : "21600s",
        notification: { channel_id: "family", tag: msg.tag },
      },
      apns: {
        headers: { "apns-collapse-id": msg.tag.slice(0, 64), "apns-priority": msg.urgency === "high" ? "10" : "5" },
        payload: { aps: { sound: "default" } },
      },
    },
  };
}

function isUnregistered(body: unknown): boolean {
  const e = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error;
  if (!e) return false;
  if (e.status === "NOT_FOUND") return true;
  return Array.isArray(e.details) && e.details.some((d) => (d as { errorCode?: unknown })?.errorCode === "UNREGISTERED");
}

export async function sendFcm(sub: Pick<PushSub, "token">, msg: PushMessage, deps: FcmDeps = {}): Promise<SendOutcome> {
  const sa = serviceAccountFromEnv(deps.env ?? process.env);
  if (!sa) return "skipped";
  const doFetch = deps.fetch ?? fetch;
  const access = await accessToken(sa, deps);
  if (!access) return "skipped";
  try {
    const res = await doFetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.projectId)}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify(fcmBody(sub.token, msg)),
    });
    if (res.ok) return "ok";
    const body = await res.json().catch(() => null);
    if (res.status === 404 || res.status === 410 || isUnregistered(body)) return "gone";
    if (res.status === 401 || res.status === 403) {
      // Our token or the service account's rights, not this device's fault: mint a fresh token next time.
      cached = null;
      console.error("[push] FCM refused our credentials", res.status);
      return "skipped";
    }
    if (res.status === 429 || res.status >= 500) return "transient";
    return "error";
  } catch (e) {
    console.error("[push] FCM send failed", String(e));
    return "transient";
  }
}
