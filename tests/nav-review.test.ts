import { beforeEach, describe, expect, it } from "vitest";
import { GET as laneGet } from "@/app/api/lane/route";
import { GET as bookGet } from "@/app/api/book/route";
import { GET as cardsGet } from "@/app/api/cards/route";
import type { Chapter } from "@/app/api/book/chapters";
import { households, householdOf, sendOrder } from "@/lib/households";
import { laneGroups } from "@/lib/lane-groups";
import { roomsFor } from "@/lib/menu";
import { canStartPortrait } from "@/lib/muse-portrait";
import { everydayHelpers } from "@/lib/nearby";
import { claimedByOccasions, occasionGroups } from "@/lib/occasion-album";
import type { Card } from "@/lib/schemas";
import { spacesFor, tabsFor } from "@/lib/spaces";
import { listMembers, listRelationships, resetDemo } from "@/lib/store";
import { authedGet } from "./auth-helper";

beforeEach(() => {
  process.env.MOCK = "true";
  resetDemo();
});

const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

describe("Memory Lane is everyday photos and voices only", () => {
  it("leaves out every card Occasions, Stories, The Book and Advice show", async () => {
    const { elsewhere } = await json<{ elsewhere: string[] }>(laneGet(authedGet("http://test/api/lane", "arjun")));
    const { cards } = await json<{ cards: Card[] }>(cardsGet(authedGet("http://test/api/cards", "arjun")));
    const skip = new Set(elsewhere);
    const lane = laneGroups(cards, null, skip);
    const shown = [...lane.photo, ...lane.video, ...lane.audio].map((c) => c.id);
    // Occasions: a festival's guide cards, a birthday's wishes and song, a wedding album.
    for (const id of ["demo-diya-1", "demo-diwali-rangoli", "demo-bday-1", "demo-wish-dadi-arjun", "demo-wish-priya-arjun", "demo-wed-mandap"]) expect(shown, id).not.toContain(id);
    // Stories, Advice (advice and a blessing), The Book (an elder's daily answers).
    for (const id of ["demo-story-elephant", "demo-story-swim", "demo-dadi-advice-1", "demo-dada-bless-1", "demo-book-dadi-bestday", "demo-book-dada-proud"]) expect(shown, id).not.toContain(id);
    // Everyday ones stay.
    for (const id of ["demo-maa-voice-30", "demo-voice-1", "demo-voice-2", "demo-maa-morning", "demo-court-leo"]) expect(shown, id).toContain(id);
  });

  it("claims for Occasions exactly what Occasions shows", () => {
    const card = (id: string, extra: Partial<Card> = {}) => ({ id, type: "photo", takenAt: "2026-10-26T10:00:00.000Z", ritualSlug: null, authorId: "a", ...extra }) as Card;
    const cards = [card("g1", { ritualSlug: "lights" }), card("w1", { type: "audio" }), card("al1"), card("plain")];
    const albums = [{ id: "A", title: "Wed", event: "wedding", cardIds: ["al1"], endAt: "2026-01-01T00:00:00.000Z" }, { id: "B", title: "Sun", event: "gathering", cardIds: ["plain"], endAt: "2026-01-01T00:00:00.000Z" }] as never;
    const runs = [{ id: "r1", familyId: "f", ritualSlug: "birthday", occasionDate: "2026-09-01", status: "done", createdAt: "2026-09-01T00:00:00.000Z" }] as never;
    const wishCards = [{ ritualRunId: "r1", cardId: "w1" }];
    const shown = occasionGroups({ cards, albums, runs, wishes: wishCards, titleFor: (s) => s }).flatMap((g) => [...g.prints, ...g.voices].map((c) => c.id));
    expect([...claimedByOccasions(cards, albums, runs, wishCards)].sort()).toEqual(shown.sort());
    expect(claimedByOccasions(cards, albums, runs, wishCards).has("plain")).toBe(false);
  });
});

describe("The Book is daily answers only", () => {
  it("has no advice or blessing chapters, for either parent", async () => {
    for (const member of ["dadi", "dada"]) {
      const { chapters } = await json<{ chapters: Chapter[] }>(bookGet(authedGet(`http://test/api/book?member=${member}`, "arjun")));
      expect(chapters.length).toBeGreaterThan(0);
      expect(chapters.every((c) => c.source === "today")).toBe(true);
      expect(chapters.map((c) => c.card.id).filter((id) => /advice|bless/.test(id))).toEqual([]);
    }
  });
});

describe("Care tabs don't repeat each other", () => {
  it("keeps the first-to-call list on Nearby, out of Helpers", () => {
    const helpers = [
      { id: "h1", name: "Grocer", emergency: false },
      { id: "h2", name: "Neighbour", emergency: true },
    ];
    expect(everydayHelpers(helpers).map((h) => h.id)).toEqual(["h1"]);
  });

  it("sends from a parent to a home outside their own by default; children see the grandparents first", () => {
    const members = listMembers().filter((m) => m.familyId === "demo-family");
    const rels = listRelationships();
    const homes = households(members, rels);
    const dadi = members.find((m) => m.id === "dadi")!;
    const first = sendOrder(dadi, members, rels)[0];
    expect(first.id).not.toBe("dada");
    expect(householdOf("dadi", homes)?.members.some((m) => m.id === first.id)).toBe(false);
    expect(first.role).toBe("adult");
    const arjun = members.find((m) => m.id === "arjun")!;
    expect(sendOrder(arjun, members, rels)[0].role).toBe("elder");
    expect(sendOrder(arjun, members, rels).some((m) => m.role === "child" || m.id === "arjun")).toBe(false);
  });
});

describe("children's rooms", () => {
  it("gives children no Portrait tab, grown-ups keep it", () => {
    const byId = (id: string) => listMembers().find((m) => m.id === id)!;
    expect(canStartPortrait(byId("aria"))).toBe(false);
    expect(canStartPortrait(byId("leo"))).toBe(false);
    expect(canStartPortrait(byId("arjun"))).toBe(true);
    const kid = roomsFor(false, false).flatMap((r) => r.tabs.map((t) => t.href));
    expect(kid).not.toContain("/portrait");
    expect(roomsFor(false).flatMap((r) => r.tabs.map((t) => t.href))).toContain("/portrait");
    expect(tabsFor("/book", false)?.space.rooms.map((r) => r.title)).toEqual(["Family tree", "Homes", "The Book", "Advice"]);
    expect(tabsFor("/portrait", false)).toBeNull();
    expect(tabsFor("/book")?.space.rooms.map((r) => r.title)).toContain("Portrait");
  });

  it("keeps every tab href unique across the house, with and without Portrait", () => {
    for (const isParent of [true, false])
      for (const portrait of [true, false]) {
        const hrefs = spacesFor(isParent, portrait).flatMap((s) => s.rooms.map((r) => r.href));
        expect(new Set(hrefs).size).toBe(hrefs.length);
      }
  });
});
