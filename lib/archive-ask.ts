// Ask the family: a question answered only from what the family has said, in
// their own voices, with every claim pointing at the clip it came from.
//   retrieve (lib/archive.ts) -> Muse Spark writes a short answer from those
//   passages only -> Zod -> every quote checked against its source -> cached.
// No relevant passage, or no quote that survives the check, is an honest
// "no one has said that yet" and an offer to ask by voice. Server only.
import { z } from "zod";
import { dbListCards, dbListMembers } from "./db";
import { withDemoShelf } from "./demo";
import { listDocsMany } from "./family-docs";
import { cacheKey } from "./llm";
import { museJson } from "./muse";
import { callName } from "./people";
import type { Member } from "./schemas";
import { sealedCardIds } from "./today";
import {
  QUOTE_MAX_WORDS,
  buildSnippets,
  groundCitations,
  normaliseQuestion,
  numbersGrounded,
  pickAskTarget,
  rankSnippets,
  wordCount,
  type Citation,
  type Snippet,
} from "./archive";

export const ASK_MAX_CHARS = 200;
export const ASK_PER_MINUTE = 8;
export const CACHE_MS = 24 * 3_600_000;
const TOP = 8;

/** Strict: what Muse may return. The speaker and the moment are re-read from the passage, so a wrong one is harmless. */
export const AskAnswerSchema = z.object({
  answer: z.string().max(700),
  citations: z
    .array(
      z.object({
        cardId: z.string().min(1).max(100),
        quote: z
          .string()
          .min(3)
          .max(300)
          .refine((q) => wordCount(q) <= QUOTE_MAX_WORDS, "quote-too-long"),
        speakerId: z.string().min(1).max(80),
        at: z.number().min(0).max(86_400),
      }),
    )
    .max(TOP),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

export type AskResult =
  | { status: "answer"; answer: string; citations: Citation[]; source: "muse" | "fallback"; cached: boolean }
  | { status: "empty"; message: string; askTo: { id: string; name: string } | null };

const SYSTEM = [
  "You answer a question for a family using ONLY the numbered passages below, which are things family members said in their own voices. Reply JSON only:",
  '{"answer": str, "citations": [{"cardId": str, "quote": str, "speakerId": str, "at": number}]}',
  "Rules:",
  "- Use only what the passages say. Add nothing from general knowledge, no advice, no guesses, no numbers or names that are not in a passage.",
  "- Two or three short sentences, warm and plain, in the language of the question. Say who said it (use the names in the speaker field) in the answer.",
  "- Every claim needs a citation. `quote` is copied word for word from one passage (20 words at most). `cardId`, `speakerId` and `at` are copied from that passage's header.",
  '- If the passages do not answer the question, reply {"answer": "", "citations": []}.',
].join("\n");

// ---------- the 24 h cache and the rate limit (per server instance) ----------

const cache = new Map<string, { at: number; value: AskAnswer }>();
const hits = new Map<string, number[]>();

export function askRateOk(memberId: string, now = Date.now()): boolean {
  const recent = (hits.get(memberId) ?? []).filter((t) => t > now - 60_000);
  if (recent.length >= ASK_PER_MINUTE) {
    hits.set(memberId, recent);
    return false;
  }
  recent.push(now);
  hits.set(memberId, recent);
  return true;
}

export function resetAskState(): void {
  cache.clear();
  hits.clear();
}

/** Answers are cached by what they were written from (the question and the exact passages), so a new memory or a viewer who may hear less never sees a stale or sealed answer. */
function cacheId(familyId: string, question: string, passages: Snippet[]): string {
  return `${familyId}|${cacheKey("ask", `${normaliseQuestion(question)}\n${passages.map((p) => `${p.id}:${p.text}`).join("\n")}`, "ask")}`;
}

// ---------- the family's words ----------

export async function loadArchive(familyId: string, viewerId: string): Promise<{ snippets: Snippet[]; members: Member[] }> {
  const [stored, members, docs] = await Promise.all([
    dbListCards(familyId),
    dbListMembers(familyId),
    listDocsMany(familyId, ["recipe", "story", "question", "today_task", "chitthi"] as const),
  ]);
  const hidden = sealedCardIds(docs.today_task, viewerId);
  const now = Date.now();
  for (const l of docs.chitthi) if (l.authorId !== viewerId && Date.parse(l.deliverAt) > now) hidden.add(l.id);
  const snippets = buildSnippets({ cards: withDemoShelf(stored, familyId), recipes: docs.recipe, stories: docs.story, questions: docs.question, hidden, familyId });
  return { snippets, members };
}

const header = (s: Snippet, name: string) => `[cardId: ${s.cardId} | speakerId: ${s.speakerId ?? "unknown"} | speaker: ${name} | at: ${s.at}]`;
const firstWords = (t: string, n: number) => t.split(/\s+/).slice(0, n).join(" ");

/** The answer with no model: the best passages, quoted. Used in mock mode and when Muse is unavailable. */
function extractive(passages: Snippet[], names: Map<string, string>): AskAnswer {
  const picks: Snippet[] = [];
  for (const p of passages) if (!picks.some((x) => x.cardId === p.cardId) && picks.length < 2) picks.push(p);
  if (!picks.length) return { answer: "", citations: [] };
  const who = Array.from(new Set(picks.map((p) => names.get(p.speakerId ?? "") || "Someone in the family")));
  return {
    answer: `${who.join(" and ")} spoke of it.`,
    citations: picks.map((p) => ({ cardId: p.cardId, quote: firstWords(p.text, 18), speakerId: p.speakerId ?? "unknown", at: p.at })),
  };
}

export async function askFamily(input: { familyId: string; viewerId: string; question: string; archive?: { snippets: Snippet[]; members: Member[] } }): Promise<AskResult> {
  const question = input.question.trim().slice(0, ASK_MAX_CHARS);
  const { snippets, members } = input.archive ?? (await loadArchive(input.familyId, input.viewerId));
  const names = new Map(members.map((m) => [m.id, callName(m)]));
  const speakerNames = new Map(members.map((m) => [m.id, `${m.displayName} ${m.firstName}`]));
  const passages = rankSnippets(question, snippets, { limit: TOP, speakerNames }).map((r) => r.snippet);

  const empty = (): AskResult => {
    const to = pickAskTarget(question, members, input.viewerId);
    return {
      status: "empty",
      message: to ? `No one in the family has said that yet — ask ${callName(to)}?` : "No one in the family has said that yet.",
      askTo: to ? { id: to.id, name: callName(to) } : null,
    };
  };
  if (!passages.length) return empty();

  const finish = (data: AskAnswer, source: "muse" | "fallback", cached: boolean): AskResult => {
    const citations = groundCitations(data.citations, passages);
    if (!data.answer.trim() || !citations.length) return empty();
    return { status: "answer", answer: data.answer.trim(), citations, source, cached };
  };

  const key = cacheId(input.familyId, question, passages);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return finish(hit.value, "muse", true);

  const user = `Question: ${question}\n\nPassages:\n${passages.map((p, i) => `${i + 1}. ${header(p, names.get(p.speakerId ?? "") ?? "a family member")}\n${p.text}`).join("\n\n")}`;
  const out = await museJson<AskAnswer>({
    familyId: input.familyId,
    purpose: "Answered a question from the family's own voices",
    system: SYSTEM,
    user,
    schema: AskAnswerSchema,
    mock: () => extractive(passages, names),
    fallback: extractive(passages, names),
    maxTokens: 700,
    // A model may say "nothing here" ({"answer": ""}); anything else must keep at least one real quote and no invented number.
    accept: (d) => (d.answer.trim() === "" && d.citations.length === 0) || (groundCitations(d.citations, passages).length > 0 && numbersGrounded(d.answer, passages)),
  });
  if (out.source === "muse") cache.set(key, { at: Date.now(), value: out.data });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return finish(out.data, out.source, out.cached);
}
