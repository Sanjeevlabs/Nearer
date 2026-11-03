import { z } from "zod";
import { curatePlaylist } from "@/lib/llm";
import { serverLedger, serverStore } from "@/lib/llm-server";
import { dbAddGatherSession, dbListCards, dbListGatherSessions, dbListMembers } from "@/lib/db";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { FAMILY_WIDE, seenBy } from "@/lib/card-privacy";

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [sessions, members] = await Promise.all([dbListGatherSessions(auth.familyId), dbListMembers(auth.familyId)]);
  return Response.json({ sessions, members });
}

const CreateGatherSchema = z.object({
  title: z.string().min(1).max(120).default("Family evening"),
  startsAt: z.string().datetime(),
  invites: z.array(z.string()).max(20).default([]),
});

// Plan a Gather: date + per-member local times (client renders via Intl),
// invites, playlist curated by the model from the Lane.
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/gather")) return Response.json({ error: "rate-limited" }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = CreateGatherSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-gather" }, { status: 400 });
  }
  // A gathering plays for everyone: only family-wide voices.
  const cards = seenBy(await dbListCards(auth.familyId), FAMILY_WIDE);
  const audio = cards.filter((c) => c.type === "audio").slice(0, 20);
  const { tracks } = await curatePlaylist(
    audio.map((c) => ({ id: c.id, caption: c.caption })),
    { store: serverStore, ledger: serverLedger },
  );
  const session = await dbAddGatherSession({
    familyId: auth.familyId,
    title: parsed.data.title,
    startsAt: parsed.data.startsAt,
    invites: parsed.data.invites,
    playlist: tracks.map((t) => t.cardId),
  });
  return Response.json({ session, playlist: tracks }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
