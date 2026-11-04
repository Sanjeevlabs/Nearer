import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FAMILY_STORY_IDEAS, FAMILY_STORY_TAG, STORY_IDEAS, familyStoriesFor, ideaFor, resolveIdea } from "@/lib/story-ideas";
import { listMembers } from "@/lib/store";

const names = { children: ["Asha", "Ravi"], grandchildren: ["Mira", "Tej"] };

describe("family story prompts", () => {
  it("has about twenty, all tagged family-story, each with a first-person ask", () => {
    expect(FAMILY_STORY_IDEAS.length).toBeGreaterThanOrEqual(20);
    for (const i of FAMILY_STORY_IDEAS) {
      expect(i.tags).toContain(FAMILY_STORY_TAG);
      expect(i.beats).toHaveLength(3);
      expect(i.ask && i.ask.length).toBeGreaterThan(5);
      expect(i.ask!.length).toBeLessThanOrEqual(70); // "Tell me a story about " + ask must fit the 80-character request
    }
    expect(new Set(FAMILY_STORY_IDEAS.map((i) => i.id)).size).toBe(FAMILY_STORY_IDEAS.length);
  });

  it("includes the named prompts", () => {
    const titles = FAMILY_STORY_IDEAS.map((i) => i.title);
    expect(titles).toContain("Where you grew up, and what the street sounded like");
    expect(titles).toContain("A hard year, and how the family came through");
    expect(titles).toContain("The day {child} was born");
  });

  it("resolves {child} and {grandchild} everywhere, and rotates names", () => {
    const born = FAMILY_STORY_IDEAS.find((i) => i.id === "fs-born")!;
    expect(resolveIdea(born, names, 0).title).toBe("The day Asha was born");
    expect(resolveIdea(born, names, 1).title).toBe("The day Ravi was born");
    for (const i of FAMILY_STORY_IDEAS) {
      const r = resolveIdea(i, names, 3);
      for (const t of [r.title, r.lesson, ...r.beats]) expect(t).not.toMatch(/[{}]/);
    }
  });

  it("falls back to plain words when the family has nobody for a placeholder", () => {
    const held = FAMILY_STORY_IDEAS.find((i) => i.id === "fs-held")!;
    expect(resolveIdea(held, { children: [], grandchildren: [] }).title).toBe("The first time you held your grandchild");
  });

  it("keeps the folk tale of the day separate from family prompts", () => {
    expect(STORY_IDEAS.some((i) => i.tags?.includes(FAMILY_STORY_TAG))).toBe(false);
    expect(ideaFor("2026-10-31", []).tags).toBeUndefined();
  });

  it("moves by day, returns the count asked for and honours skips", () => {
    const a = familyStoriesFor("2026-10-31", 5);
    const b = familyStoriesFor("2026-11-01", 5);
    expect(a).toHaveLength(5);
    expect(a[1].id).toBe(b[0].id);
    const skipped = familyStoriesFor("2026-10-31", 5, (i) => i.id === a[0].id);
    expect(skipped.some((i) => i.id === a[0].id)).toBe(false);
    expect(skipped).toHaveLength(5);
  });

  it("rotates all four new family history prompts and lets families skip them", () => {
    const ids = ["fs-grandparents-work", "fs-parents-met", "fs-grandmother-recipe", "fs-family-saying"];
    const seen = new Set<string>();
    for (let day = 1; day <= FAMILY_STORY_IDEAS.length; day++) {
      const date = `2026-11-${String(day).padStart(2, "0")}`;
      for (const idea of familyStoriesFor(date, 5)) seen.add(idea.id);
      expect(familyStoriesFor(date, 5, (idea) => ids.includes(idea.id)).some((idea) => ids.includes(idea.id))).toBe(false);
    }
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });

  it("never hard-codes a demo family name in lib/", () => {
    process.env.MOCK = "true";
    const demo = new Set(["Arjun", "Priya", "Dadi", "Dada", "Leo", "Aria", "Kavya", "Rohan", "Vihaan", "Rahul", "Anaya", "Kabir", "Maa", "Papa"]);
    for (const m of listMembers()) {
      for (const n of [m.firstName, m.displayName]) if (n.length > 2) demo.add(n);
    }
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith("story-ideas.ts")) files.push(p);
      }
    };
    walk(join(process.cwd(), "lib"));
    expect(files).toHaveLength(1);
    const src = readFileSync(files[0], "utf8");
    for (const n of demo) expect(src, `lib/story-ideas.ts mentions "${n}"`).not.toMatch(new RegExp(`\\b${n}\\b`));
  });
});
