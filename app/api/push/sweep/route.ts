import { cronAuthorized } from "@/lib/auth";
import { guardWrites } from "@/lib/api-guard";
import { dbListFamilyIds } from "@/lib/db";
import { sweepOverdue } from "@/lib/push/events";

// Check-ins past their grace: tell the person's chosen people, once. Cheap enough to run
// every 15 minutes (the Cron Trigger in wrangler.jsonc); idempotent, safe to call again.
// Authorization: Bearer CRON_SECRET, like /api/ritual-scan.
async function getHandler(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return Response.json({ error: "unauthorized-cron" }, { status: 401 });
  let told = 0;
  for (const familyId of await dbListFamilyIds()) {
    try {
      told += await sweepOverdue(familyId);
    } catch (e) {
      console.error("[push] sweep failed", familyId, String(e));
    }
  }
  return Response.json({ told });
}

export const GET = guardWrites(getHandler);
