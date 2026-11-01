// Care circle helpers, powered by Muse. Tasks only: Muse never gives medical,
// legal or financial advice; it turns a spoken need into a task and writes a
// short reassurance for the parent in their own language.
// Server only.
import { z } from "zod";
import { NEED_KINDS } from "./kinds";
import { describeLang } from "./languages";
import { museJson } from "./muse";

const NeedDraftSchema = z.object({
  title: z.string().min(3).max(120),
  kind: z.enum(NEED_KINDS),
  when: z.string().max(60).default(""),
});
export type NeedDraft = z.infer<typeof NeedDraftSchema>;

const NEED_SYSTEM = [
  "A parent asked their family for practical help by voice. Turn it into one task. Reply JSON only:",
  '{"title": str, "kind": "groceries"|"house"|"ride"|"repair"|"gas"|"bills"|"health"|"errand"|"visit"|"pets"|"other", "when": str}',
  "- kind \"health\" is only for logistics (an appointment, a medicine pickup); \"bills\" is only a reminder task. Nearer never handles money.",
  "- title: short, in English, in the parent's own framing (\"The geyser isn't heating\").",
  "- when: only if they said a time (\"Tuesday morning\"), else \"\".",
  "- Never diagnose, never give medical or any other advice. If they mention feeling unwell, the task is kind \"visit\": \"Someone to visit and check on me\".",
].join("\n");

const KEYWORDS: [RegExp, NeedDraft["kind"]][] = [
  [/gas|cylinder|सिलेंडर|गैस/i, "gas"],
  [/vegetable|milk|grocer|sabzi|doodh|सब्ज़ी|दूध|राशन/i, "groceries"],
  [/\b(?:ride|drive|car|take me|temple|clinic|station)\b|ले चलो|गाड़ी/i, "ride"],
  [/broken|fix|repair|geyser|leak|fan|light|ठीक|खराब/i, "repair"],
  [/clean|wash|house|safai|सफ़ाई/i, "house"],
  [/\bbill\b|electricity|internet bill|recharge|बिल/i, "bills"],
  [/\bdog\b|\bcat\b|\bvet\b|pet food|walker/i, "pets"],
  [/appointment|check-?up|medicine|pharmacy|refill|दवा/i, "health"],
  [/unwell|not (?:feeling |doing )?(?:so )?well|feeling (?:low|weak|dizzy)|tired|lonely|अकेल|तबीयत/i, "visit"],
];

export function mockNeed(transcript: string): NeedDraft {
  const text = transcript.trim().replace(/\s+/g, " ");
  // Feeling unwell always becomes "someone visit me", whatever else was said.
  const visit = KEYWORDS.find(([, k]) => k === "visit")?.[0].test(text);
  const kind = visit ? "visit" : (KEYWORDS.find(([re]) => re.test(text))?.[1] ?? "other");
  const when = text.match(/\b(today|tomorrow|tonight|this week|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?: morning| evening)?)\b/i)?.[0] ?? "";
  const title = kind === "visit" ? "Someone to visit and check on me" : text.split(/(?<=[.!?।])\s+/)[0]?.slice(0, 120) || "Help with something at home";
  return NeedDraftSchema.parse({ title: title.length >= 3 ? title : "Help with something at home", kind, when });
}

export async function needFromVoice(familyId: string, parentName: string, transcript: string, lang: string): Promise<NeedDraft> {
  const fallback = mockNeed(transcript);
  const out = await museJson({
    familyId,
    purpose: `Turned ${parentName}'s voice request into a task`,
    system: NEED_SYSTEM,
    user: `Parent: ${parentName}\nLanguage: ${describeLang(lang)}\nWhat they said:\n${transcript}`,
    schema: NeedDraftSchema,
    mock: () => mockNeed(transcript),
    fallback,
    maxTokens: 300,
  });
  return out.data;
}

const NoteSchema = z.object({ text: z.string().min(3).max(240) });

/** A two-line reassurance for the parent, in their language. */
export async function noteForParent(familyId: string, parent: { displayName: string; displayLang: string }, english: string): Promise<string> {
  if (parent.displayLang === "en") return english;
  const out = await museJson({
    familyId,
    purpose: `Wrote a note for ${parent.displayName} in ${describeLang(parent.displayLang).split(" (")[0]}`,
    system: "Rewrite this short note to a parent in their language, warmly and plainly, like their own child would say it. Keep names as written. Reply JSON only: {\"text\": str}.",
    user: `Language: ${describeLang(parent.displayLang)}\nNote: ${english}`,
    schema: NoteSchema,
    mock: () => ({ text: english }),
    fallback: { text: english },
    maxTokens: 200,
  });
  return out.data.text;
}
