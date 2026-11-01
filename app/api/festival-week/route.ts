import { requireSession } from "@/lib/auth";
import { memberFor } from "@/lib/request-memo";
import { dbEnsureRitualRun, dbListCards, dbListMembers, dbListWishes } from "@/lib/db";
import { withDemoShelf } from "@/lib/demo";
import { festivalWeek, type FestivalWeekPayload } from "@/lib/festival-week";
import { familyHolidays, ritualConfigs } from "@/lib/occasions-server";
import { localDay } from "@/lib/ritual-agent";
import { guardWrites } from "@/lib/api-guard";

// Festival Week for the viewer's family: the festival it keeps that falls in
// the next seven days, with the ritual's steps, colour and greeting (all from
// rituals/*.json), the family's own photos from past years, and who leads.
// `{ week: null }` when no kept festival is that close.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [members, me] = await Promise.all([dbListMembers(auth.familyId), memberFor(req, auth.memberId)]);
  const [fam, stored] = await Promise.all([familyHolidays(auth.familyId, members).catch(() => null), dbListCards(auth.familyId)]);
  if (!fam) return Response.json({ week: null });
  const today = localDay(new Date(), me?.tz).toISOString().slice(0, 10);
  const week = festivalWeek({
    today,
    holidays: fam.all,
    choices: fam.settings,
    configs: ritualConfigs(),
    cards: withDemoShelf(stored, auth.familyId),
    members,
    viewerId: auth.memberId,
  });
  if (!week) return Response.json({ week: null });
  // The run the family's wishes for this festival gather on (idempotent, as in /api/rituals).
  const run = await dbEnsureRitualRun(week.slug, week.date, auth.familyId).catch(() => null);
  const wishes = run ? await dbListWishes(undefined, auth.familyId).catch(() => []) : [];
  const payload: FestivalWeekPayload = {
    ...week,
    ritualRunId: run?.id ?? null,
    viewerWished: Boolean(run && wishes.some((w) => w.ritualRunId === run.id && w.memberId === auth.memberId)),
  };
  return Response.json({ week: payload });
}

export const GET = guardWrites(getHandler);
