/**
 * Web Push for the installed web app (Android Chrome, desktop browsers, iOS 16.4+ from
 * the Home Screen). Client side only; the server half is lib/push/webpush.ts.
 * Nothing here asks for permission by itself: `enableWebPush` runs from a tap.
 * Every function is safe to call anywhere and never throws.
 */
import { isNative, nativePushGranted, registerPush, unregisterPush } from "./native";

export type PushSupport =
  /** The app on a phone: its own notification permission. */
  | "native"
  /** This browser can be subscribed. */
  | "ready"
  /** iPhone or iPad in Safari: notifications only work once Nearer is on the Home Screen. */
  | "needs-install"
  /** The person said no in the browser: only browser settings can change it. */
  | "blocked"
  | "unsupported";

const ASK_KEY = "aangan:push-ask-until";
/** After "Not now" the card stays away this long. */
export const ASK_PAUSE_MS = 30 * 86_400_000;

function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ says "Macintosh" but has a touch screen.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export function pushSupport(): PushSupport {
  try {
    if (isNative()) return "native";
    if (typeof window === "undefined") return "unsupported";
    if (isIosBrowser() && !isStandalone()) return "needs-install";
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    if (Notification.permission === "denied") return "blocked";
    return "ready";
  } catch {
    return "unsupported";
  }
}

/** "Not now" is remembered for 30 days (this browser only). */
export function askPausedUntil(): number {
  try {
    return Number(localStorage.getItem(ASK_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function pauseAsk(now = Date.now()): void {
  try {
    localStorage.setItem(ASK_KEY, String(now + ASK_PAUSE_MS));
  } catch {
    /* private mode: it may ask again next visit */
  }
}

export function clearAskPause(): void {
  try {
    localStorage.removeItem(ASK_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function askIsPaused(now = Date.now()): boolean {
  return askPausedUntil() > now;
}

function keyBytes(b64url: string): Uint8Array {
  const s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The server's VAPID public key, or null when this server has no push keys (the app then offers nothing). */
export async function serverVapidKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { key?: unknown };
    return typeof j.key === "string" ? j.key : null;
  } catch {
    return null;
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js"));
  } catch {
    return null;
  }
}

/** The browser's current subscription, if there is one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    if (pushSupport() !== "ready" && pushSupport() !== "blocked") return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Is this device already getting notes? (granted and subscribed, or the app with permission) */
export async function pushIsOn(): Promise<boolean> {
  if (isNative()) return nativePushGranted();
  return Boolean(await currentSubscription());
}

export type EnableResult = "on" | "denied" | "needs-install" | "unsupported" | "not-configured" | "failed";

async function sendSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;
  try {
    const res = await fetch("/api/push/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "webpush", subscription: { endpoint: json.endpoint, keys: json.keys } }) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Turn notifications on for this device. Call from a tap: the browser only shows its
 * permission prompt for a user gesture, and iOS refuses otherwise.
 */
export async function enableNotifications(): Promise<EnableResult> {
  try {
    if (isNative()) return (await registerPush()) ? "on" : "denied";
    const support = pushSupport();
    if (support === "needs-install" || support === "unsupported") return support;
    if (support === "blocked") return "denied";
    const key = await serverVapidKey();
    if (!key) return "not-configured";
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = await registration();
    if (!reg) return "failed";
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as unknown as BufferSource }));
    if (!(await sendSubscription(sub))) return "failed";
    clearAskPause();
    return "on";
  } catch {
    return "failed";
  }
}

/** Turn notifications off for this device only (the browser permission stays as it is). */
export async function disableNotifications(): Promise<void> {
  try {
    if (isNative()) return void (await unregisterPush());
    const sub = await currentSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await fetch("/api/push/register", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: endpoint }) }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  } catch {
    /* nothing to turn off */
  }
}

/**
 * Sign-out: this device stops being pushed to for the person who is leaving. Call it
 * BEFORE the session cookie is cleared (the server needs to know who is asking).
 */
export async function forgetPushDevice(): Promise<void> {
  await disableNotifications();
}

/** Signed in on a device that already said yes: make sure the server has its current subscription (keys rotate). */
export async function refreshSubscription(): Promise<void> {
  try {
    if (isNative() || pushSupport() !== "ready" || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await sendSubscription(sub);
  } catch {
    /* quiet */
  }
}
