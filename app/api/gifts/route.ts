import { requireSession } from "@/lib/auth";
import { dbListPlays } from "@/lib/db";
import { cardsFor, docsFor } from "@/lib/request-data";
import { DEMO_SHELF_CARDS } from "@/lib/demo";
import { giftsFor } from "@/lib/gifts";

// GET → what the signed-in person's gifts did this week (their recipes cooked,
// their stories and answers heard). Read-only, the session's family only.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [live, plays, recipes, attempts, stories, questions] = await Promise.all([
    cardsFor(req, auth.familyId),
    dbListPlays(undefined, auth.familyId),
    docsFor(req, auth.familyId, "recipe"),
    docsFor(req, auth.familyId, "attempt"),
    docsFor(req, auth.familyId, "story"),
    docsFor(req, auth.familyId, "question"),
  ]);
  const cards = [...live, ...DEMO_SHELF_CARDS.filter((d) => d.familyId === auth.familyId && !live.some((c) => c.id === d.id))];
  return Response.json({ gifts: giftsFor(auth.memberId, { cards, plays, recipes, attempts, stories, questions }) });
}
