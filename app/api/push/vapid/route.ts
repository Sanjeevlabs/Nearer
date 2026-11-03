import { requireSession } from "@/lib/auth";
import { vapidFromEnv } from "@/lib/push/webpush";
import { guardApi } from "@/lib/api-guard";

// The public half of the VAPID key pair, which a browser needs to subscribe. Not a secret,
// but only signed-in people have a reason to ask. 404 when this server has no keys: the app
// then never offers web notifications.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const vapid = vapidFromEnv();
  if (!vapid) return Response.json({ error: "not-configured" }, { status: 404 });
  return Response.json({ key: vapid.publicKey });
}

export const GET = guardApi(getHandler);
