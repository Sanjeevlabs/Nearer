import { mockGetBlob, usesMockStorage } from "@/lib/storage";
import { requireSession } from "@/lib/auth";
import { isMediaMime } from "@/lib/media-types";
import { guardApi } from "@/lib/api-guard";
import { mediaAllowed } from "@/lib/media-gate";



// In-memory byte server (mock mode, and the demo families when the database
// is live). Real families' live traffic is redirected to signed bucket URLs
// by /api/media/[...path] instead.
async function getHandler(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  // With a live database, only demo-family paths may use this seam.
  if (!usesMockStorage(path ?? "")) return Response.json({ error: "not-found" }, { status: 404 });
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (path && !path.startsWith(`${auth.familyId}/`)) return Response.json({ error: "forbidden-family" }, { status: 403 });
  // A note for particular people: its bytes are theirs and its author's only.
  if (path && !(await mediaAllowed(auth.familyId, auth.memberId, path))) return Response.json({ error: "unknown-media" }, { status: 404 });
  const blob = path ? mockGetBlob(path) : undefined;
  if (!path || !blob || !isMediaMime(blob.mime)) return Response.json({ error: "unknown-media" }, { status: 404 });
  return new Response(blob.bytes as unknown as BodyInit, {
    headers: { "content-type": blob.mime, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}

export const GET = guardApi(getHandler);
