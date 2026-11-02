// Every feature, in five rooms of a house. The single source of rooms → ordered
// tabs. The rooms sheet shows only the five rooms; a room opens on its first tab,
// and inside it the tab row (lib/spaces.ts → RoomHeader) is the only way sideways.
// Every tab is its own page: no two tabs anywhere share one. A room with one page
// (Kitchen) has no tab row.
//
//   Living Room: time with each other now (Time together, Coming up, Occasions).
//   Memories:    what you keep (Memory Lane, Stories, the Book, Advice, Ask the family).
//   Kitchen:     Recipes. Cooking together live is a preset in the Living Room's "Open your door".
//   Our People:  who and where (the tree, homes, the kids, visits).
//   Care:        help at home and people nearby (the first-to-call list).
//
// Pages that are not tabs still resolve: Portrait (/portrait) opens from the Family
// tree ("Family portrait"), Holidays (/together/holidays) from Visits. /send (Send
// something) opens from the window's gift button, a care task or an occasion.
// Safe & sound is not here: it lives on the window, the first screen. Settings is
// not here either: tap your own photo. Care contacts are two taps away: the house,
// then Care (Nearby is its third tab), and the window's info sheet links them.
// Kid mode (lib/kids.ts isKid) shows three rooms only: Living Room (Time together,
// Coming up), Memories (Memory Lane, Stories) and Our People (Family tree).
// scripts/walk.py mirrors this.

export interface RoomTab {
  href: string;
  /** Short label for the tab row. The page's own title may say more (Helpers → "Local helpers"). */
  label: string;
}
export interface Room {
  id: "living" | "memories" | "kitchen" | "people" | "care";
  title: string;
  /** One line under the tile: what's in this room. */
  note: string;
  icon: string;
  /** In order. The tile opens the first one. */
  tabs: RoomTab[];
}

/** What a child in kid mode sees: room id -> the tabs they keep. */
export const KID_TABS: Partial<Record<Room["id"], string[]>> = {
  living: ["/gather/play", "/gather"],
  memories: ["/lane", "/stories"],
  people: ["/bond"],
};

/**
 * The five rooms for a viewer. `kid` = kid mode: three rooms, fewer tabs. `hasKids` = the family has
 * kid members: grown-ups get a Kids tab after Homes. `isParent` and `canPortrait` are kept for callers
 * (Portrait is reached from the Family tree, not a tab).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function roomsFor(isParent: boolean, canPortrait = true, kid = false, hasKids = false): Room[] {
  const rooms: Room[] = [
    {
      id: "living",
      title: "Living Room",
      note: "Time together now, what is coming up, occasions",
      icon: "door",
      tabs: [
        { href: "/gather/play", label: "Time together" },
        { href: "/gather", label: "Coming up" },
        { href: "/rituals", label: "Occasions" },
      ],
    },
    {
      id: "memories",
      title: "Memories",
      note: "Photos and voices, stories, the Book, advice",
      icon: "memories",
      tabs: [
        { href: "/lane", label: "Memory Lane" },
        { href: "/stories", label: "Stories" },
        { href: "/book", label: "The Book" },
        { href: "/advice", label: "Advice" },
        { href: "/ask-family", label: "Ask the family" },
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
      id: "people",
      title: "Our People",
      note: `Tree, homes, ${hasKids && !kid ? "the kids, " : ""}visits`,
      icon: "tree",
      tabs: [
        { href: "/bond", label: "Family tree" },
        { href: "/bond/homes", label: "Homes" },
        ...(hasKids && !kid ? [{ href: "/bond/kids", label: "Kids" }] : []),
        { href: "/together/visits", label: "Visits" },
      ],
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
  ];
  if (kid) {
    return rooms
      .filter((r) => KID_TABS[r.id])
      .map((r) => ({
        ...r,
        note: r.id === "memories" ? "Photos, voices and stories" : r.id === "living" ? "Time together, and what is coming up" : "Your family tree",
        tabs: KID_TABS[r.id]!.map((href) => r.tabs.find((t) => t.href === href)!).filter(Boolean),
      }));
  }
  return rooms;
}

/** Where a room's tile goes: its first tab. */
export function roomHref(room: Room): string {
  return room.tabs[0].href;
}
