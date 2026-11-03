import { expect, it } from "vitest";
import { GET, POST } from "@/app/api/kitchen/route";
import { KitchenPreferencesSchema } from "@/lib/kinds";
import { MOCK_SCAN, parseScan } from "@/lib/recipe-scan";
import { authedGet, authedJson } from "./auth-helper";

const url = "http://localhost/api/kitchen";
const member = "arjun";

it("prepares a typed draft with ingredients and steps", async () => {
  const response = await POST(authedJson(url, { action: "draft", text: "Simmer one cup of rice in water until tender." }, member));
  expect(response.status).toBe(200);
  const { draft } = await response.json();
  expect(draft.ingredients.some((item: { item: string }) => item.item === "rice")).toBe(true);
  expect(draft.steps).toHaveLength(1);
  expect(parseScan(MOCK_SCAN)?.caloriesPerServing).toBe(240);
});

it("remembers preferences for the member and returns another suggestion", async () => {
  const prefs = KitchenPreferencesSchema.parse({ fridge: "rice and lemon", servings: 3 });
  const result = await POST(authedJson(url, { action: "surprise", prefs }, member));
  expect(result.status).toBe(200);
  const { draft } = await result.json();
  const another = await POST(authedJson(url, { action: "surprise", prefs, previous: draft.title }, member));
  expect(another.status).toBe(200);
  expect((await another.json()).draft.title).not.toBe(draft.title);
  expect(await (await GET(authedGet(`${url}?prefs=1`, member))).json()).toEqual({ prefs });
  expect(await (await GET(authedGet(`${url}?prefs=1`, "dadi"))).json()).toEqual({ prefs: KitchenPreferencesSchema.parse({}) });
});
