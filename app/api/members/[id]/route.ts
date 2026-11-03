import { requireCan, requireSession } from "@/lib/auth";
import { dbGetMember, dbListMembers, dbRemoveMember, dbUpdateMemberProfile } from "@/lib/db";
import { deleteDocsForMember } from "@/lib/family-docs";
import { can } from "@/lib/permissions";
import { breaksAdminCap, recordTeenConsent, teenConsentProblem } from "@/lib/roles";
import { UpdateMemberRequestSchema, type Member } from "@/lib/schemas";
import { guardApi } from "@/lib/api-guard";

// Editing and removing people in the tree, and assigning access roles.
// - A person without an account (added by a relative) can be edited or
//   removed by any member (not by a teen or child).
// - A person with their own account edits themselves (Settings); only an
//   owner/admin can remove them, and nobody removes themselves here (Leave family).
// - Roles change only by an owner/admin. The owner is never changed here:
//   ownership moves with POST /api/members/[id]/owner. At most 3 admins
//   (owner included); a teen needs their parent's consent.
// - Joiners who are still waiting are let in or declined at ./approve.

async function target(req: Request, id: string): Promise<{ auth: { familyId: string; memberId: string }; member: Member; me: Member } | Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [member, me] = await Promise.all([dbGetMember(id), dbGetMember(auth.memberId)]);
  if (!member || member.familyId !== auth.familyId || !me) return Response.json({ error: "unknown-member" }, { status: 404 });
  return { auth, member, me };
}

async function patchHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const t = await target(req, params.id);
  if (t instanceof Response) return t;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = UpdateMemberRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-member" }, { status: 400 });
  const { access, ...details } = parsed.data;
  const self = t.member.id === t.me.id;
  const changingRole = access !== undefined && access !== t.member.access;

  if (changingRole) {
    if (!can(t.me, "roles.assign")) return Response.json({ error: "not-allowed", action: "roles.assign" }, { status: 403 });
    if (t.member.status === "pending") return Response.json({ error: "pending", hint: "approve" }, { status: 409 });
    if (access === "owner") return Response.json({ error: "use-transfer" }, { status: 409 });
    if (t.member.access === "owner") return Response.json({ error: "owner-use-transfer" }, { status: 409 });
    if (access === "child" && t.member.email) return Response.json({ error: "has-account" }, { status: 409 });
    if (breaksAdminCap(await dbListMembers(t.auth.familyId), t.member, access)) return Response.json({ error: "admins-full", max: 3 }, { status: 409 });
    if (access === "teen") {
      const problem = await teenConsentProblem(t.auth.familyId, t.me, t.member.id);
      if (problem) return problem;
    }
  }
  if (Object.keys(details).length > 0 && !self) {
    if (t.member.email) return Response.json({ error: "has-account" }, { status: 403 });
    if (!can(t.me, "tree.edit")) return Response.json({ error: "not-allowed", action: "tree.edit" }, { status: 403 });
  }
  const patch = { ...details, ...(changingRole ? { access } : {}), ...(details.displayName && !t.member.email ? { firstName: details.displayName } : {}) };
  const member = await dbUpdateMemberProfile(t.member.id, patch);
  if (!member) return Response.json({ error: "update-failed" }, { status: 500 });
  const consent = changingRole && access === "teen" ? await recordTeenConsent(t.auth.familyId, t.member.id, t.me.id) : null;
  return Response.json({ member, ...(consent ? { consent } : {}) });
}

async function deleteHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const t = await target(req, params.id);
  if (t instanceof Response) return t;
  if (t.member.id === t.me.id) return Response.json({ error: "use-leave-family" }, { status: 409 });
  if (t.member.access === "owner") return Response.json({ error: "owner" }, { status: 409 });
  const action = t.member.status === "pending" ? "members.approve" : t.member.email ? "tree.remove-account" : "tree.remove";
  const guard = await requireCan(t.auth, action);
  if (guard instanceof Response) return guard;
  // People with their own account (and admins) are removed only by an owner/admin.
  if ((t.member.access === "admin" || t.member.access === "teen") && !can(guard, "tree.remove-account")) return Response.json({ error: "not-allowed", action: "tree.remove-account" }, { status: 403 });
  const ok = await dbRemoveMember(t.member.id);
  if (!ok) return Response.json({ error: "remove-failed" }, { status: 500 });
  await deleteDocsForMember(t.auth.familyId, t.member.id);
  return Response.json({ removed: t.member.id });
}

export const PATCH = guardApi(patchHandler);
export const DELETE = guardApi(deleteHandler);
