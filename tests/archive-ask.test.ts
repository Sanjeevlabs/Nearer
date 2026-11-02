import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as askPost } from "@/app/api/ask/route";
import { POST as keeperPost } from "@/app/api/keeper/route";
import { AskAnswerSchema, askFamily, askRateOk, loadArchive, resetAskState } from "@/lib/archive-ask";
import { buildSnippets, groundCitations, numbersGrounded, pickAskTarget, quoteGrounded, rankSnippets, type Snippet } from "@/lib/archive";
import { dbAddCard } from "@/lib/db";
import type { Card } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { authedJson } from "./auth-helper";

beforeEach(() => {
  process.env.MOCK = "true";
  resetDemo();
  resetAskState();
});

const card = (id: string, transcript: string, over: Partial<Card> = {}): Card =>
  ({ id, familyId: "demo-family", type: "audio", caption: "", summary: "", lang: "en", takenAt: "2026-10-01T10:00:00.000Z", ritualSlug: null, source: "upload", mediaRef: null, peaks: [], palette: [], transcript, transcriptLang: "en", segments: [], authorId: "dadi", coverRef: null, addressedTo: null, place: "", note: "", ...over }) as Card;

const build = (cards: Card[], hidden: string[] = []) => buildSnippets({ cards, recipes: [], stories: [], questions: [], hidden: new Set(hidden), familyId: "demo-family" });

describe("ranking", () => {
  const cards = [
    card("c-swim", "My brother said do not be afraid, the water will hold you, keep moving your arms. On the seventh day I could swim past him.", { authorId: "dada" }),
    card("c-dal", "I always fry the onions slowly for the dal. Never rush the onions, the whole taste is there."),
    card("c-rain", "Rain all evening and the street smelled of wet earth.", { authorId: "arjun" }),
  ];
  it("finds the passage that answers, across spellings and inflections", () => {
    const snips = build(cards);
    expect(rankSnippets("How did Papa learn swimming?", snips)[0].snippet.cardId).toBe("c-swim");
    expect(rankSnippets("how does she fry onions", snips)[0].snippet.cardId).toBe("c-dal");
    // "daal" is not a word anyone said, but it is near "dal".
    expect(rankSnippets("daal tips", snips)[0].snippet.cardId).toBe("c-dal");
  });
  it("returns nothing when nothing matches, and never ranks on a name alone", () => {
    const snips = build(cards);
    expect(rankSnippets("quantum physics lecture", snips)).toEqual([]);
    expect(rankSnippets("what did Papa say", snips, { speakerNames: new Map([["dada", "Papa Dada"]]) })).toEqual([]);
  });
  it("matches any script", () => {
    const snips = build([card("c-hi", "एक गाँव में एक हाथी रोज़ नदी जाता था।", { transcriptLang: "hi" })]);
    expect(rankSnippets("हाथी", snips)[0].snippet.cardId).toBe("c-hi");
  });
  it("keeps at most 8, and at most 3 passages of one card", () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: `Sentence ${i} about the mango tree and the courtyard wall number ${i} which is long enough to be its own passage of speech here ok.` }));
    const snips = build([card("c-long", "x", { segments: long })]);
    expect(snips.length).toBeGreaterThan(8);
    expect(rankSnippets("mango tree", snips).length).toBe(3);
  });
});

describe("grounding", () => {
  const src = "Pressure-cook it with the water, turmeric and salt for three whistles. Heat ghee, add the jeera.";
  it("accepts a verbatim quote, ignoring case and punctuation", () => {
    expect(quoteGrounded("pressure cook it with the water turmeric and salt", src)).toBe(true);
  });
  it("accepts a quote with one small slip, rejects one that is invented", () => {
    expect(quoteGrounded("Pressure-cook it with the water, turmeric and salt for three whistle", src)).toBe(true);
    expect(quoteGrounded("Boil it with the water and a lot of sugar for ten minutes", src)).toBe(false);
    expect(quoteGrounded("She always said never marry for money", src)).toBe(false);
  });
  it("takes the speaker and moment from the passage, drops invented and over-long quotes, and keeps one per quote", () => {
    const passage: Snippet = { id: "s1", cardId: "c1", speakerId: "dadi", at: 12, takenAt: "2026-10-01T10:00:00.000Z", text: src, context: "", kind: "voice", lang: "en" };
    const out = groundCitations(
      [
        { cardId: "c1", quote: "add the jeera", speakerId: "someone-else", at: 999 },
        { cardId: "c1", quote: "add the jeera", speakerId: "dadi", at: 12 },
        { cardId: "c1", quote: "She told me to leave home at sixteen", speakerId: "dadi", at: 12 },
        { cardId: "other", quote: "add the jeera", speakerId: "dadi", at: 12 },
        { cardId: "c1", quote: Array(25).fill("water").join(" "), speakerId: "dadi", at: 12 },
      ],
      [passage],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cardId: "c1", speakerId: "dadi", at: 12, playable: true });
  });
  it("refuses numbers the passages do not contain", () => {
    const p = { text: "three whistles", context: "" } as Snippet;
    expect(numbersGrounded("It takes three whistles", [p])).toBe(true);
    expect(numbersGrounded("It takes 4 whistles", [p])).toBe(false);
  });
  it("the model's schema is strict", () => {
    expect(AskAnswerSchema.safeParse({ answer: "x", citations: [{ cardId: "c", quote: "hello there", speakerId: "d", at: 1 }] }).success).toBe(true);
    expect(AskAnswerSchema.safeParse({ answer: "x", citations: [{ cardId: "c", quote: "hello there", speakerId: "d" }] }).success).toBe(false);
    expect(AskAnswerSchema.safeParse({ answer: "x", citations: [{ cardId: "c", quote: Array(21).fill("w").join(" "), speakerId: "d", at: 1 }] }).success).toBe(false);
    expect(AskAnswerSchema.safeParse({ citations: [] }).success).toBe(false);
  });
});

describe("the archive is the viewer's family and what the viewer may hear", () => {
  it("never reads another family's words", () => {
    const foreign = card("x-1", "The zeppelin landed behind the old school.", { familyId: "other-family" });
    expect(build([foreign])).toEqual([]);
  });
  it("leaves out sealed cards and photos", () => {
    const snips = build([card("sealed", "The zeppelin landed."), card("photo", "zeppelin", { type: "photo" })], ["sealed"]);
    expect(snips).toEqual([]);
  });
  it("answers from the demo family only, even when another family holds a matching card", async () => {
    await dbAddCard({ ...card("zz-foreign", "The zeppelin landed behind the old school."), familyId: "other-family" } as never);
    const res = await askPost(authedJson("http://test/api/ask", { question: "Tell me about the zeppelin" }, "arjun"));
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("empty");
  });
});

describe("asking the demo family", () => {
  const ask = async (question: string, as = "arjun") => (await askPost(authedJson("http://test/api/ask", { question }, as))).json() as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("answers 'How did Papa learn to swim?' from Papa's own voice, with a clip at its moment", async () => {
    const body = await ask("How did Papa learn to swim?");
    expect(body.status).toBe("answer");
    expect(body.citations.length).toBeGreaterThan(0);
    const swim = (body.citations as { cardId: string; speakerId: string; quote: string; at: number; playable: boolean }[]).find((c) => c.cardId === "demo-story-swim");
    expect(swim).toBeDefined();
    expect(swim?.speakerId).toBe("dada");
    expect(swim?.playable).toBe(true);
    const { snippets } = await loadArchive("demo-family", "arjun");
    expect(snippets.filter((s) => s.cardId === "demo-story-swim").some((s) => quoteGrounded(swim!.quote, s.text))).toBe(true);
  });

  it("answers a recipe question from the recipe Maa recorded", async () => {
    const body = await ask("How does Maa make dal?");
    expect(body.status).toBe("answer");
    expect(body.citations.some((c: { cardId: string }) => c.cardId === "demo-recipe-dal")).toBe(true);
  });

  it("says nobody has said it yet, and offers to ask the person named", async () => {
    const body = await ask("What did Papa say about quantum physics?");
    expect(body).toMatchObject({ status: "empty", askTo: { id: "dada" } });
    expect(body.message).toMatch(/^No one in the family has said that yet — ask .+\?$/);
  });

  it("the ask-by-voice button reuses the existing questions API", async () => {
    const res = await keeperPost(authedJson("http://test/api/keeper", { action: "ask", toMemberId: "dada", text: "What did Papa say about quantum physics?", topic: "story" }, "arjun"));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { question: { toMemberId: string } }).question.toMemberId).toBe("dada");
  });

  it("rejects an empty or oversized question and rate-limits", async () => {
    expect((await askPost(authedJson("http://test/api/ask", { question: "" }, "arjun"))).status).toBe(400);
    expect((await askPost(authedJson("http://test/api/ask", { question: "x".repeat(300) }, "arjun"))).status).toBe(400);
    expect(Array.from({ length: 9 }, () => askRateOk("m1", 1_000)).filter(Boolean)).toHaveLength(8);
    expect(askRateOk("m1", 70_000)).toBe(true);
  });

  it("asks someone else, never the asker", () => {
    const members = [{ id: "a", displayName: "Arjun", firstName: "Arjun", role: "adult", status: "active" }, { id: "m", displayName: "Maa", firstName: "Sunita", role: "elder", status: "active" }] as never;
    expect(pickAskTarget("what did Arjun say", members, "a")?.id).toBe("m");
  });
});

describe("when the model invents a quote", () => {
  it("drops it; if none survives it is an honest empty answer", async () => {
    vi.resetModules();
    vi.doMock("@/lib/muse", () => ({
      museJson: async () => ({
        data: { answer: "He learned in a day.", citations: [{ cardId: "demo-story-swim", quote: "I learned to swim in a single afternoon", speakerId: "dada", at: 0 }] },
        source: "muse",
        cached: false,
        cost: 0,
        model: "m",
      }),
    }));
    const mod = await import("@/lib/archive-ask");
    const r = await mod.askFamily({ familyId: "demo-family", viewerId: "arjun", question: "How did Papa learn to swim?" });
    expect(r.status).toBe("empty");
    vi.doUnmock("@/lib/muse");
    vi.resetModules();
  });
  it("keeps the real quote beside an invented one", async () => {
    vi.resetModules();
    vi.doMock("@/lib/muse", () => ({
      museJson: async () => ({
        data: {
          answer: "Papa learned from his brother.",
          citations: [
            { cardId: "demo-story-swim", quote: "I learned to swim in a single afternoon", speakerId: "dada", at: 0 },
            { cardId: "demo-story-swim", quote: "मेरे बड़े भाई ने कहा, डरो मत, पानी तुम्हें पकड़ लेगा", speakerId: "dada", at: 0 },
          ],
        },
        source: "muse",
        cached: false,
        cost: 0,
        model: "m",
      }),
    }));
    const mod = await import("@/lib/archive-ask");
    const r = await mod.askFamily({ familyId: "demo-family", viewerId: "arjun", question: "How did Papa learn to swim?" });
    expect(r.status).toBe("answer");
    if (r.status === "answer") expect(r.citations.map((c) => c.quote)).toEqual(["मेरे बड़े भाई ने कहा, डरो मत, पानी तुम्हें पकड़ लेगा"]);
    vi.doUnmock("@/lib/muse");
    vi.resetModules();
  });
});

describe("the 24 h cache", () => {
  it("answers the same question again without asking Muse twice", async () => {
    vi.resetModules();
    const museJson = vi.fn(async (o: { mock: () => unknown }) => ({ data: o.mock(), source: "muse", cached: false, cost: 0, model: "m" }));
    vi.doMock("@/lib/muse", () => ({ museJson }));
    const mod = await import("@/lib/archive-ask");
    await mod.askFamily({ familyId: "demo-family", viewerId: "arjun", question: "How did Papa learn to swim?" });
    const again = await mod.askFamily({ familyId: "demo-family", viewerId: "arjun", question: "how did papa learn to swim" });
    expect(museJson).toHaveBeenCalledTimes(1);
    expect(again.status === "answer" && again.cached).toBe(true);
    vi.doUnmock("@/lib/muse");
    vi.resetModules();
  });
});

void askFamily;
