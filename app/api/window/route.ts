import { z } from "zod";
import { checkRateLimit, requireSession, sessionFromRequest } from "@/lib/auth";
import { dbListMembers } from "@/lib/db";
import { getDoc, putDoc } from "@/lib/family-docs";
import { defaultView, homePhotoOk, photoRefFor, readWindow, windowState } from "@/lib/window-server";
import { FIRST_SCENES, POTS, WALLS } from "@/lib/kinds";
import { can } from "@/lib/permissions";
import { guardWrites } from "@/lib/api-guard";

// The window (LITE): your view into the other home, one still photograph.
// Each person may pick a family photo or a photo of their home. The old
// slideshow ("living"), scene, pots and mixAlbum actions are still accepted
// (so older clients don't break) but change nothing on screen.

async function getHandler(req: Request): Promise<Response> {
  // The window's reads start with the auth lookup, not after it: the signed
  // session already names the family, and the reads only read. A refused
  // request throws them away.
  const claimed = sessionFromRequest(req);
  const preread = claimed ? readWindow(claimed.familyId) : undefined;
  preread?.catch(() => undefined);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/window")) return Response.json({ error: "rate-limited" }, { status: 429 });
  return Response.json(await windowState(auth.familyId, auth.memberId, new Date(), preread));
}

const Choose = z.object({
  action: z.literal("choose"),
  cardId: z.string().min(1).nullable(),
  style: z.enum(["still", "living"]).default("living"),
});
const Compose = z.object({ action: z.literal("compose") });
const Quiet = z.object({ action: z.literal("quiet"), hours: z.number().int().min(2).max(12) });
const Wall = z.object({ action: z.literal("wall"), wall: z.enum(WALLS) });
const People = z.object({ action: z.literal("people"), people: z.array(z.string().min(1).max(64)).max(2) });
const Scene = z.object({ action: z.literal("scene"), scene: z.enum(FIRST_SCENES) });
const Pots = z.object({ action: z.literal("pots"), pots: z.array(z.enum(POTS)).max(3) });
const HomePhoto = z
  .object({ action: z.literal("homePhoto"), ref: z.string().min(1).max(300).nullable().optional(), mix: z.boolean().optional() })
  .refine((b) => b.ref !== undefined || b.mix !== undefined);

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/window")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const body = await req.json().catch(() => null);
  const now = new Date().toISOString();
  const mine = await getDoc(auth.familyId, "window_view", auth.memberId);

  const choose = Choose.safeParse(body);
  if (choose.success) {
    const imageRef = choose.data.cardId ? await photoRefFor(auth.familyId, choose.data.cardId) : null;
    if (choose.data.cardId && !imageRef) return Response.json({ error: "unknown-photo" }, { status: 404 });
    const view = await putDoc(auth.familyId, "window_view", {
      ...(mine ?? defaultView(auth.familyId, auth.memberId)),
      id: auth.memberId,
      memberId: auth.memberId,
      cardId: choose.data.cardId,
      imageRef,
      style: "still",
      madeBy: "family",
      updatedAt: now,
    });
    return Response.json({ view });
  }

  const base = mine ?? defaultView(auth.familyId, auth.memberId);
  const keep = mine?.updatedAt ?? now;
  const wall = Wall.safeParse(body);
  if (wall.success) return Response.json({ view: await putDoc(auth.familyId, "window_view", { ...base, wall: wall.data.wall, updatedAt: keep }) });
  const pick = Scene.safeParse(body);
  if (pick.success) return Response.json({ view: await putDoc(auth.familyId, "window_view", { ...base, scene: pick.data.scene, updatedAt: keep }) });
  const pots = Pots.safeParse(body);
  if (pots.success) return Response.json({ view: await putDoc(auth.familyId, "window_view", { ...base, pots: Array.from(new Set(pots.data.pots)), updatedAt: keep }) });
  const home = HomePhoto.safeParse(body);
  if (home.success) {
    const { ref, mix } = home.data;
    // Only this family's own photo: its uploads, or one of its photo cards.
    if (ref && !(await homePhotoOk(auth.familyId, ref))) return Response.json({ error: "unknown-photo" }, { status: 404 });
    const next = { ...base, ...(ref !== undefined ? { homePhoto: ref } : {}), ...(mix !== undefined ? { mixAlbum: mix } : {}), updatedAt: keep };
    return Response.json({ view: await putDoc(auth.familyId, "window_view", next) });
  }
  const people = People.safeParse(body);
  if (people.success) {
    const members = await dbListMembers(auth.familyId);
    // Teens (and children) are never at someone's window.
    if (people.data.people.some((id) => { const m = members.find((x) => x.id === id); return m && !can(m, "window.at"); })) return Response.json({ error: "not-at-window" }, { status: 403 });
    const ids = Array.from(new Set(people.data.people)).filter((id) => id !== auth.memberId && members.some((m) => m.id === id));
    return Response.json({ view: await putDoc(auth.familyId, "window_view", { ...base, people: ids, updatedAt: mine?.updatedAt ?? now }) });
  }

  const quiet = Quiet.safeParse(body);
  if (quiet.success) {
    const view = await putDoc(auth.familyId, "window_view", {
      ...base,
      quietAfterHours: quiet.data.hours,
      updatedAt: mine?.updatedAt ?? now,
    });
    return Response.json({ view });
  }

  // Muse no longer composes motion over the photo: there is no living window.
  if (Compose.safeParse(body).success) return Response.json({ error: "still-window" }, { status: 409 });
  return Response.json({ error: "invalid-window" }, { status: 400 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
