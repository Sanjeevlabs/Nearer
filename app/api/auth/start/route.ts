import { z } from "zod";
import { allowAuthAttempt, sendCode } from "@/lib/otp";
import { guardApi } from "@/lib/api-guard";

const StartSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

// Step 1 of sign-in: email a 6-digit code. Same response whether or not the
// email belongs to a family, so the endpoint can't be used to probe accounts.
async function postHandler(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-email" }, { status: 400 });
  if (!allowAuthAttempt(`start:${parsed.data.email}`, 4)) return Response.json({ error: "too-many-codes" }, { status: 429 });
  const sent = await sendCode(parsed.data.email);
  if (!sent.ok) return Response.json({ error: "code-not-sent" }, { status: 502 });
  return Response.json({ sent: true, mock: sent.mock });
}

export const POST = guardApi(postHandler);
