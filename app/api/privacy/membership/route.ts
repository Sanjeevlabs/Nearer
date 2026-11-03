import { z } from "zod";
import { dbGetMember, dbListMembers, dbRemoveMember } from "@/lib/db";
import { requireMember, requireSession } from "@/lib/auth";
import { deleteDocsForMember } from "@/lib/family-docs";
import { guardApi } from "@/lib/api-guard";

const BodySchema = z.object({ memberId: z.string().min(1) });

// "Leave family": remove the member completely (member, edges, traces).
// Shared family cards are kept — the UI says exactly this.
async function deleteHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  const ownership = requireMember(auth, parsed.data.memberId);
  if (ownership) return ownership;
  if (!(await dbGetMember(parsed.data.memberId))) {
    return Response.json({ error: "unknown-member" }, { status: 404 });
  }
  // The family always keeps its owner: hand it over before the owner leaves.
  const family = await dbListMembers(auth.familyId);
  const me = family.find((m) => m.id === parsed.data.memberId);
  if (me?.access === "owner" && family.length > 1) {
    return Response.json({ error: "owner-must-transfer" }, { status: 409 });
  }
  const ok = await dbRemoveMember(parsed.data.memberId);
  if (!ok) return Response.json({ error: "leave-failed" }, { status: 500 });
  // Their moments, questions, recipes they cooked, needs, local helpers.
  await deleteDocsForMember(auth.familyId, parsed.data.memberId);
  return Response.json({ left: true });
}

export const DELETE = guardApi(deleteHandler);
