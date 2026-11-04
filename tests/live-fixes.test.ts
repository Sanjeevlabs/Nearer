import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as recipeGET } from "@/app/api/kitchen/[id]/route";
import { RecipeCover, dishOf } from "@/components/recipe-art";
import { listDocs } from "@/lib/family-docs";
import { INSTALL_STEPS, pushGuide } from "@/lib/push-guide";
import { resetDemo } from "@/lib/store";
import { THEME_HINT } from "@/lib/theme-hint";
import { authedGet } from "./auth-helper";

beforeEach(() => resetDemo());

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36";

describe("every demo recipe shows calories per serving", () => {
  for (const [family, member] of [["demo-family", "dadi"], ["demo-iyer", "iyer-nani"]] as const) {
    it(`${family}: kcal on every ingredient, a per-serving total, times and servings`, async () => {
      const recipes = await listDocs(family, "recipe");
      expect(recipes.length).toBeGreaterThan(0);
      for (const r of recipes) {
        const res = await recipeGET(authedGet(`http://t/api/kitchen/${r.id}?lang=en`, member, family), { params: Promise.resolve({ id: r.id }) });
        const body = (await res.json()) as { recipe: { caloriesPerServing?: number | null; serves: string; prepMins: number | null; cookMins: number | null; ingredients: { kcal?: number }[] } };
        expect(body.recipe.caloriesPerServing, r.id).toBeGreaterThan(20);
        expect(body.recipe.caloriesPerServing, r.id).toBeLessThan(900);
        expect(body.recipe.ingredients.every((i) => typeof i.kcal === "number"), r.id).toBe(true);
        expect(body.recipe.serves, r.id).toBeTruthy();
        expect((body.recipe.prepMins ?? 0) + (body.recipe.cookMins ?? 0), r.id).toBeGreaterThan(0);
      }
    });
  }

  it("the dal's total is the sum of its ingredients over four servings", async () => {
    const dal = (await listDocs("demo-family", "recipe")).find((r) => r.id === "recipe-dadi-dal")!;
    const sum = dal.ingredients.reduce((n, i) => n + (i.kcal ?? 0), 0);
    expect(dal.caloriesPerServing).toBe(Math.round(sum / 4));
  });
});

describe("palak paneer has its own art", () => {
  it("greens get a green cover that is not the dal bowl's", () => {
    expect(dishOf("Palak paneer")).toBe("greens");
    expect(dishOf("Dal tadka")).toBeNull();
    const cover = (title: string) => renderToStaticMarkup(createElement(RecipeCover, { recipe: { course: "main", title } }));
    expect(cover("Palak paneer")).not.toBe(cover("Dal tadka"));
    expect(cover("Palak paneer")).toContain("#e3efd8");
  });
});

describe("the kitchen page is built to wrap", () => {
  it("ingredient rows wrap, so a long amount stacks under the name instead of printing over it", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("app/kitchen/[id]/page.tsx", "utf8");
    const row = src.slice(src.indexOf('aria-pressed={got}'));
    expect(row).toContain("flex-wrap");
    expect(row).toContain("break-words");
    expect(row).not.toMatch(/<span className="shrink-0 text-right">/);
  });
});

describe("notifications on iPhone", () => {
  it("Safari in a tab: 'Add to Home Screen first' with three steps", () => {
    const g = pushGuide("needs-install", IPHONE_SAFARI);
    expect(g.label).toBe("Add to Home Screen first");
    expect(g.turnOn).toBe(false);
    expect(g.steps).toEqual(INSTALL_STEPS);
    expect(g.steps).toHaveLength(3);
  });
  it("another browser on iPhone is sent to Safari", () => {
    const g = pushGuide("needs-install", IPHONE_CHROME);
    expect(g.label).toBeNull();
    expect(g.steps).toEqual([]);
    expect(g.note).toBe("Open nearer.site in Safari to turn notifications on.");
  });
  it("unsupported keeps its words and has no button; ready turns on as before", () => {
    expect(pushGuide("unsupported", ANDROID)).toMatchObject({ label: null, turnOn: false, note: "This browser can't show notifications." });
    expect(pushGuide("ready", ANDROID).turnOn).toBe(true);
    expect(pushGuide("native", ANDROID).turnOn).toBe(true);
  });
  it("blocked says how to allow them again in phone settings", () => {
    expect(pushGuide("blocked", IPHONE_SAFARI)).toMatchObject({ turnOn: false, label: null });
    expect(pushGuide("blocked", IPHONE_SAFARI).note).toContain("Settings app");
    expect(pushGuide("blocked", ANDROID).note).toContain("App info");
  });
});

describe("the first-paint theme script", () => {
  it("is a plain string: no helper from the bundler can leak into it", () => {
    expect(typeof THEME_HINT).toBe("string");
    expect(THEME_HINT).not.toContain("__name");
    expect(() => new Function(THEME_HINT)).not.toThrow();
  });
});
