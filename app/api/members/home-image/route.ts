import { HomeImageRequestSchema } from "@/lib/schemas";
import { dbSetMemberHome } from "@/lib/db";
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
  const parsed = HomeImageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid-home-image" }, { status: 400 });
  }
  const ownership = requireMember(auth, parsed.data.memberId);
  if (ownership) return ownership;
  const member = await dbSetMemberHome(parsed.data.memberId, parsed.data.mediaRef, parsed.data.palette);
  if (!member) {
    return Response.json({ error: "unknown-member" }, { status: 404 });
  }
  return Response.json({ member });
}

export const POST = guardApi(postHandler);
