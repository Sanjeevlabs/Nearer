// Together habits: the wording, one tick per person per local day, who may do
// what, the courtyard slice, the daily purge, the nudge and the letter's words.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as courtyardGET } from "@/app/api/courtyard/route";
import { GET as habitsGET, POST as habitsPOST } from "@/app/api/habits/route";
import { dbUpdateMemberProfile } from "@/lib/db";
import { deleteDoc, listDocs, putDoc } from "@/lib/family-docs";
import { habitCan, habitData, habitLine, habitWeekFacts, dayIn, doneLabel, everyoneDone, tickId, timeLabel, todaysTicks, habitTitle } from "@/lib/habits";
import { DOC_SCHEMAS } from "@/lib/kinds";
import { purgeExpired, TTL } from "@/lib/purge";
import { resetDemo } from "@/lib/store";
import { gatherWeekFacts } from "@/lib/weekly-letter";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
const URL = "http://localhost/api/habits";
const D = 86_400_000;
// Wed 28 Oct 2026, 04:00 UTC = 09:30 IST, and 00:00 in New York (EDT).
const T0 = new Date("2026-10-28T04:00:00.000Z");

const post = (memberId: string, body: unknown) => habitsPOST(authedJson(URL, body, memberId));
const get = async (memberId: string) => (await (await habitsGET(authedGet(URL, memberId))).json()) as ReturnType<typeof habitData>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  resetDemo();
});
afterEach(() => vi.useRealTimers());

const j = (id: string, name: string) => ({ id, name });
const four = [j("arjun", "Arjun"), j("dadi", "Maa"), j("dada", "Papa"), j("priya", "Priya")];

describe("habitLine: words only", () => {
  const line = (viewerId: string, joined: { id: string; name: string }[], tickedIds: string[], habitName = "Morning walk") => habitLine({ habitName, viewerId, joined, tickedIds });
  it("reads as the owner wrote it", () => {
    expect(line("arjun", four, ["dadi", "priya"])).toBe("Maa and Priya walked today");
    expect(line("arjun", four, ["arjun"])).toBe("Just you so far today");
    expect(line("arjun", four, [])).toBe("Nobody yet today");
    expect(line("arjun", [...four, j("kavya", "Kavya")], [...four.map((x) => x.id), "kavya"])).toBe("All five of you walked today");
  });
  it("covers the other shapes", () => {
    expect(line("arjun", four, ["arjun", "dadi"])).toBe("You and Maa walked today");
    expect(line("arjun", four, ["dadi"])).toBe("Maa walked today");
    expect(line("arjun", four, ["dadi", "dada", "priya"])).toBe("Maa, Papa and Priya walked today");
    expect(line("arjun", four, ["arjun", "dadi", "dada"])).toBe("You, Maa and Papa walked today");
    expect(line("arjun", four, ["arjun", "dadi", "dada", "priya"])).toBe("All four of you walked today");
    expect(line("arjun", four.slice(0, 2), ["arjun", "dadi"])).toBe("Both of you walked today");
    // Only one person in, and they did it: that is "Just you", not "all of you".
    expect(line("arjun", four.slice(0, 1), ["arjun"])).toBe("Just you so far today");
    // The viewer has not joined, the others all did it.
    expect(line("kavya", four.slice(1, 3), ["dadi", "dada"])).toBe("Everyone walked today");
    // Many: the first two, then others.
    const many = ["a", "b", "c", "d", "e"].map((x) => j(x, x.toUpperCase()));
    expect(line("arjun", many, ["a", "b", "c", "d"])).toBe("A, B and others walked today");
  });
  it("a habit that is not a walk says 'did it'", () => {
    expect(line("arjun", four, ["dadi", "priya"], "Evening prayers")).toBe("Maa and Priya did it today");
    expect(doneLabel("Evening prayers")).toBe("Done today ✓");
  });
  it("never carries a digit, a streak or a day count", () => {
    for (const ids of [[], ["arjun"], ["dadi"], ["dadi", "priya"], ["arjun", "dadi", "dada", "priya"]]) expect(line("arjun", four, ids)).not.toMatch(/\d|streak|day[s ]|in a row/i);
  });
  it("titles and labels", () => {
    expect(timeLabel(7, 0)).toBe("7 AM");
    expect(timeLabel(7, 30)).toBe("7:30 AM");
    expect(timeLabel(0, 5)).toBe("12:05 AM");
    expect(timeLabel(12, 0)).toBe("12 PM");
    expect(timeLabel(19, 0)).toBe("7 PM");
    expect(habitTitle({ name: "Morning walk", hour: 7, minute: 0 })).toBe("Morning walk · 7 AM");
    expect(doneLabel("Morning walk")).toBe("Walked today ✓");
  });
});

describe("the schema", () => {
  it("is a kind with a bounded name and a one-row-per-day tick id", () => {
    expect(Object.keys(DOC_SCHEMAS)).toEqual(expect.arrayContaining(["habit", "habit_tick"]));
    const ok = { id: "h1", name: "Morning walk", hour: 7, minute: 0, createdBy: "dadi", createdAt: T0.toISOString(), members: [], archivedAt: null };
    expect(DOC_SCHEMAS.habit.safeParse(ok).success).toBe(true);
    expect(DOC_SCHEMAS.habit.safeParse({ ...ok, name: "x".repeat(41) }).success).toBe(false);
    expect(DOC_SCHEMAS.habit.safeParse({ ...ok, hour: 24 }).success).toBe(false);
    expect(DOC_SCHEMAS.habit_tick.safeParse({ id: tickId("h1", "dadi", "2026-10-28"), habitId: "h1", memberId: "dadi", day: "28-10-2026", at: T0.toISOString() }).success).toBe(false);
  });
});

describe("POST /api/habits", () => {
  it("the demo family starts with the walk, and Arjun reads 'Maa and Priya walked today'", async () => {
    const d = await get("arjun");
    expect(d.habit?.name).toBe("Morning walk");
    expect(d.habit?.members).toEqual(["dadi", "dada", "arjun", "priya"]);
    expect(d.me).toEqual({ joined: true, ticked: false });
    expect(d.today.map((t) => t.memberId).sort()).toEqual(["dadi", "priya"]);
    const names: Record<string, string> = { dadi: "Maa", priya: "Priya" };
    expect(habitLine({ habitName: d.habit!.name, viewerId: "arjun", joined: d.habit!.members.map((id) => ({ id, name: names[id] ?? id })), tickedIds: d.today.map((t) => t.memberId) })).toBe("Maa and Priya walked today");
  });

  it("a double tap is one tick (claimDoc), and untick takes it back", async () => {
    const first = await post("arjun", { action: "tick", habitId: "habit-morning-walk" });
    const again = await post("arjun", { action: "tick", habitId: "habit-morning-walk" });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    const mine = (await listDocs(FAM, "habit_tick")).filter((t) => t.memberId === "arjun");
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe("habit-morning-walk:arjun:2026-10-28");
    expect((await get("arjun")).me.ticked).toBe(true);
    await post("arjun", { action: "untick", habitId: "habit-morning-walk" });
    expect((await listDocs(FAM, "habit_tick")).filter((t) => t.memberId === "arjun")).toHaveLength(0);
    expect((await get("arjun")).me.ticked).toBe(false);
  });

  it("you tick for yourself only, and only once you have joined", async () => {
    const out = await post("kavya", { action: "tick", habitId: "habit-morning-walk" });
    expect(out.status).toBe(409);
    expect(await listDocs(FAM, "habit_tick").then((l) => l.some((t) => t.memberId === "kavya"))).toBe(false);
    // A memberId in the body is not even part of the schema; the tick is the session's.
    await post("kavya", { action: "join", habitId: "habit-morning-walk" });
    await post("kavya", { action: "tick", habitId: "habit-morning-walk", memberId: "arjun" });
    const ticks = await listDocs(FAM, "habit_tick");
    expect(ticks.some((t) => t.memberId === "kavya")).toBe(true);
    expect(ticks.filter((t) => t.memberId === "arjun")).toHaveLength(0);
  });

  it("validates every write", async () => {
    expect((await post("arjun", { action: "nope" })).status).toBe(400);
    expect((await post("arjun", { action: "rename", habitId: "habit-morning-walk", name: "x".repeat(41) })).status).toBe(400);
    expect((await post("arjun", { action: "rename", habitId: "habit-morning-walk", name: "   " })).status).toBe(400);
    expect((await post("arjun", { action: "retime", habitId: "habit-morning-walk", hour: 25, minute: 0 })).status).toBe(400);
    expect((await post("arjun", { action: "tick", habitId: "missing" })).status).toBe(404);
    expect((await habitsPOST(new Request(URL, { method: "POST", body: "{" }))).status).toBe(401);
  });

  it("permissions: children join and tick but do not start, rename or archive; archive is the creator or an admin", async () => {
    expect(habitCan("create", { id: "aria", role: "child", access: "child", status: "active" })).toBe(false);
    expect(habitCan("join", { id: "aria", role: "child", access: "child", status: "active" })).toBe(true);
    expect(habitCan("tick", { id: "aria", role: "child", access: "child", status: "active" })).toBe(true);
    expect(habitCan("tick", { id: "x", role: "adult", access: "member", status: "pending" })).toBe(false);
    // Aria joins and ticks.
    expect((await post("aria", { action: "join", habitId: "habit-morning-walk" })).status).toBe(200);
    expect((await post("aria", { action: "tick", habitId: "habit-morning-walk" })).status).toBe(200);
    expect((await post("aria", { action: "rename", habitId: "habit-morning-walk", name: "Run" })).status).toBe(403);
    expect((await post("aria", { action: "retime", habitId: "habit-morning-walk", hour: 6, minute: 0 })).status).toBe(403);
    expect((await post("aria", { action: "archive", habitId: "habit-morning-walk" })).status).toBe(403);
    // Priya is a grown-up but neither the creator (Maa) nor an admin.
    expect((await post("priya", { action: "rename", habitId: "habit-morning-walk", name: "Dawn walk" })).status).toBe(200);
    expect((await post("priya", { action: "archive", habitId: "habit-morning-walk" })).status).toBe(403);
    expect((await get("arjun")).habit?.name).toBe("Dawn walk");
    expect((await post("priya", { action: "retime", habitId: "habit-morning-walk", hour: 6, minute: 30 })).status).toBe(200);
    expect((await get("arjun")).habit).toMatchObject({ hour: 6, minute: 30 });
    // Maa made it: she can archive. After that, anyone grown-up can start a new one, once.
    expect((await post("dadi", { action: "archive", habitId: "habit-morning-walk" })).status).toBe(200);
    expect((await get("arjun")).habit).toBeNull();
    expect((await post("aria", { action: "create" })).status).toBe(403);
    expect((await post("priya", { action: "create" })).status).toBe(201);
    expect((await post("arjun", { action: "create" })).status).toBe(409);
    const made = await get("priya");
    expect(made.habit).toMatchObject({ name: "Morning walk", hour: 7, minute: 0, createdBy: "priya", members: ["priya"] });
  });

  it("an admin who did not start it can archive it", async () => {
    expect((await post("arjun", { action: "archive", habitId: "habit-morning-walk" })).status).toBe(200);
  });

  it("join and leave are one write each and idempotent", async () => {
    await post("kavya", { action: "join", habitId: "habit-morning-walk" });
    await post("kavya", { action: "join", habitId: "habit-morning-walk" });
    expect((await get("kavya")).habit?.members.filter((m) => m === "kavya")).toHaveLength(1);
    await post("kavya", { action: "leave", habitId: "habit-morning-walk" });
    await post("kavya", { action: "leave", habitId: "habit-morning-walk" });
    expect((await get("kavya")).me.joined).toBe(false);
  });
});

describe("a person's own day", () => {
  it("India and New York each tick their own 'today'", async () => {
    await dbUpdateMemberProfile("priya", { tz: "America/New_York" });
    // 04:00 UTC: 29 Oct has not come yet in New York (00:00 on the 28th), and it is 28 Oct 09:30 in India.
    expect(dayIn("Asia/Kolkata", T0)).toBe("2026-10-28");
    expect(dayIn("America/New_York", T0)).toBe("2026-10-28");
    // 20:00 UTC: 01:30 on the 29th in India, 16:00 on the 28th in New York.
    vi.setSystemTime(new Date("2026-10-28T20:00:00.000Z"));
    await post("arjun", { action: "tick", habitId: "habit-morning-walk" });
    await post("priya", { action: "tick", habitId: "habit-morning-walk" });
    const ticks = await listDocs(FAM, "habit_tick");
    expect(ticks.find((t) => t.memberId === "arjun")?.day).toBe("2026-10-29");
    expect(ticks.find((t) => t.memberId === "priya")?.day).toBe("2026-10-28");
    // Both of those count as "today" for each of them right now.
    const d = await get("arjun");
    expect(d.today.map((t) => `${t.memberId}:${t.day}`)).toEqual(expect.arrayContaining(["arjun:2026-10-29", "priya:2026-10-28"]));
    // The seeded 'dadi today' (28th, India) is yesterday for her now: she is not in today's line.
    expect(d.today.some((t) => t.memberId === "dadi")).toBe(false);
    // 03:00 UTC on the 29th: still the 28th in New York, 08:30 on the 29th in India.
    vi.setSystemTime(new Date("2026-10-29T03:00:00.000Z"));
    expect((await get("priya")).today.some((t) => t.memberId === "priya")).toBe(true);
    // 05:00 UTC on the 29th: New York is on the 29th now, so Priya's 28th tick is yesterday.
    vi.setSystemTime(new Date("2026-10-29T05:00:00.000Z"));
    expect((await get("priya")).today.some((t) => t.memberId === "priya")).toBe(false);
    expect((await get("priya")).me.ticked).toBe(false);
  });

  it("todaysTicks ignores people who left or never joined", () => {
    const members = [{ id: "a", tz: "Asia/Kolkata", status: "active" as const }, { id: "b", tz: "Asia/Kolkata", status: "active" as const }];
    const ticks = [{ habitId: "h", memberId: "a", day: "2026-10-28", at: T0.toISOString() }, { habitId: "h", memberId: "b", day: "2026-10-28", at: T0.toISOString() }, { habitId: "other", memberId: "a", day: "2026-10-28", at: T0.toISOString() }];
    expect(todaysTicks({ id: "h", members: ["a"] }, ticks, members, T0).map((t) => t.memberId)).toEqual(["a"]);
    expect(everyoneDone(["a"], ["a"])).toBe(false);
    expect(everyoneDone(["a", "b"], ["a", "b"])).toBe(true);
  });
});

describe("when everyone has done it", () => {
  it("lights the lamp and tells the others once, in words; the one who finished is not told", async () => {
    for (const id of ["dada", "arjun"]) await deleteDoc(FAM, "nudge", `x-${id}`);
    await post("dada", { action: "tick", habitId: "habit-morning-walk" });
    expect((await listDocs(FAM, "nudge")).filter((n) => n.text.startsWith("Everyone walked"))).toHaveLength(0);
    const before = (await listDocs(FAM, "lamp")).length;
    await post("arjun", { action: "tick", habitId: "habit-morning-walk" });
    const told = (await listDocs(FAM, "nudge")).filter((n) => n.text === "Everyone walked together");
    expect(told.map((n) => n.toMemberId).sort()).toEqual(["dada", "dadi", "priya"]);
    expect(told.every((n) => n.kind === "shared" && !/\d/.test(n.text))).toBe(true);
    const lamps = await listDocs(FAM, "lamp");
    expect(lamps.length).toBeGreaterThanOrEqual(before);
    expect(lamps.some((l) => l.litBy === "arjun" && l.litAt !== null)).toBe(true);
    expect((await get("priya")).everyone).toBe(true);
    // Untick and tick again the same week: no second nudge.
    await post("arjun", { action: "untick", habitId: "habit-morning-walk" });
    await post("arjun", { action: "tick", habitId: "habit-morning-walk" });
    expect((await listDocs(FAM, "nudge")).filter((n) => n.text === "Everyone walked together")).toHaveLength(3);
  });

  it("missing the hour is never a nudge", async () => {
    vi.setSystemTime(new Date("2026-10-28T09:00:00.000Z")); // 14:30 IST, well past 7 AM, nobody nagged
    await get("arjun");
    expect((await listDocs(FAM, "nudge")).some((n) => /walk/i.test(n.text))).toBe(false);
  });
});

describe("the courtyard slice", () => {
  it("carries habits, the same payload the route serves", async () => {
    const all = (await (await courtyardGET(authedGet("http://localhost/api/courtyard", "arjun"))).json()) as Record<string, unknown>;
    expect(all).toHaveProperty("habits");
    expect(all.habits).toEqual(await get("arjun"));
    for (const who of ["dadi", "aria"]) {
      const c = (await (await courtyardGET(authedGet("http://localhost/api/courtyard", who))).json()) as Record<string, unknown>;
      expect(c).toHaveProperty("habits");
    }
  });
  it("is registered as a courtyard slice on the client", async () => {
    const src = (await import("fs")).readFileSync("lib/courtyard-data.tsx", "utf8");
    expect(src).toContain('"/api/habits": "habits"');
  });
});

describe("the daily purge", () => {
  it("drops ticks older than 60 days and keeps the rest", async () => {
    const tick = (day: string, ageDays: number) => ({ id: tickId("habit-morning-walk", "dadi", day), habitId: "habit-morning-walk", memberId: "dadi", day, at: new Date(T0.getTime() - ageDays * D).toISOString() });
    await putDoc(FAM, "habit_tick", tick("2026-08-27", 62));
    await putDoc(FAM, "habit_tick", tick("2026-08-30", 59));
    await putDoc(FAM, "habit_tick", tick("2026-10-27", 1));
    expect(TTL.habitTickMs).toBe(60 * D);
    const out = await purgeExpired(FAM, T0);
    expect(out.habitTicks).toBe(1);
    const left = (await listDocs(FAM, "habit_tick")).map((t) => t.day);
    expect(left).not.toContain("2026-08-27");
    expect(left).toEqual(expect.arrayContaining(["2026-08-30", "2026-10-27"]));
    expect((await purgeExpired(FAM, T0)).habitTicks).toBe(0);
  });
});

describe("the weekly letter's words", () => {
  const habit = { id: "h", name: "Morning walk", members: ["dadi", "priya"] };
  const names = { dadi: "Maa", priya: "Priya" };
  const days = ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"];
  const t = (memberId: string, day: string) => ({ habitId: "h", memberId, day });
  it("says who walked most mornings and the day all of them walked, never a count", () => {
    const ticks = [...days.slice(0, 5).map((d) => t("dadi", d)), t("priya", "2026-10-25")];
    const facts = habitWeekFacts(habit, ticks, names, days).map((f) => f.text);
    expect(facts).toEqual(["Maa walked most mornings", "The whole family walked together on Sunday"]);
    expect(facts.join(" ")).not.toMatch(/\d/);
  });
  it("says nothing when it was a quiet week", () => {
    expect(habitWeekFacts(habit, [t("dadi", "2026-10-22")], names, days)).toEqual([]);
  });
  it("reaches the letter's facts", async () => {
    const now = new Date("2026-10-29T04:00:00.000Z");
    vi.setSystemTime(now);
    for (const d of ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]) await putDoc(FAM, "habit_tick", { id: tickId("habit-morning-walk", "dadi", d), habitId: "habit-morning-walk", memberId: "dadi", day: d, at: `${d}T02:00:00.000Z` });
    const { facts } = await gatherWeekFacts(FAM, undefined, now);
    expect(facts.some((f) => f.endsWith("Maa walked most mornings"))).toBe(true);
  });
});
