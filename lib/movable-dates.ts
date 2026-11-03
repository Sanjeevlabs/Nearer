// Movable festival dates via live search grounding (Fix 5,
// 01_api_fundamentals/10: POST /v1/responses with a web_search tool; the
// model browses, we read output_text and only trust an ISO date in the
// requested year). Cached per (slug, year) in memory + the ritual_configs
// row; the data fixture is the fallback, never the source of truth.
import { isMockMode } from "./config";
import { PROVIDERS, activeProvider } from "./config";
import { cacheKey, memoryStore, SpendLedger, type LlmStore } from "./llm";
import { MODEL_TIMEOUT_MS, deadline } from "./timeouts";

export type MovableSource = "live" | "cache" | "fixture";

export interface MovableResult {
  date: string | null;
  source: MovableSource;
  cached: boolean;
  cost: number;
  citations: string[];
}

export interface MovableDeps {
  store?: LlmStore;
  ledger?: SpendLedger;
  getPersistent?: (slug: string, year: number) => Promise<{ date: string; sources: string[] } | undefined>;
  setPersistent?: (slug: string, year: number, date: string, sources: string[]) => Promise<void>;
  fixture?: (slug: string) => string | null;
  fetchGrounded?: (prompt: string) => Promise<{ text: string; citations: string[]; cost: number }>;
}

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

export function parseGroundedDate(text: string, year: number): string | null {
  const m = ISO_DATE.exec(text);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y !== year || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return m[0];
}

export function groundingPrompt(title: string, year: number): string {
  // The festival name comes from the ritual config (family data); the
  // instruction asks for a bare ISO date the validator can check.
  return `On which Gregorian calendar date does "${title}" fall in ${year}? Reply with ONLY the ISO date (YYYY-MM-DD), no other text.`;
}

async function liveGround(prompt: string): Promise<{ text: string; citations: string[]; cost: number }> {
  const provider = activeProvider();
  const cfg = PROVIDERS[provider];
  const key = process.env.META_API_KEY;
  if (!key) throw new Error("missing-key");
  const res = await fetch("https://api.meta.ai/v1/responses", {
    method: "POST",
    signal: deadline(MODEL_TIMEOUT_MS),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: cfg.captionModel, input: prompt, tools: [{ type: "web_search" }] }),
  });
  if (!res.ok) throw new Error(`provider-${res.status}`);
  const data = (await res.json()) as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      url?: string;
      content?: Array<{ type?: string; text?: unknown; annotations?: Array<{ type?: string; url?: string }> }>;
    }>;
  };
  // This implementation has no top-level output_text: the answer is the
  // last non-empty message part with type "output_text".
  const texts: string[] = [];
  if (typeof data.output_text === "string" && data.output_text.trim()) texts.push(data.output_text);
  const citations: string[] = [];
  for (const item of data.output ?? []) {
    for (const block of item.content ?? []) {
      if (item.type === "message" && block.type === "output_text" && typeof block.text === "string" && block.text.trim()) {
        texts.push(block.text);
      }
      for (const a of block.annotations ?? []) {
        if (a?.type === "url_citation" && typeof a.url === "string") citations.push(a.url);
      }
    }
    if (typeof item.url === "string") citations.push(item.url);
  }
  const text = texts.length > 0 ? texts[texts.length - 1] : "";
  return { text, citations: Array.from(new Set(citations)).slice(0, 8), cost: 0.01 };
}

export interface MovableResolverDeps extends MovableDeps {
  getPersistent: NonNullable<MovableDeps["getPersistent"]>;
  setPersistent: NonNullable<MovableDeps["setPersistent"]>;
  fixture: NonNullable<MovableDeps["fixture"]>;
}

// Year-aware resolution for a set of config slugs: this year's grounded
// date, rolling to next year when this year's occasion is more than a week
// past. Returns the dates map + whether ANY date came from live/cache
// (false means the fixture carried everything).
export async function resolveMovableDates(
  slugs: { slug: string; title: string }[],
  now: Date,
  deps: MovableResolverDeps,
): Promise<{ dates: Record<string, string>; grounded: boolean }> {
  const year = now.getUTCFullYear();
  const today = now.toISOString().slice(0, 10);
  const dates: Record<string, string> = {};
  let grounded = false;
  for (const c of slugs) {
    const current = await getMovableDate(c.slug, c.title, year, deps);
    let iso = current.date;
    if (current.source !== "fixture") grounded = true;
    const stale = iso !== null && iso < today && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`) > 7 * 86400000;
    if (stale) {
      const next = await getMovableDate(c.slug, c.title, year + 1, deps);
      if (next.date) {
        iso = next.date;
        if (next.source !== "fixture") grounded = true;
      }
    }
    if (iso) dates[c.slug] = iso;
  }
  return { dates, grounded };
}

export async function getMovableDate(
  slug: string,
  title: string,
  year: number,
  deps: MovableDeps = {},
): Promise<MovableResult> {
  const store = deps.store ?? memoryStore();
  const ledger = deps.ledger ?? new SpendLedger(store);
  const key = `llm:movable:${slug}:${year}`;
  const hit = store.get(key);
  if (hit) {
    return { date: hit, source: "cache", cached: true, cost: 0, citations: [] };
  }
  if (deps.getPersistent) {
    try {
      const saved = await deps.getPersistent(slug, year);
      if (saved?.date) {
        store.set(key, saved.date);
        return { date: saved.date, source: "cache", cached: true, cost: 0, citations: saved.sources };
      }
    } catch {
      // Fall through to live.
    }
  }
  const fixtureDate = deps.fixture ? deps.fixture(slug) : null;
  // An injected fetchGrounded is a test stub, not the network: it may run in
  // mock mode so the parse/cache path is covered without live calls.
  if ((!isMockMode() && process.env.META_API_KEY) || deps.fetchGrounded) {
    try {
      const fetchGrounded = deps.fetchGrounded ?? liveGround;
      const { text, citations, cost } = await fetchGrounded(groundingPrompt(title, year));
      const date = parseGroundedDate(text, year);
      if (date) {
        if ((await ledger.check(cost))) {
          await ledger.commit(cost);
          store.set(key, date);
          await deps.setPersistent?.(slug, year, date, citations).catch(() => undefined);
          return { date, source: "live", cached: false, cost, citations };
        }
      }
    } catch {
      // Fall through to the fixture.
    }
  }
  return { date: fixtureDate, source: "fixture", cached: false, cost: 0, citations: [] };
}
