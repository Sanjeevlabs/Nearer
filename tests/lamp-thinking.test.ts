// "Thinking of you": the 2-hour glow, the push that reaches the other home (one per pair per 2 h,
// held for the morning in quiet hours), the 10-minute light cooldown, the inbox line, the "felt" receipt.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as inboxGet } from "@/app/api/inbox/route";
import { GET as lampGet, POST as lampPost } from "@/app/api/lamp/route";
import { dbUpdateMemberProfile } from "@/lib/db";
import { LAMP_GLOW_HOURS, LAMP_PUSH_GAP_MS, LIGHT_COOLDOWN_MS, glowFrom, lampPushedRecently, lightCooldownLeft } from "@/lib/lamp";
import { pushIdle } from "@/lib/push/background";
import { getPushSettings } from "@/lib/push/prefs";
import { clearOutbox, outbox } from "@/lib/push/send";
import { resetPushStore } from "@/lib/push/store";
import { resetDemo } from "@/lib/store";
import { authedGet, authedJson } from "./auth-helper";

const H = 3_600_000;
const M = 60_000;
// 16:00 UTC = noon in New York (arjun); 21:30 in India (dadi).
const NOON_NY = new Date("2026-10-28T16:00:00.000Z");
const NIGHT_NY = new Date("2026-10-28T05:00:00.000Z"); // 01:00 in New York
const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const light = (as: string) => lampPost(authedJson("http://t/api/lamp", { action: "light" }, as));
const toArjun = () => outbox.filter((o) => o.memberId === "arjun").map((o) => o.msg.body);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON_NY);
  resetDemo();
  await dbUpdateMemberProfile("arjun", { tz: "America/New_York" });
  resetPushStore();
  clearOutbox();
});
afterEach(() => vi.useRealTimers());

describe("the glow", () => {
  it("is full when lit, fades in a straight line, and is gone at 2 hours", () => {
    expect(LAMP_GLOW_HOURS).toBe(2);
    const t = Date.parse("2026-11-01T00:00:00Z");
    const lit = new Date(t).toISOString();
    expect(glowFrom(lit, t)).toBe(1);
    expect(glowFrom(lit, t + 30 * M)).toBe(0.75);
    expect(glowFrom(lit, t + H)).toBe(0.5);
    expect(glowFrom(lit, t + 90 * M)).toBe(0.25);
    expect(glowFrom(lit, t + 2 * H)).toBe(0);
    expect(glowFrom(lit, t + 24 * H)).toBe(0);
    expect(glowFrom(null, t)).toBe(0);
  });
});

describe("the throttles (pure)", () => {
  it("one light per person per 10 minutes", () => {
    const now = Date.parse("2026-11-01T10:00:00Z");
    const lit = { dadi: new Date(now - 4 * M).toISOString() };
    expect(lightCooldownLeft(lit, "dadi", now)).toBe(6 * M);
    expect(lightCooldownLeft(lit, "arjun", now)).toBe(0);
    expect(lightCooldownLeft(lit, "dadi", now + 7 * M)).toBe(0);
    expect(LIGHT_COOLDOWN_MS).toBe(10 * M);
  });
  it("one lamp push per sender and recipient per 2 hours", () => {
    const now = Date.parse("2026-11-01T10:00:00Z");
    const pushed = { "dadi>arjun": new Date(now - 119 * M).toISOString() };
    expect(lampPushedRecently(pushed, "dadi", "arjun", now)).toBe(true);
    expect(lampPushedRecently(pushed, "dadi", "arjun", now + 2 * M)).toBe(false);
    expect(lampPushedRecently(pushed, "arjun", "dadi", now)).toBe(false);
    expect(LAMP_PUSH_GAP_MS).toBe(2 * H);
  });
});

describe("lighting the lamp reaches the other home", () => {
  it("pushes 'Maa is thinking of you', and a second tap inside 10 minutes does nothing", async () => {
    expect((await light("dadi")).status).toBe(200);
    vi.setSystemTime(new Date(NOON_NY.getTime() + 3 * M));
    const again = await json<{ throttled?: boolean; retryInSeconds?: number }>(light("dadi"));
    await pushIdle();
    expect(again.throttled).toBe(true);
    expect(again.retryInSeconds).toBeGreaterThan(0);
    expect(toArjun()).toEqual(["Maa is thinking of you"]);
  });

  it("pushes at most once per pair in 2 hours, then again after", async () => {
    await light("dadi");
    vi.setSystemTime(new Date(NOON_NY.getTime() + 11 * M));
    await light("dadi"); // allowed by the 10-minute rule, but the push is inside the 2 hours
    await pushIdle();
    expect(toArjun()).toHaveLength(1);
    vi.setSystemTime(new Date(NOON_NY.getTime() + 2 * H + M));
    await light("dadi");
    await pushIdle();
    expect(toArjun()).toHaveLength(2);
  });

  it("holds the push for the morning summary in quiet hours (01:00 where they are)", async () => {
    vi.setSystemTime(NIGHT_NY);
    await light("dadi");
    await pushIdle();
    expect(toArjun()).toEqual([]);
    expect((await getPushSettings("demo-family", "arjun")).overflow).toBe(1);
  });

  it("a heartbeat and a light share the same 2-hour push rule", async () => {
    await lampPost(authedJson("http://t/api/lamp", { action: "beat", toMemberId: "arjun" }, "dadi"));
    vi.setSystemTime(new Date(NOON_NY.getTime() + 11 * M));
    await light("dadi");
    await pushIdle();
    expect(toArjun()).toHaveLength(1);
  });
});

describe("what the recipient and the sender see", () => {
  it("the recipient's inbox says who lit it and when; opening it tells the sender 'felt'", async () => {
    await light("dadi");
    const inbox = await json<{ items: { kind: string; text: string; waiting: boolean }[] }>(inboxGet(authedGet("http://t/api/inbox", "arjun")));
    const item = inbox.items.find((i) => i.kind === "lamp");
    expect(item?.text).toBe("Maa lit the lamp for you · 12:00 PM");
    expect(item?.waiting).toBe(true);

    const seen = async (as: string) => (await json<{ felt: { by: string; at: string } | null }>(lampGet(authedGet("http://t/api/lamp", as)))).felt;
    expect(await seen("dadi")).toBeNull();
    vi.setSystemTime(new Date(NOON_NY.getTime() + 14 * M));
    expect((await lampPost(authedJson("http://t/api/lamp", { action: "felt" }, "arjun"))).status).toBe(200);
    expect(await seen("dadi")).toMatchObject({ by: "arjun", at: new Date(NOON_NY.getTime() + 14 * M).toISOString() });

    const after = await json<{ items: { kind: string; waiting: boolean }[] }>(inboxGet(authedGet("http://t/api/inbox", "arjun")));
    expect(after.items.find((i) => i.kind === "lamp")?.waiting).toBe(false);
  });

  it("someone who was asleep still gets the arrival 10 hours later, with the glow gone", async () => {
    await light("dadi");
    vi.setSystemTime(new Date(NOON_NY.getTime() + 10 * H));
    const v = await json<{ arrived: { from: string } | null; lamps: { litBy: string | null; glow: number }[] }>(lampGet(authedGet("http://t/api/lamp", "arjun")));
    expect(v.arrived).toMatchObject({ from: "dadi" });
    expect(v.lamps.find((l) => l.litBy === "dadi")?.glow).toBe(0);
  });
});
