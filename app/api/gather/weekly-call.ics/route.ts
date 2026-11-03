import { requireSession } from "@/lib/auth";
import { dbGetMember, dbListMembers } from "@/lib/db";
import { getDoc } from "@/lib/family-docs";
import { farZone, weeklyCallIcs } from "@/lib/weekly-call";
import { guardApi } from "@/lib/api-guard";

// The weekly call as a repeating calendar event, for any calendar app.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const call = await getDoc(auth.familyId, "weekly_call", "weekly-call");
  if (!call) return Response.json({ error: "no-weekly-call" }, { status: 404 });
  const [me, members] = await Promise.all([dbGetMember(auth.memberId), dbListMembers(auth.familyId)]);
  const yourTz = me?.tz && me.tz !== "UTC" ? me.tz : call.tz;
  const host = members.find((m) => m.id === call.hostId);
  const body = weeklyCallIcs({ call, familyId: auth.familyId, yourTz, theirTz: farZone(yourTz, host?.tz, members.map((m) => m.tz)) });
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="weekly-call.ics"', "cache-control": "no-store" } });
}

export const GET = guardApi(getHandler);
