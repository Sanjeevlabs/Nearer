import { requireCan, requireSession } from "@/lib/auth";
import { dbDeleteRelationship, dbListRelationships } from "@/lib/db";
import { guardApi } from "@/lib/api-guard";

// Remove one link from the tree (a mistake, or a relation that's wrong).
async function deleteHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const allowed = await requireCan(auth, "tree.edit");
  if (allowed instanceof Response) return allowed;
  const rel = (await dbListRelationships(auth.familyId)).find((r) => r.id === params.id);
  if (!rel) return Response.json({ error: "unknown-link" }, { status: 404 });
  await dbDeleteRelationship(rel.id, auth.familyId);
  return Response.json({ removed: rel.id });
}

export const DELETE = guardApi(deleteHandler);
