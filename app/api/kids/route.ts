import { requireSession, sessionFromRequest } from "@/lib/auth";
import { cardsFor, docsFor, membersFor, prefetchDocs, preloadCore, relationshipsFor } from "@/lib/request-data";
import { isKid } from "@/lib/kids";
import { kidsPage } from "@/lib/kids-page";
import { sealedCardIds } from "@/lib/today";
import { withDemoShelf } from "@/lib/demo";
import { guardWrites } from "@/lib/api-guard";

// The Kids page for grown-ups (/bond/kids) in one round trip: the kids' fridge, what they
// asked, and the bedtime stories. It reads the same lists the kid
// routes (/api/kid-ask, /api/bedtime) read, once; lib/kids-page.ts decides what
// is shown. A child has kid-home instead: 403.
// GET -> { kids, fridge, voices, asks, askStory, stories }

async function getHandler(req: Request): Promise<Response> {
  // Start the shared reads now, in the same wave as the session lookup (lib/request-data.ts).
  const claimed = sessionFromRequest(req);
  if (claimed) {
    preloadCore(req, claimed.familyId);
    void relationshipsFor(req, claimed.familyId).catch(() => undefined);
    prefetchDocs(req, claimed.familyId, ["kid_ask", "bedtime_story", "story", "today_task", "chitthi"]);
  }
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const f = auth.familyId;
  const [members, rels, stored, asks, stories, tales, tasks, letters] = await Promise.all([
    membersFor(req, f),
    relationshipsFor(req, f),
    cardsFor(req, f),
    docsFor(req, f, "kid_ask"),
    docsFor(req, f, "bedtime_story"),
    docsFor(req, f, "story"),
    docsFor(req, f, "today_task"),
    docsFor(req, f, "chitthi"),
  ]);
  if (isKid(members.find((m) => m.id === auth.memberId))) return Response.json({ error: "not-allowed" }, { status: 403 });
  // What /api/cards keeps sealed stays sealed here.
  const sealed = sealedCardIds(tasks, auth.memberId);
  const now = Date.now();
  for (const l of letters) if (l.authorId !== auth.memberId && Date.parse(l.deliverAt) > now) sealed.add(l.id);
  const all = withDemoShelf(stored, f);
  const cards = sealed.size ? all.filter((c) => !sealed.has(c.id)) : all;
  return Response.json(kidsPage({ viewerId: auth.memberId, members, rels, cards, asks, stories, tales }), { headers: { "cache-control": "no-store" } });
}

export const GET = guardWrites(getHandler);
