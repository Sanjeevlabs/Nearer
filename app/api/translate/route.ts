import { z } from "zod";
import { TranslateRequestSchema } from "@/lib/schemas";
import { serverLedger, serverStore } from "@/lib/llm-server";
import { translateText } from "@/lib/llm";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { guardApi } from "@/lib/api-guard";

// One text ({text, targetLang}) or a screen's worth at once ({texts, targetLang}):
// a page of prompts is one request, not twenty. Each text is cached on its own.
const BatchSchema = z.object({
  texts: z.array(z.string().min(1).max(2000)).min(1).max(40),
  targetLang: z.string().min(2).max(8),
});

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/translate")) return Response.json({ error: "rate-limited" }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const opts = { store: serverStore, ledger: serverLedger };
  const batch = BatchSchema.safeParse(body);
  if (batch.success) {
    const out = await Promise.all(batch.data.texts.map((t) => translateText(t, batch.data.targetLang, opts)));
    return Response.json({ translations: out.map((o) => o.translation), cost: out.reduce((s, o) => s + o.cost, 0) });
  }
  const parsed = TranslateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-translate" }, { status: 400 });
  }
  // Cache key inside translateText is per text + target lang.
  const { translation, cached, cost } = await translateText(parsed.data.text, parsed.data.targetLang, opts);
  return Response.json({ translation, cached, cost });
}

export const POST = guardApi(postHandler);
