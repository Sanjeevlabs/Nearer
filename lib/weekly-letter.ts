// "A letter from the courtyard": once a week Muse drafts a short letter from
// what really happened. Server only. It reads, then proposes; a grown-up
// approves before anything appears (see the approve route).
import { z } from "zod";
import { dbListCards, dbListMembers, dbListPlays, dbListReactions, dbListSuggestions } from "./db";
import { listDocs } from "./family-docs";
import { activeHabit, habitWeekFacts } from "./habits";
import { museJson } from "./muse";
import { callName } from "./people";
import type { Suggestion } from "./schemas";
import { weekStartOf } from "./week";

export const LETTER_TITLE_MAX = 60;
export const LETTER_BODY_MAX = 900;
export const LETTER_FACT_MAX = 40;
export const LETTER_GOAL = "Send this week's letter?";

export const WeeklyLetterSchema = z.object({
  title: z.string().trim().min(1).max(LETTER_TITLE_MAX),
  body: z.string().trim().min(1).max(LETTER_BODY_MAX),
  lang: z.enum(["en", "hi"]),
});
export type WeeklyLetter = z.infer<typeof WeeklyLetterSchema>;

export interface WeeklyLetterPayload extends WeeklyLetter {
  action: "weekly_letter";
  weekStart: string;
  factCount: number;
}

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export { weekStartOf };

/** The letter's language from a display language: Hindi in Devanagari, else English. */
export function letterLang(displayLang: string | undefined): "en" | "hi" {
  return displayLang === "hi-deva" || displayLang === "hi" ? "hi" : "en";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export interface WeekFacts {
  weekStart: string;
  facts: string[];
}

/** The week's grounded facts for one family, oldest first, at most LETTER_FACT_MAX plain lines. */
export async function gatherWeekFacts(familyId: string, weekStart?: string, now: Date = new Date()): Promise<WeekFacts> {
  const explicit = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : undefined;
  const from = explicit ? Date.parse(`${explicit}T00:00:00.000Z`) : now.getTime() - 7 * DAY;
  const to = explicit ? from + 7 * DAY : now.getTime() + 1;
  const key = explicit ?? weekStartOf(now);
  const inWeek = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && t >= from && t < to;
  };

  const [members, cards, plays, reactions, stories, recipes, attempts, questions, lamps, chitthi, tasks, habits, habitTicks] = await Promise.all([
    dbListMembers(familyId),
    dbListCards(familyId),
    dbListPlays(undefined, familyId),
    dbListReactions(undefined, familyId),
    listDocs(familyId, "story"),
    listDocs(familyId, "recipe"),
    listDocs(familyId, "attempt"),
    listDocs(familyId, "question"),
    listDocs(familyId, "lamp"),
    listDocs(familyId, "chitthi"),
    listDocs(familyId, "today_task"),
    listDocs(familyId, "habit"),
    listDocs(familyId, "habit_tick"),
  ]);
  const name = (id: string | null | undefined) => callName(members.find((m) => m.id === id));
  // Not for the whole family yet: sealed morning letters and unfinished Today answers.
  const hidden = new Set<string>();
  for (const l of chitthi) if (Date.parse(l.deliverAt) > now.getTime()) hidden.add(l.id);
  for (const t of tasks) if (!t.completedAt) for (const a of t.answers) hidden.add(a.cardId);
  const visible = cards.filter((c) => !hidden.has(c.id));
  const what = (c: { type: string }) => (c.type === "audio" ? "voice note" : c.type === "video" ? "video" : "photo");

  const rows: { at: string; text: string }[] = [];
  for (const c of visible) {
    if (!inWeek(c.takenAt)) continue;
    const words = oneLine((c.type === "audio" ? c.transcript || c.caption : c.caption) || "");
    rows.push({ at: c.takenAt, text: `${name(c.authorId)} shared a ${what(c)}${words ? ` '${clip(words, 70)}'` : ""}` });
  }
  const cardById = new Map(visible.map((c) => [c.id, c]));
  const seen = new Set<string>();
  for (const p of plays) {
    const card = cardById.get(p.cardId);
    const k = `${p.memberId}:${p.cardId}`;
    if (!card || !inWeek(p.playedAt) || seen.has(k) || p.memberId === card.authorId) continue;
    seen.add(k);
    rows.push({ at: p.playedAt, text: `${name(p.memberId)} listened to ${name(card.authorId)}'s ${what(card)}` });
  }
  const verb = { love: "sent love to", laugh: "laughed at", bless: "blessed" } as const;
  for (const r of reactions) {
    const card = cardById.get(r.cardId);
    if (!card || !inWeek(r.createdAt)) continue;
    rows.push({ at: r.createdAt, text: `${name(r.memberId)} ${verb[r.kind]} ${name(card.authorId)}'s ${what(card)}` });
  }
  for (const s of stories) if (inWeek(s.createdAt)) rows.push({ at: s.createdAt, text: `${name(s.tellerId)} told the story '${clip(s.title, 60)}'` });
  for (const r of recipes) if (inWeek(r.createdAt)) rows.push({ at: r.createdAt, text: `${name(r.addedBy ?? r.cookId)} wrote down the recipe '${clip(r.title, 60)}'` });
  for (const a of attempts) {
    if (!inWeek(a.createdAt)) continue;
    const recipe = recipes.find((r) => r.id === a.recipeId);
    rows.push({ at: a.createdAt, text: `${name(a.memberId)} cooked ${recipe ? `'${clip(recipe.title, 60)}'` : "a family recipe"}` });
  }
  for (const q of questions) if (inWeek(q.createdAt)) rows.push({ at: q.createdAt, text: `${q.askedBy ? name(q.askedBy) : "The family"} asked ${name(q.toMemberId)}: '${clip(oneLine(q.text), 70)}'` });
  for (const l of lamps) if (inWeek(l.litAt)) rows.push({ at: l.litAt as string, text: `${name(l.litBy)} lit the lamp` });
  // The family habit, in words: who walked most mornings, a day the whole family did it together. No counts.
  const habit = activeHabit(habits);
  if (habit) {
    const days = Array.from({ length: 7 }, (_, i) => new Date(from + i * DAY).toISOString().slice(0, 10));
    const inFamily = habit.members.filter((id) => members.some((m) => m.id === id));
    const names = Object.fromEntries(inFamily.map((id) => [id, name(id)]));
    for (const f of habitWeekFacts({ ...habit, members: inFamily }, habitTicks, names, days)) rows.push({ at: `${f.day}T12:00:00.000Z`, text: f.text });
  }
  // Safety check-ins are private to the people chosen for them: never part of a letter.

  rows.sort((a, b) => a.at.localeCompare(b.at));
  const facts = rows.slice(-LETTER_FACT_MAX).map((r) => `${WEEKDAYS[new Date(r.at).getUTCDay()]}: ${r.text}`);
  return { weekStart: key, facts };
}

/** Deterministic letter from the first six facts (no model). */
export function fallbackLetter(facts: string[], lang: "en" | "hi" = "en"): WeeklyLetter {
  const lines = facts.slice(0, 6).map((f) => `• ${f.replace(/^\w{3}: /, "")}`);
  const hi = lang === "hi";
  const head = hi ? "प्यारे परिवार,\n\nइस हफ़्ते आँगन में यह सब हुआ:" : "Dear family,\n\nHere is what happened in the courtyard this week:";
  const tail = hi ? "आप सबको बहुत प्यार।" : "With love, from all of us at home.";
  const make = () => `${head}\n${lines.join("\n")}\n\n${tail}`;
  while (make().length > LETTER_BODY_MAX && lines.length > 1) lines.pop();
  return { title: hi ? "आँगन से एक चिट्ठी" : "A letter from the courtyard", body: clip(make(), LETTER_BODY_MAX), lang };
}

const SYSTEM =
  "You write a short, warm weekly letter to a family, from the courtyard of their home. " +
  "Use ONLY the people and facts listed; never invent a person, an event, a place or a quote. " +
  "Speak to them as 'you all' (second person plural), tenderly and plainly. " +
  "No numbers, counts, scores or rankings, no health advice. Do not mention who was quiet. " +
  'Reply with JSON only: {"title": string (max 60 chars), "body": string (max 900 chars), "lang": "en" or "hi"}. ' +
  "Write the letter in the requested language.";

/** Ask Muse for the letter; any unavailable or invalid answer becomes the fixed fallback. */
export async function writeLetter(familyId: string, facts: string[], lang: "en" | "hi"): Promise<WeeklyLetter> {
  const fallback = fallbackLetter(facts, lang);
  const res = await museJson<WeeklyLetter>({
    familyId,
    purpose: "Wrote this week's letter from the courtyard",
    system: SYSTEM,
    user: `Language: ${lang === "hi" ? "Hindi (Devanagari)" : "English"}\nThis week:\n${facts.join("\n")}`,
    schema: WeeklyLetterSchema,
    mock: () => fallback,
    fallback,
    maxTokens: 700,
    // No counts or scores: reject any answer with digits.
    accept: (d) => !/\d/.test(`${d.title} ${d.body}`),
  });
  return { ...res.data, lang };
}

/**
 * This week's letter suggestion, if one was made. "live" = still pending or
 * already approved; "any" also counts one the family said "Not now" to.
 */
export async function weeklyLetterMade(familyId: string, weekStart: string, mode: "live" | "any"): Promise<Suggestion | undefined> {
  const all = await dbListSuggestions(undefined, familyId);
  return all.find((s) => {
    const p = (s.payload ?? {}) as { action?: string; weekStart?: string };
    if (p.action !== "weekly_letter" || p.weekStart !== weekStart) return false;
    return mode === "any" || s.status !== "rejected";
  });
}
