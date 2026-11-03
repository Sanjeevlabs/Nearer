import { isDemoFamily, requireCan, requireSession } from "@/lib/auth";
import { dbGetMember, dbListMembers, dbUpdateMemberProfile } from "@/lib/db";
import { MAX_ADMINS } from "@/lib/permissions";
import { adminCount } from "@/lib/roles";
import { guardApi } from "@/lib/api-guard";

// Hand the family over: the owner makes someone else the owner and becomes
// an admin. Owner only. The new owner must be an active grown-up (admin or
// member) with their own account, and the admin cap (3, owner included) holds.
async function postHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const me = await requireCan(auth, "owner.transfer");
  if (me instanceof Response) return me;
  const to = await dbGetMember(params.id);
  if (!to || to.familyId !== auth.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });
  if (to.id === me.id) return Response.json({ error: "already-owner" }, { status: 409 });
  if (to.status === "pending") return Response.json({ error: "pending" }, { status: 409 });
  if (to.access !== "admin" && to.access !== "member") return Response.json({ error: "grown-ups-only" }, { status: 409 });
  // Demo people share one demo sign-in; real owners must be able to sign in.
  if (!to.email && !isDemoFamily(auth.familyId)) return Response.json({ error: "needs-account" }, { status: 409 });
  const after = adminCount(await dbListMembers(auth.familyId)) + (to.access === "admin" ? 0 : 1);
  if (after > MAX_ADMINS) return Response.json({ error: "admins-full", max: MAX_ADMINS }, { status: 409 });
  // Old owner steps down first: the database allows one owner per family.
  const was = await dbUpdateMemberProfile(me.id, { access: "admin" });
  if (!was) return Response.json({ error: "transfer-failed" }, { status: 500 });
  const owner = await dbUpdateMemberProfile(to.id, { access: "owner" });
  if (!owner) {
    await dbUpdateMemberProfile(me.id, { access: "owner" });
    return Response.json({ error: "transfer-failed" }, { status: 500 });
  }
  return Response.json({ owner, previous: was });
}

export const POST = guardApi(postHandler);
