import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { docsFor } from "@/lib/request-data";
import { needFromVoice, noteForParent } from "@/lib/care";
import { dbAddAgentRun, dbListCards, dbListMembers, dbListRelationships } from "@/lib/db";
import { deleteDoc, getDoc, listDocs, newId, putDoc } from "@/lib/family-docs";
import { householdOf, households } from "@/lib/households";
import { HELPER_ROLES, NEED_KINDS, NEED_STATUSES, PRIORITIES, RECURRENCE, type Helper, type Need } from "@/lib/kinds";
import { isDialable, MAX_NEARBY, normalizePhone, rankNearby } from "@/lib/nearby";
import { can } from "@/lib/permissions";
import type { Member } from "@/lib/schemas";
import { guardWrites } from "@/lib/api-guard";

// Care board: tasks for each home (open → assigned → in progress → done,
// or cancelled) and the home's local helpers. A helper marked `emergency` is
// on that home's Trusted nearby list: at most five, ranked, each with their
// consent. Every task change is written to its timeline. Tasks only: no
// medical, legal or financial advice anywhere. (The old rota / "who handles
// what" setup is retired; its stored docs are left untouched.)

const When = z.string().trim().max(60).default("");
const DueAt = z.string().datetime().nullable().optional();
const Phone = z.string().trim().max(30).regex(/^[+\d\s()-]*$/).default("");

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("need"),
    forMemberId: z.string().min(1),
    title: z.string().trim().min(3).max(120),
    kind: z.enum(NEED_KINDS).default("other"),
    when: When,
    priority: z.enum(PRIORITIES).default("normal"),
    dueAt: DueAt,
    recurring: z.enum(RECURRENCE).default("none"),
    petId: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
  }),
  z.object({ action: z.literal("need-from-voice"), cardId: z.string().min(1), forMemberId: z.string().min(1) }),
  z.object({ action: z.literal("claim"), needId: z.string().min(1) }),
  // Assign to any family member (siblings split the work).
  z.object({ action: z.literal("assign-to"), needId: z.string().min(1), memberId: z.string().min(1) }),
  // The local helper who will actually go.
  z.object({ action: z.literal("assign"), needId: z.string().min(1), helperId: z.string().min(1) }),
  z.object({ action: z.literal("status"), needId: z.string().min(1), status: z.enum(NEED_STATUSES) }),
  z.object({ action: z.literal("done"), needId: z.string().min(1) }),
  z.object({ action: z.literal("reopen"), needId: z.string().min(1) }),
  z.object({
    action: z.literal("need-edit"),
    needId: z.string().min(1),
    title: z.string().trim().min(3).max(120),
    kind: z.enum(NEED_KINDS),
    when: When,
    priority: z.enum(PRIORITIES).optional(),
    dueAt: DueAt,
    recurring: z.enum(RECURRENCE).optional(),
  }),
  z.object({ action: z.literal("need-delete"), needId: z.string().min(1) }),
  z.object({ action: z.literal("helper"), forMemberId: z.string().min(1), name: z.string().trim().min(1).max(60), role: z.enum(HELPER_ROLES).default("other"), phone: Phone, hours: z.string().trim().max(60).default(""), note: z.string().trim().max(160).default(""), emergency: z.boolean().default(false), consent: z.boolean().default(false) }),
  z.object({ action: z.literal("helper-edit"), helperId: z.string().min(1), name: z.string().trim().min(1).max(60), role: z.enum(HELPER_ROLES), phone: Phone, hours: z.string().trim().max(60).default(""), note: z.string().trim().max(160).default(""), emergency: z.boolean().optional(), consent: z.boolean().optional() }),
  z.object({ action: z.literal("helper-remove"), helperId: z.string().min(1) }),
  // Trusted nearby rank: swap with the one above (-1) or below (+1) in that home.
  z.object({ action: z.literal("nearby-move"), helperId: z.string().min(1), dir: z.union([z.literal(-1), z.literal(1)]) }),
]);

// Anyone may ask for themselves and edit or withdraw their own tasks;
// running care (assigning, local helpers) needs care.manage. Your own
// trusted-nearby people (the ones near *you*) are always yours to keep.
const SELF_SERVICE = new Set(["need", "need-from-voice", "need-edit", "need-delete"]);
const NEARBY_SELF = new Set(["helper", "helper-edit", "helper-remove", "nearby-move"]);

/** Trusted nearby for a home, ranked #1 first. */
function rankedNearby(helpers: Helper[], homeIds: Set<string>): Helper[] {
  return rankNearby(helpers.filter((h) => h.emergency && homeIds.has(h.forMemberId)));
}

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [needs, helpers] = await Promise.all([docsFor(req, auth.familyId, "need"), docsFor(req, auth.familyId, "helper")]);
  // Oldest first, so the trusted-nearby rank (#1 = earliest) reads straight off the list.
  return Response.json({ needs, helpers: rankNearby(helpers) });
}

function nextDue(from: string | null, recurring: Need["recurring"]): string | null {
  if (recurring === "none") return null;
  const d = from ? new Date(from) : new Date();
  if (recurring === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/care")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-care" }, { status: 400 });
  const body = parsed.data;
  const members = await dbListMembers(auth.familyId);
  const person = (id: string | null | undefined): Member | undefined => members.find((m) => m.id === id);
  const me = person(auth.memberId);
  const now = new Date().toISOString();
  // Teens (and children) don't write to care at all: no tasks, no Trusted nearby.
  if (!can(me, "care.write")) return Response.json({ error: "not-allowed", action: "care.write" }, { status: 403 });

  // Your own trusted-nearby list (the people near *you*) is yours to keep.
  let ownNearby = false;
  if (NEARBY_SELF.has(body.action)) {
    if (body.action === "helper") ownNearby = body.forMemberId === auth.memberId;
    else if ("helperId" in body) ownNearby = (await getDoc(auth.familyId, "helper", body.helperId))?.forMemberId === auth.memberId;
  }
  if (!SELF_SERVICE.has(body.action) && !ownNearby && !can(me, "care.manage")) return Response.json({ error: "not-allowed", action: "care.manage" }, { status: 403 });
  const askingForSelf = "forMemberId" in body && body.forMemberId === auth.memberId;
  if ((body.action === "need" || body.action === "need-from-voice") && !askingForSelf && !can(me, "care.manage")) return Response.json({ error: "not-allowed", action: "care.manage" }, { status: 403 });

  const loadNeed = async (id: string): Promise<Need | Response> => (await getDoc(auth.familyId, "need", id)) ?? Response.json({ error: "unknown-need" }, { status: 404 });
  const reassure = async (need: Need, english: string) => {
    const parent = person(need.forMemberId);
    return parent ? noteForParent(auth.familyId, parent, english) : english;
  };
  /** Save with one more line on the ticket's timeline. */
  const save = (need: Need, what: string, patch: Partial<Need> = {}) =>
    putDoc(auth.familyId, "need", { ...need, ...patch, history: [...need.history, { at: now, by: auth.memberId, what }].slice(-100) });
  const homeIdsOf = async (memberId: string): Promise<Set<string>> => {
    const home = householdOf(memberId, households(members, await dbListRelationships(auth.familyId)));
    return new Set([memberId, ...(home?.members.map((m) => m.id) ?? [])]);
  };
  /** Trusted nearby rules: dialable number, their consent, at most five per home. */
  const nearbyProblem = async (forMemberId: string, phone: string, consent: boolean, exceptId?: string): Promise<Response | null> => {
    if (!consent) return Response.json({ error: "needs-consent" }, { status: 400 });
    if (!isDialable(phone)) return Response.json({ error: "invalid-phone" }, { status: 400 });
    const listed = rankedNearby(await listDocs(auth.familyId, "helper"), await homeIdsOf(forMemberId)).filter((h) => h.id !== exceptId);
    if (listed.length >= MAX_NEARBY) return Response.json({ error: "nearby-full", max: MAX_NEARBY }, { status: 409 });
    return null;
  };

  switch (body.action) {
    case "need": {
      if (!person(body.forMemberId)) return Response.json({ error: "unknown-member" }, { status: 404 });
      const assignee = body.assignee ? person(body.assignee) : undefined;
      const need = await putDoc(auth.familyId, "need", {
        id: newId("need"),
        forMemberId: body.forMemberId,
        askedBy: auth.memberId,
        title: body.title,
        kind: body.kind,
        when: body.when,
        priority: body.priority,
        dueAt: body.dueAt ?? null,
        recurring: body.recurring,
        petId: body.petId ?? null,
        status: assignee ? "claimed" : "open",
        claimedBy: assignee?.id ?? null,
        history: [{ at: now, by: auth.memberId, what: assignee ? `Created and assigned to ${assignee.displayName}` : "Created" }],
        createdAt: now,
      });
      return Response.json({ need }, { status: 201 });
    }
    case "need-from-voice": {
      const parent = person(body.forMemberId);
      const card = (await dbListCards(auth.familyId)).find((c) => c.id === body.cardId);
      if (!parent || !card) return Response.json({ error: "unknown" }, { status: 404 });
      const draft = await needFromVoice(auth.familyId, parent.displayName, card.transcript || card.caption, card.transcriptLang || card.lang);
      const need = await putDoc(auth.familyId, "need", { id: newId("need"), forMemberId: parent.id, askedBy: auth.memberId, ...draft, status: "open", history: [{ at: now, by: auth.memberId, what: "Asked by voice (written down by Muse)" }], createdAt: now });
      await dbAddAgentRun({ goal: `Care: turned ${parent.displayName}'s voice into a task`, tools: ["muse-voice-transcribe", "muse-spark", "create_need"], familyId: auth.familyId });
      return Response.json({ need }, { status: 201 });
    }
    case "claim":
    case "assign-to": {
      const need = await loadNeed(body.needId);
      if (need instanceof Response) return need;
      const who = person(body.action === "claim" ? auth.memberId : body.memberId);
      if (!who || !can(who, "care.write")) return Response.json({ error: "unknown-member" }, { status: 404 });
      const noteForParent = await reassure(need, `${who.displayName} is taking care of it.`);
      const what = body.action === "claim" ? `${who.displayName} took it` : `${me?.displayName ?? "Family"} assigned it to ${who.displayName}`;
      return Response.json({ need: await save(need, what, { status: need.status === "progress" ? "progress" : "claimed", claimedBy: who.id, noteForParent }) });
    }
    case "assign": {
      const need = await loadNeed(body.needId);
      if (need instanceof Response) return need;
      const helper = await getDoc(auth.familyId, "helper", body.helperId);
      // A helper serves the whole home (Maa's grocer is Papa's grocer too).
      if (!helper || !(await homeIdsOf(need.forMemberId)).has(helper.forMemberId)) return Response.json({ error: "unknown-helper" }, { status: 404 });
      const english = `${helper.name} will help${need.when ? ` (${need.when})` : ""}. ${me?.displayName ?? "Family"} arranged it.`;
      return Response.json({ need: await save(need, `${helper.name} (${helper.role}) will go`, { status: need.status === "open" ? "claimed" : need.status, claimedBy: need.claimedBy ?? auth.memberId, helperId: helper.id, noteForParent: await reassure(need, english) }) });
    }
    case "status":
    case "done":
    case "reopen": {
      const need = await loadNeed(body.needId);
      if (need instanceof Response) return need;
      const status = body.action === "done" ? "done" : body.action === "reopen" ? "open" : body.status;
      const label: Record<Need["status"], string> = { open: "Re-opened", claimed: "Assigned", progress: "Started", done: "Done", cancelled: "Cancelled" };
      const patch: Partial<Need> =
        status === "open"
          ? { status, claimedBy: null, helperId: null, noteForParent: "", doneAt: null }
          : status === "done"
            ? { status, claimedBy: need.claimedBy ?? auth.memberId, doneAt: now }
            : { status };
      const saved = await save(need, label[status], patch);
      // A recurring task rolls forward: the next one is created, open, with the same people.
      let next: Need | null = null;
      if (status === "done" && need.recurring !== "none") {
        next = await putDoc(auth.familyId, "need", {
          ...need,
          id: newId("need"),
          status: need.claimedBy ? "claimed" : "open",
          dueAt: nextDue(need.dueAt, need.recurring),
          doneAt: null,
          noteForParent: "",
          history: [{ at: now, by: auth.memberId, what: `Repeats ${need.recurring}: created after the last one was done` }],
          createdAt: now,
        });
      }
      return Response.json({ need: saved, next });
    }
    case "need-edit":
    case "need-delete": {
      const need = await loadNeed(body.needId);
      if (need instanceof Response) return need;
      const mine = need.askedBy === auth.memberId || need.forMemberId === auth.memberId;
      if (!mine && !can(me, "care.manage")) return Response.json({ error: "not-yours" }, { status: 403 });
      if (body.action === "need-delete") {
        await deleteDoc(auth.familyId, "need", need.id);
        return Response.json({ deleted: need.id });
      }
      const { action: _a, needId: _n, ...fields } = body;
      void _a;
      void _n;
      return Response.json({ need: await save(need, "Edited", { ...fields, dueAt: fields.dueAt === undefined ? need.dueAt : fields.dueAt }) });
    }
    case "helper": {
      if (!person(body.forMemberId)) return Response.json({ error: "unknown-member" }, { status: 404 });
      // Someone's number on a trusted-nearby list only with their say-so (DPDP consent).
      if (body.emergency) {
        const problem = await nearbyProblem(body.forMemberId, body.phone, body.consent);
        if (problem) return problem;
      }
      const { action: _a, ...rest } = body;
      void _a;
      const phone = body.emergency ? normalizePhone(body.phone) : body.phone;
      return Response.json({ helper: await putDoc(auth.familyId, "helper", { id: newId("helper"), ...rest, phone, addedBy: auth.memberId, createdAt: now }) }, { status: 201 });
    }
    case "helper-edit": {
      const helper = await getDoc(auth.familyId, "helper", body.helperId);
      if (!helper) return Response.json({ error: "unknown-helper" }, { status: 404 });
      const { action: _a, helperId: _h, ...fields } = body;
      void _a;
      void _h;
      const emergency = fields.emergency ?? helper.emergency;
      const consent = fields.consent ?? helper.consent;
      if (emergency) {
        const problem = await nearbyProblem(helper.forMemberId, fields.phone, consent, helper.id);
        if (problem) return problem;
      }
      return Response.json({ helper: await putDoc(auth.familyId, "helper", { ...helper, ...fields, emergency, consent, phone: emergency ? normalizePhone(fields.phone) : fields.phone }) });
    }
    case "helper-remove": {
      const helper = await getDoc(auth.familyId, "helper", body.helperId);
      if (!helper) return Response.json({ error: "unknown-helper" }, { status: 404 });
      await deleteDoc(auth.familyId, "helper", helper.id);
      return Response.json({ removed: helper.id });
    }
    case "nearby-move": {
      const helper = await getDoc(auth.familyId, "helper", body.helperId);
      if (!helper?.emergency) return Response.json({ error: "unknown-helper" }, { status: 404 });
      const ranked = rankedNearby(await listDocs(auth.familyId, "helper"), await homeIdsOf(helper.forMemberId));
      const i = ranked.findIndex((h) => h.id === helper.id);
      const other = ranked[i + body.dir];
      if (!other) return Response.json({ nearby: ranked });
      // Rank is the order of createdAt. Swap the two, then re-stamp the home's list
      // 1 ms apart from the earliest, so ties (people seeded together) can't scramble it.
      const order = [...ranked];
      [order[i], order[i + body.dir]] = [order[i + body.dir], order[i]];
      const base = Date.parse(ranked[0].createdAt);
      for (let k = 0; k < order.length; k++) {
        const h = order[k];
        const stamp = new Date(base + k).toISOString();
        if (h.createdAt !== stamp) await putDoc(auth.familyId, "helper", { ...h, createdAt: stamp });
      }
      return Response.json({ nearby: rankedNearby(await listDocs(auth.familyId, "helper"), await homeIdsOf(helper.forMemberId)) });
    }
  }
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
