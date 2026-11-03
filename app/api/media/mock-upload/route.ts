import { mockPutBlob, usesMockStorage } from "@/lib/storage";
import { requireSession } from "@/lib/auth";
import { isMediaMime } from "@/lib/media-types";
import { guardApi } from "@/lib/api-guard";



// In-memory upload target: the client PUTs bytes here in mock mode, and for
// the demo families even when the database is live. Real families' live
// traffic goes straight to the signed bucket URL instead.
async function putHandler(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  // With a live database, only demo-family paths may use this seam.
  if (!usesMockStorage(path ?? "")) return Response.json({ error: "not-found" }, { status: 404 });
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (path && !path.startsWith(`${auth.familyId}/`)) return Response.json({ error: "forbidden-family" }, { status: 403 });
  const mime = (searchParams.get("mime") || "").toLowerCase();
  // Photos, voices and videos only: never HTML or scripts on the app's origin.
  if (!isMediaMime(mime)) return Response.json({ error: "unsupported-media" }, { status: 415 });
  if (!path) return Response.json({ error: "missing-path" }, { status: 400 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) return Response.json({ error: "empty-upload" }, { status: 400 });
  if (buf.byteLength > 25 * 1024 * 1024) return Response.json({ error: "media-too-large" }, { status: 413 });
  mockPutBlob(path, new Uint8Array(buf), mime);
  return Response.json({ ok: true, path });
}

export const PUT = guardApi(putHandler);
