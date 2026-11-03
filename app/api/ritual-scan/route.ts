import { askWeeklyQuestions } from "@/lib/keeper";
import { planRitualScan } from "@/lib/ritual-agent";
import { dbAddAgentRun, dbAddSuggestion, dbAssignDailyRole, dbEnsureRitualRun, dbListFamilyIds, dbListDailyRoles, dbListMembers, dbListRitualRuns, dbListSuggestions, dbListWishes, dbSetRitualRunStatus } from "@/lib/db";
import { familyHolidays, ritualConfigs } from "@/lib/occasions-server";
import { cronAuthorized, requireSession } from "@/lib/auth";
import { purgeSandboxes } from "@/lib/demo-sandbox";
import { dbFor, orUnlessRead } from "@/lib/family-db";
import { getCronState, pageFamilies, setCronState } from "@/lib/cron-state";
import { guardWrites } from "@/lib/api-guard";
import { letterLang } from "@/lib/weekly-letter";
import { draftWeeklyLetter } from "@/lib/weekly-letter-run";
import { runScanNudges } from "@/lib/nudge-run";
import { purgeExpired } from "@/lib/purge";
import { purgeSessions } from "@/lib/sessions";

// Daily ritual/role scan. Vercel Cron (GET, see vercel.json) hits this with
// Authorization: Bearer CRON_SECRET; manual callers use POST with a session.
// Idempotent — safe to call repeatedly.
async function getHandler(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return Response.json({ error: "unauthorized-cron" }, { status: 401 });
  // Demo visitors' copies expire after 48 hours (rows and media).
  const sb = dbFor(null);
  const purged = sb ? await purgeSandboxes(sb).catch((e: unknown) => ({ error: String(e) })) : null;
  // Sessions a week past expiry or revocation go too (demo visitors make one each).
  const sessionsPurged = await purgeSessions().catch(() => -1);
  // Cron covers one page of families per invocation (a cursor in cron_state
  // moves on each day); one family's failure never blocks the others.
  const cursor = String((await getCronState("ritual-scan")).lastFamilyId ?? "");
  const { batch, next } = pageFamilies(await dbListFamilyIds(), cursor);
  await setCronState("ritual-scan", { lastFamilyId: next });
  const results = [];
  for (const familyId of batch) {
    try {
      results.push({ familyId, ...(await (await runScan(familyId)).json()) });
    } catch (e) {
      // The error's name only (DbReadError, ...), never its message or any family data.
      console.error("[ritual-scan] family scan failed", familyId, e instanceof Error ? e.name : "error");
      results.push({ familyId, error: "scan-failed" });
    }
  }
  return Response.json({ families: results, purged, sessionsPurged });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  return runScan(auth.familyId);
}

async function runScan(familyId: string): Promise<Response> {
  const now = new Date();
  const nowISO = now.toISOString();
  const members = await dbListMembers(familyId);
  const [runs, wishes, roles] = await Promise.all([dbListRitualRuns(familyId), dbListWishes(undefined, familyId), dbListDailyRoles(familyId)]);

  // Festivals of the traditions this family celebrates (+ manual overrides);
  // national days are on the calendar but nobody is asked for a wish.
  const fam = await familyHolidays(familyId, members).catch(orUnlessRead(null));
  const festivals = (fam?.visible ?? []).filter((h) => h.kind === "festival");
  const ritualSlugs = new Set(ritualConfigs().map((c) => c.slug));
  const configs = festivals.map((h) => ({ slug: h.key, title: h.title, ritual: h.ritual && ritualSlugs.has(h.ritual) ? h.ritual : null }));
  const movable: Record<string, string> = {};
  for (const h of festivals) {
    // The nearest date per festival from today on (a key can recur yearly).
    if (h.date >= nowISO.slice(0, 10) && (!movable[h.key] || h.date < movable[h.key])) movable[h.key] = h.date;
  }

  const plan = planRitualScan(nowISO, members, configs, movable, { runs, wishes, roles }, familyId);

  // Once a week: Muse drafts the family's letter (a suggestion; a grown-up approves it).
  const keeper = members.find((m) => m.access === "owner") ?? members.find((m) => m.access === "admin") ?? members[0];
  const letter = await draftWeeklyLetter(familyId, { lang: letterLang(keeper?.displayLang), by: "scan" }).catch(() => ({ status: "skipped" as const }));
  const letterDrafted = letter.status === "created" ? 1 : 0;

  // Queue the calendar nudges (an occasion this week, the call tomorrow, letter day) and deliver what is due at 8 AM.
  const nudges = await runScanNudges(familyId, { members, now, occasions: festivals.map((h) => ({ slug: h.key, title: h.title, date: h.date })) });

  // Expired ephemeral rows go (knocks, old nudges, day lines, open check-ins, ...). Never throws.
  const purged = await purgeExpired(familyId, now).catch((e: unknown) => ({ error: String(e) }));

  // Nothing within the next 7 days and no elder to ask: no writes at all.
  if (plan.ensureRuns.length === 0 && plan.deliverRuns.length === 0 && plan.suggestions.length === 0 && !members.some((m) => m.role === "elder")) {
    console.log("[ritual-scan] skipped", familyId);
    return Response.json({ date: nowISO.slice(0, 10), skipped: true, runsEnsured: 0, runsDelivered: 0, rolesAssigned: 0, suggestions: 0, questionsAsked: 0, letters: letterDrafted, nudges, purged });
  }

  // TODO(batch): these helpers write one row per call (dbEnsureRitualRun also re-lists the
  // runs, dbAssignDailyRole upserts one role, dbAddSuggestion inserts one suggestion). lib/db.ts
  // needs array variants (dbEnsureRitualRuns / dbAssignDailyRoles / dbAddSuggestions) to make
  // each loop a single insert.
  for (const r of plan.ensureRuns) await dbEnsureRitualRun(r.slug, r.occasionDate, familyId);
  for (const id of plan.deliverRuns) await dbSetRitualRunStatus(id, "delivered", familyId);
  for (const role of plan.roles) await dbAssignDailyRole(role.memberId, role.prompt, role.roleDate, familyId);
  // Idempotent: a suggestion already made (same goal and payload) is not made again.
  const sig = (goal: string, payload: unknown) => `${goal}|${JSON.stringify(payload ?? {})}`;
  const made = new Set((await dbListSuggestions(undefined, familyId)).map((x) => sig(x.goal, x.payload)));
  const created = [];
  for (const s of plan.suggestions) {
    if (made.has(sig(s.goal, s.payload))) continue;
    made.add(sig(s.goal, s.payload));
    created.push(await dbAddSuggestion({ goal: s.goal, payload: s.payload, familyId }));
  }
  // Story keeper: one gentle question per elder per week (idempotent).
  const questions = await askWeeklyQuestions(familyId, members, now).catch(() => []);
  await dbAddAgentRun({
    familyId,
    goal: `Ritual scan ${nowISO.slice(0, 10)}`,
    tools: ["read_family_graph", "request_wish", "schedule_notification", "assign_daily_role", ...(questions.length ? ["ask_elder_question"] : [])],
    status: "done",
  });
  return Response.json({
    date: nowISO.slice(0, 10),
    runsEnsured: plan.ensureRuns.length,
    runsDelivered: plan.deliverRuns.length,
    rolesAssigned: plan.roles.length,
    suggestions: created.length,
    questionsAsked: questions.length,
    letters: letterDrafted,
    nudges,
    purged,
  });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
