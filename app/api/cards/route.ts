import { z } from "zod";
import { CreateCardRequestSchema } from "@/lib/schemas";
import { resolveTakenAt } from "@/lib/dating";
import { captionCard, sha256Hex } from "@/lib/llm";
import { serverLedger, serverStore } from "@/lib/llm-server";
import { dbAddCard, dbListCards, dbListMembers } from "@/lib/db";
import { isKid } from "@/lib/kids";
import { eventFromText, fileCard, titleAlbum, type EventKind } from "@/lib/albums";
import { listDocs, putDoc } from "@/lib/family-docs";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { withDemoShelf } from "@/lib/demo";
import { guardWrites } from "@/lib/api-guard";
import { pushAddressed } from "@/lib/push/events";
import { addressees } from "@/lib/households";
import { withListen } from "@/lib/listen";

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [stored, letters, listen] = await Promise.all([dbListCards(auth.familyId), listDocs(auth.familyId, "chitthi"), listDocs(auth.familyId, "card_listen").catch(() => [])]);
  // "How to listen" is added only for the people a note was sent to (lib/listen.ts).
  const cards = withListen(withDemoShelf(stored, auth.familyId), listen, auth.memberId);
  // Today's answers are open to everyone at once. Only morning letters wait:
  const sealed = new Set<string>();
  // Morning letters stay in the envelope until their morning (the author can always see theirs).
  const now = Date.now();
  for (const l of letters) if (l.authorId !== auth.memberId && Date.parse(l.deliverAt) > now) sealed.add(l.id);
  return Response.json({ familyId: auth.familyId, cards: sealed.size ? cards.filter((c) => !sealed.has(c.id)) : cards });
}

const MultipartFieldsSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(["photo", "audio", "video"]),
  caption: z.string().max(280).default(""),
  lang: z.string().min(2).max(8).default("en"),
  takenAt: z.string().datetime(),
  source: z.enum(["upload", "today", "glasses", "ritual", "agent"]).default("upload"),
  peaks: z.string().default("[]"),
  palette: z.string().default("[]"),
  transcript: z.string().max(2000).default(""),
  transcriptLang: z.string().min(2).max(8).default("en"),
  segments: z.string().default("[]"),
  taggedNames: z.string().default("[]"),
  place: z.string().trim().max(60).default(""),
  note: z.string().trim().max(140).default(""),
  /** Where the bytes already went (`storage:<family>/uploads/…`, from /api/media/upload-url). */
  mediaRef: z.string().max(300).default(""),
  takenAtSource: z.enum(["exif", "file", "model", "now"]).default("now"),
  forMemberId: z.string().max(64).optional(),
});

/**
 * "Add to the fridge": the card is marked as a kid's. The kid must be an active kid of this family,
 * and the one adding must be a grown-up (a child never pins for another child). Returns the id to
 * store, null when not asked for, or the error response.
 */
async function fridgeTarget(familyId: string, authorId: string, forMemberId: string | null | undefined): Promise<string | null | Response> {
  if (!forMemberId) return null;
  const members = await dbListMembers(familyId);
  const kid = members.find((m) => m.id === forMemberId);
  if (!kid || kid.status === "pending" || !isKid(kid)) return Response.json({ error: "not-a-kid" }, { status: 400 });
  if (isKid(members.find((m) => m.id === authorId))) return Response.json({ error: "not-allowed" }, { status: 403 });
  return kid.id;
}

/** A card may only point at its own family's uploads; anything else is dropped. */
function ownMediaRef(ref: string, familyId: string): string | null {
  return ref.startsWith(`storage:${familyId}/uploads/`) && !ref.includes("..") ? ref : null;
}

/** The caller's own card with this client id, if a previous try already saved it. */
async function existingOwnCard(familyId: string, authorId: string, id: string | undefined) {
  if (!id) return null;
  const cards = await dbListCards(familyId);
  return cards.find((c) => c.id === id && c.authorId === authorId) ?? null;
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseNames(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((n): n is string => typeof n === "string").slice(0, 20);
  } catch {
    // Fall through to comma-separated.
  }
  return raw
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 20);
}

// Multipart card upload: the `media` file carries the real bytes; `frames`
// carry video key frames. Photos/video with an empty caption are grounded by
// Muse Spark vision (sees the bytes) and dated EXIF/file first; uploader-
// supplied names are the ONLY names a caption may contain (grounding subset).
async function postMultipart(req: Request, familyId: string, authorId: string): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid-multipart" }, { status: 400 });
  }
  const fields = MultipartFieldsSchema.safeParse({
    id: form.get("id") ?? undefined,
    type: form.get("type") ?? undefined,
    caption: form.get("caption") ?? undefined,
    lang: form.get("lang") ?? undefined,
    takenAt: form.get("takenAt") ?? undefined,
    source: form.get("source") ?? undefined,
    peaks: form.get("peaks") ?? undefined,
    palette: form.get("palette") ?? undefined,
    transcript: form.get("transcript") ?? undefined,
    transcriptLang: form.get("transcriptLang") ?? undefined,
    segments: form.get("segments") ?? undefined,
    taggedNames: form.get("taggedNames") ?? undefined,
    place: form.get("place") ?? undefined,
    note: form.get("note") ?? undefined,
    mediaRef: form.get("mediaRef") ?? undefined,
    takenAtSource: form.get("takenAtSource") ?? undefined,
    forMemberId: form.get("forMemberId") || undefined,
  });
  if (!fields.success) {
    return Response.json({ error: "invalid-card" }, { status: 400 });
  }
  const f = fields.data;
  const fridge = await fridgeTarget(familyId, authorId, f.forMemberId);
  if (fridge instanceof Response) return fridge;
  // A retry of an upload that already landed: answer with the card, change nothing.
  const already = await existingOwnCard(familyId, authorId, f.id);
  if (already) return Response.json({ card: already, album: null }, { status: 200 });
  const mediaEntry = form.get("media");
  const mediaFile = mediaEntry instanceof File && mediaEntry.size > 0 ? mediaEntry : null;
  const mediaBytes = mediaFile ? new Uint8Array(await mediaFile.arrayBuffer()) : null;
  if (mediaBytes && mediaBytes.length > 25 * 1024 * 1024) {
    return Response.json({ error: "media-too-large" }, { status: 413 });
  }
  const frames = form.getAll("frames").filter((x): x is File => x instanceof File && x.size > 0).slice(0, 3);
  const frameImages = await Promise.all(
    frames.map(async (blob) => ({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "image/jpeg" })),
  );
  const taggedNames = parseNames(f.taggedNames);

  let caption = f.caption;
  let lang = f.lang;
  let takenAt = f.takenAt;
  // What kind of moment it is: Muse's vision label when it looked, else the words.
  let event: EventKind = eventFromText(`${f.caption} ${f.transcript}`);
  // Vision grounding needs the bytes; without media there is no model call.
  if ((f.type === "photo" || f.type === "video") && !caption.trim() && mediaBytes) {
    const images =
      f.type === "video" && frameImages.length > 0
        ? frameImages
        : [{ bytes: mediaBytes, mime: mediaFile && mediaFile.type ? mediaFile.type : "image/jpeg" }];
    const prompt = `${f.type === "video" ? "A short family video moment" : "A family photo"}. Tagged: ${taggedNames.join(", ") || "none"}.`;
    const { caption: grounded } = await captionCard(prompt, {
      mediaId: sha256Hex(mediaBytes),
      store: serverStore,
      ledger: serverLedger,
      images,
    });
    // The vision prompt above constrains names to the uploader's list (the
    // only names the model may repeat); the card stores the grounded text.
    caption = grounded.caption;
    lang = grounded.language;
    // The photo's own date wins (EXIF, then the file); the model only fills a gap.
    takenAt = resolveTakenAt({ exifDate: f.takenAtSource === "exif" || f.takenAtSource === "file" ? f.takenAt : null, modelDate: grounded.takenAt });
    if (grounded.event !== "everyday") event = grounded.event;
  }
  const peaks = parseJsonArray(f.peaks).filter((n): n is number => typeof n === "number");
  const palette = parseJsonArray(f.palette).filter((n): n is string => typeof n === "string");
  const segments = parseJsonArray(f.segments);
  const card = await dbAddCard({
    ...(f.id ? { id: f.id } : {}),
    authorId,
    familyId,
    type: f.type,
    caption,
    summary: "",
    lang,
    takenAt,
    ritualSlug: null,
    source: f.source,
    mediaRef: ownMediaRef(f.mediaRef, familyId),
    peaks: peaks.slice(0, 128),
    palette: palette.slice(0, 5),
    transcript: f.transcript.slice(0, 2000),
    transcriptLang: f.transcriptLang,
    segments: segments.slice(0, 64) as { start: number; end: number; text: string }[],
    place: f.place,
    note: f.note,
    forMemberId: fridge,
  });
  const album = await fileIntoAlbum(familyId, card, event);
  pushAddressed(familyId, card);
  return Response.json({ card, album }, { status: 201 });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/cards")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) return postMultipart(req, auth.familyId, auth.memberId);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = CreateCardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-card" }, { status: 400 });
  }
  // JSON path: client-supplied caption only — NEVER a model call. An empty
  // caption stays empty (the UI renders its untitled state); video cards that
  // need grounding must use the multipart upload with real bytes.
  const { id: clientId, forMemberId, listen, ...data } = parsed.data;
  const fridge = await fridgeTarget(auth.familyId, auth.memberId, forMemberId);
  if (fridge instanceof Response) return fridge;
  const already = await existingOwnCard(auth.familyId, auth.memberId, clientId);
  if (already) return Response.json({ card: already, album: null }, { status: 200 });
  const card = await dbAddCard({
    authorId: auth.memberId,
    id: clientId ?? crypto.randomUUID(),
    familyId: auth.familyId,
    summary: "",
    ritualSlug: null,
    forMemberId: fridge,
    ...data,
  });
  // No model here: sorted from the words the person wrote.
  const album = card.type === "audio" ? null : await fileIntoAlbum(auth.familyId, card, eventFromText(card.caption));
  // "How to listen": only with people it was sent to; kept apart from the card, best effort (never fails the upload).
  const to = addressees(card).filter((id) => id !== auth.memberId);
  if (listen && to.length) {
    await putDoc(auth.familyId, "card_listen", { id: card.id, cardId: card.id, authorId: auth.memberId, listen, to, at: new Date().toISOString() }).catch((e: unknown) => console.error("[cards] listen label not kept", String(e)));
  }
  // A note sent to particular people: a gentle push to them (background; never fails the upload).
  pushAddressed(auth.familyId, card);
  return Response.json({ card, album }, { status: 201 });
}

/** Muse files the photo into an event album and (re)titles it once it has a few photos. */
async function fileIntoAlbum(familyId: string, card: Awaited<ReturnType<typeof dbAddCard>>, event: EventKind) {
  try {
    const album = await fileCard(familyId, card, event);
    if (!album || album.fixedBy || album.cardIds.length < 2) return album;
    const [cards, members] = await Promise.all([dbListCards(familyId), dbListMembers(familyId)]);
    const captions = cards.filter((c) => album.cardIds.includes(c.id)).map((c) => c.caption).filter(Boolean);
    const title = await titleAlbum(familyId, album, captions, members.map((m) => m.displayName).concat(members.map((m) => m.firstName)));
    return title === album.title ? album : await putDoc(familyId, "album", { ...album, title });
  } catch (e) {
    // Sorting must never fail an upload.
    console.error("[albums] filing failed", (e as Error).message);
    return null;
  }
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
