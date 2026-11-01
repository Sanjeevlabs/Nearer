// The daily purge: expired ephemeral rows go, live ones stay, a second run
// finds nothing, and the API that serves each row stops serving it once its
// TTL has passed (a fake clock, no waiting).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as dayLineGET } from "@/app/api/day-line/route";
import { GET as safetyGET } from "@/app/api/safety/route";
import { GET as sitGET } from "@/app/api/sit/route";
import { dbAddSuggestion, dbListSuggestions } from "@/lib/db";
import { listDocs, putDoc } from "@/lib/family-docs";
import { dismiss, listDismissed } from "@/lib/gather-store";
import { purgeExpired, TTL } from "@/lib/purge";
import { expireCheckin, OPEN_TTL_MS, stateOf } from "@/lib/safety";
import { resetDemo } from "@/lib/store";
import { authedGet } from "./auth-helper";

const FAM = "demo-family";
const T0 = new Date("2026-10-28T09:00:00.000Z");
const plus = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const H = 3_600_000;
const D = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  resetDemo();
});
afterEach(() => vi.useRealTimers());

const ids = async (kind: "knock" | "nudge" | "day_line" | "sitting" | "muse_call" | "presence") => (await listDocs(FAM, kind)).map((d) => d.id);

describe("purgeExpired", () => {
  it("removes each expired kind and keeps the live ones", async () => {
    await putDoc(FAM, "knock", { id: "k-old", memberId: "arjun", note: "", at: plus(-2 * H), until: plus(-H) });
    await putDoc(FAM, "knock", { id: "k-live", memberId: "arjun", note: "", at: plus(-H), until: plus(H) });
    // Delivered 31 days ago goes, delivered 5 days ago stays, never delivered and 31 days old goes.
    const nudge = (id: string, at: string, deliveredAt: string | null) => ({ id, toMemberId: "arjun", kind: "heard", text: "x", href: "/", at, deliverAfter: at, deliveredAt, channel: deliveredAt ? "inapp" : null, seenAt: null });
    await putDoc(FAM, "nudge", nudge("n-old", plus(-32 * D), plus(-31 * D)));
    await putDoc(FAM, "nudge", nudge("n-new", plus(-6 * D), plus(-5 * D)));
    await putDoc(FAM, "nudge", nudge("n-stuck", plus(-31 * D), null));
    await putDoc(FAM, "day_line", { id: "arjun", memberId: "arjun", text: "Old", until: plus(-H), createdAt: plus(-20 * H) });
    await putDoc(FAM, "day_line", { id: "kavya", memberId: "kavya", text: "Live", until: plus(5 * H), createdAt: plus(-H) });
    const sit = (id: string, startsAt: string) => ({ id, reason: "chai", title: "Chai", hostId: "arjun", startsAt, createdAt: plus(-9 * D) });
    await putDoc(FAM, "sitting", sit("s-old", plus(-8 * D)));
    await putDoc(FAM, "sitting", sit("s-recent", plus(-D)));
    const call = (id: string, at: string) => ({ id, purpose: "p", model: "m", at });
    await putDoc(FAM, "muse_call", call("m-old", plus(-91 * D)));
    await putDoc(FAM, "muse_call", call("m-new", plus(-89 * D)));
    const pres = (id: string, at: string) => ({ id, memberId: "arjun", moment: "here", at });
    await putDoc(FAM, "presence", pres("p-old", plus(-16 * D)));
    await putDoc(FAM, "presence", pres("p-new", plus(-14 * D)));

    const out = await purgeExpired(FAM, T0);
    expect(out.knocks).toBeGreaterThanOrEqual(1);
    expect(out.dayLines).toBeGreaterThanOrEqual(1);
    expect(out.nudges).toBeGreaterThanOrEqual(2);
    expect(await ids("knock")).toContain("k-live");
    expect(await ids("knock")).not.toContain("k-old");
    const nudges = await ids("nudge");
    expect(nudges).toContain("n-new");
    expect(nudges).not.toContain("n-old");
    expect(nudges).not.toContain("n-stuck");
    expect(await ids("day_line")).toContain("kavya");
    expect(await ids("day_line")).not.toContain("arjun");
    expect(await ids("sitting")).not.toContain("s-old");
    expect(await ids("sitting")).toContain("s-recent");
    expect(await ids("muse_call")).toContain("m-new");
    expect(await ids("muse_call")).not.toContain("m-old");
    expect(await ids("presence")).not.toContain("p-old");
    expect(await ids("presence")).toContain("p-new");
    // Idempotent: a second run finds nothing.
    expect(Object.values(await purgeExpired(FAM, T0)).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("closes an open check-in older than 48 h as no reply, and leaves a fresh one open", async () => {
    await putDoc(FAM, "safety_checkin", { id: "c-stale", memberId: "arjun", kind: "heading", etaAt: plus(-47 * H), closedAt: null, location: null, at: plus(-49 * H) });
    await putDoc(FAM, "safety_checkin", { id: "c-help", memberId: "kavya", kind: "help", etaAt: null, closedAt: null, location: { lat: 1, lng: 2, accuracy: 3, at: plus(-49 * H) }, at: plus(-49 * H) });
    await putDoc(FAM, "safety_checkin", { id: "c-fresh", memberId: "leo", kind: "heading", etaAt: plus(H), closedAt: null, location: null, at: plus(-H) });
    const out = await purgeExpired(FAM, T0);
    expect(out.checkinsClosed).toBe(2);
    const all = await listDocs(FAM, "safety_checkin");
    expect(all.find((c) => c.id === "c-stale")).toMatchObject({ noReply: true, closedAt: plus(-H) });
    expect(all.find((c) => c.id === "c-help")).toMatchObject({ noReply: true, location: null });
    expect(all.find((c) => c.id === "c-fresh")?.closedAt).toBeNull();
    expect(stateOf(all, "arjun", T0.getTime())).toMatchObject({ tone: "calm", label: "No reply" });
  });

  it("deletes closed check-ins after 30 days, and withdraws a pending suggestion nobody answered", async () => {
    await putDoc(FAM, "safety_checkin", { id: "c-done", memberId: "arjun", kind: "home-safe", etaAt: null, closedAt: plus(-31 * D), location: null, at: plus(-31 * D) });
    const s = await dbAddSuggestion({ goal: "old", payload: {}, familyId: FAM });
    vi.setSystemTime(new Date(Date.now() + TTL.suggestionMs + D));
    const out = await purgeExpired(FAM, new Date());
    expect(out.checkinsDeleted).toBe(1);
    expect(out.suggestionsWithdrawn).toBeGreaterThanOrEqual(1);
    expect((await dbListSuggestions(undefined, FAM)).find((x) => x.id === s.id)?.status).toBe("rejected");
  });

  it("drops an event dismissal once its date has passed, keeps a coming one", async () => {
    await dismiss(FAM, "arjun", "suggest:diwali:all:2026-10-20");
    await dismiss(FAM, "arjun", "suggest:diwali:all:2026-11-08");
    const out = await purgeExpired(FAM, T0);
    expect(out.eventDismissals).toBe(1);
    expect(await listDismissed(FAM, "arjun")).toEqual(["suggest:diwali:all:2026-11-08"]);
  });

  it("trims lamp heartbeats past their 2-day life", async () => {
    await putDoc(FAM, "lamp", { id: "home-x", litAt: null, litBy: null, beats: [{ from: "arjun", at: plus(-3 * D) }, { from: "arjun", at: plus(-H) }], felt: {}, updatedAt: plus(-H) });
    expect((await purgeExpired(FAM, T0)).lampBeats).toBe(1);
    expect((await listDocs(FAM, "lamp")).find((l) => l.id === "home-x")?.beats).toHaveLength(1);
  });
});

describe("staleness: the API stops serving a row once its TTL has passed (no purge needed)", () => {
  it("knock: gone at its `until`", async () => {
    await putDoc(FAM, "knock", { id: "k1", memberId: "kavya", note: "", at: T0.toISOString(), until: plus(45 * 60_000) });
    const read = async () => ((await (await sitGET(authedGet("http://t/api/sit", "arjun"))).json()) as { knocks: { id: string }[] }).knocks.map((k) => k.id);
    expect(await read()).toContain("k1");
    vi.setSystemTime(plus(46 * 60_000));
    expect(await read()).not.toContain("k1");
  });

  it("sitting: gone 3 hours after it starts", async () => {
    await putDoc(FAM, "sitting", { id: "s1", reason: "chai", title: "Chai", hostId: "kavya", startsAt: plus(H), createdAt: T0.toISOString() });
    const read = async () => ((await (await sitGET(authedGet("http://t/api/sit", "arjun"))).json()) as { sittings: { id: string }[] }).sittings.map((s) => s.id);
    expect(await read()).toContain("s1");
    vi.setSystemTime(plus(H + 3 * H + 60_000));
    expect(await read()).not.toContain("s1");
  });

  it("day line: gone at the end of its author's day", async () => {
    await putDoc(FAM, "day_line", { id: "kavya", memberId: "kavya", text: "At the temple", until: plus(6 * H), createdAt: T0.toISOString() });
    const read = async () => ((await (await dayLineGET(authedGet("http://t/api/day-line", "arjun"))).json()) as { lines: { memberId: string }[] }).lines.map((l) => l.memberId);
    expect(await read()).toContain("kavya");
    vi.setSystemTime(plus(6 * H + 1000));
    expect(await read()).not.toContain("kavya");
  });

  it("open check-in: reads as closed no reply 48 h on (safe & sound API)", async () => {
    await putDoc(FAM, "safety_settings", { id: "kavya", memberId: "kavya", enabled: true, watchers: ["arjun"], paused: false, updatedAt: T0.toISOString() });
    await putDoc(FAM, "safety_checkin", { id: "c1", memberId: "kavya", kind: "heading", etaAt: plus(H), closedAt: null, location: null, at: T0.toISOString() });
    type Data = { members: { memberId: string; tone: string | null; label: string | null }[] };
    const read = async () => ((await (await safetyGET(authedGet("http://t/api/safety", "arjun"))).json()) as Data).members.find((m) => m.memberId === "kavya");
    vi.setSystemTime(plus(3 * H));
    expect(await read()).toMatchObject({ tone: "overdue" });
    vi.setSystemTime(plus(OPEN_TTL_MS + 60_000));
    expect(await read()).toMatchObject({ tone: "calm", label: "No reply" });
    const open = { id: "z", memberId: "kavya", kind: "help" as const, note: "", etaAt: null, closedAt: null, noReply: false, location: null, at: T0.toISOString() };
    expect(expireCheckin(open, T0.getTime() + OPEN_TTL_MS - 1).closedAt).toBeNull();
  });
});
