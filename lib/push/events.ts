// What causes a push, one call per place the event is born. Each is fire-and-forget
// (inBackground): the person's own action never waits for it and never fails because of it.
// The rules (quiet hours, six a day, the 8 AM summary) are lib/push/policy.ts.
// Server only.
import { dbGetMember, dbListMembers } from "../db";
import { claimDoc, claimPushCooldown, getDoc, listDocs, putDoc } from "../family-docs";
import { isDemoFamily } from "../family";
import { addressees } from "../households";
import type { Member } from "../schemas";
import { callName } from "../people";
import { stateOf } from "../safety";
import type { Knock, SafetyCheckin, Sitting } from "../kinds";
import { inBackground } from "./background";
import { PUSH_TITLE, eventWords, thingOf, wordsFor } from "./copy";
import { decidePush, localClock } from "./policy";
import { defaultSettings, getPushSettings, saveTally } from "./prefs";
import { hasDevice, isMock, pushToMember, type SendDeps } from "./send";
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
  if (to.familyId !== familyId || to.status === "pending" || !(await hasDevice(familyId, to.id, deps))) return "skipped";
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
type AddressedCard = { id: string; type: string; authorId: string | null; addressedTo: string | null };

export function pushAddressed(familyId: string, card: AddressedCard): void {
  inBackground(() => pushAddressedNow(familyId, card));
}

export async function pushAddressedNow(familyId: string, card: AddressedCard, excludeId?: string): Promise<void> {
  const to = addressees(card).filter((id) => id !== card.authorId && id !== excludeId);
  if (!card.authorId || to.length === 0) return;
  const from = await activeMember(familyId, card.authorId);
  if (!from) return;
  for (const id of Array.from(new Set(to)).slice(0, 12)) {
    const m = await activeMember(familyId, id);
    if (!m) continue;
    await routePush(familyId, m, "voice", (w) => ({ body: w.voice(callName(from), thingOf(card.type)), url: `/lane?card=${encodeURIComponent(card.id)}`, tag: `voice-${card.id}`, urgency: "high" }));
  }
}

/**
 * A door opened for specific people. The invite is sent once or counted in the morning summary.
 * Family-wide doors are visible in the app without a push.
 */
export async function pushDoorNow(familyId: string, knock: Knock, now: Date = new Date(), deps: SendDeps = {}): Promise<"sent" | "held" | "skipped"> {
  if (!knock.invites?.length || knock.seenAt || Date.parse(knock.until) <= now.getTime()) return "skipped";
  const from = await activeMember(familyId, knock.memberId);
  if (!from) return "skipped";
  const current = await getDoc(familyId, "knock", knock.id);
  if (!current || current.seenAt) return "skipped";
  if (!(await claimDoc(familyId, "push_claim", { id: `push-door:${knock.id}`, until: now.toISOString() }))) return "skipped";
  await putDoc(familyId, "knock", { ...current, seenAt: now.toISOString() });
  let out: "sent" | "held" | "skipped" = "skipped";
  for (const id of new Set(knock.invites)) {
    if (id === from.id) continue;
    const recipient = await activeMember(familyId, id);
    if (!recipient) continue;
    const result = await routePush(familyId, recipient, "ask", () => ({ body: eventWords.door(callName(from), knock.activity === "chai"), url: `/call/${encodeURIComponent(knock.id)}`, tag: `door-${knock.id}`, urgency: "high" }), now, deps);
    if (out === "skipped" || result === "sent") out = result;
  }
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
    await routePush(familyId, to, "lamp", (w) => ({ body: w.beat(callName(from)), url: "/?push=lamp", tag: `lamp-${from.id}`, urgency: "high" }));
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
    out[id] = await routePush(familyId, m, "lamp", (w) => ({ body: w.beat(callName(from)), url: "/?push=lamp", tag: `lamp-${from.id}`, urgency: "high" }), now, deps);
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
export async function pushMorning(familyId: string, members: Member[], delivered: Map<string, string[]>, now: Date = new Date(), deps: SendDeps = {}, onlyMorningHour = false): Promise<number> {
  let n = 0;
  const saved = new Map((await listDocs(familyId, "push_settings")).map((s) => [s.id, s]));
  for (const m of members) {
    if (m.status === "pending") continue;
    const lines = delivered.get(m.id) ?? [];
    const settings = saved.get(m.id) ?? defaultSettings(m.id);
    if (!settings.digest || (lines.length === 0 && settings.overflow === 0)) continue;
    const clock = localClock(m.tz, now);
    if (onlyMorningHour && clock.hour !== 8) continue;
    if (!(await hasDevice(familyId, m.id, deps))) continue;
    const ready = clock.hour >= 8 && clock.hour < 22;
    // Claim against the local day so the sweep and daily scan cannot both send a digest.
    const dayMark = `push-digest:${m.id}:${clock.day}`;
    if (!ready || !(await claimDoc(familyId, "push_claim", { id: dayMark, until: now.toISOString() }))) {
      if (lines.length > 0) await saveTally(familyId, settings, { day: settings.day, sent: settings.sent, overflow: Math.min(1000, settings.overflow + lines.length) });
      continue;
    }
    const count = lines.length + settings.overflow;
    const only = lines.length === 1 && settings.overflow === 0 && wordsFor(m.displayLang) === wordsFor("en") ? lines[0] : null;
    const result = await routePush(familyId, m, "digest", (w) => ({ body: only ?? (count === 1 ? w.digestOne : w.digest(count)), url: "/inbox", tag: `digest-${clock.day}`, urgency: "normal" }), now, deps);
    if (result === "sent") {
      n++;
      if (settings.overflow > 0) {
        const current = await getPushSettings(familyId, m.id);
        await saveTally(familyId, current, { day: current.day, sent: current.sent, overflow: Math.max(0, current.overflow - settings.overflow) });
      }
    }
  }
  return n;
}

/** The regular sweep catches 8 AM in each time zone even when the daily scan runs earlier. */
export async function sweepHeldPush(familyId: string, now: Date = new Date(), deps: SendDeps = {}): Promise<number> {
  if (!isMock(deps) && isDemoFamily(familyId)) return 0;
  const held = (await listDocs(familyId, "push_settings")).filter((s) => s.digest && s.overflow > 0);
  if (!held.length) return 0;
  const members = (await Promise.all(held.map((s) => activeMember(familyId, s.id)))).filter((m): m is Member => m !== null);
  return pushMorning(familyId, members, new Map(), now, deps, true);
}


export async function pushHabitTick(familyId: string, habit: { id: string; members: string[] }, fromId: string, day: string, now: Date = new Date()): Promise<void> {
  const from = await activeMember(familyId, fromId);
  if (!from || !habit.members.includes(fromId)) return;
  const id = `push-habit:${habit.id}:${fromId}:${day}`;
  if (!(await claimDoc(familyId, "push_claim", { id, until: now.toISOString() }))) return;
  for (const memberId of new Set(habit.members)) {
    if (memberId === fromId) continue;
    const to = await activeMember(familyId, memberId);
    if (to) await routePush(familyId, to, "lamp", () => ({ body: eventWords.habit(callName(from)), url: "/?push=habit#habit", tag: id, urgency: "normal" }), now);
  }
}

export async function pushSittingInvite(familyId: string, sitting: Sitting, now: Date): Promise<void> {
  const from = await activeMember(familyId, sitting.hostId);
  if (!from) return;
  for (const memberId of new Set(sitting.invites)) {
    if (memberId === from.id) continue;
    const to = await activeMember(familyId, memberId);
    if (to) await routePush(familyId, to, "ask", () => ({
      body: eventWords.sitting(callName(from), sitting.reason === "chai"),
      url: `/call/${encodeURIComponent(sitting.id)}`,
      tag: `sit-${sitting.id}`,
      urgency: "normal",
    }), now);
  }
}

export async function pushDoorJoined(familyId: string, door: { id: string; hostId: string }, fromId: string, now: Date = new Date()): Promise<void> {
  if (fromId === door.hostId) return;
  const [from, to] = await Promise.all([activeMember(familyId, fromId), activeMember(familyId, door.hostId)]);
  if (!from || !to) return;
  const id = `push-door-join:${door.id}:${fromId}`;
  if (!(await claimDoc(familyId, "push_claim", { id, until: now.toISOString() }))) return;
  await routePush(familyId, to, "ask", () => ({ body: eventWords.doorJoined(callName(from)), url: `/call/${encodeURIComponent(door.id)}`, tag: id, urgency: "high" }), now);
}

export async function pushCardActivity(familyId: string, card: { id: string; authorId: string | null }, fromId: string, kind: "reply" | "reaction", now: Date = new Date(), replyId?: string): Promise<void> {
  if (!card.authorId || card.authorId === fromId) return;
  const [from, to] = await Promise.all([activeMember(familyId, fromId), activeMember(familyId, card.authorId)]);
  if (!from || !to) return;
  const id = `push-card:${card.id}`;
  if (!(await claimPushCooldown(familyId, id, now, 3_600_000))) return;
  await routePush(familyId, to, "voice", () => ({ body: eventWords[kind](callName(from)), url: `/lane?card=${encodeURIComponent(replyId ?? card.id)}`, tag: id, urgency: "normal" }), now);
}

export async function pushFamilyJoined(familyId: string, fromId: string, now: Date = new Date()): Promise<void> {
  const from = await activeMember(familyId, fromId);
  if (!from) return;
  const id = `push-family-join:${fromId}`;
  if (!(await claimDoc(familyId, "push_claim", { id, until: now.toISOString() }))) return;
  for (const to of await dbListMembers(familyId)) {
    if (to.id !== fromId && (to.access === "owner" || to.access === "admin"))
      await routePush(familyId, to, "ask", () => ({ body: eventWords.familyJoined(callName(from)), url: `/people/${encodeURIComponent(fromId)}`, tag: id, urgency: "normal" }), now);
  }
}
