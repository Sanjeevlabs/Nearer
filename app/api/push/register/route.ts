import { isDemoFamily } from "@/lib/family";
import { isMock } from "@/lib/push/send";
import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { removeByToken, upsertSub } from "@/lib/push/store";
import { b64uDecode, isPushEndpoint } from "@/lib/push/webpush";

// A phone or browser that wants to be pushed to. Your own devices only: the member and
// family come from the session, never the body. The token is unique, so a device that
// signs in as someone else is re-bound to them, not duplicated.
// POST   { kind: "fcm", token, platform } | { kind: "webpush", subscription }  -> save this device
// DELETE { token } (the FCM token, or the Web Push endpoint)                    -> forget this device (sign-out, turn off)

const b64uLen = (n: number) => (s: string) => {
  try {
    return b64uDecode(s).length === n;
  } catch {
    return false;
  }
};

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fcm"), token: z.string().trim().min(20).max(4096), platform: z.enum(["android", "ios"]).default("android") }),
  z.object({
    kind: z.literal("webpush"),
    subscription: z.object({
      endpoint: z.string().max(2048).refine(isPushEndpoint, "not a push service"),
      keys: z.object({ p256dh: z.string().refine(b64uLen(65), "bad key"), auth: z.string().refine(b64uLen(16), "bad key") }),
    }),
    platform: z.enum(["web"]).default("web"),
  }),
]);

const Forget = z.object({ token: z.string().trim().min(1).max(4096) });

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!isMock() && isDemoFamily(auth.familyId)) return Response.json({ error: "demo-push-unavailable" }, { status: 403 });
  if (!checkRateLimit(auth, "/api/push/register", Date.now(), 10)) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-push" }, { status: 400 });
  const b = parsed.data;
  const sub = await upsertSub(
    b.kind === "fcm"
      ? { familyId: auth.familyId, memberId: auth.memberId, kind: "fcm", token: b.token, platform: b.platform }
      : { familyId: auth.familyId, memberId: auth.memberId, kind: "webpush", token: b.subscription.endpoint, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth, platform: b.platform },
  );
  return Response.json({ ok: true, id: sub.id }, { status: 201 });
}

async function deleteHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/push/register", Date.now(), 10)) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Forget.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-push" }, { status: 400 });
  // Only this member's own device in this family; anything else is "nothing to remove".
  return Response.json({ ok: true, removed: await removeByToken(auth.familyId, auth.memberId, parsed.data.token) });
}

export const POST = guardWrites(postHandler);
export const DELETE = guardWrites(deleteHandler);
