import { z } from "zod";
import { serverLedger, serverStore } from "@/lib/llm-server";
import { normalizeDisplayLang } from "@/lib/i18n";
import { suggestQuestions } from "@/lib/llm";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { guardApi } from "@/lib/api-guard";

const QuerySchema = z.object({
  memberId: z.string().min(1).default("dadi"),
  displayLang: z.string().min(2).max(8).default("en"),
});

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/suggest")) return Response.json({ error: "rate-limited" }, { status: 429 });
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    memberId: searchParams.get("memberId") ?? undefined,
    displayLang: searchParams.get("displayLang") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "invalid-suggest" }, { status: 400 });
  }
  const displayLang = normalizeDisplayLang(parsed.data.displayLang);
  const { questions, cached, cost } = await suggestQuestions(
    { memberId: parsed.data.memberId, displayLang },
    { store: serverStore, ledger: serverLedger },
  );
  return Response.json({ questions, displayLang, cached, cost });
}

export const GET = guardApi(getHandler);
