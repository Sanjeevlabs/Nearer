// The morning lamp is the parent's "I'm okay": the first lamp or moment of the day counts; if it has not
// come by their usual time + 2 h, the far child gets one gentle invitation (never an alarm, never at night,
// once a day), from the 15-minute sweep.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sweepGet } from "@/app/api/push/sweep/route";
import { POST as lampPost } from "@/app/api/lamp/route";
import { dbUpdateMemberProfile } from "@/lib/db";
import { deleteDoc, listDocs, putDoc } from "@/lib/family-docs";
import { morningCheck } from "@/lib/morning";
import { pushIdle } from "@/lib/push/background";
import { sweepQuietMornings } from "@/lib/push/morning";
import { clearOutbox, outbox } from "@/lib/push/send";
import { resetPushStore } from "@/lib/push/store";
import { resetDemo } from "@/lib/store";
import { authedJson } from "./auth-helper";

const FAM = "demo-family";
const KOLKATA = "Asia/Kolkata";
// 13:00 UTC: 18:30 in Kolkata (dadi), 09:00 in New York (arjun).
const LATE_AFTERNOON = new Date("2026-10-28T13:00:00.000Z");
// 03:00 UTC: 08:30 in Kolkata, 23:00 the night before in New York.
const EARLY_IN = new Date("2026-10-28T03:00:00.000Z");
const at = (day: string, utc: string) => `${day}T${utc}:00.000Z`;
const pres = (memberId: string, iso: string) => ({ id: `p-${memberId}-${iso}`, memberId, moment: "awake" as const, note: "", at: iso });
// Dadi's habit: first moment about 07:00 in Kolkata (01:30 UTC), five days running.
const HABIT = ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"].map((d) => pres("dadi", at(d, "01:30")));

describe("morningCheck (pure)", () => {
  const base = { parentId: "dadi", tz: KOLKATA, shareVisits: true } as const;
  it("a moment today is the day's check-in", () => {
    const v = morningCheck({ ...base, presence: [...HABIT, pres("dadi", at("2026-10-28", "02:00"))], now: LATE_AFTERNOON });
    expect(v.verdict).toBe("checked-in");
  });
  it("a lamp lit today counts too", () => {
    expect(morningCheck({ ...base, presence: HABIT, signals: [at("2026-10-28", "02:10")], now: LATE_AFTERNOON }).verdict).toBe("checked-in");
  });
  it("uses the median of the last 14 days, +2 h: quiet only after 09:00 for a 07:00 riser", () => {
    const early = morningCheck({ ...base, presence: HABIT, now: new Date("2026-10-28T03:00:00.000Z") }); // 08:30
    expect(early).toMatchObject({ verdict: "early", usualHour: 7, dueHour: 9 });
    expect(morningCheck({ ...base, presence: HABIT, now: new Date("2026-10-28T04:00:00.000Z") }).verdict).toBe("quiet"); // 09:30
  });
  it("defaults to 9 AM + 2 h when there are fewer than three days of rhythm", () => {
    const two = [pres("dadi", at("2026-10-26", "01:30")), pres("dadi", at("2026-10-27", "01:30"))];
    const r = morningCheck({ ...base, presence: two, now: new Date("2026-10-28T05:00:00.000Z") }); // 10:30
    expect(r).toMatchObject({ verdict: "early", usualHour: 9, dueHour: 11 });
    expect(morningCheck({ ...base, presence: two, now: new Date("2026-10-28T06:00:00.000Z") }).verdict).toBe("quiet"); // 11:30
  });
  it("says nothing about someone with no habit, someone who keeps visits private, or the late evening", () => {
    expect(morningCheck({ ...base, presence: [], now: LATE_AFTERNOON }).verdict).toBe("no-habit");
    expect(morningCheck({ ...base, presence: HABIT, shareVisits: false, now: LATE_AFTERNOON }).verdict).toBe("private");
    expect(morningCheck({ ...base, presence: HABIT, now: new Date("2026-10-28T16:00:00.000Z") }).verdict).toBe("night"); // 21:30
  });
  it("ignores other people's moments and anything older than 14 days", () => {
    const old = ["2026-09-01", "2026-09-02", "2026-09-03"].map((d) => pres("dadi", at(d, "01:30")));
    expect(morningCheck({ ...base, presence: [...old, pres("arjun", at("2026-10-28", "02:00"))], now: LATE_AFTERNOON }).verdict).toBe("no-habit");
  });
});

describe("the sweep", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LATE_AFTERNOON);
    resetDemo();
    resetPushStore();
    clearOutbox();
    await dbUpdateMemberProfile("arjun", { tz: "America/New_York" });
    await dbUpdateMemberProfile("dadi", { tz: KOLKATA });
    for (const p of await listDocs(FAM, "presence")) if (p.memberId === "dadi") await deleteDoc(FAM, "presence", p.id);
    for (const p of HABIT) await putDoc(FAM, "presence", p);
  });
  afterEach(() => vi.useRealTimers());

  const invites = () => outbox.filter((o) => o.msg.tag === "quiet-dadi");

  it("invites the far child once: 'Maa's been quiet this morning. Send a voice note?'", async () => {
    const n = await sweepQuietMornings(FAM, LATE_AFTERNOON);
    expect(n).toBeGreaterThan(0);
    const mine = invites().find((o) => o.memberId === "arjun");
    expect(mine?.msg).toMatchObject({ body: "Maa's been quiet this morning. Send a voice note?", url: "/", urgency: "normal" });
    clearOutbox();
    expect(await sweepQuietMornings(FAM, new Date(LATE_AFTERNOON.getTime() + 15 * 60_000))).toBe(0);
    expect(invites()).toEqual([]);
  });

  it("is also what the cron route runs", async () => {
    process.env.CRON_SECRET = "s";
    const res = await sweepGet(new Request("http://t/api/push/sweep", { headers: { authorization: "Bearer s" } }));
    expect(((await res.json()) as { invited: number }).invited).toBeGreaterThan(0);
    delete process.env.CRON_SECRET;
  });

  it("stays quiet when the parent lit the lamp today", async () => {
    vi.setSystemTime(new Date("2026-10-28T02:00:00.000Z")); // 07:30 in Kolkata
    expect((await lampPost(authedJson("http://t/api/lamp", { action: "light" }, "dadi"))).status).toBe(200);
    await pushIdle();
    vi.setSystemTime(LATE_AFTERNOON);
    clearOutbox();
    expect(await sweepQuietMornings(FAM, LATE_AFTERNOON)).toBe(0);
    expect(invites()).toEqual([]);
  });

  it("the parent's first lamp each day is recorded as a moment, once", async () => {
    vi.setSystemTime(new Date("2026-10-28T02:00:00.000Z"));
    await lampPost(authedJson("http://t/api/lamp", { action: "light" }, "dadi"));
    vi.setSystemTime(new Date("2026-10-28T02:30:00.000Z"));
    await lampPost(authedJson("http://t/api/lamp", { action: "light" }, "dadi"));
    const today = (await listDocs(FAM, "presence")).filter((p) => p.memberId === "dadi" && p.at.startsWith("2026-10-28"));
    expect(today).toHaveLength(1);
    expect(today[0].moment).toBe("thinking");
  });

  it("never at night: the child asleep (23:00) hears nothing, and no mark is left so a later sweep can still invite", async () => {
    // 04:00 UTC: 09:30 in Kolkata (past 09:00), 00:00 in New York.
    const t = new Date("2026-10-28T04:00:00.000Z");
    expect(await sweepQuietMornings(FAM, t)).toBe(0);
    expect(invites().find((o) => o.memberId === "arjun")).toBeUndefined();
    expect(await listDocs(FAM, "sweep_mark")).toEqual([]);
    expect(await sweepQuietMornings(FAM, LATE_AFTERNOON)).toBeGreaterThan(0);
  });

  it("not before their usual time + 2 h", async () => {
    expect(await sweepQuietMornings(FAM, EARLY_IN)).toBe(0);
  });

  it("respects a parent who keeps visits private, and a chosen person overrides the default", async () => {
    await putDoc(FAM, "care_settings", { id: "dadi", memberId: "dadi", quietAlert: false, tellMemberId: null, graceHours: 3, shareVisits: false, updatedAt: LATE_AFTERNOON.toISOString() });
    expect(await sweepQuietMornings(FAM, LATE_AFTERNOON)).toBe(0);
    await putDoc(FAM, "care_settings", { id: "dadi", memberId: "dadi", quietAlert: true, tellMemberId: "priya", graceHours: 3, shareVisits: true, updatedAt: LATE_AFTERNOON.toISOString() });
    await dbUpdateMemberProfile("priya", { tz: "America/New_York" });
    await sweepQuietMornings(FAM, LATE_AFTERNOON);
    expect(invites().map((o) => o.memberId)).toEqual(["priya"]);
  });
});
