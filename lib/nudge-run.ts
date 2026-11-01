// The daily scan's share of nudges: queue the calendar ones (an occasion this
// week, the weekly call tomorrow, the weekly letter), then deliver whatever has
// reached its recipient's 8 AM. Server only.
import { isDemoFamily } from "./family";
import { getDoc, listDocs } from "./family-docs";
import { DOC_SCHEMAS } from "./kinds";
import { letterShareLink, renderDigestEmail } from "./nudge-mail";
import { drain, enqueueNudge, markDelivered, nudgeSettingsFor, renderNudgeText } from "./nudges";
import { mailConfigured, sendMail } from "./mail";
import { pushMorning, sweepOverdue } from "./push/events";
import type { DocKind } from "./kinds";
import type { Member } from "./schemas";
import { weekStartOf } from "./week";

const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayIn(tz: string, at: Date): number {
  try {
    const w = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
  } catch {
    return at.getUTCDay();
  }
}

export interface UpcomingOccasion {
  slug: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface NudgeScanInput {
  members: Member[];
  now: Date;
  occasions: UpcomingOccasion[];
}

/** The weekly call is another room's doc; read it defensively and treat anything odd as "no call". */
async function weeklyCall(familyId: string): Promise<{ weekday: number; tz: string; hostId: string | null; name: string } | null> {
  try {
    if (!("weekly_call" in DOC_SCHEMAS)) return null;
    const d = (await getDoc(familyId, "weekly_call" as DocKind, "weekly-call")) as unknown as Record<string, unknown> | undefined;
    if (!d || typeof d.weekday !== "number" || typeof d.tz !== "string") return null;
    const weekday = d.weekday === 7 ? 0 : d.weekday;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    return { weekday, tz: d.tz, hostId: typeof d.hostId === "string" ? d.hostId : null, name: typeof d.name === "string" ? d.name.slice(0, 40) : "" };
  } catch {
    return null;
  }
}

/** Sunday morning in the host's zone is the family's letter day. */
function hostOf(members: Member[]): Member | undefined {
  const active = members.filter((m) => m.status !== "pending");
  return active.find((m) => m.access === "owner") ?? active.find((m) => m.access === "admin") ?? active[0];
}

export async function queueScanNudges(familyId: string, input: NudgeScanInput): Promise<{ queued: number }> {
  const { members, now, occasions } = input;
  const active = members.filter((m) => m.status !== "pending");
  let queued = 0;
  const add = async (n: Parameters<typeof enqueueNudge>[1]) => {
    if (await enqueueNudge(familyId, n, now).catch(() => null)) queued++;
  };

  // An occasion in the next 7 days: everyone, once a week per occasion.
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 7 * DAY).toISOString().slice(0, 10);
  for (const o of occasions) {
    if (o.date < today || o.date > horizon) continue;
    const day = WEEKDAYS[new Date(`${o.date}T12:00:00Z`).getUTCDay()];
    for (const m of active) await add({ toMemberId: m.id, kind: "occasion", text: `${o.title} is on ${day}`, href: `/rituals#${o.slug}` });
  }

  // The weekly call is tomorrow (in the call's own zone).
  const call = await weeklyCall(familyId);
  if (call && weekdayIn(call.tz, new Date(now.getTime() + DAY)) === call.weekday) {
    for (const m of active) await add({ toMemberId: m.id, actorId: call.hostId, kind: "call", text: call.name ? `${call.name} is tomorrow` : "The family call is tomorrow", href: "/call" });
  }

  // Letter day: Sunday morning where the host lives. Once a week, to everyone, if a letter was approved this week.
  const host = hostOf(members);
  if (host && weekdayIn(host.tz, now) === 0) {
    const from = Date.parse(`${weekStartOf(now)}T00:00:00.000Z`);
    const letter = (await listDocs(familyId, "chitthi")).find((l) => l.kind === "letter" && l.body && Date.parse(l.deliverAt) >= from && Date.parse(l.deliverAt) <= now.getTime());
    if (letter) {
      for (const m of active) await add({ toMemberId: m.id, kind: "letter", text: `This week's letter: ${letter.title ?? "from the courtyard"}`.slice(0, 120), href: `/home?letter=${encodeURIComponent(letter.id)}` });
    }
  }
  return { queued };
}

/** Deliver what is due: one email per person when mail is set up and wanted, always kept in-app too. */
export async function deliverDueNudges(familyId: string, members: Member[], now: Date): Promise<{ emails: number; inapp: number }> {
  const origin = (process.env.APP_ORIGIN || "").replace(/\/$/, "");
  const batches = await drain(familyId, now);
  const out = { emails: 0, inapp: 0 };
  const texts = new Map<string, string[]>();
  const letters = batches.some((b) => b.nudges.some((n) => n.kind === "letter")) ? await listDocs(familyId, "chitthi") : [];
  for (const b of batches) {
    const member = members.find((m) => m.id === b.memberId);
    if (!member) continue;
    let channel: "email" | "inapp" = "inapp";
    const settings = await nudgeSettingsFor(familyId, member.id, member);
    if (member.email && settings.email && !isDemoFamily(familyId) && mailConfigured()) {
      const letterNudge = b.nudges.find((n) => n.kind === "letter");
      const letterId = letterNudge ? new URL(letterNudge.href, "http://x").searchParams.get("letter") : null;
      const letter = letters.find((l) => l.id === letterId && l.body);
      const openUrl = origin || "https://nearer.invalid";
      const mail = renderDigestEmail({
        name: member.displayName || member.firstName,
        lines: b.nudges.filter((n) => n.kind !== "letter").map((n) => renderNudgeText(n.text, members)),
        letter: letter ? { title: letter.title ?? "A letter from the courtyard", body: letter.body ?? "" } : null,
        openUrl,
        shareUrl: letter ? letterShareLink(letter.title ?? "A letter from the courtyard", openUrl) : null,
      });
      channel = (await sendMail({ to: member.email, ...mail })).channel;
    }
    await markDelivered(familyId, b.nudges, channel, now);
    texts.set(member.id, b.nudges.map((n) => renderNudgeText(n.text, members)));
    if (channel === "email") out.emails++;
    else out.inapp++;
  }
  // One push per person for the morning ("3 things from your family"), plus whatever was held back overnight.
  // A failure here never undoes the delivery above.
  await pushMorning(familyId, members, texts, now).catch((e: unknown) => console.error("[push] morning failed", String(e)));
  return out;
}

/** The scan's one call: queue the calendar nudges, then deliver. Never throws. */
export async function runScanNudges(familyId: string, input: NudgeScanInput): Promise<{ queued: number; emails: number; inapp: number }> {
  try {
    const { queued } = await queueScanNudges(familyId, input);
    await sweepOverdue(familyId, input.now).catch((e: unknown) => console.error("[push] overdue sweep failed", String(e)));
    return { queued, ...(await deliverDueNudges(familyId, input.members, input.now)) };
  } catch (e) {
    console.error("[nudges] scan failed", familyId, String(e));
    return { queued: 0, emails: 0, inapp: 0 };
  }
}
