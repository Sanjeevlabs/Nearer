// Deliver one message to every device a person has, and tidy up after the push
// services: a 404/410 deletes the subscription, any other refusal counts a failure
// (the row goes after MAX_FAILURES). Missing keys: no-op, said once in the log.
// In mock mode nothing leaves the process; messages are kept in `outbox` for tests.
// Never throws. Server only.
import { sendFcm, serviceAccountFromEnv } from "./fcm";
import { listSubs, noteFailure, noteOk, removeSub } from "./store";
import type { PushMessage, PushSub } from "./types";
import { sendWebPush, vapidFromEnv } from "./webpush";

export interface OutboxEntry {
  familyId: string;
  memberId: string;
  msg: PushMessage;
}

const g = globalThis as unknown as { __nearerPushOutbox?: OutboxEntry[] };
/** Mock mode: what would have been pushed. */
export const outbox: OutboxEntry[] = (g.__nearerPushOutbox ??= []);
export function clearOutbox(): void {
  outbox.length = 0;
}

const warned = new Set<string>();
function warnOnce(what: string): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[push] ${what} is not configured here; those pushes are skipped`);
}
/** Tests. */
export function resetPushWarnings(): void {
  warned.clear();
}

export interface SendDeps {
  fetch?: typeof fetch;
  now?: () => number;
  env?: Record<string, string | undefined>;
  /** Override MOCK (tests drive the real path with a fake fetch). */
  mock?: boolean;
}

export interface SendResult {
  /** Devices the push service accepted the message for. */
  sent: number;
  /** Subscriptions deleted (gone, or too many failures). */
  removed: number;
}

export const isMock = (deps: SendDeps = {}): boolean => deps.mock ?? process.env.MOCK === "true";

/** Does this person have anywhere to be pushed to? (Mock mode: always, so the outbox fills.) */
export async function hasDevice(familyId: string, memberId: string, deps: SendDeps = {}): Promise<boolean> {
  if (isMock(deps)) return true;
  return (await listSubs(familyId, memberId)).length > 0;
}

async function sendOne(sub: PushSub, msg: PushMessage, deps: SendDeps) {
  const env = deps.env ?? process.env;
  if (sub.kind === "fcm") {
    if (!serviceAccountFromEnv(env)) {
      warnOnce("FCM_SERVICE_ACCOUNT");
      return "skipped" as const;
    }
    return sendFcm(sub, msg, deps);
  }
  if (!vapidFromEnv(env)) {
    warnOnce("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
    return "skipped" as const;
  }
  return sendWebPush(sub, msg, deps);
}

export async function pushToMember(familyId: string, memberId: string, msg: PushMessage, deps: SendDeps = {}): Promise<SendResult> {
  const out: SendResult = { sent: 0, removed: 0 };
  try {
    if (isMock(deps)) {
      outbox.push({ familyId, memberId, msg });
      return out;
    }
    for (const sub of await listSubs(familyId, memberId)) {
      const outcome = await sendOne(sub, msg, deps);
      if (outcome === "ok") {
        out.sent++;
        await noteOk(sub);
      } else if (outcome === "gone") {
        await removeSub(sub);
        out.removed++;
      } else if (outcome === "error") {
        if (await noteFailure(sub)) out.removed++;
      }
      // "transient" and "skipped" count against nobody.
    }
  } catch (e) {
    console.error("[push] send failed", String(e));
  }
  return out;
}
