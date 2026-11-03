import { expect, it } from "vitest";
import { GET, POST } from "@/app/api/kitchen/route";
import { POST as scan } from "@/app/api/kitchen/scan/route";
import { POST as transcribe } from "@/app/api/transcribe/route";
import { KitchenPreferencesSchema } from "@/lib/kinds";
import { MOCK_SCAN, parseScan } from "@/lib/recipe-scan";
import { authedGet, authedJson, sessionCookie } from "./auth-helper";

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

it("saves editable drafts from the mock photo and voice paths", async () => {
  const photo = await scan(authedJson(`${url}/scan`, {
    image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=",
  }, member));
  expect(photo.status).toBe(200);
  const photographed = await photo.json();
  const savedPhoto = await POST(authedJson(url, { ...photographed.draft, action: "create", scanRef: "test/photo" }, member));
  expect(savedPhoto.status).toBe(201);
  expect((await savedPhoto.json()).recipe).toMatchObject({ coverRef: "test/photo", caloriesPerServing: 240 });

  const form = new FormData();
  form.append("audio", new Blob(["mock audio"], { type: "audio/wav" }), "test.wav");
  const voice = await transcribe(new Request("http://localhost/api/transcribe", {
    method: "POST", headers: { cookie: sessionCookie(member) }, body: form,
  }));
  expect(voice.status).toBe(200);
  const spoken = await voice.json();
  const preview = await POST(authedJson(url, { action: "draft", text: spoken.transcript.transcript }, member));
  expect(preview.status).toBe(200);
  const { draft } = await preview.json();
  const savedVoice = await POST(authedJson(url, { ...draft, action: "create", title: "Edited voice recipe" }, member));
  expect(savedVoice.status).toBe(201);
  expect((await savedVoice.json()).recipe.title).toBe("Edited voice recipe");
});
