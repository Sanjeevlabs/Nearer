// The seven agent tools (PRD §Agents), db-backed. Every tool is READ or
// DRAFT-only: nothing here writes a user-visible change. runAgent wraps tool
// results into `suggestions`; the approve route executes them after review.
import type { AgentTool } from "./agent";
import { dbListCards, dbListMembers, dbListRelationships, dbListWishes } from "./db";
import { FAMILY_WIDE, seenBy } from "./card-privacy";
import { gatherWeekFacts, LETTER_GOAL, writeLetter, type WeeklyLetterPayload } from "./weekly-letter";

type LetterOpts = { lang?: "en" | "hi"; minFacts?: number };

/** Draft the week's letter from grounded facts. Reads only; the approve route writes it. */
export function weeklyLetterTool(familyId: string, opts: LetterOpts = {}): AgentTool {
  return {
    name: "draft_weekly_letter",
    description: "Draft this week's short letter to the family from what really happened (needs approval).",
    parameters: { type: "object", properties: { weekStart: { type: "string" } } },
    run: async (args) => {
      const { weekStart, facts } = await gatherWeekFacts(familyId, typeof args.weekStart === "string" ? args.weekStart : undefined);
      if (facts.length < Math.max(1, opts.minFacts ?? 1)) return { draft: false, reason: "quiet-week", factCount: facts.length };
      const letter = await writeLetter(familyId, facts, opts.lang ?? "en");
      const payload: WeeklyLetterPayload = { action: "weekly_letter", ...letter, weekStart, factCount: facts.length };
      return { draft: true, suggestion: { goal: LETTER_GOAL, payload } };
    },
  };
}

export function agentTools(familyId: string, opts: LetterOpts = {}): AgentTool[] {
  return [
    {
      name: "read_family_graph",
      description: "Read the family members and Bond relationships.",
      parameters: { type: "object", properties: {} },
      run: async () => ({
        members: (await dbListMembers(familyId)).map((m) => ({ id: m.id, name: m.displayName, role: m.role, tz: m.tz })),
        relationships: await dbListRelationships(familyId),
      }),
    },
    {
      name: "query_lane",
      description: "Query Memory Lane cards, optionally filtered.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string" },
          ritualSlug: { type: "string" },
          limit: { type: "number" },
        },
      },
      run: async (args) => {
        // The family agent works for everyone: notes for particular people are never its to read.
        const all = seenBy(await dbListCards(familyId), FAMILY_WIDE);
        const type = typeof args.type === "string" ? args.type : undefined;
        const slug = typeof args.ritualSlug === "string" ? args.ritualSlug : undefined;
        const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 8;
        return all
          .filter((c) => (!type || c.type === type) && (!slug || c.ritualSlug === slug))
          .slice(0, limit)
          .map((c) => ({ id: c.id, type: c.type, caption: c.caption, takenAt: c.takenAt }));
      },
    },
    {
      name: "create_card",
      description: "Draft a memory card (persisted only after approval).",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string" },
          caption: { type: "string" },
          lang: { type: "string" },
        },
      },
      run: async (args) => ({
        draft: true,
        card: {
          familyId,
          type: typeof args.type === "string" ? args.type : "photo",
          caption: typeof args.caption === "string" ? args.caption.slice(0, 280) : "A family memory.",
          lang: typeof args.lang === "string" ? args.lang : "en",
          takenAt: new Date().toISOString(),
        },
      }),
    },
    {
      name: "schedule_notification",
      description: "Draft a reminder suggestion for the family.",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      run: async (args) => ({ draft: true, text: typeof args.text === "string" ? args.text : "" }),
    },
    {
      name: "request_wish",
      description: "Draft a wish/blessing request for a ritual run.",
      parameters: {
        type: "object",
        properties: {
          ritualRunId: { type: "string" },
          memberId: { type: "string" },
          kind: { type: "string" },
        },
      },
      run: async (args) => ({
        draft: true,
        ritualRunId: args.ritualRunId ?? null,
        memberId: args.memberId ?? null,
        kind: args.kind ?? "wish",
        existing: await dbListWishes(typeof args.ritualRunId === "string" ? args.ritualRunId : undefined, familyId).then((w) => w.length),
      }),
    },
    {
      name: "assign_daily_role",
      description: "Draft an elder daily role (ikigai) for today.",
      parameters: { type: "object", properties: { memberId: { type: "string" }, prompt: { type: "string" } } },
      run: async (args) => ({
        draft: true,
        memberId: typeof args.memberId === "string" ? args.memberId : "dadi",
        prompt: typeof args.prompt === "string" ? args.prompt : "Bless one grandchild by voice today.",
        roleDate: new Date().toISOString().slice(0, 10),
      }),
    },
    {
      name: "create_gather_session",
      description: "Draft a Gather evening session.",
      parameters: { type: "object", properties: { title: { type: "string" }, startsAt: { type: "string" } } },
      run: async (args) => ({
        draft: true,
        title: typeof args.title === "string" ? args.title : "Family evening",
        startsAt: typeof args.startsAt === "string" ? args.startsAt : new Date(Date.now() + 86400000).toISOString(),
      }),
    },
    weeklyLetterTool(familyId, opts),
  ];
}
