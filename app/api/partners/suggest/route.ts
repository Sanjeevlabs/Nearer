import { z } from "zod";
import { checkRateLimit, requireSession } from "@/lib/auth";
import { dbGetMember } from "@/lib/db";
import { sendCountry } from "@/lib/send-apps";
import { partnersForCountry, storesForCountry } from "@/lib/partners/registry";
import { callName } from "@/lib/people";
import { isBlockedText, refFor, searchCandidates } from "@/lib/partners/catalog";
import { pickSuggestions } from "@/lib/partners/suggest";
import { guardApi } from "@/lib/api-guard";

// POST {forMemberId, occasion? | need?} → three things to send, chosen by Muse
// only from what the partners' catalogues returned. Never medical, never ads.
const BodySchema = z
  .object({
    forMemberId: z.string().min(1).max(64),
    occasion: z.string().trim().min(1).max(80).optional(),
    need: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((b) => !(b.occasion && b.need), { message: "occasion-or-need" });

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  if (!checkRateLimit(auth, "/api/partners/suggest")) return Response.json({ error: "rate-limited" }, { status: 429 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid-request" }, { status: 400 });
  const body = parsed.data;
  const recipient = await dbGetMember(body.forMemberId);
  if (!recipient || recipient.familyId !== auth.familyId) return Response.json({ error: "unknown-member" }, { status: 404 });

  const kind = body.need ? "need" : "occasion";
  const title = body.need ?? body.occasion ?? "Just because";
  // Medicines go only through a licensed partner with a prescription (SPEC §9.1): not here.
  if (isBlockedText(title))
    return Response.json({
      suggestions: [],
      sample: false,
      refused: "medical",
    });

  // The recipient's own country, same resolver as the app links; an unknown zone is generic, never India.
  const country = sendCountry(recipient.tz);
  const eligible = partnersForCountry(country).some((p) => p.sendable) || storesForCountry(country).length > 0;
  // Nobody to ask in their country: no search, and the page leaves this section out (the links stay).
  if (!eligible) return Response.json({ eligible: false, suggestions: [], sample: false });
  const found = await searchCandidates({
    familyId: auth.familyId,
    memberId: auth.memberId,
    country,
    city: recipient.city,
    kind,
    title,
  });
  const { suggestions, source } = await pickSuggestions({
    familyId: auth.familyId,
    recipientName: callName(recipient),
    kind,
    title,
    candidates: found.candidates,
  });
  return Response.json({
    eligible: true,
    sample: found.sample,
    source,
    connectable: found.connectable,
    suggestions: suggestions.flatMap((s) => {
      const ref = refFor(auth.familyId, auth.memberId, s);
      return ref
        ? [
            {
              id: ref,
              partnerId: s.partnerId,
              via: s.via,
              kind: s.kind,
              name: s.name,
              price: s.price,
              currency: s.currency,
              image: s.image ?? null,
              why: s.why,
              sample: s.sample,
              needsAccount: s.account,
            },
          ]
        : [];
    }),
  });
}

export const POST = guardApi(postHandler);
