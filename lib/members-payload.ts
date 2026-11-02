// The family's people as one viewer may see them: GET /api/members, and the
// family part of GET /api/session?family=1. Server only.
import { DEMO_FAMILY } from "./family";
import { can } from "./permissions";
import { familyNameFor, membersAllFor } from "./request-data";
import type { Member } from "./schemas";

// The family's people. Each person's email stays theirs: others only learn
// that they have an account. The cross-family personId never leaves the server.
function forViewer(m: Member, viewerId: string): Member {
  return { ...m, email: m.id === viewerId ? m.email : m.email ? "account" : null, personId: null };
}

/** The family's people as this viewer may see them (GET /api/members, and GET /api/session?family=1). */
export async function membersPayload(req: Request, auth: { familyId: string; memberId: string }) {
  const [all, name] = await Promise.all([membersAllFor(req, auth.familyId), familyNameFor(req, auth.familyId)]);
  const members = all.filter((m) => m.status !== "pending");
  // Waiting to join: only the people who can let them in see them.
  const me = members.find((m) => m.id === auth.memberId);
  const pending = can(me, "members.approve") ? all.filter((m) => m.status === "pending").map((m) => forViewer(m, auth.memberId)) : [];
  const clean = name.replace(/^the\s+/i, "").replace(/\s+family$/i, "");
  return { members: members.map((m) => forViewer(m, auth.memberId)), pending, family: { ...DEMO_FAMILY, id: auth.familyId, name: clean || (auth.familyId === "demo-family" ? DEMO_FAMILY.name : "Family") } };
}
