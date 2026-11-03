import { DisplayLangRequestSchema } from "@/lib/schemas";
import { dbSetMemberDisplayLang } from "@/lib/db";
import { requireMember, requireSession } from "@/lib/auth";
import { guardApi } from "@/lib/api-guard";

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = DisplayLangRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-display-lang" }, { status: 400 });
  }
  const ownership = requireMember(auth, parsed.data.memberId);
  if (ownership) return ownership;
  const member = await dbSetMemberDisplayLang(parsed.data.memberId, parsed.data.displayLang);
  if (!member) return Response.json({ error: "unknown-member" }, { status: 404 });
  return Response.json({ member });
}

export const POST = guardApi(postHandler);
