import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isMockMode, providerKey } from "@/lib/config";
import { dbListCards, dbListMembers, dbListRelationships } from "@/lib/db";
import { listDocs, newId, putDoc } from "@/lib/family-docs";
import { loadFamilyImage, museImage } from "@/lib/muse-image";
import { checkPick, PORTRAIT_STYLES, portraitPrompt, quotaLeft } from "@/lib/muse-portrait";
import { guardWrites } from "@/lib/api-guard";
import { seenBy } from "@/lib/card-privacy";

// Family portrait (Muse Image). Nothing here posts anything: the route
// paints, the person looks, and only /api/muse/keep makes it a family card.
// GET  → { left, sample }: renders left today, and whether Muse is off.
// POST → { people: [{ memberId, cardId? }], style, variant? }
//        → { runId, image } (live) or { runId, sample: true } (Muse is off:
//        the screen paints a labelled sample from the same photos).

const Body = z.object({
  people: z.array(z.object({ memberId: z.string().min(1).max(80), cardId: z.string().min(1).max(80).optional() })).min(1).max(10),
  style: z.enum(PORTRAIT_STYLES),
  variant: z.number().int().min(0).max(20).default(0),
});

const museOff = () => isMockMode() || !providerKey("meta");

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const runs = await listDocs(auth.familyId, "muse_image_run");
  return Response.json({ left: quotaLeft(runs, "portrait"), sample: museOff() });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid-portrait" }, { status: 400 });
  const body = parsed.data;

  const [members, rels] = await Promise.all([dbListMembers(auth.familyId), dbListRelationships(auth.familyId)]);
  const viewer = members.find((m) => m.id === auth.memberId);
  if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401 });
  const ids = body.people.map((p) => p.memberId);
  const problem = checkPick(viewer, ids, members, rels);
  if (problem) return Response.json({ error: problem }, { status: problem === "not-allowed" || problem === "child-not-allowed" ? 403 : 400 });

  const runs = await listDocs(auth.familyId, "muse_image_run");
  if (quotaLeft(runs, "portrait") <= 0) return Response.json({ error: "daily-limit" }, { status: 429 });

  // Each person's photo: the one chosen from the family's own photos, else their profile photo.
  const cards = body.people.some((p) => p.cardId) ? seenBy(await dbListCards(auth.familyId), auth.memberId) : [];
  const refs: string[] = [];
  for (const p of body.people) {
    const m = members.find((x) => x.id === p.memberId)!;
    const card = p.cardId ? cards.find((c) => c.id === p.cardId && c.type === "photo") : undefined;
    if (p.cardId && !card) return Response.json({ error: "unknown-photo", memberId: m.id }, { status: 404 });
    const ref = (card ? (card.mediaRef ?? card.coverRef) : null) ?? m.photoRef ?? m.homeImageRef;
    if (!ref) return Response.json({ error: "no-photo", memberId: m.id }, { status: 422 });
    refs.push(ref);
  }

  const run = { id: newId("portrait"), kind: "portrait" as const, by: auth.memberId, people: ids, style: body.style, keptCardId: null, at: new Date().toISOString() };
  if (museOff()) {
    await putDoc(auth.familyId, "muse_image_run", { ...run, sample: true });
    return Response.json({ runId: run.id, sample: true, left: quotaLeft(runs, "portrait") - 1 });
  }

  const origin = new URL(req.url).origin;
  const images: string[] = [];
  for (const ref of refs) {
    const img = await loadFamilyImage(ref, auth.familyId, origin);
    if (!img) return Response.json({ error: "photo-unreadable" }, { status: 422 });
    images.push(img);
  }
  const names = body.people.map((p) => {
    const m = members.find((x) => x.id === p.memberId)!;
    return m.displayName || m.firstName;
  });
  const out = await museImage({
    familyId: auth.familyId,
    purpose: `Painted a family portrait of ${names.length} people`,
    prompt: portraitPrompt(body.style, names),
    images,
    size: names.length > 3 ? "1536x1024" : "1024x1024",
    variant: body.variant,
  });
  if (out.status === "refused") return Response.json({ error: "spend-cap" }, { status: 503 });
  if (out.status !== "ok") return Response.json({ error: "muse-failed" }, { status: 502 });
  await putDoc(auth.familyId, "muse_image_run", { ...run, sample: false });
  return Response.json({ runId: run.id, image: out.image, left: quotaLeft(runs, "portrait") - 1 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
