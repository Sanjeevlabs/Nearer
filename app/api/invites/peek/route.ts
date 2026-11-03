import { dbFindInvite, dbGetFamilyName, dbListMembers } from "@/lib/db";
import { allowAuthAttempt, callerKey } from "@/lib/otp";
import { hostOf } from "@/lib/roles";
import { guardApi } from "@/lib/api-guard";

// Before joining: what does this code open? The family's name, who invited
// you, and the places already made for people who haven't joined ("I'm Maa").
// Only call names; never emails, cities or anything else. Rate-limited per
// address so codes can't be guessed through it.
async function getHandler(req: Request): Promise<Response> {
  const ip = callerKey(req) ?? "local";
  if (!allowAuthAttempt(`peek:${ip}`, 20)) return Response.json({ error: "too-many-attempts" }, { status: 429 });
  const code = (new URL(req.url).searchParams.get("code") ?? "").trim().toUpperCase();
  if (code.length < 4 || code.length > 64) return Response.json({ error: "invalid-invite" }, { status: 400 });
  const invite = await dbFindInvite(code);
  if (!invite) return Response.json({ error: "invalid-invite" }, { status: 404 });
  const [members, name] = await Promise.all([dbListMembers(invite.familyId), dbGetFamilyName(invite.familyId)]);
  const host = hostOf(members.filter((m) => m.email)) ?? members.find((m) => m.email);
  const places = members.filter((m) => !m.email && m.access === "member" && m.role !== "child").map((m) => ({ id: m.id, callName: m.displayName || m.firstName }));
  return Response.json({ family: name.replace(/^the\s+/i, "").replace(/\s+family$/i, "") || "Family", host: host ? host.firstName : null, places });
}

export const GET = guardApi(getHandler);
