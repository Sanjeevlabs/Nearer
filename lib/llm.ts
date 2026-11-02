import { createHash } from "crypto";
import { z } from "zod";
import { containsDevanagari } from "./script";
import { describeLang } from "./languages";
import { activeProvider, failoverProvider, isMockMode, providerKey, PROVIDERS, SPEND_CAP_USD } from "./config";
import {
  CaptionSchema,
  TranslationSchema,
  VoiceTranscriptSchema,
  type Caption,
  type Translation,
  type VoiceTranscript,
} from "./schemas";
import { normalizeDisplayLang } from "./i18n";

export interface LlmStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function memoryStore(): LlmStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => map.set(key, value),
  };
}

// Spend ledger: cumulative USD across calls. Refuses calls past the cap.
export class SpendLedger {
  total = 0;
  constructor(private store: LlmStore) {
    const raw = store.get("spend:total");
    if (raw) this.total = Number(raw) || 0;
  }
  canSpend(cost: number): boolean {
    return this.total + cost <= SPEND_CAP_USD;
  }
  record(cost: number): void {
    this.total += cost;
    this.store.set("spend:total", String(this.total));
  }
  /** Shared total from durable storage, where there is one (see lib/llm-server.ts). */
  protected async sync(_delta: number): Promise<void> {}
  /** Refresh the shared total, then check the cap. Use this before every paid call. */
  async check(cost: number): Promise<boolean> {
    await this.sync(0);
    return this.canSpend(cost);
  }
  /** Record a call's cost locally and in the shared total. */
  async commit(cost: number): Promise<void> {
    this.record(cost);
    await this.sync(cost);
  }
}

export function cacheKey(model: string, input: string, mediaId: string): string {
  return createHash("sha256").update(`${model}|${input}|${mediaId}`).digest("hex");
}

const FALLBACK_CAPTION: Caption = {
  caption: "A family memory, saved to Memory Lane.",
  language: "en",
  names: [],
  takenAt: null,
  event: "everyday",
};

async function mockCaption(prompt: string): Promise<{ json: unknown; cost: number }> {
  const hindi = /hindi|\bhi\b/i.test(prompt);
  return {
    json: hindi
      ? {
          caption: "परिवार की एक प्यारी याद।",
          language: "hi",
          names: [],
          takenAt: null,
        }
      : {
          caption: "A warm family moment, kept close.",
          language: "en",
          names: [],
          takenAt: null,
        },
    cost: 0,
  };
}

export interface VisionImage {
  bytes: Uint8Array;
  mime: string;
}

function visionDataUrl(image: VisionImage): string {
  const mime = image.mime === "image/jpg" ? "image/jpeg" : image.mime || "image/jpeg";
  return `data:${mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

// Vision message builder (01_api_fundamentals/07): the image travels as an
// `image_url` content part inside a USER message (image content in a system
// message is rejected with HTTP 400). Base64 data URLs for local media.
// Pure so tests can assert the image payload without network.
export function buildVisionMessages(
  prompt: string,
  images: VisionImage[],
): { role: string; content: { type: string; text?: string; image_url?: { url: string } }[] }[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...images.map((image) => ({ type: "image_url" as const, image_url: { url: visionDataUrl(image) } })),
      ],
    },
  ];
}

async function liveCaption(
  provider: keyof typeof PROVIDERS,
  systemPrompt: string,
  userPrompt: string,
  images: VisionImage[],
): Promise<{ json: unknown; cost: number }> {
  const cfg = PROVIDERS[provider];
  const key = providerKey(provider);
  if (!key) throw new Error("missing-key");
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.captionModel,
      messages: [{ role: "system", content: systemPrompt }, ...buildVisionMessages(userPrompt, images)],
      response_format: { type: "json_object" },
      // Reasoning models spend hundreds of tokens before answering; a low
      // cap truncates the reply to null and trips the fallback every time.
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`provider-${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("empty");
  return { json: extractJson(text), cost: 0.01 };
}

const CAPTION_SYSTEM =
  "Write a short family-memory caption as JSON: {caption, language, names, takenAt, event}. " +
  "Describe ONLY what is visible in the attached image(s) plus the names listed below — " +
  "never invent people, places, or events beyond the pixels. " +
  "Caption is 10-280 chars. Names must only repeat names given in the prompt. " +
  "takenAt is ISO datetime or null when unknown. " +
  "event is what kind of moment it visibly is, one of: wedding, ritual, festival, birthday, gathering, trip, food, nature, school, everyday " +
  "(wedding = a wedding ceremony or reception; ritual = a prayer or religious ceremony; festival = festive lights, decorations or celebration; use everyday when unsure). Reply with JSON only.";

// Vision-grounded captions (01_api_fundamentals/07): the model sees the real
// bytes. The live path REQUIRES images — without media there is no model
// call, only the fixed fallback. Mock returns a deterministic stub keyed by
// media hash for tests. Never throws.
export async function captionCard(
  prompt: string,
  opts: { mediaId?: string; store?: LlmStore; ledger?: SpendLedger; images?: VisionImage[] } = {},
): Promise<{ caption: Caption; cached: boolean; cost: number }> {
  const store = opts.store ?? memoryStore();
  const ledger = opts.ledger ?? new SpendLedger(store);
  const provider = activeProvider();
  const model = PROVIDERS[provider].captionModel;
  const images = opts.images ?? [];
  const mediaKey = images.length > 0 ? images.map((i) => sha256Hex(i.bytes)).join(",") : (opts.mediaId ?? "unknown");
  const key = `llm:${cacheKey(model, prompt, mediaKey)}`;
  const hit = store.get(key);
  if (hit) {
    const parsed = CaptionSchema.safeParse(JSON.parse(hit));
    if (parsed.success) return { caption: parsed.data, cached: true, cost: 0 };
  }

  // No media, no model: the fixed fallback is not a model caption.
  if (images.length === 0 && !isMockMode()) {
    return { caption: FALLBACK_CAPTION, cached: false, cost: 0 };
  }

  const estimatedCost = isMockMode() ? 0 : 0.01;
  if (!(await ledger.check(estimatedCost))) {
    return { caption: FALLBACK_CAPTION, cached: false, cost: 0 };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = isMockMode()
        ? await mockCaption(prompt)
        : await liveCaption(provider, CAPTION_SYSTEM, prompt, images).catch(async (err) => {
            // The other Muse host takes over when it has a key; otherwise rethrow.
            const next = failoverProvider(provider);
            if (next) return liveCaption(next, CAPTION_SYSTEM, prompt, images);
            throw err;
          });
      const parsed = CaptionSchema.safeParse(out.json);
      if (!parsed.success) continue;
      parsed.data.language = normalizeLangCode(parsed.data.language, "en");
      await ledger.commit(out.cost);
      store.set(key, JSON.stringify(parsed.data));
      return { caption: parsed.data, cached: false, cost: out.cost };
    } catch {
      continue;
    }
  }
  return { caption: FALLBACK_CAPTION, cached: false, cost: 0 };
}



const FALLBACK_TRANSLATION: Translation = {
  text: "A family memory, kept close.",
  language: "en",
};

const KNOWN_EN_TO_HI_DEVA: Array<[RegExp, string]> = [
  // Prompts an elder is asked to tell or answer (Stories, today's question), so
  // Dadi reads them in Hindi in the demo. Mock mode only; live mode asks Muse.
  // "$1" keeps a family name as it is.
  [/^One thing you miss about (.+)$/i, "$1 की एक बात जो आपको याद आती है"],
  [/^The monkey and the crocodile$/i, "बंदर और मगरमच्छ"],
  [/^The thirsty crow$/i, "प्यासा कौआ"],
  [/^The lion and the mouse$/i, "शेर और चूहा"],
  [/^The tortoise who talked too much$/i, "बहुत बोलने वाला कछुआ"],
  [/^The blue jackal$/i, "नीला सियार"],
  [/^The hare and the lion in the well$/i, "खरगोश और कुएँ वाला शेर"],
  [/^The goose with golden feathers$/i, "सुनहरे पंखों वाली हंसिनी"],
  [/^The elephant and the thin rope$/i, "हाथी और पतली रस्सी"],
  [/^A story only you know$/i, "एक कहानी जो सिर्फ़ आपके पास है"],
  [/^Where you grew up, and what the street sounded like$/i, "आप कहाँ पले-बढ़े, और वहाँ की गली कैसी सुनाई देती थी"],
  [/^How the two of you met$/i, "आप दोनों कैसे मिले"],
  [/^A hard year, and how the family came through$/i, "एक मुश्किल साल, और परिवार उससे कैसे निकला"],
  [/^The day (.+) was born$/i, "जिस दिन $1 का जन्म हुआ"],
  [/^Where your own grandparents lived$/i, "आपके अपने दादा-दादी कहाँ रहते थे"],
  [/^Your first job, and your first pay$/i, "आपकी पहली नौकरी, और पहली तनख़्वाह"],
  [/^A time you were really scared, and what got you through$/i, "जब आप सच में डर गए थे, और किसने हिम्मत दी"],
  [/^Your wedding day, including what went wrong$/i, "आपकी शादी का दिन, और उस दिन क्या गड़बड़ हुई"],
  [/^How (.+) got their name$/i, "$1 का नाम कैसे रखा गया"],
  [/^The day the family moved, or you left home for the first time$/i, "जिस दिन परिवार ने घर बदला, या आपने पहली बार घर छोड़ा"],
  [/^Something precious you lost, and what came after$/i, "कोई क़ीमती चीज़ जो खो गई, और उसके बाद क्या हुआ"],
  [/^A festival from your childhood, and what made it special$/i, "बचपन का एक त्योहार, और उसमें क्या ख़ास था"],
  [/^A dish your mother made, and what it tasted like$/i, "आपकी माँ का बनाया एक पकवान, और उसका स्वाद"],
  [/^A teacher you never forgot$/i, "एक शिक्षक जिन्हें आप कभी नहीं भूले"],
  [/^A time you were proud of (.+)$/i, "जब आपको $1 पर गर्व हुआ"],
  [/^A mistake you made, and what you learned$/i, "आपसे हुई एक ग़लती, और उससे क्या सीखा"],
  [/^Someone who helped the family when it needed help$/i, "कोई जिसने मुश्किल में परिवार की मदद की"],
  [/^The first time you held (.+)$/i, "जब आपने पहली बार $1 को गोद में लिया"],
  [/^How you kept in touch with family before phones$/i, "फ़ोन से पहले आप परिवार से कैसे जुड़े रहते थे"],
  [/^A time the whole family laughed until they cried$/i, "जब पूरा परिवार हँसते-हँसते रो पड़ा"],
  [/^The day you got lost at the fair$/i, "जिस दिन आप मेले में खो गए थे"],
  [/^What Papa was like at my age$/i, "मेरी उम्र में पापा कैसे थे"],
  [/^An animal that lived near your home$/i, "आपके घर के पास रहने वाला एक जानवर"],
  [/^A story your grandmother told you$/i, "आपकी दादी-नानी की सुनाई एक कहानी"],
  [/^The naughtiest thing you ever did$/i, "आपकी सबसे बड़ी शरारत"],
  [/^A lullaby you sang to your children$/i, "अपने बच्चों को सुनाई एक लोरी"],
  [/birthday song/i, "परिवार ने मिलकर जन्मदिन का गीत गाया।"],
  [/courtyard game/i, "आँगन का खेल, पूरे जोश में सुनाया।"],
  [/morning blessing|morning prayer/i, "सुबह की दुआ — आज का दिन अच्छा हो।"],
  [/lullaby/i, "एक मीठी लोरी।"],
  // Demo-family rooms (mock mode only; live mode translates with Muse).
  [/^How do you make your aloo paratha\?$/i, "आप आलू पराठा कैसे बनाती हैं?"],
  [/^What did your mother cook when someone came home after a long journey\?$/i, "जब कोई लंबे सफ़र से घर लौटता था, तब आपकी माँ क्या बनाती थीं?"],
  [/^What did the street outside your first home sound like in the morning\?$/i, "आपके पहले घर के बाहर की गली सुबह कैसी सुनाई देती थी?"],
  [/^Which song did you sing while working in the kitchen\?$/i, "रसोई में काम करते हुए आप कौन-सा गीत गाती थीं?"],
  [/^What is one thing your father taught you that you still do\?$/i, "आपके पिताजी की सिखाई कौन-सी बात आप आज भी करती हैं?"],
  [/^How did your family celebrate the first rain of the year\?$/i, "साल की पहली बारिश आपका परिवार कैसे मनाता था?"],
  [/^What was your favourite festival food as a child, and who made it\?$/i, "बचपन में त्योहार का आपका पसंदीदा खाना क्या था, और कौन बनाता था?"],
  [/^Where did you go when you wanted to be alone as a young person\?$/i, "जवानी में जब अकेले रहना होता था, तब आप कहाँ जाती थीं?"],
  [/^Vegetables and milk for the week$/i, "हफ़्ते भर की सब्ज़ी और दूध"],
  [/^The gas cylinder is almost empty$/i, "गैस सिलेंडर लगभग खत्म है"],
  [/^A ride to the temple fair$/i, "मंदिर के मेले तक जाने के लिए गाड़ी"],
];

const KNOWN_EN_TO_LATN: Array<[RegExp, string]> = [
  [/birthday song/i, "Parivaar ne milkar janmadin ka geet gaya."],
  [/courtyard game/i, "Angan ka khel, poore josh mein sunaya."],
  [/morning blessing|morning prayer/i, "Subah ki dua — aaj ka din achha ho."],
  [/lullaby/i, "Ek meethi lori."],
  [/warm family moment|family memory/i, "Parivaar ki ek pyaari yaad."],
];

const KNOWN_HI_TO_EN: Array<[RegExp, string]> = [
  [/एक गाँव में एक हाथी/, "The elephant and the tailor. In a village an elephant walked to the river every day and stopped at the tailor's shop on the way. The tailor gave him a banana every day, and the elephant raised his trunk to say hello. One day, as a joke, the tailor pricked him with a needle instead of a banana. The elephant said nothing. On his way back he filled his trunk with muddy water and painted the whole shop. So, my dear, never hurt someone who is kind to you."],
  [/^हाथी और दर्ज़ी की कहानी$/, "The elephant and the tailor"],
  [/मैं सात साल की थी/, "When I got lost at the fair. I was seven, and the Dussehra fair had come to our village. Watching the swings, I let go of my mother's hand. People everywhere, and I started to cry. Then an old balloon seller lifted me onto his shoulders. From up there I saw my mother's red dupatta. Since that day I always say: look up high, and you'll find your way."],
  [/^जब मैं मेले में खो गई थी$/, "When I got lost at the fair"],
  [/तुम्हारे पापा आठ साल के थे/, "Your papa and the mango tree. Your papa was eight, very naughty. He climbed the mango tree behind the courtyard to pick the highest mango. He got the mango, but forgot how to come down! We had to call the whole neighbourhood. Your grandfather brought a ladder, and the first thing your papa did when he came down was give the mango to me. It was sweet, so sweet."],
  [/^तुम्हारे पापा और आम का पेड़$/, "Your papa and the mango tree"],
  [/हमारे गाँव के पास गंगा/, "How I learned to swim. The Ganga flowed near our village. My elder brother said: don't be afraid, the water will hold you, just keep moving your arms and legs. The first day I nearly went under; the second day I swam a little. On the seventh day I swam past my brother. The one who gets past the fear is the one who learns."],
  [/^मैंने तैरना कैसे सीखा$/, "How Papa learned to swim"],
  [/जन्मदिन का गीत/, "The family sang a birthday song together."],
  [/आँगन में धूप/, "Sunshine and tea in the courtyard."],
  [/सुबह की दुआ/, "A morning blessing for a good day."],
  [/तूर दाल धो लो/, "Wash one katori of toor dal, three times. Two katoris of water, a little turmeric, a little salt, and three whistles in the cooker. Heat the ghee, add jeera, and when it starts to crackle, the hing. Fry the onions slowly, don't rush. Then tomato, ginger, garlic. Mix in the dal, and a little more ghee on top."],
  [/दाल तड़का, जैसे मैं बनाती हूँ/, "Dal tadka, the way I make it."],
  [/पार्क में धूप/, "Lovely sun in the park this morning. When are you coming home?"],
  [/पुराना दरवाज़ा|पुरानी/i, "An old doorway in winter light."],
];

const KNOWN_HI_TO_LATN: Array<[RegExp, string]> = [
  [/जन्मदिन का गीत/, "Parivaar ne milkar janmadin ka geet gaya."],
  [/आँगन में धूप/, "Angan mein dhoop aur chai."],
  [/सुबह की दुआ/, "Subah ki dua — aaj ka din achha ho."],
  [/पार्क में धूप/, "Aaj subah park mein badi achhi dhoop thi. Tum kab aa rahe ho?"],
  [/परिवार की एक प्यारी याद/, "Parivaar ki ek pyaari yaad."],
];


// Model language codes vary ("Hindi", "HI", "hindi (devanagari)"): normalize
// to the short codes the display layer routes on. Unknown codes fall back
// to the caller's fallback so nothing unparseable reaches the UI.
export function normalizeLangCode(raw: unknown, fallback: string): string {
  const l = String(raw ?? "").trim().toLowerCase();
  if (l.startsWith("hi-latn") || l === "hinglish") return "hi-latn";
  if (l.startsWith("hi-deva") || l.includes("devanagari")) return "hi-deva";
  if (l.startsWith("hi")) return "hi";
  if (l.startsWith("en")) return "en";
  return fallback;
}

// Mock transcription stub for tests: deterministic per cache key, never a
// model. The live path below requires real audio bytes.
async function mockTranscribe(langHint: string): Promise<{ json: unknown; cost: number }> {
  const lang = normalizeDisplayLang(langHint);
  // hi-latn speakers speak Hindi: transcribe the Hindi source, the display
  // layer transliterates it to Latin script per card + lang.
  if (lang === "hi-deva" || lang === "hi-latn") {
    return {
      json: {
        transcript: "सुबह की दुआ — आज का दिन अच्छा हो। भगवान तुम्हें खुश रखे।",
        summary: "सुबह की दुआ।",
        language: "hi",
        segments: [
          { start: 0, end: 4, text: "सुबह की दुआ — आज का दिन अच्छा हो।" },
          { start: 4, end: 8, text: "भगवान तुम्हें खुश रखे।" },
        ],
      },
      cost: 0,
    };
  }
  return {
    json: {
      transcript: "Good morning, my love. Have a wonderful day. God bless your exam.",
      summary: "A morning blessing.",
      language: "en",
      segments: [
        { start: 0, end: 4, text: "Good morning, my love." },
        { start: 4, end: 8, text: "Have a wonderful day." },
        { start: 8, end: 12, text: "God bless your exam." },
      ],
    },
    cost: 0,
  };
}

async function mockTranslate(text: string, targetLang: string): Promise<{ json: unknown; cost: number }> {
  const target = normalizeDisplayLang(targetLang);
  // Mock mode has no model: other languages get the text back unchanged and
  // honestly labelled with the target (live mode translates with Muse).
  if (target !== "en" && target !== "hi-latn" && target !== "hi-deva") return { json: { text, language: target }, cost: 0 };
  if (target === "hi-deva") {
    for (const [re, hi] of KNOWN_EN_TO_HI_DEVA) {
      if (re.test(text)) return { json: { text: hi.includes("$1") ? text.trim().replace(re, hi) : hi, language: "hi-deva" }, cost: 0 };
    }
    // Unknown text: give the family's own words back rather than a made-up
    // phrase (mock mode has no model; live mode translates with Muse).
    return { json: { text, language: containsDevanagari(text) ? "hi-deva" : "en" }, cost: 0 };
  }
  if (target === "hi-latn") {
    for (const [re, latn] of KNOWN_HI_TO_LATN) {
      if (re.test(text)) return { json: { text: latn, language: "hi-latn" }, cost: 0 };
    }
    for (const [re, latn] of KNOWN_EN_TO_LATN) {
      if (re.test(text)) return { json: { text: latn, language: "hi-latn" }, cost: 0 };
    }
    if (!containsDevanagari(text)) return { json: { text, language: "hi-latn" }, cost: 0 };
    return { json: { text: "Parivaar ki ek pyaari yaad.", language: "hi-latn" }, cost: 0 };
  }
  for (const [re, en] of KNOWN_HI_TO_EN) {
    if (re.test(text)) return { json: { text: en, language: "en" }, cost: 0 };
  }
  if (!containsDevanagari(text)) return { json: { text, language: "en" }, cost: 0 };
  return { json: { text: "A family memory, kept close.", language: "en" }, cost: 0 };
}



const TRANSLATE_SYSTEM =
  "Translate the given family text as JSON: {text, language}. " +
  "text is the translation in the requested target language, language is its short code. " +
  "Translate, never explain. Reply with JSON only.";

export async function liveJson(
  provider: keyof typeof PROVIDERS,
  system: string,
  user: string,
  model: string,
  maxTokens = 500,
): Promise<{ json: unknown; cost: number }> {
  try {
    return await liveJsonOnce(provider, system, user, model, maxTokens);
  } catch (err) {
    // The same Muse call on the other host (Meta API ↔ Baseten), with its own model id.
    const next = failoverProvider(provider);
    if (!next) throw err;
    return liveJsonOnce(next, system, user, PROVIDERS[next].captionModel, maxTokens);
  }
}

async function liveJsonOnce(
  provider: keyof typeof PROVIDERS,
  system: string,
  user: string,
  model: string,
  maxTokens: number,
): Promise<{ json: unknown; cost: number }> {
  const cfg = PROVIDERS[provider];
  const key = providerKey(provider);
  if (!key) throw new Error("missing-key");
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      // Reasoning tokens count against this cap: below the floor the reply is
      // truncated before any JSON and every call falls back (seen live on picks
      // and the window's catch-up line). Callers' maxTokens is the answer size.
      max_tokens: Math.max(maxTokens, REASONING_TOKEN_FLOOR),
    }),
  });
  if (!res.ok) throw new Error(`provider-${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const raw = choice?.message?.content ?? "";
  if (!raw.trim()) throw new Error(choice?.finish_reason === "length" ? "truncated" : "empty");
  return { json: extractJson(raw), cost: 0.01 };
}

/** Floor for max_tokens on reasoning models (the vision path already uses 2000). */
export const REASONING_TOKEN_FLOOR = 2000;

/**
 * The JSON object in a model reply: plain JSON, or wrapped in a ```json fence,
 * a <think> block or a sentence. Throws "parse" when there is none.
 */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
    const start = (fenced ?? text).indexOf("{");
    const end = (fenced ?? text).lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse((fenced ?? text).slice(start, end + 1)) as unknown;
      } catch {
        /* fall through */
      }
    }
    throw new Error("parse");
  }
}

// Voice transcription: mock-first; live uses the chat endpoint with a
// description (raw audio upload wiring lands with Supabase storage).
// Shown when transcription fails: a fixed string, never a model invention.
export const TRANSCRIPT_UNAVAILABLE = "Transcript unavailable";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// One-shot transcribe request builder (06_muse_voice/01 utils.py
// transcribe_recording): the params travel as a JSON part, the recording as
// the `audio` file part, credential in the Authorization header. Pure so
// tests can assert the audio payload is present without network.
export function buildTranscribeForm(
  audioBytes: Uint8Array,
  opts: { langHint?: string; keywords?: string[]; filename?: string } = {},
): { form: FormData; hash: string } {
  const hash = sha256Hex(audioBytes);
  const request: Record<string, unknown> = {
    mode: "PUSH_TO_TALK",
    model: PROVIDERS[activeProvider()].transcribeModel,
    audioEncoding: "WAV",
  };
  if (opts.langHint) request.languageBias = [opts.langHint];
  if (opts.keywords && opts.keywords.length > 0) request.keywords = opts.keywords;
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify(request)], { type: "application/json" }), "request.json");
  form.append("audio", new Blob([audioBytes as unknown as BlobPart], { type: "audio/wav" }), opts.filename ?? "voice.wav");
  return { form, hash };
}

// Parse the one-shot response defensively (turns absent outside speech
// modes, speaker only in DIARIZATION): turns -> timed segments for lyrics.
export function parseTranscribeResponse(json: unknown, langHint: string): VoiceTranscript | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as { transcript?: unknown; audioDurationMs?: unknown; turns?: unknown; language?: unknown };
  const turns = Array.isArray(raw.turns) ? raw.turns : [];
  const durationMs = typeof raw.audioDurationMs === "number" && raw.audioDurationMs > 0 ? raw.audioDurationMs : 0;
  const segments = turns
    .map((t, i) => {
      if (!t || typeof t !== "object") return null;
      const turn = t as { startMs?: unknown; transcript?: unknown };
      const rawStart = turn.startMs;
      const start = typeof rawStart === "number" && rawStart >= 0 ? rawStart / 1000 : 0;
      const next = turns[i + 1] as { startMs?: unknown } | undefined;
      const rawNext = next?.startMs;
      const nextStart =
        typeof rawNext === "number" && rawNext > (typeof rawStart === "number" ? rawStart : -1) ? rawNext / 1000 : null;
      const end = nextStart ?? (durationMs > 0 ? durationMs / 1000 : start + 4);
      const text = typeof turn.transcript === "string" ? turn.transcript.trim() : "";
      if (!text) return null;
      return { start: Math.round(start * 10) / 10, end: Math.round(Math.max(end, start + 0.5) * 10) / 10, text };
    })
    .filter((s): s is { start: number; end: number; text: string } => s !== null);
  const joined = segments.map((s) => s.text).join(" ");
  const transcript = typeof raw.transcript === "string" && raw.transcript.trim() ? raw.transcript.trim() : joined;
  if (!transcript) return null;
  const parsed = VoiceTranscriptSchema.safeParse({
    transcript,
    summary: transcript.slice(0, 500),
    language: normalizeLangCode(raw.language, normalizeDisplayLang(langHint)),
    segments,
  });
  return parsed.success ? parsed.data : null;
}

async function liveTranscribe(
  audioBytes: Uint8Array,
  opts: { langHint?: string; keywords?: string[] },
): Promise<{ json: unknown; cost: number; durationMs: number }> {
  const key = process.env.META_API_KEY;
  if (!key) throw new Error("missing-key");
  const { form } = buildTranscribeForm(audioBytes, opts);
  const res = await fetch("https://api.meta.ai/v1/asr/transcribe", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (res.status === 413) throw new Error("audio-too-large");
  if (!res.ok) throw new Error(`provider-${res.status}`);
  const json = (await res.json()) as { audioDurationMs?: unknown };
  return { json, cost: 0.01, durationMs: typeof json.audioDurationMs === "number" ? json.audioDurationMs : 0 };
}

// Voice transcription from REAL recorded audio (06_muse_voice/01).
// Cache key = sha256 of the audio bytes, never a default id. The live path
// requires bytes and returns "Transcript unavailable" (never a model-written
// transcript) when the bytes are missing or the endpoint fails.
export async function transcribeVoice(
  input: { audioBytes?: Uint8Array; langHint?: string; keywords?: string[] },
  opts: { store?: LlmStore; ledger?: SpendLedger } = {},
): Promise<{ transcript: VoiceTranscript; cached: boolean; cost: number; unavailable: boolean }> {
  const langHint = normalizeDisplayLang(input.langHint ?? "en");
  const store = opts.store ?? memoryStore();
  const ledger = opts.ledger ?? new SpendLedger(store);
  const provider = activeProvider();
  const model = PROVIDERS[provider].transcribeModel;
  const hash = input.audioBytes ? sha256Hex(input.audioBytes) : null;
  const key = hash ? `llm:${cacheKey(model, `transcribe:${langHint}`, hash)}` : null;
  if (key) {
    const hit = store.get(key);
    if (hit) {
      const parsed = VoiceTranscriptSchema.safeParse(JSON.parse(hit));
      if (parsed.success) return { transcript: parsed.data, cached: true, cost: 0, unavailable: false };
    }
  }
  const unavailable = (): { transcript: VoiceTranscript; cached: boolean; cost: number; unavailable: boolean } => ({
    transcript: { transcript: TRANSCRIPT_UNAVAILABLE, summary: TRANSCRIPT_UNAVAILABLE, language: langHint, segments: [] },
    cached: false,
    cost: 0,
    unavailable: true,
  });
  if (!input.audioBytes || input.audioBytes.length === 0) return unavailable();
  const estimatedCost = isMockMode() ? 0 : 0.01;
  if (!(await ledger.check(estimatedCost))) return unavailable();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (isMockMode()) {
        const { json } = await mockTranscribe(langHint);
        const parsed = VoiceTranscriptSchema.safeParse(json);
        if (!parsed.success) continue;
        if (key) store.set(key, JSON.stringify(parsed.data));
        return { transcript: parsed.data, cached: false, cost: 0, unavailable: false };
      }
      const { json, cost } = await liveTranscribe(input.audioBytes, { langHint, keywords: input.keywords });
      const parsed = parseTranscribeResponse(json, langHint);
      if (!parsed) continue;
      await ledger.commit(cost);
      if (key) store.set(key, JSON.stringify(parsed));
      return { transcript: parsed, cached: false, cost, unavailable: false };
    } catch {
      continue;
    }
  }
  return unavailable();
}

const SuggestSchema = z.object({ questions: z.array(z.string().min(5).max(200)).min(1).max(5) });

const PlaylistSchema = z.object({
  tracks: z.array(z.object({ cardId: z.string(), note: z.string().max(120) })).min(1).max(8),
});

const PLAYLIST_SYSTEM =
  "Curate a warm family-evening playlist as JSON: {tracks: [{cardId, note}]}. " +
  "Pick from the given card ids only, warmest first, at most 8. " +
  "Each note is one short line about why this track fits the evening. Reply with JSON only.";

const MOCK_SUGGESTIONS: Record<string, string[]> = {
  en: [
    "What did your courtyard smell like in the morning?",
    "Which festival food should the children learn first?",
    "What blessing do you want to record for Vihaan's exam?",
  ],
  "hi-latn": [
    "Subah aapka aangan kaisa mehakta tha?",
    "Bachchon ko sabse pehle kaun-sa tyohaar ka khana seekhna chahiye?",
    "Vihaan ke exam ke liye kaun-sa aashirvaad record karna chahengi?",
  ],
  "hi-deva": [
    "सुबह आपका आँगन कैसा महकता था?",
    "बच्चों को सबसे पहले कौन-सा त्योहार का खाना सीखना चाहिए?",
    "लियो की परीक्षा के लिए कौन-सा आशीर्वाद रिकॉर्ड करना चाहेंगी?",
  ],
};

const SUGGEST_SYSTEM =
  "Suggest family questions as JSON: {questions}. Three short warm questions " +
  "an elder would love to answer by voice, in the requested language. " +
  "Reply with JSON only.";

async function mockSuggest(displayLang: string): Promise<{ json: unknown; cost: number }> {
  const lang = normalizeDisplayLang(displayLang);
  return { json: { questions: MOCK_SUGGESTIONS[lang] ?? MOCK_SUGGESTIONS.en }, cost: 0 };
}

// Elder-question suggestions via muse-spark-1.3, cached per member + lang.
// Mock returns localized starters; live calls the model once per lang.
export async function suggestQuestions(
  input: { memberId?: string; displayLang?: string },
  opts: { store?: LlmStore; ledger?: SpendLedger } = {},
): Promise<{ questions: string[]; cached: boolean; cost: number }> {
  const memberId = input.memberId ?? "elder";
  const lang = normalizeDisplayLang(input.displayLang ?? "en");
  const store = opts.store ?? memoryStore();
  const ledger = opts.ledger ?? new SpendLedger(store);
  const provider = activeProvider();
  const model = PROVIDERS[provider].captionModel;
  const key = `llm:${cacheKey(model, `suggest:${lang}`, memberId)}`;
  const hit = store.get(key);
  if (hit) {
    const parsed = SuggestSchema.safeParse(JSON.parse(hit));
    if (parsed.success) return { questions: parsed.data.questions, cached: true, cost: 0 };
  }
  const estimatedCost = isMockMode() ? 0 : 0.01;
  if (!(await ledger.check(estimatedCost))) {
    return { questions: MOCK_SUGGESTIONS[lang] ?? MOCK_SUGGESTIONS.en, cached: false, cost: 0 };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = isMockMode()
        ? await mockSuggest(lang)
        : await liveJson(
            provider,
            SUGGEST_SYSTEM,
            `Elder questions for ${memberId} in ${lang}.`,
            model,
            2000,
          );
      const parsed = SuggestSchema.safeParse(out.json);
      if (!parsed.success) continue;
      await ledger.commit(out.cost);
      store.set(key, JSON.stringify(parsed.data));
      return { questions: parsed.data.questions, cached: false, cost: out.cost };
    } catch {
      continue;
    }
  }
  return { questions: MOCK_SUGGESTIONS[lang] ?? MOCK_SUGGESTIONS.en, cached: false, cost: 0 };
}

// Gather playlist curation from the Lane (muse-spark-1.3, structured
// output, one retry then fallback). Mock picks the newest audio first.
export async function curatePlaylist(
  cards: { id: string; caption: string }[],
  opts: { store?: LlmStore; ledger?: SpendLedger } = {},
): Promise<{ tracks: { cardId: string; note: string }[]; cached: boolean; cost: number }> {
  const store = opts.store ?? memoryStore();
  const ledger = opts.ledger ?? new SpendLedger(store);
  const provider = activeProvider();
  const model = PROVIDERS[provider].captionModel;
  const ids = cards.map((c) => c.id).join(",");
  const key = `llm:${cacheKey(model, `playlist:${ids}`, "gather")}`;
  const hit = store.get(key);
  if (hit) {
    const parsed = PlaylistSchema.safeParse(JSON.parse(hit));
    if (parsed.success) return { tracks: parsed.data.tracks, cached: true, cost: 0 };
  }
  const estimatedCost = isMockMode() ? 0 : 0.01;
  if (!(await ledger.check(estimatedCost)) || cards.length === 0) {
    return { tracks: [], cached: false, cost: 0 };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = isMockMode()
        ? {
            json: {
              tracks: cards.slice(0, 5).map((c, i) => ({ cardId: c.id, note: i === 0 ? "Open the evening together" : "Keep the warmth going" })),
            },
            cost: 0,
          }
        : await liveJson(
            provider,
            PLAYLIST_SYSTEM,
            `Cards:\n${cards.slice(0, 20).map((c) => `- ${c.id}: ${c.caption.slice(0, 120)}`).join("\n")}`,
            model,
          );
      const parsed = PlaylistSchema.safeParse(out.json);
      if (!parsed.success) continue;
      // Never invent: drop tracks pointing at unknown cards.
      const known = new Set(cards.map((c) => c.id));
      const tracks = parsed.data.tracks.filter((t) => known.has(t.cardId));
      if (tracks.length === 0) continue;
      await ledger.commit(out.cost);
      store.set(key, JSON.stringify({ tracks }));
      return { tracks, cached: false, cost: out.cost };
    } catch {
      continue;
    }
  }
  return { tracks: [], cached: false, cost: 0 };
}

// Translation/transliteration into the viewer's display_lang, cached per
// card text + lang. Mock never leaks script: en output is Latin-only with
// no untranslated Hindi, hi-latn output is Latin-only, hi-deva Devanagari.
export async function translateText(
  text: string,
  targetLang: string,
  opts: { store?: LlmStore; ledger?: SpendLedger } = {},
): Promise<{ translation: Translation; cached: boolean; cost: number }> {
  const target = normalizeDisplayLang(targetLang);
  const store = opts.store ?? memoryStore();
  const ledger = opts.ledger ?? new SpendLedger(store);
  const provider = activeProvider();
  const model = PROVIDERS[provider].captionModel;
  const key = `llm:${cacheKey(model, `translate:${target}:${text}`, "text")}`;
  const hit = store.get(key);
  if (hit) {
    const parsed = TranslationSchema.safeParse(JSON.parse(hit));
    if (parsed.success) return { translation: parsed.data, cached: true, cost: 0 };
  }
  const estimatedCost = isMockMode() ? 0 : 0.01;
  if (!(await ledger.check(estimatedCost))) {
    return { translation: { ...FALLBACK_TRANSLATION, language: target }, cached: false, cost: 0 };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = isMockMode()
        ? await mockTranslate(text, target)
        : await liveJson(provider, TRANSLATE_SYSTEM, `Target language: ${describeLang(target)}\nText:\n${text}`, model, 1500);
      const parsed = TranslationSchema.safeParse(out.json);
      if (!parsed.success) continue;
      parsed.data.language = normalizeLangCode(parsed.data.language, target);
      await ledger.commit(out.cost);
      store.set(key, JSON.stringify(parsed.data));
      return { translation: parsed.data, cached: false, cost: out.cost };
    } catch {
      continue;
    }
  }
  return { translation: { ...FALLBACK_TRANSLATION, language: target }, cached: false, cost: 0 };
}

export { containsDevanagari };
