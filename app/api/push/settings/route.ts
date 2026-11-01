import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { getPushSettings, savePushPrefs } from "@/lib/push/prefs";
import { serviceAccountFromEnv } from "@/lib/push/fcm";
import { listSubs } from "@/lib/push/store";
import { vapidFromEnv } from "@/lib/push/webpush";

// Your own switches: which kinds of push you want. Safe & sound is on unless you turn it off here.
const Body = z.object({ voice: z.boolean(), lamp: z.boolean(), asks: z.boolean(), digest: z.boolean(), safety: z.boolean() });

const view = (s: { voice: boolean; lamp: boolean; asks: boolean; digest: boolean; safety: boolean }) => ({ voice: s.voice, lamp: s.lamp, asks: s.asks, digest: s.digest, safety: s.safety });

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [settings, subs] = await Promise.all([getPushSettings(auth.familyId, auth.memberId), listSubs(auth.familyId, auth.memberId)]);
  return Response.json({ settings: view(settings), devices: subs.length, configured: { app: Boolean(serviceAccountFromEnv()), web: Boolean(vapidFromEnv()) } });
}

async function putHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-push-settings" }, { status: 400 });
  return Response.json({ settings: view(await savePushPrefs(auth.familyId, auth.memberId, parsed.data)) });
}

export const GET = guardWrites(getHandler);
export const PUT = guardWrites(putHandler);
