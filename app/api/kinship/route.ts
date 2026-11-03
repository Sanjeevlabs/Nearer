import { z } from "zod";
import { resolveKinship } from "@/lib/kinship";
import { dbGetKinshipTerms, dbListRelationships, dbSetKinshipTerms } from "@/lib/db";
import { translateText } from "@/lib/llm";
import { serverLedger, serverStore } from "@/lib/llm-server";
import { normalizeDisplayLang } from "@/lib/i18n";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { guardApi } from "@/lib/api-guard";

const QuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  lang: z.string().min(2).max(8).default("en"),
});

// Viewer-relative kinship: deterministic BFS path -> kinship_cache keyed by
// (path, display_lang). The model (translate) runs only on a cache miss.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/kinship")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    lang: searchParams.get("lang") ?? undefined,
  });
  if (!parsed.success) return Response.json({ error: "invalid-kinship" }, { status: 400 });
  const displayLang = normalizeDisplayLang(parsed.data.lang);
  const result = await resolveKinship(parsed.data.from, parsed.data.to, displayLang, {
    relationships: await dbListRelationships(auth.familyId),
    getCached: (p, l) => dbGetKinshipTerms(p, l),
    setCached: (p, l, t) => dbSetKinshipTerms(p, l, t),
    translate: async (text, lang) => {
      const { translation } = await translateText(text, lang, { store: serverStore, ledger: serverLedger });
      return translation.text;
    },
  });
  return Response.json({ path: result.path, terms: result.terms, cached: result.cached });
}

export const GET = guardApi(getHandler);
