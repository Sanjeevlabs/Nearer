import { requireSession } from "@/lib/auth";
import { isGrownUp } from "@/lib/permissions";
import { dbGetFamilyName, dbListCards, dbListMembers, dbListRelationships } from "@/lib/db";
import { listDocs } from "@/lib/family-docs";
import { DOC_SCHEMAS, type DocKind } from "@/lib/kinds";
import { guardApi } from "@/lib/api-guard";

// Everything the family has put into Nearer, as one JSON file they own.
// Any member (not children) can download it. Media files are referenced by
// their storage refs; the operational Muse log and safety locations are left out.
const SKIP = new Set<DocKind>(["muse_call", "safety_checkin", "knock"]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const members = await dbListMembers(auth.familyId);
  const me = members.find((m) => m.id === auth.memberId);
  if (!me || !isGrownUp(me)) return Response.json({ error: "not-allowed" }, { status: 403 });
  const kinds = (Object.keys(DOC_SCHEMAS) as DocKind[]).filter((k) => !SKIP.has(k));
  const [name, relationships, cards, ...docs] = await Promise.all([dbGetFamilyName(auth.familyId), dbListRelationships(auth.familyId), dbListCards(auth.familyId), ...kinds.map((k) => listDocs(auth.familyId, k))]);
  const out = {
    format: "nearer-family-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: me.displayName,
    family: { id: auth.familyId, name },
    members: members.map(({ email: _e, personId: _p, ...m }) => (void _e, void _p, m)),
    relationships,
    memories: cards,
    ...Object.fromEntries(kinds.map((k, i) => [k, docs[i]])),
  };
  const slug = (name || "family").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "family";
  return new Response(JSON.stringify(out, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="nearer-${slug}-${out.exportedAt.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}

export const GET = guardApi(getHandler);
