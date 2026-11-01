// Ages and the fridge: a birthday is "MM-DD" or "YYYY-MM-DD", an age comes only from a known
// year, and isKid is one function (age under 13 when known, else the old access/role rule).
// A grown-up can add a drawing to the fridge for a kid; a non-kid target is refused.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cardsGet, POST as cardsPost } from "@/app/api/cards/route";
import { PATCH as profilePatch } from "@/app/api/members/profile/route";
import { GET as kidsGet } from "@/app/api/kids/route";
import { birthdayProblem, buildBirthday, mmdd, parseBirthday, validBirthday, validYearText } from "@/lib/birthday";
import { dbAddCard, dbGetMember, dbListMembers } from "@/lib/db";
import { DEMO_MEMBERS, daysUntilBirthday } from "@/lib/family";
import { fridgeKidId, isKid, isKidCard, kidCards, pinnedBy } from "@/lib/kids";
import { occasionsInRange } from "@/lib/occasion-calendar";
import { nextOccasion } from "@/lib/occasions-server";
import { ageOf } from "@/lib/people";
import { MemberSchema } from "@/lib/schemas";
import { resetDemo } from "@/lib/store";
import { authedGet, authedJson } from "./auth-helper";

const FAM = "demo-family";
const NOW = new Date("2026-11-01T12:00:00.000Z");
const json = async <T = Record<string, unknown>>(res: Response | Promise<Response>) => (await (await res).json()) as T;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetDemo();
});
afterEach(() => vi.useRealTimers());

describe("birthday text", () => {
  it("parses both shapes and rejects the rest", () => {
    expect(parseBirthday("11-09")).toEqual({ month: 11, day: 9, year: null });
    expect(parseBirthday("2017-11-09")).toEqual({ month: 11, day: 9, year: 2017 });
    expect(parseBirthday("")).toBeNull();
    expect(parseBirthday("13-01")).toBeNull();
    expect(parseBirthday("2019-02-29")).toBeNull(); // not a leap year
    expect(parseBirthday("2020-02-29")).not.toBeNull();
    expect(mmdd("2017-11-09")).toBe("11-09");
    expect(mmdd("11-09")).toBe("11-09");
  });

  it("composes the stored text: full date with a year, day and month without", () => {
    expect(buildBirthday("11", "09", "2017")).toBe("2017-11-09");
    expect(buildBirthday("11", "09", "")).toBe("11-09");
    expect(buildBirthday("", "09", "2017")).toBe("");
  });

  it("a year is four digits from 1900 to this year, never the future", () => {
    expect(validYearText("", NOW)).toBe(true);
    expect(validYearText("2017", NOW)).toBe(true);
    expect(validYearText("1899", NOW)).toBe(false);
    expect(validYearText("2027", NOW)).toBe(false);
    expect(validYearText("20", NOW)).toBe(false);
    expect(validBirthday("2026-11-01", NOW)).toBe(true);
    expect(validBirthday("2027-01-01", NOW)).toBe(false);
    expect(birthdayProblem("", "", "2017", NOW)).toMatch(/day and month/);
    expect(birthdayProblem("11", "09", "", NOW)).toBeNull();
  });
});

describe("ageOf", () => {
  it("is null without a birth year, and counts whole years with one", () => {
    expect(ageOf({ birthday: "" }, NOW)).toBeNull();
    expect(ageOf({ birthday: "11-09" }, NOW)).toBeNull();
    expect(ageOf({ birthday: "2017-11-09", tz: "UTC" }, NOW)).toBe(8); // turns 9 on 9 Nov
    expect(ageOf({ birthday: "2017-11-01", tz: "UTC" }, NOW)).toBe(9); // today is the day
    expect(ageOf({ birthday: "2017-11-09", tz: "UTC" }, new Date("2026-11-09T00:30:00Z"))).toBe(9);
    expect(ageOf(null, NOW)).toBeNull();
  });
});

describe("isKid by age", () => {
  const base = { access: "member" as const, role: "adult" as const };
  it("a known age decides: under 13 is a kid, 13 is a teen, never a kid", () => {
    expect(isKid({ ...base, birthday: "2017-11-09", tz: "UTC" }, NOW)).toBe(true);
    expect(isKid({ ...base, birthday: "2014-11-01", tz: "UTC" }, NOW)).toBe(true); // 12
    expect(isKid({ ...base, birthday: "2013-11-01", tz: "UTC" }, NOW)).toBe(false); // 13 today
    expect(isKid({ access: "child", role: "child", birthday: "2013-10-31", tz: "UTC" }, NOW)).toBe(false); // a 13-year-old on a child account
    expect(isKid({ ...base, birthday: "1987-07-30", tz: "UTC" }, NOW)).toBe(false);
  });
  it("without a birth year the old rule stands: child access, or a child profile with member access", () => {
    expect(isKid({ access: "child", role: "child", birthday: "03-14" }, NOW)).toBe(true);
    expect(isKid({ access: "child", role: "child" }, NOW)).toBe(true); // a child account with no year at all
    expect(isKid({ access: "member", role: "child", birthday: "" }, NOW)).toBe(true);
    expect(isKid({ access: "teen", role: "child" }, NOW)).toBe(false);
    expect(isKid({ access: "member", role: "adult", birthday: "03-14" }, NOW)).toBe(false);
    expect(isKid(undefined)).toBe(false);
  });
  it("the demo family shows ages: Vihaan 8, Anika 7, grown-ups not kids", async () => {
    const members = await dbListMembers(FAM);
    const by = (id: string) => members.find((m) => m.id === id)!;
    expect(ageOf(by("leo"), NOW)).toBe(8);
    expect(ageOf(by("aria"), NOW)).toBe(7);
    expect(members.filter((m) => isKid(m, NOW)).map((m) => m.id).sort()).toEqual(["anaya", "aria", "kabir", "leo"]);
    for (const m of members) expect(ageOf(m, NOW)).not.toBeNull();
  });
});

describe("birthdays in both formats", () => {
  it("the occasions calendar places a dated and an undated birthday on the same day", () => {
    const list = occasionsInRange([{ id: "a", birthday: "2017-11-09" }, { id: "b", birthday: "11-09" }, { id: "c", birthday: "" }], [], "2026-11-01", "2026-11-30");
    expect(list.map((o) => o.id)).toEqual(["birthday:a:2026-11-09", "birthday:b:2026-11-09"]);
    // 29 Feb with a year stays on 28 Feb in other years.
    expect(occasionsInRange([{ id: "d", birthday: "2020-02-29" }], [], "2027-02-01", "2027-03-01").map((o) => o.date)).toEqual(["2027-02-28"]);
  });
  it("coming-up counts down from either shape, and the next occasion finds it", () => {
    expect(daysUntilBirthday("2017-11-09", NOW)).toBe(8);
    expect(daysUntilBirthday("11-09", NOW)).toBe(8);
    expect(daysUntilBirthday("", NOW)).toBe(Number.POSITIVE_INFINITY);
    const members = DEMO_MEMBERS.map((m) => MemberSchema.parse(m));
    expect(nextOccasion(members, new Date("2026-11-08T00:00:00Z"), 7)?.slug).toBe("birthday");
  });
  it("a member's year is saved through the profile route and read back; a future year is refused", async () => {
    const patch = (body: unknown) => profilePatch(new Request("http://t/api/members/profile", { method: "PATCH", headers: { "content-type": "application/json", cookie: authedGet("http://t/", "arjun").headers.get("cookie")! }, body: JSON.stringify(body) }));
    expect((await patch({ birthday: "1987-07-30" })).status).toBe(200);
    expect((await dbGetMember("arjun"))!.birthday).toBe("1987-07-30");
    expect((await patch({ birthday: "2099-07-30" })).status).toBe(400);
    expect((await patch({ birthday: "07-30" })).status).toBe(200);
    expect((await dbGetMember("arjun"))!.birthday).toBe("07-30");
  });
});

describe("Add to the fridge", () => {
  const add = (as: string, forMemberId: string | null, extra: Record<string, unknown> = {}) =>
    cardsPost(authedJson("http://t/api/cards", { type: "photo", caption: "a drawing of a fish", lang: "en", takenAt: NOW.toISOString(), forMemberId, ...extra }, as));

  it("a grown-up's card for a kid is marked as theirs and lands on the fridge", async () => {
    const res = await add("arjun", "leo");
    expect(res.status).toBe(201);
    const { card } = await json<{ card: { id: string; authorId: string; forMemberId: string } }>(res);
    expect(card).toMatchObject({ authorId: "arjun", forMemberId: "leo" });
    const members = await dbListMembers(FAM);
    expect(isKidCard(card, members)).toBe(true);
    expect(fridgeKidId(card)).toBe("leo");
    expect(pinnedBy(card)).toBe("arjun");
    // Read back through the cards list and the Kids page.
    const listed = await json<{ cards: { id: string; forMemberId?: string | null }[] }>(cardsGet(authedGet("http://t/api/cards", "dadi")));
    expect(listed.cards.find((c) => c.id === card.id)?.forMemberId).toBe("leo");
    const page = await json<{ fridge: { id: string }[] }>(kidsGet(authedGet("http://t/api/kids", "dadi")));
    expect(page.fridge.map((c) => c.id)).toContain(card.id);
    expect(kidCards([card as never], members)).toHaveLength(1);
  });

  it("an ordinary grown-up card is not on the fridge, and a kid's own card has no 'pinned by'", async () => {
    const members = await dbListMembers(FAM);
    const plain = await dbAddCard({ familyId: FAM, type: "photo", caption: "garden", lang: "en", takenAt: NOW.toISOString(), authorId: "arjun" });
    expect(isKidCard(plain, members)).toBe(false);
    const own = await dbAddCard({ familyId: FAM, type: "photo", caption: "mine", lang: "en", takenAt: NOW.toISOString(), authorId: "aria" });
    expect(isKidCard(own, members)).toBe(true);
    expect(pinnedBy(own)).toBeNull();
    expect(fridgeKidId(own)).toBe("aria");
  });

  it("rejects a target who is not a kid (a grown-up, a stranger), and a child pinning for another", async () => {
    expect((await add("arjun", "priya")).status).toBe(400);
    expect((await add("arjun", "dadi")).status).toBe(400);
    expect((await add("arjun", "nobody")).status).toBe(400);
    expect((await add("aria", "leo")).status).toBe(403);
    // Nothing was stored with a mark.
    const listed = await json<{ cards: { forMemberId?: string | null }[] }>(cardsGet(authedGet("http://t/api/cards", "dadi")));
    expect(listed.cards.some((c) => c.forMemberId)).toBe(false);
  });

  it("the multipart path validates the same way", async () => {
    const form = (forMemberId: string) => {
      const f = new FormData();
      f.set("type", "photo");
      f.set("caption", "my fish");
      f.set("takenAt", NOW.toISOString());
      f.set("forMemberId", forMemberId);
      return new Request("http://t/api/cards", { method: "POST", headers: { cookie: authedGet("http://t/", "arjun").headers.get("cookie")! }, body: f });
    };
    expect((await cardsPost(form("priya"))).status).toBe(400);
    const ok = await cardsPost(form("aria"));
    expect(ok.status).toBe(201);
    expect((await json<{ card: { forMemberId: string } }>(ok)).card.forMemberId).toBe("aria");
  });
});
