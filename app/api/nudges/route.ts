import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { dbListMembers } from "@/lib/db";
import { deleteDoc, getDoc, listDocs, newId, putDoc } from "@/lib/family-docs";
import { letterShareLink } from "@/lib/nudge-mail";
import { REMIND_DAYS, listFor, reminderAt, reminderText, remindersOf, renderNudgeText } from "@/lib/nudges";
import { guardWrites } from "@/lib/api-guard";

// Your own list only: what is waiting for you, and what came this week.
// Names are resolved for you here; nobody else can read it.
// `?reminders=1`: your own "Remind me to ask" list (Settings, My reminders), future ones included.
async function getHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const members = await dbListMembers(auth.familyId);
  if (new URL(req.url).searchParams.get("reminders")) {
    const mine = await remindersOf(auth.familyId, auth.memberId);
    return Response.json(
      { reminders: mine.map((n) => ({ id: n.id, text: renderNudgeText(n.text, members), note: n.note ?? "", aboutId: n.aboutId ?? null, href: n.href, at: n.deliverAfter, seen: n.seenAt !== null })) },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const now = Date.now();
  // A reminder shows only from its day (it is yours alone either way).
  const nudges = (await listFor(auth.familyId, auth.memberId)).filter((n) => n.kind !== "reminder" || Date.parse(n.deliverAfter) <= now);
  const letters = nudges.some((n) => n.kind === "letter") ? await listDocs(auth.familyId, "chitthi") : [];
  const origin = (process.env.APP_ORIGIN || new URL(req.url).origin).replace(/\/$/, "");
  return Response.json({
    nudges: nudges.map((n) => {
      const letterId = n.kind === "letter" ? new URL(n.href, "http://x").searchParams.get("letter") : null;
      const letter = letterId ? letters.find((l) => l.id === letterId) : undefined;
      return {
        id: n.id,
        kind: n.kind,
        text: renderNudgeText(n.text, members),
        href: n.href,
        at: n.at,
        waiting: n.deliveredAt === null,
        seen: n.seenAt !== null,
        ...(letter ? { share: letterShareLink(letter.title ?? "A letter from the courtyard", origin) } : {}),
      };
    }),
  });
}

const Days = z.union(REMIND_DAYS.map((d) => z.literal(d)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<3>, z.ZodLiteral<7>]);
const Href = z.string().max(200).refine((h) => h.startsWith("/") && !h.startsWith("//"), "local link");
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remind"), aboutId: z.string().min(1).max(80), href: Href, what: z.string().trim().max(80).default(""), days: Days, note: z.string().trim().max(140).default("") }),
  z.object({ action: z.literal("edit"), id: z.string().min(1).max(80), days: Days.optional(), note: z.string().trim().max(140).optional() }),
  z.object({ action: z.literal("delete"), id: z.string().min(1).max(80) }),
]);

// "Remind me to ask": a private note to yourself, for a day you choose. It is never sent to
// anyone, never emailed or pushed, and has no weekly limit (it is yours). Edit or delete any time.
async function postHandler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-reminder" }, { status: 400 });
  const body = parsed.data;
  const members = await dbListMembers(auth.familyId);
  const me = members.find((m) => m.id === auth.memberId);
  const tz = me?.tz ?? "UTC";
  const now = new Date();
  if (body.action === "remind") {
    if (body.aboutId === auth.memberId || !members.some((m) => m.id === body.aboutId)) return Response.json({ error: "unknown-member" }, { status: 404 });
    const n = await putDoc(auth.familyId, "nudge", {
      id: newId("remind"),
      toMemberId: auth.memberId,
      kind: "reminder",
      text: reminderText(body.aboutId, body.what, body.note),
      href: body.href,
      at: now.toISOString(),
      deliverAfter: reminderAt(tz, body.days, now),
      deliveredAt: null,
      channel: null,
      seenAt: null,
      aboutId: body.aboutId,
      ...(body.note ? { note: body.note } : {}),
      ...(body.what ? { what: body.what } : {}),
    });
    return Response.json({ reminder: { id: n.id, at: n.deliverAfter } }, { status: 201 });
  }
  const cur = await getDoc(auth.familyId, "nudge", body.id);
  // Only your own reminders: anything else reads as not there.
  if (!cur || cur.kind !== "reminder" || cur.toMemberId !== auth.memberId) return Response.json({ error: "unknown-reminder" }, { status: 404 });
  if (body.action === "delete") {
    await deleteDoc(auth.familyId, "nudge", cur.id);
    return Response.json({ deleted: cur.id });
  }
  const note = body.note ?? cur.note ?? "";
  const what = cur.what ?? "";
  const next = {
    ...cur,
    note: note || undefined,
    text: cur.aboutId ? reminderText(cur.aboutId, what, note) : cur.text,
    ...(body.days ? { deliverAfter: reminderAt(tz, body.days, now), seenAt: null } : {}),
  };
  const saved = await putDoc(auth.familyId, "nudge", next);
  return Response.json({ reminder: { id: saved.id, at: saved.deliverAfter } });
}

export const GET = guardWrites(getHandler);
export const POST = guardWrites(postHandler);
