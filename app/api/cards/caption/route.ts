import { captionCard, sha256Hex } from "@/lib/llm";
import { serverLedger, serverStore } from "@/lib/llm-server";
import { requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";

// A suggested caption for one photo, before it is posted: the same Muse vision caption the card
// upload uses (spend cap, cache by photo, mock returns a canned line), shown in the caption box
// where the person can edit or clear it. Nothing is stored here. POST multipart `media` -> { caption }.
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid-multipart" }, { status: 400 });
  }
  const media = form.get("media");
  if (!(media instanceof File) || media.size === 0 || !media.type.startsWith("image/")) return Response.json({ error: "invalid-image" }, { status: 400 });
  if (media.size > 5 * 1024 * 1024) return Response.json({ error: "media-too-large" }, { status: 413 });
  const bytes = new Uint8Array(await media.arrayBuffer());
  const { caption } = await captionCard("A family photo. Tagged: none.", {
    mediaId: sha256Hex(bytes),
    store: serverStore,
    ledger: serverLedger,
    images: [{ bytes, mime: media.type }],
  });
  // The fixed fallback (spend cap, model down) is not a caption of this photo: suggest nothing.
  return Response.json({ caption: caption.caption === "A family memory, saved to Memory Lane." ? "" : caption.caption });
}

export const POST = guardWrites(postHandler);
