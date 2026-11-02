import { checkRateLimit, requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { PUSH_TITLE, wordsFor } from "@/lib/push/copy";
import { dbGetMember } from "@/lib/db";
import { serviceAccountFromEnv } from "@/lib/push/fcm";
import { isMock, pushToMember } from "@/lib/push/send";
import { listSubs } from "@/lib/push/store";
import { vapidFromEnv } from "@/lib/push/webpush";

// "Send me a test": one push to your own devices, so you can see how it will look.
// Awaited (unlike the real ones) so the answer says whether it went. Ignores the quiet
// hours and the daily count: you asked for it.
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/push/test", Date.now(), 5)) return Response.json({ error: "rate-limited" }, { status: 429 });
  const me = await dbGetMember(auth.memberId);
  const devices = (await listSubs(auth.familyId, auth.memberId)).length;
  const configured = isMock() || Boolean(serviceAccountFromEnv()) || Boolean(vapidFromEnv());
  if (!devices && !isMock()) return Response.json({ devices, sent: 0, configured });
  const r = await pushToMember(auth.familyId, auth.memberId, { title: PUSH_TITLE, body: wordsFor(me?.displayLang).test, url: "/", tag: "test", urgency: "normal" });
  return Response.json({ devices, sent: isMock() ? devices || 1 : r.sent, configured });
}

export const POST = guardWrites(postHandler);
