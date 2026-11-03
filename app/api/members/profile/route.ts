import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { dbUpdateMemberProfile } from "@/lib/db";
import { BirthdayInput } from "@/lib/schemas";
import { guardApi } from "@/lib/api-guard";

const ProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(40).optional(),
  tz: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "unknown-time-zone")
    .optional(),
  photoRef: z.string().max(512).nullable().optional(),
  /** The city, in their words: shown on the other side's window with its weather. */
  city: z.string().trim().max(60).optional(),
  /** "MM-DD", or "YYYY-MM-DD" with the year (lib/birthday.ts); "" clears it. */
  birthday: BirthdayInput.optional(),
});

// The session member edits only their own profile; no member id is accepted.
async function patchHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = ProfileSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid-profile" }, { status: 400 });
  const member = await dbUpdateMemberProfile(auth.memberId, parsed.data);
  if (!member) return Response.json({ error: "unknown-member" }, { status: 404 });
  return Response.json({ member });
}

export const PATCH = guardApi(patchHandler);
