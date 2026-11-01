import { dbAddCard, dbAddGatherSession, dbAddSuggestion, dbAddWish, dbAssignDailyRole, dbClaimSuggestion, dbGetMember, dbReleaseSuggestion, dbListMembers, dbListRitualRuns, dbListSuggestions, dbSetRitualRunStatus, dbSetSuggestionStatus } from "@/lib/db";
import { isGrownUp } from "@/lib/permissions";
import { requireSession } from "@/lib/auth";
import { DbWriteError } from "@/lib/family-db";
import { guardWrites } from "@/lib/api-guard";
import { newId, putDoc } from "@/lib/family-docs";
import { WeeklyLetterSchema } from "@/lib/weekly-letter";

// Review / Approve: the ONLY place agent proposals become actions.
// Payload actions: create_card | assign_daily_role | request_wish |
// schedule_notification (acknowledge) | create_gather_session | assemble_reel | weekly_letter.
async function postHandler(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const all = await dbListSuggestions(undefined, auth.familyId);
  const found = all.find((s) => s.id === params.id);
  if (!found) return Response.json({ error: "unknown-suggestion" }, { status: 404 });
  if (found.status !== "pending") return Response.json({ error: "already-reviewed", suggestion: found }, { status: 409 });
  // Approving makes things happen for the whole family: grown-ups only.
  const me = await dbGetMember(auth.memberId);
  if (!me || me.familyId !== auth.familyId || !isGrownUp(me) || me.role === "child") return Response.json({ error: "grown-ups-only" }, { status: 403 });
  const familyId = auth.familyId;
  const members = await dbListMembers(familyId);
  const inFamily = (id: string) => members.some((m) => m.id === id);
  const runs = await dbListRitualRuns(familyId);
  const ownRun = (id: string | null) => id === null || runs.some((r) => r.id === id);

  let decision = "approve";
  try {
    const body = (await req.json()) as { decision?: unknown };
    if (body.decision === "reject") decision = "reject";
  } catch {
    decision = "approve";
  }
  if (decision === "reject") {
    const updated = await dbSetSuggestionStatus(params.id, "rejected", familyId);
    return Response.json({ suggestion: updated ?? { ...found, status: "rejected" } });
  }

  // Claim first: only the request that flips pending -> approved runs the
  // action, so a double tap or retry can't make two cards.
  if (!(await dbClaimSuggestion(params.id, familyId))) return Response.json({ error: "already-decided" }, { status: 409 });

  const payload = (found.payload ?? {}) as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";
  // A bad payload did nothing, so give the claim back.
  const refuse = async (error: string): Promise<Response> => {
    await dbReleaseSuggestion(params.id, familyId);
    return Response.json({ error }, { status: 400 });
  };
  try {
    if (action === "create_card") {
      const card = (payload.result as { card?: Record<string, unknown> } | undefined)?.card
        ?? (payload.card as Record<string, unknown> | undefined)
        ?? (payload.args as Record<string, unknown> | undefined);
      await dbAddCard({
        familyId,
        type: (card?.type as "photo" | "audio" | "video") ?? "photo",
        caption: String(card?.caption ?? "A family memory, saved by Nearer."),
        lang: String(card?.lang ?? "en"),
        takenAt: new Date().toISOString(),
        ritualSlug: null,
        source: "agent",
      });
    } else if (action === "assign_daily_role") {
      const args = (payload.args as Record<string, unknown> | undefined) ?? {};
      const result = (payload.result as Record<string, unknown> | undefined) ?? {};
      const memberId = String(args.memberId ?? result.memberId ?? "");
      if (!inFamily(memberId)) return refuse("unknown-member");
      const prompt = String(args.prompt ?? result.prompt ?? "Bless one grandchild by voice today.");
      const roleDate = String(args.roleDate ?? result.roleDate ?? new Date().toISOString().slice(0, 10));
      await dbAssignDailyRole(memberId, prompt.slice(0, 280), roleDate.slice(0, 10), familyId);
    } else if (action === "request_wish") {
      const args = (payload.args as Record<string, unknown> | undefined) ?? {};
      const result = (payload.result as Record<string, unknown> | undefined) ?? {};
      const ritualRunId = (args.ritualRunId ?? result.ritualRunId) as string | null;
      const memberId = String(args.memberId ?? result.memberId ?? "");
      const kind = ((args.kind ?? result.kind) as "wish" | "blessing") ?? "wish";
      if (!inFamily(memberId) || !ownRun(ritualRunId ?? null)) return refuse("unknown-member");
      await dbAddWish({ ritualRunId: ritualRunId ?? null, memberId, kind: kind === "blessing" ? "blessing" : "wish", familyId });
    } else if (action === "create_gather_session") {
      const args = (payload.args as Record<string, unknown> | undefined) ?? {};
      const result = (payload.result as Record<string, unknown> | undefined) ?? {};
      await dbAddGatherSession({
        familyId,
        title: String(args.title ?? result.title ?? "Family evening").slice(0, 80),
        startsAt: String(args.startsAt ?? result.startsAt ?? new Date(Date.now() + 86400000).toISOString()),
      });
    } else if (action === "weekly_letter") {
      // Stored as a written chitthi (no voice card), to the whole family, delivered now.
      const letter = WeeklyLetterSchema.safeParse(payload);
      if (!letter.success) return refuse("invalid-letter");
      await putDoc(familyId, "chitthi", { id: newId("letter"), kind: "letter", ...letter.data, authorId: auth.memberId, deliverAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    } else if (action === "assemble_reel") {
      const ritualRunId = String((payload.ritualRunId as string | undefined) ?? "");
      if (ritualRunId && !ownRun(ritualRunId)) return refuse("unknown-run");
      if (ritualRunId) await dbSetRitualRunStatus(ritualRunId, "delivered", familyId);
      await dbAddSuggestion({
        familyId,
        goal: `Reel ready for ${ritualRunId || "the occasion"}`,
        payload: { action: "reel_ready", ritualRunId },
      });
    }
    // schedule_notification approvals simply acknowledge the reminder.
  } catch (e) {
    await dbReleaseSuggestion(params.id, familyId).catch(() => undefined); // let them try again
    if (e instanceof DbWriteError) throw e; // guardWrites answers 503 save-failed
    return Response.json({ error: "approve-failed" }, { status: 500 });
  }
  const updated = await dbSetSuggestionStatus(params.id, "approved", familyId);
  return Response.json({ suggestion: updated ?? { ...found, status: "approved" } });
}

export const POST = guardWrites(postHandler);
