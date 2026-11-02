import { beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent";
import { agentTools, weeklyLetterTool } from "@/lib/agent-tools";
import { dbAddCard, dbListSuggestions } from "@/lib/db";
import { WeeklyLetterSchema, fallbackLetter, gatherWeekFacts, weekStartOf } from "@/lib/weekly-letter";
import { resetDemo } from "@/lib/store";

const FAM = "demo-family";

async function addFreshCards(n: number, daysAgo = 1) {
  for (let i = 0; i < n; i++) {
    await dbAddCard({
      familyId: FAM,
      type: "audio",
      caption: `Rain all evening ${i}`,
      lang: "en",
      takenAt: new Date(Date.now() - daysAgo * 86_400_000 - i * 60_000).toISOString(),
      authorId: "dadi",
      source: "upload",
    });
  }
}

describe("draft_weekly_letter (mock)", () => {
  beforeEach(() => resetDemo());

  it("gathers grounded facts, max 40, plain strings", async () => {
    await addFreshCards(3);
    const { facts, weekStart } = await gatherWeekFacts(FAM);
    expect(facts.length).toBeGreaterThanOrEqual(3);
    expect(facts.length).toBeLessThanOrEqual(40);
    expect(facts.some((f) => /^\w{3}: Maa shared a voice memory 'Rain all evening/.test(f))).toBe(true);
    expect(weekStart).toBe(weekStartOf());
  });

  it("returns a schema-valid draft suggestion", async () => {
    await addFreshCards(4);
    const out = (await weeklyLetterTool(FAM).run({})) as { draft: boolean; suggestion: { goal: string; payload: Record<string, unknown> } };
    expect(out.suggestion.goal).toBe("Send this week's letter?");
    const p = out.suggestion.payload;
    expect(p.action).toBe("weekly_letter");
    expect(WeeklyLetterSchema.safeParse({ title: p.title, body: p.body, lang: p.lang }).success).toBe(true);
    expect(typeof p.weekStart).toBe("string");
    expect(p.factCount).toBeGreaterThanOrEqual(4);
  });

  it("the fixed fallback is valid, uses only the first six facts, and speaks Hindi on request", () => {
    const facts = Array.from({ length: 10 }, (_, i) => `Tue: Maa shared a photo 'n${i}'`);
    const en = fallbackLetter(facts);
    expect(WeeklyLetterSchema.safeParse(en).success).toBe(true);
    expect(en.body).toContain("'n5'");
    expect(en.body).not.toContain("'n6'");
    const hi = fallbackLetter(facts, "hi");
    expect(hi.lang).toBe("hi");
    expect(hi.body).toContain("प्यारे परिवार");
    expect(fallbackLetter(["Mon: " + "x".repeat(400), "Tue: " + "y".repeat(400), "Wed: " + "z".repeat(400)]).body.length).toBeLessThanOrEqual(900);
  });

  it("a quiet week drafts nothing under the minimum", async () => {
    const out = (await weeklyLetterTool(FAM, { minFacts: 9999 }).run({})) as { draft: boolean };
    expect(out.draft).toBe(false);
  });

  it("runAgent turns the goal into one pending-ready suggestion and writes nothing itself", async () => {
    await addFreshCards(3);
    const before = (await dbListSuggestions(undefined, FAM)).length;
    const r = await runAgent("Draft this week's letter from the courtyard", agentTools(FAM));
    expect(r.toolCalls.map((c) => c.name)).toEqual(["draft_weekly_letter"]);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].payload.action).toBe("weekly_letter");
    expect((await dbListSuggestions(undefined, FAM)).length).toBe(before);
  });
});
