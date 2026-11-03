import { z } from "zod";
import { isGrownUp } from "@/lib/permissions";
import { requireSession } from "@/lib/auth";
import { dbGetMember, dbListMembers } from "@/lib/db";
import { getDoc } from "@/lib/family-docs";
import { canChange } from "@/lib/permissions";
import { createShare, listShares, revokeShare } from "@/lib/shares";
import { isKid } from "@/lib/kids";
import { guardApi } from "@/lib/api-guard";

// GET    → this family's public links (what's out there, and how often opened)
// POST   → share one recipe publicly; returns the link
// DELETE → stop sharing (the link shows "no longer shared")
const Post = z.object({ kind: z.literal("recipe"), id: z.string().min(1) });
const Del = z.object({ token: z.string().min(20).max(64) });

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const shares = (await listShares(auth.familyId)).filter((s) => !s.revokedAt);
  return Response.json({ shares: shares.map((s) => ({ token: s.token, kind: s.kind, refId: s.refId, title: s.snapshot.title, views: s.views, createdBy: s.createdBy, createdAt: s.createdAt })) });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const body = Post.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-share" }, { status: 400 });
  const me = await dbGetMember(auth.memberId);
  if (!me || !isGrownUp(me)) return Response.json({ error: "not-allowed" }, { status: 403 });
  const recipe = await getDoc(auth.familyId, "recipe", body.data.id);
  if (!recipe) return Response.json({ error: "unknown-recipe" }, { status: 404 });
  const cook = (await dbListMembers(auth.familyId)).find((m) => m.id === recipe.cookId);
  // Nothing a child made ever goes public.
  if (isKid(cook)) return Response.json({ error: "not-allowed" }, { status: 403 });
  const share = await createShare({
    familyId: auth.familyId,
    kind: "recipe",
    refId: recipe.id,
    createdBy: auth.memberId,
    snapshot: {
      title: recipe.title,
      from: cook?.displayName ?? "the family",
      course: recipe.course,
      prepMins: recipe.prepMins,
      cookMins: recipe.cookMins,
      serves: recipe.serves,
      memory: recipe.memory,
      prepWork: recipe.prepWork,
      outcome: recipe.outcome,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
    },
  });
  return Response.json({ token: share.token, path: `/r/${share.token}`, views: share.views }, { status: 201 });
}

async function deleteHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const body = Del.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-share" }, { status: 400 });
  const me = await dbGetMember(auth.memberId);
  const share = (await listShares(auth.familyId)).find((s) => s.token === body.data.token);
  if (!share) return Response.json({ error: "unknown-share" }, { status: 404 });
  // Whoever shared it, or an admin, can stop it.
  if (!canChange(me, share.createdBy)) return Response.json({ error: "not-yours" }, { status: 403 });
  await revokeShare(auth.familyId, share.token);
  return Response.json({ revoked: share.token });
}

export const GET = guardApi(getHandler);
export const POST = guardApi(postHandler);
export const DELETE = guardApi(deleteHandler);
