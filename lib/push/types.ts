// Push: shared shapes. Server only (the client helpers live in lib/web-push.ts and lib/native.ts).

export type PushKind = "fcm" | "webpush";

export interface PushSub {
  id: string;
  familyId: string;
  memberId: string;
  kind: PushKind;
  /** FCM/APNs device token, or the Web Push endpoint URL. Unique. */
  token: string;
  p256dh: string | null;
  auth: string | null;
  platform: string;
  createdAt: string;
  lastOkAt: string | null;
  failures: number;
}

/** What the person sees. No counts of inactivity, never a streak. */
export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap goes (an in-app path). */
  url: string;
  /** Same tag = the newer one replaces the older on the phone. */
  tag: string;
  urgency: "high" | "normal" | "low";
}

/**
 * What one send came to:
 *  - ok: delivered to the push service.
 *  - gone: the service says the device or browser is gone (404/410): delete the subscription.
 *  - error: this subscription was refused for another reason: count a failure (dropped after 5).
 *  - transient: a 429, a 5xx or no network: not the subscription's fault, nothing is counted.
 *  - skipped: not configured here (no keys), or our own credentials failed: nothing is counted.
 */
export type SendOutcome = "ok" | "gone" | "error" | "transient" | "skipped";

export type PushCategory = "voice" | "lamp" | "ask" | "safety" | "digest";
