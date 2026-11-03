import { createDownloadUrl } from "@/lib/storage";
import { requireSession } from "@/lib/auth";
import { guardApi } from "@/lib/api-guard";
import { mediaAllowed } from "@/lib/media-gate";

// Private-bucket reads: refs shaped `storage:<path>` resolve here and are
// redirected (307) to a short-lived signed URL. Clients keep using
// resolveMediaUrl synchronously; freshness is minted per request.
// The media of a note for particular people is signed only for them and its author.
async function getHandler(_req: Request, props: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(_req);
  if (auth instanceof Response) return auth;
  const path = params.path.join("/");
  if (!path || path.includes("..") || !path.startsWith(`${auth.familyId}/`)) {
    return Response.json({ error: "invalid-media-path" }, { status: 400 });
  }
  if (!(await mediaAllowed(auth.familyId, auth.memberId, path))) return Response.json({ error: "unknown-media" }, { status: 404 });
  const target = await createDownloadUrl(path);
  if (!target) return Response.json({ error: "unknown-media" }, { status: 404 });
  // The mock store hands back a same-origin path; Response.redirect needs an absolute URL.
  return Response.redirect(new URL(target.url, _req.url), 307);
}

export const GET = guardApi(getHandler);
