import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { docsFor, membersFor, relationshipsFor } from "@/lib/request-data";
import { deleteDoc, getDoc, newId, putDoc } from "@/lib/family-docs";
import { guardiansOf, isKid, marksFor, recentGrowth } from "@/lib/kids";
import { guardWrites } from "@/lib/api-guard";

// Height marks on the doorframe. A parent or grandparent adds a mark for a child; the
// child sees them on their wall. Just a number and a date: no advice, no comparison.
// GET ?memberId=  -> that child's marks, oldest first
// GET             -> the marks under a week old that moved up from the one before ("grew")
// POST            -> add {memberId, cm, note?, at?}
// DELETE ?id=     -> remove a mark you added

const Add = z.object({
  memberId: z.string().min(1).max(80),
  cm: z.number().min(30).max(220),
  note: z.string().trim().max(60).default(""),
  at: z.string().datetime().optional(),
});

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const marks = await docsFor(req, auth.familyId, "height_mark");
  const who = new URL(req.url).searchParams.get("memberId");
  if (who) return Response.json({ marks: marksFor(who, marks) });
  const members = await membersFor(req, auth.familyId);
  const me = members.find((m) => m.id === auth.memberId);
  // The growth line is news for grown-ups; a child reads their own wall.
  return Response.json({ grew: isKid(me) ? [] : recentGrowth(marks, new Date()) });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/height")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Add.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-mark" }, { status: 400 });
  const [members, rels] = await Promise.all([membersFor(req, auth.familyId), relationshipsFor(req, auth.familyId)]);
  const me = members.find((m) => m.id === auth.memberId);
  const kid = members.find((m) => m.id === parsed.data.memberId);
  if (!me || !kid || !isKid(kid)) return Response.json({ error: "unknown-child" }, { status: 404 });
  if (isKid(me) || !guardiansOf(kid.id, rels).includes(me.id)) return Response.json({ error: "not-yours" }, { status: 403 });
  const now = Date.now();
  const at = parsed.data.at ?? new Date(now).toISOString();
  if (Date.parse(at) > now + 60_000) return Response.json({ error: "invalid-mark" }, { status: 400 });
  const mark = await putDoc(auth.familyId, "height_mark", { id: newId("hm"), memberId: kid.id, cm: Math.round(parsed.data.cm * 10) / 10, at, byMemberId: me.id, note: parsed.data.note });
  return Response.json({ mark }, { status: 201 });
}

async function deleteHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "invalid-mark" }, { status: 400 });
  const mark = await getDoc(auth.familyId, "height_mark", id);
  if (!mark) return Response.json({ error: "unknown-mark" }, { status: 404 });
  if (mark.byMemberId !== auth.memberId) return Response.json({ error: "not-yours" }, { status: 403 });
  await deleteDoc(auth.familyId, "height_mark", id);
  return Response.json({ deleted: id });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
export const DELETE = guardWrites(deleteHandler);
