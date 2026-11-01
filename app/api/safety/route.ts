import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { docsFor } from "@/lib/request-data";
import { dbListMembers } from "@/lib/db";
import { getDoc, listDocs, newId, putDoc } from "@/lib/family-docs";
import { SAFETY_KINDS } from "@/lib/kinds";
import { stateOf, withoutStaleLocation } from "@/lib/safety";
import { guardWrites } from "@/lib/api-guard";

// Safe & sound. Owned by the person it protects:
// - Only she can turn it on, choose who sees it, pause it, or check in.
// - Only the people she chose ever see her check-ins (enforced here).
// - Location is accepted only with "I need help", only if she sends it, and
//   is dropped after 24 hours.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), enabled: z.boolean(), watchers: z.array(z.string().min(1)).max(12), paused: z.boolean().default(false) }),
  z.object({
    action: z.literal("checkin"),
    kind: z.enum(SAFETY_KINDS),
    note: z.string().trim().max(120).default(""),
    etaMinutes: z.number().int().min(5).max(60 * 24).optional(),
    etaAt: z.string().datetime().optional(),
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000) }).optional(),
  }),
  z.object({ action: z.literal("close"), checkinId: z.string().min(1) }),
]);

async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const [settings, checkins] = await Promise.all([docsFor(req, auth.familyId, "safety_settings"), docsFor(req, auth.familyId, "safety_checkin")]);
  // Who shares with me: enabled, not paused, and I'm one of their chosen people.
  const sharesWithMe = new Set(settings.filter((s) => s.enabled && !s.paused && s.watchers.includes(auth.memberId)).map((s) => s.memberId));
  const visible = checkins.filter((c) => c.memberId === auth.memberId || sharesWithMe.has(c.memberId)).map((c) => withoutStaleLocation(c));
  const mine = settings.find((s) => s.memberId === auth.memberId) ?? null;
  // At a glance, per person (for the home screen): everyone sharing with me, plus me if I'm on.
  const people = [...(mine?.enabled ? [auth.memberId] : []), ...Array.from(sharesWithMe).filter((id) => id !== auth.memberId)];
  const members = people.map((memberId) => {
    const state = stateOf(visible, memberId);
    return {
      memberId,
      tone: state?.tone ?? null,
      label: state?.label ?? null,
      at: state?.at ?? null,
      etaAt: state && (state.tone === "pending" || state.tone === "overdue") ? state.etaAt : null,
      recent: visible.filter((c) => c.memberId === memberId).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 5),
    };
  });
  return Response.json({
    mine,
    sharing: Array.from(sharesWithMe),
    checkins: visible.slice(0, 200),
    members,
  });
}

async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-safety" }, { status: 400 });
  const body = parsed.data;
  const now = new Date();

  if (body.action === "settings") {
    const family = new Set((await dbListMembers(auth.familyId)).map((m) => m.id));
    const watchers = Array.from(new Set(body.watchers.filter((w) => w !== auth.memberId)));
    if (watchers.some((w) => !family.has(w))) return Response.json({ error: "unknown-member" }, { status: 400 });
    if (body.enabled && watchers.length === 0) return Response.json({ error: "choose-someone" }, { status: 400 });
    return Response.json({ settings: await putDoc(auth.familyId, "safety_settings", { id: auth.memberId, memberId: auth.memberId, enabled: body.enabled, watchers, paused: body.paused, updatedAt: now.toISOString() }) });
  }

  const mine = await getDoc(auth.familyId, "safety_settings", auth.memberId);
  if (!mine?.enabled) return Response.json({ error: "safety-off" }, { status: 409 });

  if (body.action === "close") {
    const c = await getDoc(auth.familyId, "safety_checkin", body.checkinId);
    if (!c || c.memberId !== auth.memberId) return Response.json({ error: "unknown-checkin" }, { status: 404 });
    return Response.json({ checkin: await putDoc(auth.familyId, "safety_checkin", { ...c, closedAt: now.toISOString(), location: null }) });
  }

  // A new check-in closes any earlier open one (you're home, so you're no longer "heading").
  for (const open of (await listDocs(auth.familyId, "safety_checkin")).filter((c) => c.memberId === auth.memberId && !c.closedAt && c.kind !== "home-safe" && c.kind !== "out-late")) {
    await putDoc(auth.familyId, "safety_checkin", { ...open, closedAt: now.toISOString(), location: null });
  }
  const needsEta = body.kind === "heading" || body.kind === "journey";
  const etaAt = needsEta ? (body.etaAt ? new Date(body.etaAt).toISOString() : new Date(now.getTime() + (body.etaMinutes ?? 30) * 60_000).toISOString()) : null;
  const location = body.kind === "help" && body.location ? { ...body.location, at: now.toISOString() } : null;
  const closesItself = body.kind === "home-safe" || body.kind === "out-late";
  const checkin = await putDoc(auth.familyId, "safety_checkin", { id: newId("safe"), memberId: auth.memberId, kind: body.kind, note: body.note, etaAt, closedAt: closesItself ? now.toISOString() : null, location, at: now.toISOString() });
  return Response.json({ checkin }, { status: 201 });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
