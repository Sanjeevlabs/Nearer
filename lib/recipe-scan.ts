// Read a recipe card: a photo of a handwritten or printed recipe, in any
// language → a draft in the Kitchen's own recipe shape, for a person to check
// in the recipe editor before anything is saved. Server only.
// Zod-validated, one retry, then a safe fallback (an empty editor with the
// photo attached). Spend-capped and cached by the photo; logged.
import { z } from "zod";
import { activeProvider, failoverProvider, isMockMode, PROVIDERS, providerKey, type ProviderName } from "./config";
import { newId, putDoc } from "./family-docs";
import { RecipeSchema } from "./kinds";
import { buildVisionMessages, cacheKey, sha256Hex, type LlmStore, type SpendLedger, type VisionImage } from "./llm";
import { serverLedger, serverStore } from "./llm-server";
import { MODEL_TIMEOUT_MS, deadline, isTimeout } from "./timeouts";

/** What Muse may fill in: the editor's fields, never who cooks it or why it matters. */
export const ScannedRecipeSchema = RecipeSchema.pick({
  title: true,
  course: true,
  serves: true,
  prepMins: true,
  cookMins: true,
  caloriesPerServing: true,
  prepWork: true,
  outcome: true,
  ingredients: true,
  steps: true,
  lang: true,
}).refine((r) => r.ingredients.length > 0 && r.steps.length > 0, { message: "empty recipe" });

export type ScannedRecipe = z.infer<typeof ScannedRecipeSchema>;

export const SCAN_SYSTEM =
  "You read a photo of a family recipe card (handwritten or printed, any language) and return JSON only: " +
  '{"title": string, "course": one of "breakfast","main","side","snack","sweet","drink","other", "serves": string, ' +
  '"prepMins": integer or null, "cookMins": integer or null, "prepWork": string[], "outcome": string, ' +
  '"ingredients": [{"item": string, "said": string, "approx": string}], "steps": [{"text": string, "tip": string}], "lang": short language code}. ' +
  "Write down ONLY what is on the card, in the card's own language and words. said = the amount exactly as written (\"1 katori\", \"a fistful\"); " +
  "approx = a cautious everyday equivalent only when the written amount is vague, else empty. Never invent an ingredient, step, time or amount. " +
  "Use null for times that are not written. Include caloriesPerServing as an approximate integer only when quantities and serving size are clear. If you cannot read a recipe in the photo, return {\"title\": \"\", \"ingredients\": [], \"steps\": []}.";

/** A fixed synthetic card for mock mode and the demo without a key. */
export const MOCK_SCAN: ScannedRecipe = {
  title: "Besan ladoo",
  course: "sweet",
  serves: "about 12 ladoos",
  prepMins: null,
  cookMins: 25,
  caloriesPerServing: 240,
  prepWork: ["Sift the besan", "Powder the sugar"],
  outcome: "Smells nutty, the colour of sand at sunset; holds when you press it.",
  ingredients: [
    { item: "besan", said: "2 katori", approx: "≈ 2 cups" },
    { item: "ghee", said: "1 katori, a little less", approx: "≈ ¾ cup" },
    { item: "sugar, powdered", said: "1½ katori", approx: "≈ 1½ cups" },
    { item: "elaichi", said: "4-5, crushed", approx: "" },
    { item: "almonds", said: "a handful, chopped", approx: "" },
  ],
  steps: [
    { text: "Warm the ghee in a heavy kadhai on low heat and add the besan.", tip: "" },
    { text: "Keep stirring on low for 20-25 minutes until it smells nutty and turns golden.", tip: "Don't leave it, it burns at the bottom." },
    { text: "Take it off the heat and let it cool until you can touch it.", tip: "" },
    { text: "Mix in the sugar, elaichi and almonds, then press into round ladoos.", tip: "If it won't hold, add a spoon of warm ghee." },
  ],
  lang: "en",
};

type VisionCall = (provider: ProviderName, system: string, image: VisionImage) => Promise<{ json: unknown; cost: number }>;

async function liveVision(provider: ProviderName, system: string, image: VisionImage): Promise<{ json: unknown; cost: number }> {
  const cfg = PROVIDERS[provider];
  const key = providerKey(provider);
  if (!key) throw new Error("missing-key");
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    signal: deadline(MODEL_TIMEOUT_MS),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.captionModel,
      messages: [{ role: "system", content: system }, ...buildVisionMessages("Read this recipe card.", [image])],
      response_format: { type: "json_object" },
      max_tokens: 3000,
    }),
  });
  if (!res.ok) throw new Error(`provider-${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { json: JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as unknown, cost: 0.01 };
}

/** Validate a model reply. Null when it is not a usable recipe. */
export function parseScan(json: unknown): ScannedRecipe | null {
  const out = ScannedRecipeSchema.safeParse(json);
  return out.success ? out.data : null;
}

export async function scanRecipe(opts: {
  familyId: string;
  image: VisionImage;
  ledger?: SpendLedger;
  store?: LlmStore;
  /** Tests inject the model call. */
  call?: VisionCall;
  /** Tests force the live path while MOCK is on. */
  forceLive?: boolean;
}): Promise<{ draft: ScannedRecipe | null; source: "muse" | "fallback" }> {
  const ledger = opts.ledger ?? serverLedger;
  const store = opts.store ?? serverStore;
  const provider = activeProvider();
  const model = PROVIDERS[provider].captionModel;
  const started = Date.now();
  const log = (ok: boolean, cached: boolean, cost: number) =>
    putDoc(opts.familyId, "muse_call", { id: newId("muse"), purpose: "Read a recipe card from a photo", model, cached, ok, ms: Date.now() - started, cost, at: new Date().toISOString() }).catch(() => undefined);

  const mock = isMockMode() && !opts.forceLive;
  if (mock) {
    await log(true, false, 0);
    return { draft: MOCK_SCAN, source: "muse" };
  }
  const key = `scan:${cacheKey(model, SCAN_SYSTEM, sha256Hex(opts.image.bytes))}`;
  const hit = store.get(key);
  if (hit) {
    const cached = parseScan(JSON.parse(hit));
    if (cached) {
      await log(true, true, 0);
      return { draft: cached, source: "muse" };
    }
  }
  if (!(await ledger.check(0.01))) {
    await log(false, false, 0);
    return { draft: null, source: "fallback" };
  }
  const call: VisionCall =
    opts.call ??
    ((p, s, i) =>
      liveVision(p, s, i).catch((err) => {
        if (isTimeout(err)) throw err;
        const next = failoverProvider(p);
        if (next) return liveVision(next, s, i);
        throw err;
      }));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await call(provider, SCAN_SYSTEM, opts.image);
      const draft = parseScan(out.json);
      if (!draft) continue;
      await ledger.commit(out.cost);
      store.set(key, JSON.stringify(draft));
      await log(true, false, out.cost);
      return { draft, source: "muse" };
    } catch (err) {
      if (isTimeout(err)) break;
      continue;
    }
  }
  await log(false, false, 0);
  return { draft: null, source: "fallback" };
}
