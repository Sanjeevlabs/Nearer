import { z } from "zod";
import { checkRateLimit, requireSession, sessionFromRequest } from "@/lib/auth";
import { eventFromText, fileCard } from "@/lib/albums";
import { dbListCards } from "@/lib/db";
import { deleteDoc, getDoc, listDocs, putDoc } from "@/lib/family-docs";
import { EVENT_KINDS } from "@/lib/kinds";
import { guardWrites } from "@/lib/api-guard";

// Albums. GET → albums (newest first).
// POST → rename · remove (a photo from an album) · move (to another album) ·
//        merge (two albums) · delete (album only; photos stay in the Lane) ·
//        cover · resort (file older photos that aren't in an album yet).
// Any change by a person marks the album fixed; Muse won't reshuffle it.

const id = z.string().min(1).max(80);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), albumId: id, title: z.string().trim().min(1).max(80), event: z.enum(EVENT_KINDS).optional() }),
  z.object({ action: z.literal("remove"), albumId: id, cardId: id }),
  z.object({ action: z.literal("move"), albumId: id, cardId: id, toAlbumId: id }),
  z.object({ action: z.literal("merge"), albumId: id, intoAlbumId: id }),
  z.object({ action: z.literal("cover"), albumId: id, cardId: id }),
  z.object({ action: z.literal("delete"), albumId: id }),
  z.object({ action: z.literal("resort") }),
]);

async function getHandler(req: Request): Promise<Response> {
  // The read starts with the session check, not after it (a refused request throws it away).
  const claimed = sessionFromRequest(req);
  const early = claimed ? listDocs(claimed.familyId, "album") : null;
  early?.catch(() => undefined);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const albums = (await (early && claimed?.familyId === auth.familyId ? early : listDocs(auth.familyId, "album"))).sort((a, b) => b.endAt.localeCompare(a.endAt));
  return Response.json({ albums });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/albums")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-album" }, { status: 400 });
  const body = parsed.data;
  const fixedBy = auth.memberId;

  if (body.action === "resort") {
    const cards = await dbListCards(auth.familyId);
    const filed = new Set((await listDocs(auth.familyId, "album")).flatMap((a) => a.cardIds));
    let count = 0;
    for (const c of cards.filter((x) => x.type !== "audio" && !filed.has(x.id)).sort((a, b) => a.takenAt.localeCompare(b.takenAt))) {
      if (await fileCard(auth.familyId, c, eventFromText(`${c.caption} ${c.summary}`))) count++;
    }
    return Response.json({ filed: count });
  }

  const album = await getDoc(auth.familyId, "album", body.albumId);
  if (!album) return Response.json({ error: "unknown-album" }, { status: 404 });
  switch (body.action) {
    case "rename":
      return Response.json({ album: await putDoc(auth.familyId, "album", { ...album, title: body.title, event: body.event ?? album.event, madeBy: "family", fixedBy }) });
    case "cover":
      if (!album.cardIds.includes(body.cardId)) return Response.json({ error: "not-in-album" }, { status: 404 });
      return Response.json({ album: await putDoc(auth.familyId, "album", { ...album, coverId: body.cardId, fixedBy }) });
    case "remove": {
      const cardIds = album.cardIds.filter((c) => c !== body.cardId);
      if (cardIds.length === 0) {
        await deleteDoc(auth.familyId, "album", album.id);
        return Response.json({ deleted: album.id });
      }
      return Response.json({ album: await putDoc(auth.familyId, "album", { ...album, cardIds, coverId: album.coverId === body.cardId ? cardIds[0] : album.coverId, fixedBy }) });
    }
    case "move": {
      const to = await getDoc(auth.familyId, "album", body.toAlbumId);
      if (!to || to.id === album.id || !album.cardIds.includes(body.cardId)) return Response.json({ error: "cannot-move" }, { status: 404 });
      await putDoc(auth.familyId, "album", { ...to, cardIds: Array.from(new Set([...to.cardIds, body.cardId])), fixedBy });
      const rest = album.cardIds.filter((c) => c !== body.cardId);
      if (rest.length === 0) await deleteDoc(auth.familyId, "album", album.id);
      else await putDoc(auth.familyId, "album", { ...album, cardIds: rest, coverId: album.coverId === body.cardId ? rest[0] : album.coverId, fixedBy });
      return Response.json({ moved: body.cardId, to: to.id });
    }
    case "merge": {
      const into = await getDoc(auth.familyId, "album", body.intoAlbumId);
      if (!into || into.id === album.id) return Response.json({ error: "cannot-merge" }, { status: 404 });
      const merged = await putDoc(auth.familyId, "album", {
        ...into,
        cardIds: Array.from(new Set([...into.cardIds, ...album.cardIds])),
        startAt: album.startAt < into.startAt ? album.startAt : into.startAt,
        endAt: album.endAt > into.endAt ? album.endAt : into.endAt,
        fixedBy,
      });
      await deleteDoc(auth.familyId, "album", album.id);
      return Response.json({ album: merged });
    }
    case "delete":
      await deleteDoc(auth.familyId, "album", album.id);
      return Response.json({ deleted: album.id });
  }
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
