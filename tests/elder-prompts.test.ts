import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { containsDevanagari, translateText } from "@/lib/llm";
import { FAMILY_STORY_IDEAS, STORY_IDEAS, resolveIdea } from "@/lib/story-ideas";
import { DEMO_MEMBERS } from "@/lib/family";
import { POST as translatePOST } from "@/app/api/translate/route";
import { sessionCookie } from "./auth-helper";

// Story and question prompts reach an elder in their own language. Dadi
// (lang hi, display hi-deva) reads them in Devanagari; in mock mode the demo's
// prompts have known Hindi, live mode asks Muse (cached).
const toHindi = async (text: string) => (await translateText(text, "hi-deva")).translation.text;
const root = process.cwd();

describe("prompts for an elder, in Hindi", () => {
  it("Dadi reads Hindi in Devanagari", () => {
    const dadi = DEMO_MEMBERS.find((m) => m.id === "dadi")!;
    expect(dadi.lang).toBe("hi");
    expect(dadi.displayLang).toBe("hi-deva");
  });

  it("every folk-tale idea and every family-story prompt (names filled in) comes back in Devanagari", async () => {
    const names = { children: ["Arjun", "Kavya"], grandchildren: ["Vihaan", "Anika"] };
    for (const idea of [...STORY_IDEAS, ...FAMILY_STORY_IDEAS.map((i) => resolveIdea(i, names))]) {
      const hi = await toHindi(idea.title);
      expect(containsDevanagari(hi), idea.title).toBe(true);
    }
    expect(await toHindi("The day Arjun was born")).toBe("जिस दिन Arjun का जन्म हुआ");
  });

  it("today's question for the parents and the Stories starters come back in Hindi", async () => {
    expect(await toHindi("One thing you miss about Arjun, Kavya & Rohan")).toBe("Arjun, Kavya & Rohan की एक बात जो आपको याद आती है");
    const page = readFileSync(join(root, "app", "stories", "page.tsx"), "utf8");
    const starters = JSON.parse(page.match(/const STARTERS = (\[[^\]]+\])/)![1]) as string[];
    expect(starters.length).toBeGreaterThan(3);
    for (const s of starters) expect(containsDevanagari(await toHindi(s)), s).toBe(true);
  });

  it("an English reader keeps the English prompt", async () => {
    expect((await translateText("The thirsty crow", "en")).translation.text).toBe("The thirsty crow");
  });

  it("the recorder keeps the prompt on screen in the reader's language, large for an elder", () => {
    const sheet = readFileSync(join(root, "components", "add-sheet.tsx"), "utf8");
    expect(sheet).toMatch(/<Teleprompter text=\{contribution\.prompt\} \/>/);
    const tp = readFileSync(join(root, "components", "prompt-text.tsx"), "utf8");
    expect(tp).toMatch(/useState\(viewer\.role === "elder"\)/);
    // English first: the original shows until the translation lands, so recording never waits.
    expect(tp).toMatch(/: \{ text, lang: sourceLang \}/);
    for (const f of [join("app", "stories", "page.tsx"), join("components", "today.tsx")]) expect(readFileSync(join(root, f), "utf8")).toMatch(/<PromptText /);
  });
});

describe("a screen of prompts is one translate request", () => {
  const ask = (body: unknown) => translatePOST(new Request("http://test/api/translate", { method: "POST", headers: { cookie: sessionCookie("dadi", "demo-family"), "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("translates a batch in order", async () => {
    const res = await ask({ texts: ["The thirsty crow", "The blue jackal"], targetLang: "hi-deva" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { translations: { text: string }[] };
    expect(body.translations.map((t) => t.text)).toEqual(["प्यासा कौआ", "नीला सियार"]);
  });

  it("refuses more than 40 at once", async () => {
    expect((await ask({ texts: Array(41).fill("x"), targetLang: "hi-deva" })).status).toBe(400);
  });
});
