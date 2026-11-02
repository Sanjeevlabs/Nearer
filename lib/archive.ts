// The family archive: what the family has said, in their own voices, made
// searchable. Pure (no I/O): the route feeds it cards and docs.
//   buildSnippets  cards + recipes + stories + asks -> quotable passages
//   rankSnippets   BM25 over normalised text, plus a typo/transliteration-
//                  tolerant token match, so "daal" finds "dal" and any script works
//   quoteGrounded  a model's quote must really be in its source (fuzzy >= 0.9)
// Nothing here calls a model.
import type { Question, Recipe, Story } from "./kinds";
import type { Card, Member } from "./schemas";

export type SnippetKind = "voice" | "video" | "recipe";

export interface Snippet {
  id: string;
  /** The card to play. A recipe nobody recorded is `recipe:<id>` (nothing to play). */
  cardId: string;
  speakerId: string | null;
  /** Seconds into the clip where this passage starts (0 when untimed). */
  at: number;
  takenAt: string;
  /** What was said: the only text a quote may come from. */
  text: string;
  /** Words that help find it but are never quoted: the question it answered, a story title. */
  context: string;
  kind: SnippetKind;
  lang: string;
}

const MAX_WORDS = 45;
export const MAX_CARDS = 400;
export const MAX_SNIPPETS = 3000;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => clean(s).split(" ").filter(Boolean);

/** Group timed segments (or untimed sentences) into passages of about a breath or two. */
function windows(card: Card): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  if (card.segments.length) {
    let cur: { text: string[]; at: number; n: number } | null = null;
    for (const s of card.segments) {
      const n = words(s.text).length;
      if (cur && cur.n + n > MAX_WORDS) {
        out.push({ text: cur.text.join(" "), at: cur.at });
        cur = null;
      }
      if (!cur) cur = { text: [], at: s.start, n: 0 };
      cur.text.push(clean(s.text));
      cur.n += n;
    }
    if (cur) out.push({ text: cur.text.join(" "), at: cur.at });
    return out;
  }
  const sentences = clean(card.transcript).split(/(?<=[.!?।])\s+/).filter(Boolean);
  let buf: string[] = [];
  let n = 0;
  for (const s of sentences) {
    const k = words(s).length;
    if (buf.length && n + k > MAX_WORDS) {
      out.push({ text: buf.join(" "), at: 0 });
      buf = [];
      n = 0;
    }
    buf.push(s);
    n += k;
  }
  if (buf.length) out.push({ text: buf.join(" "), at: 0 });
  return out;
}

export interface ArchiveInput {
  cards: Card[];
  recipes: Recipe[];
  stories: Story[];
  questions: Pick<Question, "text" | "answeredCardId">[];
  /** Card ids this viewer may not hear yet (sealed daily answers, letters still in the envelope). */
  hidden: Set<string>;
  familyId: string;
}

/**
 * Every passage the viewer may be answered from. Family-scoped by construction:
 * a card or recipe of another family is skipped even if it is passed in.
 */
export function buildSnippets({ cards, recipes, stories, questions, hidden, familyId }: ArchiveInput): Snippet[] {
  const context = new Map<string, string[]>();
  const addCtx = (cardId: string | null | undefined, ...parts: string[]) => {
    if (!cardId) return;
    context.set(cardId, [...(context.get(cardId) ?? []), ...parts.filter(Boolean)]);
  };
  for (const s of stories) addCtx(s.cardId, s.title, s.summary);
  for (const q of questions) addCtx(q.answeredCardId, q.text);
  for (const r of recipes) addCtx(r.voiceCardId, r.title);

  const out: Snippet[] = [];
  const recent = [...cards].filter((c) => c.familyId === familyId).sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, MAX_CARDS);
  for (const c of recent) {
    if (hidden.has(c.id) || c.type === "photo" || !c.transcript.trim()) continue;
    const ctx = clean([c.caption, c.summary, ...(context.get(c.id) ?? [])].join(" "));
    for (const w of windows(c)) {
      out.push({ id: `${c.id}@${w.at}`, cardId: c.id, speakerId: c.authorId, at: w.at, takenAt: c.takenAt, text: w.text, context: ctx, kind: c.type === "video" ? "video" : "voice", lang: c.transcriptLang });
    }
  }
  for (const r of recipes) {
    const voice = r.voiceCardId && !hidden.has(r.voiceCardId) ? r.voiceCardId : null;
    if (r.voiceCardId && hidden.has(r.voiceCardId)) continue;
    const lines = [
      r.memory,
      ...r.ingredients.map((i) => clean(`${i.said || ""} ${i.item}`)),
      ...r.steps.map((s) => clean(`${s.text} ${s.tip}`)),
    ].filter(Boolean);
    let buf: string[] = [];
    let n = 0;
    const flush = () => {
      if (!buf.length) return;
      out.push({ id: `recipe:${r.id}@${out.length}`, cardId: voice ?? `recipe:${r.id}`, speakerId: r.cookId, at: 0, takenAt: r.createdAt, text: buf.join(". "), context: r.title, kind: "recipe", lang: r.lang });
      buf = [];
      n = 0;
    };
    for (const l of lines) {
      const k = words(l).length;
      if (buf.length && n + k > MAX_WORDS) flush();
      buf.push(l.replace(/[.!?]+$/, ""));
      n += k;
    }
    flush();
  }
  return out.slice(0, MAX_SNIPPETS);
}

// ---------- tokens ----------

const STOP = new Set(
  (
    "a an the and or but if of to in on at by for with from as is are was were be been am do does did done how what when where who whom why which that this these those it its " +
    "i me my we our you your he him his she her they them their about tell told say said says ask any some there here can could would should will have has had not no yes so just " +
    "से का की के को में पर है हैं था थी थे और या कि यह वह एक कैसे क्या कब कहाँ कौन क्यों मैं हम तुम आप ने भी तो नहीं"
  ).split(" "),
);

/** Lower-case, unicode-aware words; english suffixes folded so "making" meets "make". */
export function tokens(text: string): string[] {
  const raw = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  for (const w of raw) {
    if (STOP.has(w) || w.length < 2) continue;
    out.push(stem(w));
  }
  return out;
}

function stem(w: string): string {
  if (!/^[a-z]+$/.test(w) || w.length < 4) return w;
  let s = w;
  if (s.endsWith("ies") && s.length > 4) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("es") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s !== w && /([^aeiou])\1$/.test(s) && !/(ll|ss|zz)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

function bigrams(w: string): Set<string> {
  const g = new Set<string>();
  const p = `^${w}$`;
  for (let i = 0; i < p.length - 1; i++) g.add(p.slice(i, i + 2));
  return g;
}

function dice(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let hit = 0;
  x.forEach((g) => y.has(g) && hit++);
  return (2 * hit) / (x.size + y.size);
}

// ---------- ranking ----------

export interface Ranked {
  snippet: Snippet;
  score: number;
}

/**
 * BM25 over each passage (its words plus the context that finds it). A query
 * word the corpus has never seen borrows near spellings ("daal" for "dal") at
 * a discount. Names of speakers lift a passage but never make one relevant on
 * their own. At most `perCard` passages per card, `limit` in all.
 */
export function rankSnippets(query: string, snippets: Snippet[], opts: { limit?: number; perCard?: number; speakerNames?: Map<string, string> } = {}): Ranked[] {
  const limit = opts.limit ?? 8;
  const perCard = opts.perCard ?? 3;
  const nameTokens = new Set(Array.from(opts.speakerNames?.values() ?? []).flatMap((n) => tokens(n)));
  const all = Array.from(new Set(tokens(query)));
  // Who is named only lifts a passage; what is asked about has to be found in it.
  const q = all.filter((t) => !nameTokens.has(t));
  if (!q.length || !snippets.length) return [];

  const docs = snippets.map((s) => {
    const tf = new Map<string, number>();
    for (const t of tokens(`${s.text} ${s.context}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let len = 0;
    tf.forEach((n) => (len += n));
    const names = new Set(tokens(opts.speakerNames?.get(s.speakerId ?? "") ?? ""));
    return { s, tf, len, names };
  });
  const df = new Map<string, number>();
  for (const d of docs) d.tf.forEach((_, t) => df.set(t, (df.get(t) ?? 0) + 1));
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const vocab = Array.from(df.keys());

  // query term -> weighted corpus terms
  const terms: [string, number][] = [];
  for (const t of q) {
    if (df.has(t)) terms.push([t, 1]);
    else if (t.length >= 4) for (const v of vocab) if (v.length >= 3 && v[0] === t[0] && dice(t, v) >= 0.7) terms.push([v, 0.6]);
  }

  const N = docs.length;
  const k1 = 1.2;
  const b = 0.75;
  const ranked: Ranked[] = [];
  for (const d of docs) {
    let score = 0;
    for (const [t, w] of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
    }
    if (score <= 0) continue;
    for (const t of all) if (d.names.has(t)) score += 0.5;
    ranked.push({ snippet: d.s, score });
  }
  ranked.sort((a, b2) => b2.score - a.score || b2.snippet.takenAt.localeCompare(a.snippet.takenAt));
  // A passage that only brushes the question (far below the best one) is noise, not evidence.
  const floor = (ranked[0]?.score ?? 0) * 0.4;
  const seen = new Map<string, number>();
  const out: Ranked[] = [];
  for (const r of ranked) {
    if (r.score < floor) break;
    const n = seen.get(r.snippet.cardId) ?? 0;
    if (n >= perCard) continue;
    seen.set(r.snippet.cardId, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- grounding ----------

const squash = (s: string) => (s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).join(" ");

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Is `quote` really in `source`? Exact after folding case and punctuation, else the best same-length stretch of words must match >= `min` (so a stray "um" or a dropped comma passes, a different sentence does not). */
export function quoteGrounded(quote: string, source: string, min = 0.9): boolean {
  const q = squash(quote);
  const s = squash(source);
  if (q.length < 3 || !s) return false;
  if (` ${s} `.includes(` ${q} `)) return true;
  const qw = q.split(" ");
  const sw = s.split(" ");
  if (qw.length < 2) return false;
  for (let size = Math.max(1, qw.length - 1); size <= Math.min(sw.length, qw.length + 1); size++) {
    for (let i = 0; i + size <= sw.length; i++) {
      const cand = sw.slice(i, i + size).join(" ");
      const sim = 1 - lev(cand, q) / Math.max(cand.length, q.length);
      if (sim >= min) return true;
    }
  }
  return false;
}

export const QUOTE_MAX_WORDS = 20;
export const wordCount = (s: string) => words(s).length;

export interface RawCitation {
  cardId: string;
  quote: string;
  speakerId: string;
  at: number;
}
export interface Citation extends RawCitation {
  takenAt: string;
  kind: SnippetKind;
  /** The card can be played (a recipe nobody recorded cannot). */
  playable: boolean;
}

/**
 * Keep only citations whose quote is in a passage of that same card that was
 * actually retrieved. The speaker and the moment are taken from that passage,
 * never from the model. Repeats are dropped.
 */
export function groundCitations(cites: RawCitation[], retrieved: Snippet[]): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const c of cites) {
    if (wordCount(c.quote) > QUOTE_MAX_WORDS) continue;
    const src = retrieved.find((s) => s.cardId === c.cardId && quoteGrounded(c.quote, s.text));
    if (!src) continue;
    const key = `${src.cardId}|${squash(c.quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ cardId: src.cardId, quote: clean(c.quote), speakerId: src.speakerId ?? c.speakerId, at: src.at, takenAt: src.takenAt, kind: src.kind, playable: !src.cardId.startsWith("recipe:") });
  }
  return out;
}

/** Numbers in an answer must be numbers the snippets contain: a model may not invent a quantity. */
export function numbersGrounded(answer: string, retrieved: Snippet[]): boolean {
  const have = new Set(retrieved.flatMap((s) => `${s.text} ${s.context}`.match(/\d+/g) ?? []));
  return (answer.match(/\d+/g) ?? []).every((n) => have.has(n));
}

// ---------- who to ask when nobody has said it ----------

/** The person the question names ("what did Papa say…"), else the first elder who is not the asker. */
export function pickAskTarget(question: string, members: Member[], viewerId: string): Member | null {
  const active = members.filter((m) => m.status !== "pending" && m.id !== viewerId);
  const q = new Set(tokens(question));
  const named = active.find((m) => [m.displayName, m.firstName].some((n) => n && tokens(n).some((t) => q.has(t))));
  return named ?? active.find((m) => m.role === "elder") ?? null;
}

/** One normalised form for caching and comparing questions. */
export function normaliseQuestion(q: string): string {
  return squash(q);
}
