// "Powered by Muse": the one door every new helper capability goes through.
// - Structured output only, validated by Zod (one retry, then a safe fallback).
// - Cached by input, so the same recipe or question is never paid for twice.
// - Respects the shared spend cap.
// - Logs a muse_call row per call so Agent activity shows exactly what Muse
//   did for this family (purpose, model, time, cost, cached or not).
// Server only.
import type { z } from "zod";
import { activeProvider, isMockMode, PROVIDERS } from "./config";
import { newId, putDoc } from "./family-docs";
import { cacheKey, liveJson } from "./llm";
import { serverLedger, serverStore } from "./llm-server";

export interface MuseResult<T> {
  data: T;
  /** "muse" when Muse produced it, "fallback" when we fell back safely. */
  source: "muse" | "fallback";
  cached: boolean;
  cost: number;
  model: string;
}

export async function museJson<T>(opts: {
  familyId: string;
  /** Human sentence for Agent activity: "Wrote up Dadi's recipe from her voice note". */
  purpose: string;
  system: string;
  user: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Deterministic stand-in used in mock mode (tests, demo without a key). */
  mock: () => unknown;
  fallback: T;
  maxTokens?: number;
  /** Extra post-validation guard (grounding): return false to reject. */
  accept?: (data: T) => boolean;
}): Promise<MuseResult<T>> {
  const provider = activeProvider();
  const model = PROVIDERS[provider].captionModel;
  const key = `muse:${cacheKey(model, `${opts.system}\n${opts.user}`, "muse")}`;
  const started = Date.now();
  // `why` says what failed (budget, provider-<status>, truncated, empty, parse,
  // schema, grounding) so a fallback is diagnosable from the muse_call rows.
  const log = (ok: boolean, cached: boolean, cost: number, why?: string) =>
    putDoc(opts.familyId, "muse_call", {
      id: newId("muse"),
      purpose: opts.purpose,
      model,
      cached,
      ok,
      ...(why ? { why } : {}),
      ms: Date.now() - started,
      cost,
      at: new Date().toISOString(),
    }).catch(() => undefined);

  const hit = serverStore.get(key);
  if (hit) {
    const parsed = opts.schema.safeParse(JSON.parse(hit));
    if (parsed.success) {
      await log(true, true, 0);
      return { data: parsed.data, source: "muse", cached: true, cost: 0, model };
    }
  }
  const estimated = isMockMode() ? 0 : 0.01;
  if (!(await serverLedger.check(estimated))) {
    await log(false, false, 0, "budget");
    return { data: opts.fallback, source: "fallback", cached: false, cost: 0, model };
  }
  const reasons: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = isMockMode() ? { json: opts.mock(), cost: 0 } : await liveJson(provider, opts.system, opts.user, model, opts.maxTokens ?? 1200);
      const parsed = opts.schema.safeParse(out.json);
      if (!parsed.success) {
        reasons.push("schema");
        continue;
      }
      if (opts.accept && !opts.accept(parsed.data)) {
        reasons.push("grounding");
        continue;
      }
      await serverLedger.commit(out.cost);
      serverStore.set(key, JSON.stringify(parsed.data));
      await log(true, false, out.cost);
      return { data: parsed.data, source: "muse", cached: false, cost: out.cost, model };
    } catch (err) {
      reasons.push(err instanceof Error ? err.message.slice(0, 40) : "error");
      continue;
    }
  }
  await log(false, false, 0, reasons.join(","));
  return { data: opts.fallback, source: "fallback", cached: false, cost: 0, model };
}
