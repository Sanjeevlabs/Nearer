import { requireSession } from "@/lib/auth";
import { dbListCards, dbListMembers } from "@/lib/db";
import { withDemoShelf } from "@/lib/demo";
import { listDocs } from "@/lib/family-docs";
import { bookChapters } from "./chapters";
import { guardApi } from "@/lib/api-guard";

// GET /api/book?member=<id> → that person's chapters, newest first.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const memberId = new URL(req.url).searchParams.get("member") ?? "";
  const members = await dbListMembers(auth.familyId);
  if (!members.some((m) => m.id === memberId)) return Response.json({ error: "unknown-member" }, { status: 404 });
  const [tasks, stored] = await Promise.all([listDocs(auth.familyId, "today_task"), dbListCards(auth.familyId)]);
  const chapters = bookChapters({ memberId, viewerId: auth.memberId, tasks, cards: withDemoShelf(stored, auth.familyId), members });
  return Response.json({ member: memberId, chapters });
}

export const GET = guardApi(getHandler);
