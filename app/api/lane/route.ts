import { requireSession, sessionFromRequest } from "@/lib/auth";
import { dbListCards, dbListRitualRuns, dbListWishes } from "@/lib/db";
import { membersFor, preloadSessionMember } from "@/lib/request-data";
import { withDemoShelf } from "@/lib/demo";
import { listDocsMany } from "@/lib/family-docs";
import { laneElsewhere } from "@/lib/lane-groups";
import { claimedByOccasions } from "@/lib/occasion-album";

// GET /api/lane → { elsewhere }: ids of the cards another tab shows
// (Occasions, Stories, The Book, Advice). Memory Lane leaves them out, so it
// is the family's everyday photos and voices and nothing shows twice.
/** Everything the answer is made from: four queries and the family list, one wave (the four document kinds are one query), within a Worker's open connections. */
function readLane(req: Request, f: string) {
  return Promise.all([dbListCards(f), listDocsMany(f, ["album", "story", "question", "today_task"] as const), dbListRitualRuns(f), dbListWishes(undefined, f), membersFor(req, f)]);
}

export async function GET(req: Request): Promise<Response> {
  // The reads start with the session check, not after it (the signed cookie names the family; a refused request throws them away).
  const claimed = sessionFromRequest(req);
  // The signed-in member's own row comes out of the same family list (no query of its own).
  if (claimed) preloadSessionMember(req, claimed);
  const early = claimed ? readLane(req, claimed.familyId) : null;
  early?.catch(() => undefined);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const f = auth.familyId;
  const [stored, docs, runs, wishes, members] = await (early && claimed?.familyId === f ? early : readLane(req, f));
  const { album: albums, story: stories, question: questions, today_task: tasks } = docs;
  const cards = withDemoShelf(stored, f);
  const wishCards = wishes.filter((w) => w.ritualRunId && w.cardId).map((w) => ({ ritualRunId: w.ritualRunId, cardId: w.cardId }));
  const elsewhere = laneElsewhere({
    occasions: claimedByOccasions(cards, albums, runs, wishCards),
    stories,
    questions,
    tasks,
    bookIds: members.filter((m) => m.role === "elder").map((m) => m.id),
    cards,
  });
  return Response.json({ elsewhere: [...elsewhere] });
}
