// Children in Aangan: kid cards, asks that clear when answered, bedtime stories that open at
// 7 PM their time, the doorframe's "grew" line, kid mode's three rooms and what is deleted
// with a child. No model calls anywhere.
import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as bedtimeGet, POST as bedtimePost } from "@/app/api/bedtime/route";
import { GET as heightGet, POST as heightPost, DELETE as heightDelete } from "@/app/api/height/route";
import { GET as askGet, POST as askPost } from "@/app/api/kid-ask/route";
import { POST as sharePost } from "@/app/api/share/route";
import { GET as waitingGet } from "@/app/api/waiting/route";
import { dbAddCard, dbListMembers, dbListRelationships } from "@/lib/db";
import { deleteDocsForMember, listDocs, putDoc } from "@/lib/family-docs";
import { DOC_SCHEMAS } from "@/lib/kinds";
import { growLine, guardiansOf, isKid, isKidCard, kidsOf, kidsTile, recentGrowth, grandparentsOf } from "@/lib/kids";
import { roomsFor } from "@/lib/menu";
import { resetDemo } from "@/lib/store";
import { spacesFor, tabsFor } from "@/lib/spaces";
import { windowState } from "@/lib/window-server";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
// 12:00 UTC = 17:30 in India, before bedtime. 13:30 UTC is 7:00 PM.
const NOON = new Date("2026-11-01T12:00:00.000Z");
const SEVEN_PM = new Date("2026-11-01T13:30:00.000Z");
const json = async <T = Record<string, unknown>>(res: Response | Promise<Response>) => (await (await res).json()) as T;
const post = (path: string, body: unknown, as: string) => authedJson(`http://t${path}`, body, as);
const get = (path: string, as: string) => authedGet(`http://t${path}`, as);
const voice = (authorId: string, transcript = "Hello") => dbAddCard({ familyId: FAM, type: "audio", caption: transcript, lang: "en", takenAt: new Date().toISOString(), authorId, transcript, transcriptLang: "en" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
  resetDemo();
});
afterEach(() => vi.useRealTimers());

describe("schema", () => {
  it("the three kinds exist and the database allows them", () => {
    const sql = readFileSync("supabase/schema.sql", "utf8");
    const line = sql.split("\n").find((l) => l.includes("family_docs_kind_check check")) ?? "";
    for (const k of ["bedtime_story", "kid_ask", "height_mark"]) {
      expect(Object.keys(DOC_SCHEMAS)).toContain(k);
      expect(line).toContain(`'${k}'`);
    }
  });
  it("a height is 30 to 220 cm, a note 60 characters", () => {
    const base = { id: "h", memberId: "leo", at: NOON.toISOString(), byMemberId: "arjun" };
    expect(DOC_SCHEMAS.height_mark.safeParse({ ...base, cm: 29 }).success).toBe(false);
    expect(DOC_SCHEMAS.height_mark.safeParse({ ...base, cm: 221 }).success).toBe(false);
    expect(DOC_SCHEMAS.height_mark.safeParse({ ...base, cm: 120, note: "x".repeat(61) }).success).toBe(false);
    expect(DOC_SCHEMAS.height_mark.safeParse({ ...base, cm: 120 }).success).toBe(true);
  });
});

describe("who is a kid, and whose", () => {
  it("child access, or a child-generation profile with plain member access; never a teen or a grown-up", () => {
    expect(isKid({ access: "child", role: "child" })).toBe(true);
    expect(isKid({ access: "member", role: "child" })).toBe(true);
    expect(isKid({ access: "teen", role: "child" })).toBe(false);
    expect(isKid({ access: "member", role: "adult" })).toBe(false);
    expect(isKid(undefined)).toBe(false);
  });

  it("isKidCard looks only at the author", async () => {
    const members = await dbListMembers(FAM);
    expect(isKidCard({ authorId: "aria" }, members)).toBe(true);
    expect(isKidCard({ authorId: "leo" }, members)).toBe(true);
    expect(isKidCard({ authorId: "dadi" }, members)).toBe(false);
    expect(isKidCard({ authorId: null }, members)).toBe(false);
    expect(isKidCard({ authorId: "nobody" }, members)).toBe(false);
  });

  it("parents and grandparents come from the tree", async () => {
    const rels = await dbListRelationships(FAM);
    expect(guardiansOf("leo", rels).sort()).toEqual(["arjun", "dada", "dadi", "priya"]);
    expect(grandparentsOf("leo", rels).sort()).toEqual(["dada", "dadi"]);
    const members = await dbListMembers(FAM);
    expect(kidsOf("dadi", members, rels).map((m) => m.id).sort()).toEqual(["aria", "leo"]);
    expect(kidsOf("kavya", members, rels).map((m) => m.id)).toEqual(["anaya"]);
  });
});

describe("Ask Dadi", () => {
  it("an open ask waits for her, and clears when she answers; the answer is also a Story titled with the question", async () => {
    const before = await json<{ items: { kind: string; text: string }[] }>(waitingGet(get("/api/waiting", "dadi")));
    expect(before.items.find((i) => i.kind === "kid")?.text).toBe("Vihaan asked you something");
    // The question itself is not also a "voice note" line.
    expect(before.items.filter((i) => i.text.includes("voice note") && i.text.includes("Vihaan"))).toHaveLength(0);

    // Someone else in the family cannot answer it.
    const arjunCard = await voice("arjun");
    expect((await askPost(post("/api/kid-ask", { action: "answer", askId: "ask-leo-meet", cardId: arjunCard.id }, "arjun"))).status).toBe(403);

    const answerCard = await voice("dadi", "We met at a wedding, and your Papa could not find his shoes.");
    const done = await json<{ ask: { answeredCardId: string }; story: { title: string; tellerId: string; cardId: string } }>(askPost(post("/api/kid-ask", { action: "answer", askId: "ask-leo-meet", cardId: answerCard.id }, "dadi")));
    expect(done.ask.answeredCardId).toBe(answerCard.id);
    expect(done.story).toMatchObject({ tellerId: "dadi", cardId: answerCard.id, title: "Maa, how did you and Papa meet?" });
    expect((await listDocs(FAM, "story")).some((s) => s.cardId === answerCard.id)).toBe(true);

    const after = await json<{ items: { kind: string }[] }>(waitingGet(get("/api/waiting", "dadi")));
    expect(after.items.some((i) => i.kind === "kid")).toBe(false);
    // Answering twice is refused.
    expect((await askPost(post("/api/kid-ask", { action: "answer", askId: "ask-leo-meet", cardId: answerCard.id }, "dadi"))).status).toBe(409);
  });

  it("only a child asks; 'Another one?' twice is one ask; it goes to their own grandparents", async () => {
    expect((await askPost(post("/api/kid-ask", { action: "ask", text: "Hi", topic: "question" }, "arjun"))).status).toBe(403);
    const body = { action: "ask", topic: "story", text: "Another story, please", toMemberId: "dadi" };
    const first = await askPost(post("/api/kid-ask", body, "aria"));
    expect(first.status).toBe(201);
    expect((await askPost(post("/api/kid-ask", body, "aria"))).status).toBe(200);
    expect((await listDocs(FAM, "kid_ask")).filter((a) => a.fromMemberId === "aria")).toHaveLength(1);
    // Aimed at a stranger to the child, it goes to any of her people instead.
    const loose = await json<{ ask: { toMemberId: string | null } }>(askPost(post("/api/kid-ask", { action: "ask", text: "Why is the sky blue?", toMemberId: "rohan" }, "aria")));
    expect(loose.ask.toMemberId).toBeNull();
    const dadi = await json<{ asks: { fromMemberId: string }[] }>(askGet(get("/api/kid-ask", "dadi")));
    expect(dadi.asks.map((a) => a.fromMemberId)).toContain("aria");
    // Not shown to people who are not her family of the child.
    const kavya = await json<{ asks: unknown[] }>(askGet(get("/api/kid-ask", "kavya")));
    expect(kavya.asks).toHaveLength(0);
  });
});

describe("bedtime stories", () => {
  it("play only after 7 PM where the child is", async () => {
    vi.setSystemTime(NOON);
    resetDemo();
    const early = await json<{ tonight: { cardId: string | null; byMemberId: string } | null; open: boolean }>(bedtimeGet(get("/api/bedtime", "aria")));
    expect(early.open).toBe(false);
    expect(early.tonight).toMatchObject({ byMemberId: "dadi", cardId: null });

    vi.setSystemTime(new Date(SEVEN_PM.getTime() - 60_000));
    expect((await json<{ open: boolean }>(bedtimeGet(get("/api/bedtime", "aria")))).open).toBe(false);

    vi.setSystemTime(SEVEN_PM);
    const late = await json<{ tonight: { cardId: string | null; title: string } | null; open: boolean }>(bedtimeGet(get("/api/bedtime", "aria")));
    expect(late.open).toBe(true);
    expect(late.tonight).toMatchObject({ cardId: "demo-bedtime-dadi-aria", title: "The little elephant and the moon" });
  });

  it("a grown-up gets one prompt a day: recording or 'Not now' ends it, and it comes back tomorrow", async () => {
    const p1 = await json<{ prompt: { childId: string } | null }>(bedtimeGet(get("/api/bedtime", "dadi")));
    // Anika was told yesterday, so Vihaan is next.
    expect(p1.prompt?.childId).toBe("leo");
    expect((await bedtimePost(post("/api/bedtime", { action: "not-now" }, "dadi"))).status).toBe(200);
    expect((await json<{ prompt: unknown }>(bedtimeGet(get("/api/bedtime", "dadi")))).prompt).toBeNull();
    // Saying it twice is the same row.
    await bedtimePost(post("/api/bedtime", { action: "not-now" }, "dadi"));
    expect((await listDocs(FAM, "bedtime_story")).filter((s) => s.byMemberId === "dadi" && !s.cardId)).toHaveLength(1);
    // The child never sees a "not now" row as a story.
    vi.setSystemTime(SEVEN_PM);
    expect((await json<{ tonight: unknown }>(bedtimeGet(get("/api/bedtime", "leo")))).tonight).toBeNull();
    // Next day, the prompt is back.
    vi.setSystemTime(new Date(NOON.getTime() + 24 * 3_600_000));
    expect((await json<{ prompt: unknown }>(bedtimeGet(get("/api/bedtime", "dadi")))).prompt).not.toBeNull();
  });

  it("only a child's own grandparent or parent can tell one, with their own voice note", async () => {
    const mine = await voice("dadi");
    expect((await bedtimePost(post("/api/bedtime", { action: "create", forMemberId: "leo", cardId: mine.id }, "kavya"))).status).toBe(403);
    expect((await bedtimePost(post("/api/bedtime", { action: "create", forMemberId: "leo", cardId: "nope" }, "dadi"))).status).toBe(404);
    expect((await bedtimePost(post("/api/bedtime", { action: "create", forMemberId: "leo", cardId: mine.id }, "dadi"))).status).toBe(201);
    expect((await bedtimePost(post("/api/bedtime", { action: "not-now" }, "aria"))).status).toBe(403);
    // Telling Vihaan ends today's prompt.
    expect((await json<{ prompt: unknown }>(bedtimeGet(get("/api/bedtime", "dadi")))).prompt).toBeNull();
  });
});

describe("the doorframe", () => {
  const mark = (memberId: string, cm: number, at: string) => ({ id: `m-${memberId}-${at}`, memberId, cm, at, byMemberId: "arjun", note: "" });

  it("'grew' says how much since the mark before, only for a mark under a week old, never for no change", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const marks = [mark("leo", 117.5, "2025-09-01T10:00:00Z"), mark("leo", 122.5, "2026-04-14T10:00:00Z"), mark("leo", 124.5, "2026-10-29T10:00:00Z")];
    const [g] = recentGrowth(marks, now);
    expect(g).toMatchObject({ memberId: "leo", by: 2, cm: 124.5 });
    expect(growLine("Vihaan", g, now)).toBe("Vihaan grew 2 cm since 14 Apr");
    // Older than a week: no line. One mark only: no line. Same height: no line.
    expect(recentGrowth(marks, new Date("2026-11-10T10:00:00Z"))).toEqual([]);
    expect(recentGrowth([marks[0]], now)).toEqual([]);
    expect(recentGrowth([mark("aria", 100, "2026-04-01T10:00:00Z"), mark("aria", 100, "2026-10-30T10:00:00Z")], now)).toEqual([]);
    // Half centimetres read as one decimal; the line carries no advice words.
    expect(growLine("Anika", { by: 1.5, since: "2026-04-14T10:00:00Z" }, now)).toBe("Anika grew 1.5 cm since 14 Apr");
  });

  it("the seed shows Vihaan growing this week", async () => {
    const out = await json<{ grew: { memberId: string; by: number }[] }>(heightGet(get("/api/height", "dadi")));
    expect(out.grew).toEqual([expect.objectContaining({ memberId: "leo", by: 2 })]);
    // A child reads their own wall, not the news line.
    expect((await json<{ grew: unknown[] }>(heightGet(get("/api/height", "leo")))).grew).toEqual([]);
    const leo = await json<{ marks: unknown[] }>(heightGet(get("/api/height?memberId=leo", "leo")));
    expect(leo.marks).toHaveLength(3);
  });

  it("a parent or grandparent adds a mark; others cannot; you remove only your own", async () => {
    const add = (as: string, cm = 126) => heightPost(post("/api/height", { memberId: "aria", cm, note: "Shoes off" }, as));
    expect((await add("kavya")).status).toBe(403);
    expect((await add("aria")).status).toBe(403);
    expect((await heightPost(post("/api/height", { memberId: "dadi", cm: 150 }, "dadi"))).status).toBe(404);
    expect((await add("dadi", 12)).status).toBe(400);
    const made = await json<{ mark: { id: string } }>(add("dadi"));
    const del = (as: string) => heightDelete(new Request(`http://t/api/height?id=${made.mark.id}`, { method: "DELETE", headers: authedGet("http://t/", as).headers }));
    expect((await del("arjun")).status).toBe(403);
    expect((await del("dadi")).status).toBe(200);
  });
});

describe("kid mode menu", () => {
  it("three rooms: Memories (Lane, Stories), Celebrations (Coming up, Play), Family (Tree)", () => {
    const rooms = roomsFor(false, false, true);
    expect(rooms.map((r) => r.title)).toEqual(["Memories", "Family", "Celebrations"]);
    expect(Object.fromEntries(rooms.map((r) => [r.title, r.tabs.map((t) => t.href)]))).toEqual({
      Memories: ["/lane", "/stories"],
      Celebrations: ["/gather", "/gather/play"],
      Family: ["/bond"],
    });
    expect(spacesFor(false, false, true).flatMap((s) => s.rooms.map((r) => r.href))).not.toContain("/care");
    // Grown-ups are unchanged: five rooms.
    expect(roomsFor(false)).toHaveLength(5);
    // A kid's tab row is only their own two tabs.
    expect(tabsFor("/lane", false, true)?.space.rooms.map((r) => r.href)).toEqual(["/lane", "/stories"]);
  });
});

describe("From the kids", () => {
  it("counts the kids' new cards since the last visit and names who; asks are not counted", async () => {
    const members = await dbListMembers(FAM);
    const w = await windowState(FAM, "dadi", new Date());
    expect(w.glance.kids).toMatchObject({ href: "/lane?from=kids", text: "New from Vihaan & Anika", count: 3 });
    // A visit after all of it: nothing new.
    expect(kidsTile([{ id: "c", authorId: "leo", takenAt: new Date(NOON.getTime() - 3_600_000).toISOString() }], members, "dadi", NOON.toISOString(), NOON)).toBeNull();
    // Other grown-ups' cards never count.
    expect(kidsTile([{ id: "c", authorId: "arjun", takenAt: NOON.toISOString() }], members, "dadi", null, NOON)).toBeNull();
    // A kid's own window is not a thing, but their own cards never count for them.
    expect(kidsTile([{ id: "c", authorId: "leo", takenAt: new Date(NOON.getTime() - 1000).toISOString() }], members, "leo", null, NOON)).toBeNull();
  });
});

describe("privacy", () => {
  it("what a child made never goes public", async () => {
    await putDoc(FAM, "recipe", { id: "r-kid", title: "Leo's toast", cookId: "leo", createdAt: NOON.toISOString() });
    expect((await sharePost(post("/api/share", { kind: "recipe", id: "r-kid" }, "arjun"))).status).toBe(403);
    expect((await sharePost(post("/api/share", { kind: "recipe", id: "r-kid" }, "leo"))).status).toBe(403);
  });

  it("leaving removes a child's asks, stories and marks, and a grown-up's own", async () => {
    await deleteDocsForMember(FAM, "leo");
    expect((await listDocs(FAM, "kid_ask")).some((a) => a.fromMemberId === "leo")).toBe(false);
    expect((await listDocs(FAM, "height_mark")).some((m) => m.memberId === "leo")).toBe(false);
    expect((await listDocs(FAM, "height_mark")).some((m) => m.memberId === "aria")).toBe(true);
    await deleteDocsForMember(FAM, "dadi");
    expect((await listDocs(FAM, "bedtime_story")).some((s) => s.byMemberId === "dadi")).toBe(false);
  });
});
