import { afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/kitchen/route";
import { recipeAttribution } from "@/components/recipe-art";
import { ingredientIconPath } from "@/components/ingredient-icon";
import { chefCalories, chefDietViolations } from "@/lib/chef-diet";
import { KitchenPreferencesSchema } from "@/lib/kinds";
import { ChefRecipeSchema, surpriseRecipe } from "@/lib/kitchen";
import * as muse from "@/lib/muse";
import * as images from "@/lib/muse-image";
import { mockGetBlob } from "@/lib/storage";
import { resolveMediaUrl } from "@/lib/media-session";
import { GET as readMedia } from "@/app/api/media/[...path]/route";
import { grantVoiceConsent, hasVoiceConsent } from "@/lib/voice-consent";
import { authedGet, authedJson } from "./auth-helper";

const family = "demo-family";
const prefs = KitchenPreferencesSchema.parse({ diet: "Vegan, no onion-garlic, gluten-free", servings: 3, calories: 200 });
const submit = (body: unknown) => POST(authedJson("http://test/api/kitchen", body, "arjun"));
afterEach(() => vi.restoreAllMocks());

it("credits the keeper for Muse ideas and the teacher for family recipes", () => {
  expect(recipeAttribution(true, "you")).toBe("Idea from Muse · kept by you");
  expect(recipeAttribution(true, "Maa")).toBe("Idea from Muse · kept by Maa");
  expect(recipeAttribution(false, "you")).toBe("Taught by you");
});

it("shares recording consent for the same member without granting it to another member", () => {
  grantVoiceConsent("recipe-recorder");
  expect(hasVoiceConsent("recipe-recorder")).toBe(true);
  expect(hasVoiceConsent("another-recorder")).toBe(false);
});

it("has distinct icon artwork for common ingredients and a generic fallback", () => {
  const names = "onion garlic ginger tomato potato rice lentils flour milk yogurt ghee oil egg chicken fish paneer spinach chilli coriander cumin turmeric salt sugar lemon carrot peas cauliflower cabbage beans mushroom bread pasta cheese honey nuts apple banana coconut tea coffee".split(" ");
  const paths = names.map(ingredientIconPath);
  expect(new Set(paths).size).toBe(names.length);
  expect(paths).not.toContain(ingredientIconPath("unknown pantry item"));
});

it("shows offline time, servings and ingredient calorie estimates in typed and spoken drafts", async () => {
  const response = await submit({ action: "draft", text: "Simmer one cup of rice in water for 18 minutes. Serves 3." });
  expect(response.status).toBe(200);
  const { draft } = await response.json();
  expect(draft).toMatchObject({ serves: "3", prepMins: 5, cookMins: 18, caloriesPerServing: 68 });
  expect(draft.ingredients).toEqual(expect.arrayContaining([expect.objectContaining({ item: "rice", kcal: 205 }), expect.objectContaining({ item: "water", kcal: 0 })]));
});

it("rounds total ingredient kcal per serving and checks the supported diets", () => {
  expect(chefCalories([{ kcal: 400 }, { kcal: 202 }], 3)).toBe(201);
  const ingredients = ["chicken stock", "egg", "fish sauce", "oat milk", "butter", "honey", "garlic powder", "red onions", "maida", "barley malt", "eggplant"].map((item) => ({ item }));
  expect(chefDietViolations("Vegetarian", ingredients)).toEqual(["chicken stock", "egg", "fish sauce"]);
  expect(chefDietViolations(prefs.diet, ingredients)).toEqual(["chicken stock", "egg", "fish sauce", "butter", "honey", "garlic powder", "red onions", "maida", "barley malt"]);
});

it("retries a dietary violation once and flags it when the retry still violates the diet", async () => {
  const valid = await surpriseRecipe(family, prefs);
  const bad = { ...valid, ingredients: [{ item: "chicken", said: "200 g", approx: "", kcal: 300 }] };
  const call = vi.spyOn(muse, "museJson").mockResolvedValue({ data: bad, source: "muse", cached: false, cost: 0, model: "mock" });
  expect(await surpriseRecipe(family, prefs)).toMatchObject({ dietViolations: ["chicken"], caloriesPerServing: 100 });
  expect(call).toHaveBeenCalledTimes(2);
  expect(JSON.parse(call.mock.calls[1][0].user).avoidIngredients).toEqual(["chicken"]);
});

it.each(["invalid JSON", "spend cap"])("serves a complete backup after %s", async (failure) => {
  vi.spyOn(muse, "museJson").mockImplementation(async (opts) => {
    if (failure === "invalid JSON") expect(opts.schema.safeParse({ title: "Only a title" }).success).toBe(false);
    return { data: opts.fallback, source: "fallback", cached: false, cost: 0, model: "mock" };
  });
  const backup = await surpriseRecipe(family, prefs);
  expect(ChefRecipeSchema.safeParse(backup).success).toBe(true);
  expect(backup).toMatchObject({ servings: 3, overCalories: true, fallback: true, dietViolations: [] });
});

it.each(["failed", "refused", "ok"] as const)("requests the picture only when kept, and saves the recipe when image status is %s", async (status) => {
  const image = vi.spyOn(images, "museImage").mockResolvedValue(status === "ok"
    ? { status, image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=", cached: false, cost: 0 }
    : { status });
  const preview = await submit({ action: "surprise", prefs });
  const { draft } = await preview.json();
  expect(image).not.toHaveBeenCalled();
  const kept = await submit({ action: "keep-idea", draft: { ...draft, caloriesPerServing: 1, cookId: "dadi" } });
  expect(kept.status).toBe(201);
  const { recipe } = await kept.json();
  expect(recipe).toMatchObject({ museIdea: true, cookId: "arjun", caloriesPerServing: draft.caloriesPerServing });
  if (status === "ok") {
    const path = recipe.coverRef.slice("storage:".length);
    expect(mockGetBlob(path)?.mime).toBe("image/png");
    const mediaUrl = resolveMediaUrl(recipe.coverRef);
    expect(mediaUrl).toBe(`/api/media/${path}`);
    const response = await readMedia(authedGet(`http://test${mediaUrl}`, "dadi"), { params: Promise.resolve({ path: path.split("/") }) });
    expect(response.status).toBe(307);
  } else expect(recipe.coverRef).toBeNull();
  expect(image).toHaveBeenCalledTimes(1);
  expect(image).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, images: [] }));
});
