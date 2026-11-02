import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { roomHref, roomsFor } from "@/lib/menu";
import { spaceFor, spacesFor, tabsFor } from "@/lib/spaces";

const tabLabels = (path: string) => tabsFor(path)?.space.rooms.map((r) => r.title) ?? [];

describe("the five rooms", () => {
  for (const isParent of [false, true]) {
    it(`gives every tab its own page, unique across the whole house (${isParent ? "parent" : "child"})`, () => {
      const hrefs = roomsFor(isParent).flatMap((r) => r.tabs.map((t) => t.href));
      expect(new Set(hrefs).size).toBe(hrefs.length);
      expect(hrefs.every((h) => h.startsWith("/") && !h.includes("#") && !h.includes("?"))).toBe(true);
    });

    it(`never points a tab at Safe & sound, Settings or Invite (${isParent ? "parent" : "child"})`, () => {
      const hrefs = spacesFor(isParent).flatMap((s) => s.rooms.map((r) => r.href));
      for (const bad of ["/safe", "/settings", "/ask", "/around"]) expect(hrefs).not.toContain(bad);
    });
  }

  it("groups the rooms as agreed, in order", () => {
    const tabs = Object.fromEntries(roomsFor(false).map((r) => [r.title, r.tabs.map((t) => `${t.label} ${t.href}`)]));
    expect(Object.keys(tabs)).toEqual(["Living Room", "Memories", "Kitchen", "Our People", "Care"]);
    expect(tabs).toEqual({
      "Living Room": ["Time together /gather/play", "Coming up /gather", "Occasions /rituals"],
      Memories: ["Memory Lane /lane", "Stories /stories", "The Book /book", "Advice /advice", "Ask the family /ask-family"],
      Kitchen: ["Recipes /kitchen"],
      "Our People": ["Family tree /bond", "Homes /bond/homes", "Visits /together/visits"],
      Care: ["Care tasks /care", "Helpers /care/helpers", "Nearby /nearby"],
    });
    // Never these words as room names.
    expect(roomsFor(false).map((r) => r.title).join(" ")).not.toMatch(/Together|Keepsakes/);
  });

  it("opens each room's tile on its first tab", () => {
    for (const r of roomsFor(false)) {
      expect(roomHref(r)).toBe(r.tabs[0].href);
      expect(spaceFor(roomHref(r))?.space.id).toBe(r.id);
      expect(spaceFor(roomHref(r))?.room).toBe(roomHref(r));
    }
  });

  it("shows each room's tabs on its pages, with the right one active; Kitchen and pages outside rooms have none", () => {
    const keep = ["Memory Lane", "Stories", "The Book", "Advice", "Ask the family"];
    expect(tabLabels("/stories")).toEqual(keep);
    expect(tabLabels("/book")).toEqual(keep);
    expect(tabLabels("/together/visits")).toEqual(["Family tree", "Homes", "Visits"]);
    expect(tabLabels("/care/helpers")).toEqual(["Care tasks", "Helpers", "Nearby"]);
    expect(tabsFor("/send")).toBeNull();
    expect(roomsFor(false).flatMap((r) => r.tabs.map((t) => t.href))).not.toContain("/send");
    expect(roomsFor(false).find((r) => r.id === "care")?.note).not.toMatch(/send/i);
    expect(tabLabels("/gather")).toEqual(["Time together", "Coming up", "Occasions"]);
    expect(tabLabels("/rituals")).toEqual(["Time together", "Coming up", "Occasions"]);
    expect(tabsFor("/gather/play")?.room).toBe("/gather/play");
    expect(tabsFor("/care/helpers")?.room).toBe("/care/helpers");
    expect(tabsFor("/kitchen")).toBeNull();
    for (const p of ["/safe", "/settings", "/day", "/people/dadi", "/lane/album/a1", "/gather/ev_123", "/together/p1", "/kitchen/r1", "/portrait", "/together/holidays"]) expect(tabsFor(p), p).toBeNull();
  });

  it("renders only the five rooms in the rooms sheet: no nested lists", () => {
    const src = readFileSync(join(__dirname, "../components/shell.tsx"), "utf8");
    const sheet = src.slice(src.indexOf("function RoomsSheet("), src.indexOf("function Dock("));
    expect(sheet).toContain("all.map(");
    expect(sheet).toContain("roomHref(g)");
    expect(sheet).not.toMatch(/\.tabs\.map|\.items\.map|aria-expanded/);
    // The dock opens it with a house, not ⋯.
    const dock = src.slice(src.indexOf("function Dock("));
    expect(dock).toContain('aria-label="Open the house"');
    expect(dock).toContain("<HouseGlyph");
    expect(dock).not.toContain('name="more"');
  });
});
