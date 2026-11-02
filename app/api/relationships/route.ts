import { CreateRelationshipRequestSchema } from "@/lib/schemas";
import { dbAddRelationship, dbGetMember, dbListMembers } from "@/lib/db";
import { requireCan, requireSession, sessionFromRequest } from "@/lib/auth";
import { relationshipsFor } from "@/lib/request-data";
import { familyFull } from "@/lib/roles";
import { guardWrites } from "@/lib/api-guard";

async function getHandler(req: Request): Promise<Response> {
  // The list starts with the session check, not after it (a refused request throws it away).
  const claimed = sessionFromRequest(req);
  const early = claimed ? relationshipsFor(req, claimed.familyId) : null;
  early?.catch(() => undefined);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  return Response.json({ relationships: await relationshipsFor(req, auth.familyId) });
}

// Guided add: "Add Meera as Dad's mother" creates the person and the edge in
// one validated call. Any family member may add anyone, related to anyone
// already in *their* family (the anchor is checked against the session's
// family, never another family's).
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const allowed = await requireCan(auth, "tree.add");
  if (allowed instanceof Response) return allowed;
  const parsed = CreateRelationshipRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-relationship" }, { status: 400 });
  const anchor = await dbGetMember(parsed.data.memberId);
  if (!anchor || anchor.familyId !== auth.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });
  if (await familyFull(auth.familyId)) return Response.json({ error: "family-full" }, { status: 409 });
  const names = new Set((await dbListMembers(auth.familyId)).map((m) => m.displayName.toLowerCase()));
  if (names.has(parsed.data.newMemberName.toLowerCase())) return Response.json({ error: "duplicate-member" }, { status: 409 });
  const { member, relationship } = await dbAddRelationship({ ...parsed.data, familyId: auth.familyId, anchorRole: anchor.role });
  return Response.json({ member, relationship }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
