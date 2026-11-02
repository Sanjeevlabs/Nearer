import { cronAuthorized } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { dbListFamilyIds } from "@/lib/db";
import { sweepOverdue } from "@/lib/push/events";
import { sweepQuietMornings } from "@/lib/push/morning";

// Check-ins past their grace: tell the person's chosen people, once. Cheap enough to run
// every 15 minutes (the Cron Trigger in wrangler.jsonc); idempotent, safe to call again.
// Also the quiet-morning invitation (lib/push/morning.ts).
// Authorization: Bearer CRON_SECRET, like /api/ritual-scan.
async function getHandler(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return Response.json({ error: "unauthorized-cron" }, { status: 401 });
  let told = 0;
  let invited = 0;
  for (const familyId of await dbListFamilyIds()) {
    try {
      told += await sweepOverdue(familyId);
    } catch (e) {
      console.error("[push] sweep failed", familyId, String(e));
    }
    // A parent who has not said "I'm okay" by their usual time + 2 h: one gentle invitation to the far child.
    try {
      invited += await sweepQuietMornings(familyId);
    } catch (e) {
      console.error("[push] quiet-morning sweep failed", familyId, String(e));
    }
  }
  return Response.json({ told, invited });
}

export const GET = guardWrites(getHandler);
