import { requireSession } from "@/lib/auth";
import { isSampleMode } from "@/lib/config";
import { connectedGroups } from "@/lib/connected-apps";
import { dbListMembers, dbListRelationships } from "@/lib/db";
import { ACCOUNTS, isEnabled } from "@/lib/partners/registry";
import { connections } from "@/lib/partners/tokens";

// GET → every app Send something offers this family, grouped by the countries
// of their homes, with this member's connection status (lib/connected-apps.ts).
// Status only: tokens never leave the server.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [mine, members, relationships] = await Promise.all([connections(auth.familyId, auth.memberId), dbListMembers(auth.familyId), dbListRelationships(auth.familyId)]);
  const on = new Set(ACCOUNTS.filter((a) => isEnabled({ envFlag: a.envFlag, defaultOn: false })).map((a) => a.id));
  const groups = connectedGroups({
    members,
    relationships,
    connected: new Set(mine.map((c) => c.account)),
    accountOn: (id) => on.has(id),
    partnerOn: (p) => isEnabled(p),
  });
  // `accounts` keeps the plain connect/disconnect state for callers that only need that.
  const accounts = ACCOUNTS.filter((a) => on.has(a.id)).map((a) => ({ id: a.id, name: a.name, connected: mine.some((c) => c.account === a.id) }));
  return Response.json({ sample: isSampleMode(), groups, accounts });
}
