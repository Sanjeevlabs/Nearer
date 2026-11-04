import { requireSession, sessionFromRequest } from "@/lib/auth";
import { memberFor } from "@/lib/request-memo";
import { cardsFor, holidaysOf, membersFor, preloadCore } from "@/lib/request-data";
import { dbEnsureRitualRun, dbListWishes } from "@/lib/db";
import { withDemoShelf } from "@/lib/demo";
import { festivalWeek, type FestivalWeekPayload } from "@/lib/festival-week";
import { ritualConfigs } from "@/lib/occasions-server";
import { localDay } from "@/lib/ritual-agent";
import { guardWrites } from "@/lib/api-guard";
import { orUnlessRead } from "@/lib/family-db";
import { seenBy } from "@/lib/card-privacy";

// Festival Week for the viewer's family: the festival it keeps that falls in
// the next seven days, with the ritual's steps, colour and greeting (all from
// rituals/*.json), the family's own photos from past years, and who leads.
// `{ week: null }` when no kept festival is that close.
async function getHandler(req: Request): Promise<Response> {
  // The shared reads start with the auth lookup, not after it (lib/request-data.ts).
  const claimed = sessionFromRequest(req);
  if (claimed) preloadCore(req, claimed);
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [members, me] = await Promise.all([membersFor(req, auth.familyId), memberFor(req, auth.memberId)]);
  const [fam, stored] = await Promise.all([holidaysOf(req, auth.familyId).catch(orUnlessRead(null)), cardsFor(req, auth.familyId)]);
  if (!fam) return Response.json({ week: null });
  const today = localDay(new Date(), me?.tz).toISOString().slice(0, 10);
  const week = festivalWeek({
    today,
    holidays: fam.all,
    choices: fam.settings,
    configs: ritualConfigs(),
    cards: seenBy(withDemoShelf(stored, auth.familyId), auth.memberId),
    members,
    viewerId: auth.memberId,
  });
  if (!week) return Response.json({ week: null });
  // The run the family's wishes for this festival gather on (idempotent, as in /api/rituals).
  // The wishes are listed alongside it, not after it; they only count once the run exists.
  const [run, allWishes] = await Promise.all([dbEnsureRitualRun(week.slug, week.date, auth.familyId).catch(() => null), dbListWishes(undefined, auth.familyId)]);
  const wishes = run ? allWishes : [];
  const payload: FestivalWeekPayload = {
    ...week,
    ritualRunId: run?.id ?? null,
    viewerWished: Boolean(run && wishes.some((w) => w.ritualRunId === run.id && w.memberId === auth.memberId)),
  };
  return Response.json({ week: payload });
}

export const GET = guardWrites(getHandler);
