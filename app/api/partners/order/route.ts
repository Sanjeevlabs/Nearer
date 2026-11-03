import { z } from "zod";
import { requireCan, requireSession } from "@/lib/auth";
import { dbGetMember } from "@/lib/db";
import { callName } from "@/lib/people";
import { NeedsConnect } from "@/lib/partners/adapter";
import { candidateFromRef } from "@/lib/partners/catalog";
import { confirmPreview, createPreview } from "@/lib/partners/orders";
import { getAccount } from "@/lib/partners/registry";
import { guardApi } from "@/lib/api-guard";

// Two steps, both from the signed-in member's own partner account:
//   {action:"preview", suggestionId, forMemberId, addressId?} → cart, total, address
//   {action:"confirm", previewId, confirm:true}                → places it (an explicit tap; never Muse)
// Not connected → { needsConnect: accountId }.
const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), suggestionId: z.string().min(1).max(4000), forMemberId: z.string().min(1).max(64), addressId: z.string().min(1).max(120).optional() }).strict(),
  z.object({ action: z.literal("confirm"), previewId: z.string().max(8000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/), confirm: z.literal(true) }).strict(),
]);

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  // Send something is for grown-ups with an account (never a teen or child).
  const allowed = await requireCan(auth, "partners.order");
  if (allowed instanceof Response) return allowed;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  const body = parsed.data;
  try {
    if (body.action === "preview") {
      const [recipient, me] = await Promise.all([dbGetMember(body.forMemberId), dbGetMember(auth.memberId)]);
      if (!recipient || recipient.familyId !== auth.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });
      const candidate = candidateFromRef(auth.familyId, auth.memberId, body.suggestionId);
      if (!candidate) return Response.json({ error: "suggestion-expired" }, { status: 410 });
      const preview = await createPreview({ familyId: auth.familyId, memberId: auth.memberId, candidate, recipientCity: recipient.city, ownCity: me?.city ?? "", addressId: body.addressId });
      return Response.json({ preview, recipient: callName(recipient) });
    }
    const result = await confirmPreview({ familyId: auth.familyId, memberId: auth.memberId, previewId: body.previewId });
    return Response.json({ result });
  } catch (err) {
    if (err instanceof NeedsConnect) return Response.json({ needsConnect: err.account, name: getAccount(err.account)?.name ?? err.account });
    const msg = err instanceof Error ? err.message : "error";
    if (msg === "preview-not-found") return Response.json({ error: msg }, { status: 404 });
    console.error("[partners] order failed", body.action, msg);
    return Response.json({ error: "partner-unavailable" }, { status: 502 });
  }
}

export const POST = guardApi(postHandler);
