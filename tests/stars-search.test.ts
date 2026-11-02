import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/stars/route";
import { listCards, listMembers, resetDemo } from "@/lib/store";
import { matchesSearch, starredFirst, toggleStar } from "@/lib/stars";
import { LANE_ROWS } from "@/lib/lane-groups";
import { sessionCookie } from "./auth-helper";

const FAM = "demo-family";
const req = (memberId: string, body?: unknown, fam = FAM) =>
  new Request("http://test/api/stars", body === undefined ? { headers: { cookie: sessionCookie(memberId, fam) } } : { method: "POST", headers: { cookie: sessionCookie(memberId, fam), "content-type": "application/json" }, body: JSON.stringify(body) });
const starsOf = async (memberId: string, fam = FAM) => ((await (await GET(req(memberId, undefined, fam))).json()) as { starred: string[] }).starred;

describe("favourites: a star is mine alone", () => {
  beforeEach(() => resetDemo());

  it("starring and unstarring changes only my list", async () => {
    const card = listCards().find((c) => c.familyId === FAM && c.type === "photo")!;
    expect(await starsOf("arjun")).toEqual([]);
    expect((await POST(req("arjun", { cardId: card.id }))).status).toBe(200);
    expect(await starsOf("arjun")).toEqual([card.id]);
    expect(await starsOf("dadi")).toEqual([]);
    await POST(req("arjun", { cardId: card.id }));
    expect(await starsOf("arjun")).toEqual([]);
  });

  it("on: true twice stays starred once; a card from another family is refused", async () => {
    const card = listCards().find((c) => c.familyId === FAM && c.type === "audio")!;
    await POST(req("arjun", { cardId: card.id, on: true }));
    await POST(req("arjun", { cardId: card.id, on: true }));
    expect(await starsOf("arjun")).toEqual([card.id]);
    const other = listCards().find((c) => c.familyId === "demo-iyer")!;
    expect((await POST(req("arjun", { cardId: other.id }))).status).toBe(404);
    expect((await POST(req("arjun", { nope: 1 }))).status).toBe(400);
  });

  it("needs a session", async () => {
    expect((await GET(new Request("http://test/api/stars"))).status).toBe(401);
  });

  it("starred memories come first, newest star first", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const stars = toggleStar(toggleStar([], "c"), "d");
    expect(starredFirst(list, stars).map((x) => x.id)).toEqual(["d", "c", "a", "b"]);
  });
});

describe("search: what Muse already keeps", () => {
  beforeEach(() => resetDemo());
  const members = () => listMembers();
  const cards = () => listCards().filter((c) => c.familyId === FAM);

  it("matches words in a voice memory's transcript, any case and order", () => {
    const hit = cards().filter((c) => matchesSearch(c, "WARM tonight", members()));
    expect(hit.map((c) => c.id)).toContain("demo-maa-to-arjun");
    expect(hit.every((c) => /warm/i.test(c.transcript + c.caption))).toBe(true);
  });

  it("matches a photo's caption, its place, who shared it and its year", () => {
    expect(cards().filter((c) => matchesSearch(c, "mandap", members())).map((c) => c.id)).toEqual(["demo-wed-mandap"]);
    expect(cards().filter((c) => matchesSearch(c, "jaipur", members())).length).toBeGreaterThanOrEqual(4);
    expect(cards().some((c) => c.id === "demo-wed-mandap" && matchesSearch(c, "Arjun december 2025", members()))).toBe(true);
  });

  it("an empty query matches everything; a word nobody said matches nothing", () => {
    expect(cards().every((c) => matchesSearch(c, "  ", members()))).toBe(true);
    expect(cards().filter((c) => matchesSearch(c, "zeppelin", members()))).toEqual([]);
  });

  it("Memory Lane calls them voice memories", () => {
    expect(LANE_ROWS.find((r) => r.kind === "audio")?.title).toBe("Voice memories");
  });
});
