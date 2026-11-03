import { z } from "zod";
import { createUploadUrl, storagePath } from "@/lib/storage";
import { requireSession } from "@/lib/auth";
import { isMediaMime } from "@/lib/media-types";
import { guardApi } from "@/lib/api-guard";

const BodySchema = z.object({
  filename: z.string().min(1).max(120),
  mime: z.string().min(3).max(100),
});

// Server-issued signed upload URL: the client PUTs bytes straight to the
// private bucket (or to the mock endpoint when Supabase is unavailable).
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-upload-url" }, { status: 400 });
  }
  if (!isMediaMime(parsed.data.mime)) return Response.json({ error: "unsupported-media" }, { status: 415 });
  // Always the session's own family: the client never names where it writes.
  const path = storagePath(auth.familyId, parsed.data.filename);
  const { uploadUrl, mock } = await createUploadUrl(path, parsed.data.mime);
  return Response.json({ path, uploadUrl, mock, ref: `storage:${path}` });
}

export const POST = guardApi(postHandler);
