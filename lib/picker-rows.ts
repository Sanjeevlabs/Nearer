// Who a voice note is for: the rows of the one recipient picker (dock mic and
// composer). Pure, so the order and the search are tested. Order: Everyone,
// then whole homes, then up to two people waiting for your reply, then the rest
// (search reaches all of them). At most FIRST_SCREEN rows show before search.
import { householdName, households } from "./households";
import { callName } from "./people";
import type { Member, Relationship } from "./schemas";

export const FIRST_SCREEN = 6;
export const MAX_WAITING_ROWS = 2;

export type PickerRow =
  | { kind: "everyone"; ids: string[]; label: string; sub: string }
  | { kind: "home"; key: string; ids: string[]; label: string; sub: string; members: Member[] }
  | { kind: "person"; key: string; ids: string[]; label: string; sub: string; member: Member; waiting: boolean };

export interface PickerView {
  /** Everyone, homes and waiting people: always shown. */
  top: PickerRow[];
  /** The rest, filtered by the search, trimmed to the first screen unless searching or expanded. */
  rest: PickerRow[];
  /** How many matching people are not shown yet ("Show everyone"). */
  hidden: number;
  /** True when a search field is worth showing (more people than fit). */
  searchable: boolean;
}

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q.trim().toLowerCase());
}

export function pickerView(input: {
  viewerId: string;
  members: Member[];
  relationships: Relationship[];
  /** Members who sent something the viewer has not answered. */
  waitingIds?: Iterable<string>;
  query?: string;
  expanded?: boolean;
  everyoneLabel?: string;
}): PickerView {
  const waitingIds = new Set(input.waitingIds ?? []);
  const others = input.members.filter((m) => m.id !== input.viewerId && m.status !== "pending");
  const q = (input.query ?? "").trim();
  const personRow = (m: Member): PickerRow => ({ kind: "person", key: m.id, ids: [m.id], label: callName(m), sub: `Only ${callName(m)} hears it`, member: m, waiting: waitingIds.has(m.id) });

  const top: PickerRow[] = [];
  if (others.length > 1) top.push({ kind: "everyone", ids: others.map((m) => m.id), label: input.everyoneLabel ?? "Everyone", sub: "Everyone in the family hears it" });

  const otherIds = new Set(others.map((m) => m.id));
  const homes = households(input.members, input.relationships)
    .map((h) => ({ h, mine: h.members.filter((m) => otherIds.has(m.id)) }))
    .filter(({ h, mine }) => mine.length > 1 && !h.members.some((m) => m.id === input.viewerId));
  for (const { h, mine } of homes) top.push({ kind: "home", key: h.id, ids: mine.map((m) => m.id), label: householdName({ ...h, members: mine }, callName), sub: "Only this home hears it", members: mine });

  const waiting = others.filter((m) => waitingIds.has(m.id)).slice(0, MAX_WAITING_ROWS);
  for (const m of waiting) top.push(personRow(m));

  const shownTop = new Set(waiting.map((m) => m.id));
  const left = others.filter((m) => !shownTop.has(m.id));
  const found = q ? left.filter((m) => matches(`${callName(m)} ${m.firstName}`, q)) : left;
  const room = q || input.expanded ? found.length : Math.max(0, FIRST_SCREEN - top.length);
  const rest = found.slice(0, room).map(personRow);
  return { top, rest, hidden: found.length - rest.length, searchable: top.length + left.length > FIRST_SCREEN };
}
