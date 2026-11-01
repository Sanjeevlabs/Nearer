// Tabs inside a room (SPEC §29.3): once you're in a room, its pages show as
// tabs so you can move sideways without going back. Derived from the five
// rooms in lib/menu.ts. A room with one page (Kitchen) has no tab row.
import { roomsFor, type Room } from "./menu";

export interface Space {
  id: Room["id"];
  title: string;
  rooms: { href: string; title: string }[];
}

export function spacesFor(isParent: boolean, canPortrait = true, kid = false, hasKids = false): Space[] {
  return roomsFor(isParent, canPortrait, kid, hasKids).map((r) => ({ id: r.id, title: r.title, rooms: r.tabs.map((t) => ({ href: t.href, title: t.label })) }));
}

// Every page a grown-up can have (Kids included), so /bond/kids always knows its room.
const ALL = spacesFor(false, true, false, true);

/** The space a path belongs to, and which of its rooms is open (the longest matching page wins). */
export function spaceFor(pathname: string): { space: Space; room: string } | null {
  let best: { space: Space; room: string } | null = null;
  for (const space of ALL) {
    for (const r of space.rooms) {
      if ((pathname === r.href || pathname.startsWith(`${r.href}/`)) && (!best || r.href.length > best.room.length)) best = { space, room: r.href };
    }
  }
  return best;
}

/** The room a tab page belongs to, one-page rooms (Kitchen) included: the eyebrow above its title. */
export function roomOf(pathname: string): Space | null {
  const at = spaceFor(pathname);
  return at && at.room === pathname ? at.space : null;
}

/**
 * The tab row for a page: only on a room's own tab page, and only when the
 * room has more than one. Children (`canPortrait` false) get the room without
 * Portrait, and no row on a page that isn't one of their tabs. `hasKids`
 * adds the Kids tab (grown-ups in a family with children).
 */
export function tabsFor(pathname: string, canPortrait = true, kid = false, hasKids = false): { space: Space; room: string } | null {
  const at = spaceFor(pathname);
  if (!at || at.room !== pathname) return null;
  const space = spacesFor(false, canPortrait, kid, hasKids).find((s) => s.id === at.space.id);
  if (!space || !space.rooms.some((r) => r.href === at.room)) return null;
  return space.rooms.length > 1 ? { space, room: at.room } : null;
}
