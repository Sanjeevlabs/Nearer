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
    expect(tabs).toEqual({
      Memories: ["Memory Lane /lane", "Stories /stories"],
      Kitchen: ["Recipes /kitchen"],
      Care: ["Send something /send", "Care tasks /care", "Helpers /care/helpers", "Nearby /nearby"],
      Family: ["Family tree /bond", "Homes /bond/homes", "The Book /book", "Advice /advice", "Portrait /portrait"],
      Celebrations: ["Coming up /gather", "Occasions /rituals", "Visits /together/visits", "Holidays /together/holidays", "Play /gather/play"],
    });
  });

  it("opens each room's tile on its first tab", () => {
    for (const r of roomsFor(false)) {
      expect(roomHref(r)).toBe(r.tabs[0].href);
      expect(spaceFor(roomHref(r))?.space.id).toBe(r.id);
      expect(spaceFor(roomHref(r))?.room).toBe(roomHref(r));
    }
  });

  it("shows each room's tabs on its pages, with the right one active; Kitchen and pages outside rooms have none", () => {
    expect(tabLabels("/stories")).toEqual(["Memory Lane", "Stories"]);
    expect(tabLabels("/book")).toEqual(["Family tree", "Homes", "The Book", "Advice", "Portrait"]);
    expect(tabLabels("/send")).toEqual(["Send something", "Care tasks", "Helpers", "Nearby"]);
    expect(tabLabels("/care/helpers")).toEqual(["Send something", "Care tasks", "Helpers", "Nearby"]);
    expect(tabLabels("/gather")).toEqual(["Coming up", "Occasions", "Visits", "Holidays", "Play"]);
    expect(tabLabels("/rituals")).toEqual(["Coming up", "Occasions", "Visits", "Holidays", "Play"]);
    expect(tabsFor("/gather/play")?.room).toBe("/gather/play");
    expect(tabsFor("/care/helpers")?.room).toBe("/care/helpers");
    expect(tabsFor("/kitchen")).toBeNull();
    for (const p of ["/safe", "/settings", "/day", "/people/dadi", "/lane/album/a1", "/gather/ev_123", "/together/p1", "/kitchen/r1"]) expect(tabsFor(p), p).toBeNull();
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
    expect(dock).toContain('name="rooms"');
    expect(dock).not.toContain('name="more"');
  });
});
