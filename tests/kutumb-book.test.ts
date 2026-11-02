import { beforeEach, describe, expect, it } from "vitest";
import { GET as bookGet } from "@/app/api/book/route";
import { bookChapters, byYear, type Chapter } from "@/app/api/book/chapters";
import { traceVisible } from "@/app/trace/visible";
import { dayOf, lampFor } from "@/components/person-day";
import type { CareSettings, Presence, TodayTask } from "@/lib/kinds";
import type { Card, Member } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { authedGet } from "./auth-helper";

beforeEach(() => {
  process.env.MOCK = "true";
  resetDemo();
});

const card = (id: string, authorId: string, takenAt: string, type: Card["type"] = "audio"): Card =>
  ({ id, familyId: "f", type, caption: id, summary: "", lang: "en", takenAt, ritualSlug: null, source: "upload", mediaRef: null, peaks: [], palette: [], transcript: "", transcriptLang: "en", segments: [], authorId, coverRef: null, addressedTo: null, place: "", note: "" }) as Card;
const maa = { id: "dadi", tz: "Asia/Kolkata", city: "Amritsar" } as Member;

describe("the book of Maa & Papa", () => {
  it("turns Maa's answers to the daily question into chapters, and nothing from Advice", async () => {
    const res = await bookGet(authedGet("http://test/api/book?member=dadi", "arjun"));
    expect(res.status).toBe(200);
    const { chapters } = (await res.json()) as { chapters: Chapter[] };
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(chapters.every((c) => c.card.authorId === "dadi")).toBe(true);
    // Old tasks store only the prompt id: the title is the real question.
    expect(chapters.every((c) => /\s/.test(c.title))).toBe(true);
    // Today's answer is open to Arjun even before he answers (nothing is sealed).
    expect(chapters.some((c) => c.card.id === "demo-today-maa")).toBe(true);
    const own = (await (await bookGet(authedGet("http://test/api/book?member=dadi", "dadi"))).json()) as { chapters: Chapter[] };
    expect(own.chapters.some((c) => c.card.id === "demo-today-maa")).toBe(true);
    // Every chapter is a daily answer: advice and blessings stay on Advice.
    expect([...chapters, ...own.chapters].every((c) => c.source === "today")).toBe(true);
    const papa = (await (await bookGet(authedGet("http://test/api/book?member=dada", "arjun"))).json()) as { chapters: Chapter[] };
    const ids = [...chapters, ...papa.chapters].map((c) => c.card.id);
    expect(ids).not.toContain("demo-dadi-advice-1");
    expect(ids).not.toContain("demo-dada-bless-1");
    expect(papa.chapters.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses someone outside the family", async () => {
    expect((await bookGet(authedGet("http://test/api/book?member=nobody", "arjun"))).status).toBe(404);
  });

  it("only counts the person's own voice, once, grouped by year; never an answered ask", () => {
    const tasks = [{ id: "t1", date: "2025-01-01", promptId: "miss", forParents: "One thing you miss", forChildren: "x y", parents: ["dadi"], children: ["arjun"], answers: [{ memberId: "dadi", cardId: "a", at: "2025-01-01T10:00:00.000Z" }, { memberId: "arjun", cardId: "b", at: "2025-01-01T11:00:00.000Z" }], completedAt: "2025-01-01T11:00:00.000Z", madeBy: "muse", createdAt: "2025-01-01T00:00:00.000Z" }] as TodayTask[];
    const cards = [card("a", "dadi", "2025-01-01T10:00:00.000Z"), card("b", "arjun", "2025-01-01T11:00:00.000Z"), card("c", "dadi", "2026-02-01T10:00:00.000Z")];
    const later = { ...tasks[0], id: "t2", date: "2026-02-01", answers: [{ memberId: "dadi", cardId: "c", at: "2026-02-01T10:00:00.000Z" }, { memberId: "dadi", cardId: "a", at: "2026-02-01T10:00:00.000Z" }, { memberId: "arjun", cardId: "b", at: "2026-02-01T11:00:00.000Z" }] } as TodayTask;
    const chapters = bookChapters({ memberId: "dadi", viewerId: "arjun", tasks: [...tasks, later], cards, members: [] });
    expect(chapters.map((c) => c.card.id)).toEqual(["c", "a"]);
    expect(chapters.map((c) => c.source)).toEqual(["today", "today"]);
    expect(byYear(chapters).map((y) => y.year)).toEqual([2026, 2025]);
  });
});

describe("Kutumb: the lamp-glow ring and their day", () => {
  const now = new Date("2026-10-30T12:00:00.000Z"); // 17:30 in Amritsar
  const pres = (at: string, moment: Presence["moment"] = "here") => ({ id: at, memberId: "dadi", moment, note: "", at }) as Presence;
  const settings = (shareVisits: boolean) => [{ id: "dadi", memberId: "dadi", quietAlert: false, tellMemberId: null, graceHours: 3, shareVisits, updatedAt: now.toISOString() }] as CareSettings[];

  it("glows when they shared something today in their local day", () => {
    const lamp = lampFor(maa, { presence: [], settings: [], cards: [card("x", "dadi", "2026-10-30T05:00:00.000Z"), card("y", "dadi", "2026-10-30T06:00:00.000Z", "photo")] }, now);
    expect(lamp).toEqual({ glow: true, line: "shared today" });
  });

  it("glows for a moment they shared today; just opening Nearer is never shown", () => {
    expect(lampFor(maa, { presence: [pres("2026-10-30T10:00:00.000Z", "chai")], settings: [], cards: [] }, now)).toEqual({ glow: true, line: "shared today" });
    expect(lampFor(maa, { presence: [pres("2026-10-30T10:00:00.000Z")], settings: [], cards: [] }, now).glow).toBe(false);
  });

  it("stays dim after their midnight, even if they were around a few hours ago", () => {
    // 18:00 UTC on the 29th is 23:30 in Amritsar: yesterday for her.
    const lamp = lampFor(maa, { presence: [pres("2026-10-29T18:00:00.000Z")], settings: [], cards: [] }, now);
    expect(lamp.glow).toBe(false);
    expect(lamp.line).toBe("Amritsar");
  });

  it("never glows or says 'active' for someone who turned it off", () => {
    const lamp = lampFor(maa, { presence: [pres("2026-10-30T10:00:00.000Z")], settings: settings(false), cards: [card("x", "dadi", "2026-10-30T05:00:00.000Z")] }, now);
    expect(lamp).toEqual({ glow: false, line: "Amritsar" });
  });

  it("their day is today's moments in order, else their latest day", () => {
    const cards = [card("late", "dadi", "2026-10-30T09:00:00.000Z", "photo"), card("early", "dadi", "2026-10-30T03:00:00.000Z"), card("old", "dadi", "2026-10-20T03:00:00.000Z"), card("future", "dadi", "2026-11-02T03:00:00.000Z")];
    expect(dayOf(maa, cards, now)).toEqual({ items: [cards[1], cards[0]], today: true });
    expect(dayOf(maa, [cards[2]], now)).toEqual({ items: [cards[2]], today: false });
  });
});

describe("/trace", () => {
  it("is hidden in production unless the app runs in mock mode", () => {
    expect(traceVisible({ NODE_ENV: "production" })).toBe(false);
    expect(traceVisible({ NODE_ENV: "production", MOCK: "true" })).toBe(true);
    expect(traceVisible({ NODE_ENV: "development" })).toBe(true);
  });
});
