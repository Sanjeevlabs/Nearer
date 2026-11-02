import { beforeEach, describe, expect, it } from "vitest";
import { dbAddPlay, dbListMembers, dbSetReaction } from "@/lib/db";
import { listDocs, putDoc } from "@/lib/family-docs";
import type { Attempt, Recipe, Story } from "@/lib/kinds";
import { queueScanNudges } from "@/lib/nudge-run";
import { pickWeekMoment, type MomentInput } from "@/lib/week-moment";
import type { Card, Play, Reaction } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";

const NOW = new Date("2026-11-07T09:00:00.000Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const card = (id: string, authorId: string, over: Partial<Card> = {}): Card =>
  ({ id, familyId: "f", type: "audio", caption: "", summary: "", lang: "en", takenAt: ago(48), ritualSlug: null, source: "upload", mediaRef: null, peaks: [], palette: [], transcript: "", transcriptLang: "en", segments: [], authorId, coverRef: null, addressedTo: null, place: "", note: "", ...over }) as Card;
const play = (cardId: string, memberId: string, h = 5): Play => ({ id: `${cardId}${memberId}${h}`, familyId: "f", cardId, memberId, playedAt: ago(h) });
const react = (cardId: string, memberId: string, kind: Reaction["kind"], h = 5): Reaction => ({ id: `${cardId}${memberId}${kind}`, familyId: "f", cardId, memberId, kind, createdAt: ago(h) });

const input = (over: Partial<MomentInput> = {}): MomentInput => ({
  now: NOW,
  members: [{ id: "maa", status: "active" }, { id: "arjun", status: "active" }, { id: "priya", status: "active" }],
  cards: [],
  plays: [],
  reactions: [],
  recipes: [],
  attempts: [],
  stories: [],
  tasks: [],
  letters: [],
  ...over,
});

describe("the week's best moment", () => {
  it("is null when nothing was heard, blessed or cooked", () => {
    expect(pickWeekMoment(input({ cards: [card("a", "maa")] }))).toBeNull();
    // One listen is not enough to make something of.
    expect(pickWeekMoment(input({ cards: [card("a", "maa")], plays: [play("a", "arjun")] }))).toBeNull();
  });

  it("prefers the most blessed and most heard voice memory, and names it by its story", () => {
    const stories = [{ id: "s", tellerId: "maa", cardId: "monsoon", title: "The monsoon", summary: "" } as Story];
    const m = pickWeekMoment(
      input({
        cards: [card("a", "maa"), card("monsoon", "maa")],
        plays: [play("a", "arjun"), play("a", "priya"), play("monsoon", "arjun"), play("monsoon", "priya")],
        reactions: [react("monsoon", "arjun", "bless")],
        stories,
      }),
    );
    expect(m).toMatchObject({ kind: "story", cardId: "monsoon", authorId: "maa", href: "/home?card=monsoon", text: "This week in your family: {m:maa}'s story, The monsoon" });
  });

  it("counts other people's listens only, and this week's only", () => {
    expect(pickWeekMoment(input({ cards: [card("a", "maa")], plays: [play("a", "maa"), play("a", "maa", 6), play("a", "maa", 7)] }))).toBeNull();
    expect(pickWeekMoment(input({ cards: [card("a", "maa")], plays: [play("a", "arjun", 24 * 9), play("a", "priya", 24 * 9)] }))).toBeNull();
  });

  it("leaves out a note spoken to one person, one still sealed, a letter in its envelope and a laugh", () => {
    const busy = { plays: [play("p", "arjun"), play("p", "priya")] };
    expect(pickWeekMoment(input({ cards: [card("p", "maa", { addressedTo: "arjun" })], ...busy }))).toBeNull();
    const task = { id: "t", answers: [{ memberId: "maa", cardId: "p", at: ago(30) }], completedAt: null } as never;
    expect(pickWeekMoment(input({ cards: [card("p", "maa")], tasks: [task], ...busy }))).toBeNull();
    expect(pickWeekMoment(input({ cards: [card("p", "maa")], letters: [{ id: "p", deliverAt: new Date(NOW.getTime() + 3_600_000).toISOString() }], ...busy }))).toBeNull();
    expect(pickWeekMoment(input({ cards: [card("p", "maa")], reactions: [react("p", "arjun", "laugh"), react("p", "priya", "laugh")] }))).toBeNull();
  });

  it("picks a recipe someone cooked, and says who cooked it", () => {
    const recipes = [{ id: "r", title: "Dal tadka", cookId: "maa", voiceCardId: "v" } as Recipe];
    const attempts = [{ id: "a1", recipeId: "r", memberId: "arjun", blessedBy: [], createdAt: ago(10) } as unknown as Attempt];
    const m = pickWeekMoment(input({ recipes, attempts }));
    expect(m).toMatchObject({ kind: "recipe", cardId: "v", authorId: "maa", href: "/kitchen", text: "This week in your family: {m:maa}'s Dal tadka, cooked by {m:arjun}" });
    expect(pickWeekMoment(input({ recipes, attempts: [{ ...attempts[0], createdAt: ago(24 * 10) }] }))).toBeNull();
  });

  it("keeps the nudge within its 120 characters", () => {
    const long = "A very long story title ".repeat(10);
    const m = pickWeekMoment(input({ cards: [card("a", "maa")], plays: [play("a", "arjun"), play("a", "priya")], stories: [{ id: "s", tellerId: "maa", cardId: "a", title: long.slice(0, 80), summary: "" } as Story] }));
    expect(m!.text.length).toBeLessThanOrEqual(120);
  });
});

describe("wired into the nudge run", () => {
  const FAM = "demo-family";
  // The Saturday after today: plays are stamped by the real clock, so the window must reach them.
  const saturday = (() => {
    const d = new Date();
    d.setUTCHours(9, 0, 0, 0);
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() !== 6);
    return d;
  })();
  const digests = () => listDocs(FAM, "nudge").then((l) => l.filter((n) => n.kind === "digest"));

  beforeEach(async () => {
    resetDemo();
    for (const who of ["arjun", "priya"]) {
      await dbAddPlay({ cardId: "demo-story-mela", memberId: who, familyId: FAM });
      await dbSetReaction({ cardId: "demo-story-mela", memberId: who, kind: "bless", familyId: FAM });
    }
  });

  it("queues one 'This week in your family' for everyone on Saturday, once", async () => {
    const members = await dbListMembers(FAM);
    await queueScanNudges(FAM, { members, now: saturday, occasions: [] });
    const first = await digests();
    expect(first.length).toBe(members.filter((m) => m.status !== "pending").length);
    expect(first[0].text).toMatch(/^This week in your family: \{m:dadi\}'s story, When I got lost at the fair$/);
    expect(first[0].href).toBe("/home?card=demo-story-mela");
    await queueScanNudges(FAM, { members, now: saturday, occasions: [] });
    expect((await digests()).length).toBe(first.length);
  });

  it("does nothing on any other day", async () => {
    const monday = new Date(saturday.getTime() + 2 * 86_400_000);
    await queueScanNudges(FAM, { members: await dbListMembers(FAM), now: monday, occasions: [] });
    expect(await digests()).toEqual([]);
  });

  it("respects 'fewer nudges': someone at 0 a week gets none; a full week of event nudges does not crowd it out", async () => {
    await putDoc(FAM, "nudge_settings", { id: "arjun", email: false, maxPerWeek: 0 });
    for (const [i, kind] of (["heard", "blessed", "shared"] as const).entries()) {
      await putDoc(FAM, "nudge", { id: `n${i}`, toMemberId: "priya", kind, text: "x", href: `/x${i}`, at: new Date(saturday.getTime() - 86_400_000).toISOString(), deliverAfter: saturday.toISOString(), deliveredAt: null, channel: null, seenAt: null });
    }
    await queueScanNudges(FAM, { members: await dbListMembers(FAM), now: saturday, occasions: [] });
    const to = (await digests()).map((n) => n.toMemberId);
    expect(to).not.toContain("arjun");
    expect(to).toContain("priya");
  });
});
