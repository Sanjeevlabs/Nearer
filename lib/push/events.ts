// What causes a push, one call per place the event is born. Each is fire-and-forget
// (inBackground): the person's own action never waits for it and never fails because of it.
// The rules (quiet hours, six a day, the 8 AM summary) are lib/push/policy.ts.
// Server only.
import { dbGetMember } from "../db";
import { getDoc, listDocs, putDoc } from "../family-docs";
import { addressees } from "../households";
import type { Member } from "../schemas";
import { callName } from "../people";
import { stateOf } from "../safety";
import type { Knock, SafetyCheckin } from "../kinds";
import { doorPush } from "../doors";
import { inBackground } from "./background";
import { PUSH_TITLE, thingOf, wordsFor } from "./copy";
import { decidePush, localClock } from "./policy";
import { defaultSettings, getPushSettings, saveTally } from "./prefs";
import { hasDevice, pushToMember, type SendDeps } from "./send";
import type { PushCategory, PushMessage } from "./types";

type Build = (w: ReturnType<typeof wordsFor>) => Omit<PushMessage, "title">;

async function activeMember(familyId: string, id: string): Promise<Member | null> {
  const m = await dbGetMember(id);
  return m && m.familyId === familyId && m.status !== "pending" ? m : null;
}

/**
 * Decide and deliver one push to one person: now, held for the 8 AM summary, or not at all.
 * Returns what happened (the tests read it).
 */
export async function routePush(familyId: string, to: Member, category: PushCategory, build: Build, now: Date = new Date(), deps: SendDeps = {}, opts: { dropIfHeld?: boolean } = {}): Promise<"sent" | "held" | "skipped"> {
  if (!(await hasDevice(familyId, to.id, deps))) return "skipped";
  const settings = await getPushSettings(familyId, to.id);
  const clock = localClock(to.tz, now);
  const sentToday = settings.day === clock.day ? settings.sent : 0;
  const decision = decidePush({ category, tz: to.tz, now, prefs: settings, sentToday });
  if (decision === "skip") return "skipped";
  // A note that is only good right now (an invitation) is dropped, not saved for the 8 AM summary.
  if (decision === "batch" && opts.dropIfHeld) return "skipped";
  if (decision === "batch") {
    await saveTally(familyId, settings, { day: clock.day, sent: sentToday, overflow: Math.min(1000, settings.overflow + 1) });
    return "held";
  }
  // Count it before sending, so two events at once cannot both squeeze under the cap.
  if (category !== "safety" && category !== "digest") await saveTally(familyId, settings, { day: clock.day, sent: sentToday + 1, overflow: settings.overflow });
  await pushToMember(familyId, to.id, { title: PUSH_TITLE, ...build(wordsFor(to.displayLang)) }, deps);
  return "sent";
}

// ----------------------------------------------------------------- the events

/** A voice note (or photo, or video) was sent to particular people. */
export function pushAddressed(familyId: string, card: { id: string; type: string; authorId: string | null; addressedTo: string | null }): void {
  const to = addressees(card).filter((id) => id !== card.authorId);
  if (!card.authorId || to.length === 0) return;
  const authorId = card.authorId;
  inBackground(async () => {
    const from = await activeMember(familyId, authorId);
    if (!from) return;
    for (const id of Array.from(new Set(to)).slice(0, 12)) {
      const m = await activeMember(familyId, id);
      if (!m) continue;
      await routePush(familyId, m, "voice", (w) => ({ body: w.voice(callName(from), thingOf(card.type)), url: `/lane?card=${encodeURIComponent(card.id)}`, tag: `voice-${card.id}`, urgency: "high" }));
    }
  });
}

/**
 * A door opened for one person ("Can I sit with you?"): that person hears once, now or not at all.
 * Quiet hours and the daily cap drop it (an invitation is only good now); `seenAt` marks it told,
 * so it is never sent again. Family-wide doors send nothing (the caller only calls this for one).
 */
export async function pushDoorNow(familyId: string, knock: Knock, now: Date = new Date(), deps: SendDeps = {}): Promise<"sent" | "held" | "skipped"> {
  const toId = knock.invites?.length === 1 ? knock.invites[0] : null;
  if (!toId || toId === knock.memberId || knock.seenAt) return "skipped";
  const [from, to] = await Promise.all([activeMember(familyId, knock.memberId), activeMember(familyId, toId)]);
  if (!from || !to) return "skipped";
  const out = await routePush(familyId, to, "ask", () => ({ body: doorPush(callName(from), knock.activity ?? null, knock.note), url: `/call/${encodeURIComponent(knock.id)}`, tag: `door-${knock.id}`, urgency: "high" }), now, deps, { dropIfHeld: true });
  // Told (or deliberately not): either way this door never pushes again.
  const cur = await getDoc(familyId, "knock", knock.id);
  if (cur && !cur.seenAt) await putDoc(familyId, "knock", { ...cur, seenAt: now.toISOString() });
  return out;
}

/** Fire-and-forget pushDoorNow, for the route. */
export function pushDoor(familyId: string, knock: Knock): void {
  inBackground(async () => void (await pushDoorNow(familyId, knock)));
}

/** A heartbeat: someone lit the lamp for this person. */
export function pushBeat(familyId: string, fromId: string, toId: string): void {
  if (fromId === toId) return;
  inBackground(async () => {
    const [from, to] = await Promise.all([activeMember(familyId, fromId), activeMember(familyId, toId)]);
    if (!from || !to) return;
    await routePush(familyId, to, "lamp", (w) => ({ body: w.beat(callName(from)), url: "/", tag: `lamp-${from.id}`, urgency: "high" }));
  });
}

/**
 * Someone lit the lamp: "Arjun is thinking of you" to each person in the other homes.
 * The caller has already applied the one-per-pair-per-2-hours rule (lib/lamp.ts lampPushedRecently)
 * and passes only who is due. In quiet hours (22:00 to 07:00 where they are) routePush holds it
 * for their 8 AM summary instead. Returns the outcome per person (the tests read it).
 */
export async function pushLight(familyId: string, fromId: string, toIds: string[], now: Date = new Date(), deps: SendDeps = {}): Promise<Record<string, "sent" | "held" | "skipped">> {
  const out: Record<string, "sent" | "held" | "skipped"> = {};
  const from = await activeMember(familyId, fromId);
  if (!from) return out;
  for (const id of Array.from(new Set(toIds)).filter((x) => x !== fromId).slice(0, 12)) {
    const m = await activeMember(familyId, id);
    if (!m) continue;
    out[id] = await routePush(familyId, m, "lamp", (w) => ({ body: w.thinking(callName(from)), url: "/", tag: `lamp-${from.id}`, urgency: "high" }), now, deps);
  }
  return out;
}

/** Fire-and-forget pushLight, for the route. */
export function pushLightInBackground(familyId: string, fromId: string, toIds: string[]): void {
  if (toIds.length === 0) return;
  inBackground(async () => void (await pushLight(familyId, fromId, toIds)));
}

/** A question, a request for a recipe or story, or a child's ask. `tagId` collapses it with the voice push of the same card. */
export function pushAsk(familyId: string, ask: { fromId: string; toIds: string[]; topic: string; tagId: string }): void {
  const toIds = Array.from(new Set(ask.toIds)).filter((id) => id !== ask.fromId).slice(0, 12);
  if (toIds.length === 0) return;
  inBackground(async () => {
    const from = await activeMember(familyId, ask.fromId);
    if (!from) return;
    for (const id of toIds) {
      const m = await activeMember(familyId, id);
      if (!m) continue;
      await routePush(familyId, m, "ask", (w) => ({ body: ask.topic === "story" ? w.story(callName(from)) : w.ask(callName(from)), url: "/inbox", tag: ask.tagId, urgency: "high" }));
    }
  });
}

/** The people someone chose to hear from, if Safe & sound is on and not paused. */
async function watchersOf(familyId: string, memberId: string): Promise<string[]> {
  const s = await getDoc(familyId, "safety_settings", memberId);
  return s?.enabled && !s.paused ? s.watchers.filter((w) => w !== memberId) : [];
}

/** "I need help": her chosen people hear at once, at any hour. */
export function pushHelp(familyId: string, memberId: string): void {
  inBackground(async () => {
    const [who, watchers] = await Promise.all([activeMember(familyId, memberId), watchersOf(familyId, memberId)]);
    if (!who) return;
    for (const id of watchers) {
      const m = await activeMember(familyId, id);
      if (m) await routePush(familyId, m, "safety", (w) => ({ body: w.help(callName(who)), url: "/safe", tag: `safe-${who.id}`, urgency: "high" }));
    }
  });
}

/**
 * Check-ins whose grace has run out: tell her chosen people, once each (alertedAt),
 * at any hour. Run by the sweep (every 15 minutes if the cron is set that way) and the daily scan.
 */
export async function sweepOverdue(familyId: string, now: Date = new Date(), deps: SendDeps = {}): Promise<number> {
  const all = (await listDocs(familyId, "safety_checkin")) as SafetyCheckin[];
  const open = all.filter((c) => !c.closedAt && (c.kind === "heading" || c.kind === "journey"));
  let told = 0;
  for (const memberId of Array.from(new Set(open.map((c) => c.memberId)))) {
    const state = stateOf(all, memberId, now.getTime());
    if (!state || state.tone !== "overdue" || state.checkin.alertedAt) continue;
    const [who, watchers] = await Promise.all([activeMember(familyId, memberId), watchersOf(familyId, memberId)]);
    if (!who) continue;
    // Marked first: a second sweep must not tell them again, even if this one is cut short.
    await putDoc(familyId, "safety_checkin", { ...state.checkin, alertedAt: now.toISOString() });
    for (const id of watchers) {
      const m = await activeMember(familyId, id);
      if (m && (await routePush(familyId, m, "safety", (w) => ({ body: w.overdue(callName(who)), url: "/safe", tag: `safe-${who.id}`, urgency: "high" }), now, deps)) === "sent") told++;
    }
  }
  return told;
}

/**
 * The 8 AM summary, one push: what the daily nudge run delivered plus whatever was held back
 * (quiet hours, the daily cap). `delivered` maps member id -> the texts of today's nudges.
 * Members with only held-back items are included. Outside 8:00 to 22:00 where they are, nothing
 * is sent and today's items wait with the rest. Returns how many people were pushed.
 */
export async function pushMorning(familyId: string, members: Member[], delivered: Map<string, string[]>, now: Date = new Date(), deps: SendDeps = {}): Promise<number> {
  let n = 0;
  // One read for the whole family; most people have nothing held back.
  const saved = new Map((await listDocs(familyId, "push_settings")).map((s) => [s.id, s]));
  for (const m of members) {
    if (m.status === "pending") continue;
    const lines = delivered.get(m.id) ?? [];
    const settings = saved.get(m.id) ?? defaultSettings(m.id);
    const clock = localClock(m.tz, now);
    if (lines.length === 0 && settings.overflow === 0) continue;
    if (clock.hour < 8 || clock.hour >= 22) {
      if (lines.length > 0 && settings.digest && (await hasDevice(familyId, m.id, deps))) await saveTally(familyId, settings, { day: settings.day, sent: settings.sent, overflow: Math.min(1000, settings.overflow + lines.length) });
      continue;
    }
    const count = lines.length + settings.overflow;
    const only = lines.length === 1 && settings.overflow === 0 && wordsFor(m.displayLang) === wordsFor("en") ? lines[0] : null;
    const result = await routePush(familyId, m, "digest", (w) => ({ body: only ?? (count === 1 ? w.digestOne : w.digest(count)), url: "/inbox", tag: `digest-${clock.day}`, urgency: "normal" }), now, deps);
    if (result === "sent") {
      n++;
      if (settings.overflow > 0) await saveTally(familyId, await getPushSettings(familyId, m.id), { day: settings.day, sent: settings.sent, overflow: 0 });
    }
  }
  return n;
}
