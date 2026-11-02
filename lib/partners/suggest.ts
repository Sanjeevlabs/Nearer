// Muse picks three things to send, choosing only among the catalogue rows
// the partners returned (grounded by id; name and price always come from
// the catalogue, never from Muse). One retry, then a safe fallback: the
// first relevant rows. Nothing medical. Server only.
import { z } from "zod";
import { museJson } from "../muse";
import { isBlockedText, type Candidate, type ContextKind } from "./catalog";

export interface Suggestion extends Candidate {
  why: string;
}

export const PicksSchema = z.object({
  picks: z
    .array(z.object({ id: z.string().min(1).max(200), why: z.string().default("").transform((w) => w.trim().slice(0, 90)) }))
    .min(1)
    .max(3),
});
type Picks = z.infer<typeof PicksSchema>;

/** Deterministic picks: for an occasion, two everyday items and one gift; for a need, the most relevant. */
export function defaultPicks(cs: Candidate[], n = 3, kind: ContextKind = "occasion"): Candidate[] {
  if (kind === "need") return cs.slice(0, n);
  const gifts = cs.filter((c) => c.kind === "gifts");
  const rest = cs.filter((c) => c.kind !== "gifts");
  const chosen = [...rest.slice(0, n - (gifts.length ? 1 : 0)), ...gifts.slice(0, 1)];
  for (const c of cs) if (chosen.length < n && !chosen.includes(c)) chosen.push(c);
  return chosen.slice(0, n);
}

const SYSTEM =
  "You help someone send a small, thoughtful thing to a family member far away. " +
  "Choose up to 3 items ONLY from the candidate list, by their exact id. Prefer variety across partners, " +
  "and what suits the person and the moment. Never choose anything medical, alcohol or tobacco. " +
  'For each, write "why": one warm line under 80 characters, no prices, no brand claims. ' +
  'Reply with JSON only: {"picks":[{"id":"...","why":"..."}]}';

export async function pickSuggestions(input: {
  familyId: string;
  recipientName: string;
  kind: ContextKind;
  title: string;
  candidates: Candidate[];
}): Promise<{ suggestions: Suggestion[]; source: "muse" | "fallback" }> {
  const cs = input.candidates;
  if (cs.length === 0) return { suggestions: [], source: "fallback" };
  const want = Math.min(3, cs.length);
  const ids = new Set(cs.map((c) => c.id));
  const fallbackPicks: Picks = { picks: defaultPicks(cs, want, input.kind).map((c) => ({ id: c.id, why: "" })) };
  const list = cs.map((c) => `- id: ${c.id} | ${c.name} | via ${c.via} | ${c.kind}`).join("\n");
  const res = await museJson<Picks>({
    familyId: input.familyId,
    purpose: `Picked things to send to ${input.recipientName}`,
    system: SYSTEM,
    user: `Sending to: ${input.recipientName}\n${input.kind === "occasion" ? "Occasion" : "What they need"}: ${input.title}\nCandidates:\n${list}`,
    schema: PicksSchema,
    mock: () => fallbackPicks,
    fallback: fallbackPicks,
    maxTokens: 400,
    accept: (d) => {
      const got = d.picks.map((p) => p.id);
      return got.length === want && new Set(got).size === got.length && got.every((id) => ids.has(id)) && d.picks.every((p) => !isBlockedText(p.why));
    },
  });
  const byId = new Map(cs.map((c) => [c.id, c]));
  const suggestions = res.data.picks
    .map((p) => {
      const c = byId.get(p.id);
      return c ? { ...c, why: p.why.replace(/[₹$]\s?\d[\d,.]*/g, "").trim() } : null;
    })
    .filter((s): s is Suggestion => s !== null);
  return { suggestions, source: res.source };
}
