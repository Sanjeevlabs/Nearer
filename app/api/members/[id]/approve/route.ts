import { z } from "zod";
import { requireCan, requireSession } from "@/lib/auth";
import { dbGetMember, dbListMembers, dbRemoveMember, dbUpdateMemberProfile } from "@/lib/db";
import { deleteDocsForMember } from "@/lib/family-docs";
import { MAX_PEOPLE } from "@/lib/permissions";
import { recordTeenConsent, teenConsentProblem } from "@/lib/roles";
import { guardApi } from "@/lib/api-guard";

// Waiting to join: an owner/admin lets a joiner in (as a member, or as a teen
// with a parent's consent) or declines them (their place is removed).
const Body = z.object({
  decision: z.enum(["approve", "decline"]),
  access: z.enum(["member", "teen"]).default("member"),
});

async function postHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const me = await requireCan(auth, "members.approve");
  if (me instanceof Response) return me;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-approval" }, { status: 400 });
  const who = await dbGetMember(params.id);
  if (!who || who.familyId !== auth.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });
  if (who.status !== "pending") return Response.json({ error: "not-pending" }, { status: 409 });

  if (parsed.data.decision === "decline") {
    const ok = await dbRemoveMember(who.id);
    if (!ok) return Response.json({ error: "decline-failed" }, { status: 500 });
    await deleteDocsForMember(auth.familyId, who.id);
    return Response.json({ declined: who.id });
  }

  if ((await dbListMembers(auth.familyId)).length >= MAX_PEOPLE) return Response.json({ error: "family-full", max: MAX_PEOPLE }, { status: 409 });
  const teen = parsed.data.access === "teen";
  if (teen) {
    const problem = await teenConsentProblem(auth.familyId, me, who.id);
    if (problem) return problem;
  }
  const member = await dbUpdateMemberProfile(who.id, { status: "active", access: parsed.data.access });
  if (!member) return Response.json({ error: "approve-failed" }, { status: 500 });
  const consent = teen ? await recordTeenConsent(auth.familyId, who.id, me.id) : null;
  return Response.json({ member, ...(consent ? { consent } : {}) });
}

export const POST = guardApi(postHandler);
