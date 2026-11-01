// Every feature since PR #1, in five rooms of a house (SPEC §29.3). The
// single source of rooms → ordered tabs. The rooms sheet shows only the five
// rooms; a room opens on its first tab, and inside it the tab row (lib/spaces.ts
// → RoomHeader) is the only way sideways. A room with one page (Kitchen) has
// no tab row. Every tab is its own page: no two tabs anywhere share one.
// /send (Send something) is not a tab either: it opens from the window's gift
// button, a care task or an occasion, and shows "Care" as its room (RoomHeader room prop).
// Safe & sound is not here: it lives on the window, the first screen.
// Settings is not here either: tap your own photo. Inviting family opens the
// invite sheet in place (the tree page, the dock, the window), never Settings.
// Children (teen or child access) don't get Portrait: only grown-ups start one.

export interface RoomTab {
  href: string;
  /** Short label for the tab row. The page's own title may say more (Helpers → "Local helpers"). */
  label: string;
}
export interface Room {
  id: "memories" | "kitchen" | "care" | "family" | "celebrations";
  title: string;
  /** One line under the tile: what's in this room. */
  note: string;
  icon: string;
  /** In order. The tile opens the first one. */
  tabs: RoomTab[];
}

/** The five rooms for a viewer. `canPortrait` is false for children (lib/muse-portrait canStartPortrait). */
export function roomsFor(isParent: boolean, canPortrait = true): Room[] {
  const rooms: Room[] = [
    {
      id: "memories",
      title: "Memories",
      note: "Everyday photos and voices, and stories",
      icon: "memories",
      tabs: [
        { href: "/lane", label: "Memory Lane" },
        { href: "/stories", label: "Stories" },
      ],
    },
    {
      id: "kitchen",
      title: "Kitchen",
      note: isParent ? "Your recipes, and who cooked them" : "Recipes, in the voice that taught them",
      icon: "pot",
      tabs: [{ href: "/kitchen", label: "Recipes" }],
    },
    {
      id: "care",
      title: "Care",
      note: "Help at home, people nearby",
      icon: "care",
      tabs: [
        { href: "/care", label: "Care tasks" },
        { href: "/care/helpers", label: "Helpers" },
        { href: "/nearby", label: "Nearby" },
      ],
    },
    {
      id: "family",
      title: "Family",
      note: canPortrait ? "Tree, homes, the Book, advice, a portrait" : "Tree, homes, the Book, advice",
      icon: "tree",
      tabs: [
        { href: "/bond", label: "Family tree" },
        { href: "/bond/homes", label: "Homes" },
        { href: "/book", label: "The Book" },
        { href: "/advice", label: "Advice" },
        { href: "/portrait", label: "Portrait" },
      ],
    },
    {
      id: "celebrations",
      title: "Celebrations",
      note: "Birthdays, occasions, visits, holidays, play",
      icon: "gift",
      tabs: [
        { href: "/gather", label: "Coming up" },
        { href: "/rituals", label: "Occasions" },
        { href: "/together/visits", label: "Visits" },
        { href: "/together/holidays", label: "Holidays" },
        { href: "/gather/play", label: "Play" },
      ],
    },
  ];
  return canPortrait ? rooms : rooms.map((r) => ({ ...r, tabs: r.tabs.filter((t) => t.href !== "/portrait") }));
}

/** Where a room's tile goes: its first tab. */
export function roomHref(room: Room): string {
  return room.tabs[0].href;
}
