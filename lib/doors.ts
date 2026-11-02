// Open doors: a person says "I have time now, come sit" (a `knock`). This file is the one
// place that decides who may see a door, what it is for, and how it reads. Pure: the
// server routes and the client card both use it.
//
// Availability here is only ever what someone declared by opening their door. Nothing
// is inferred from app opens, the lamp, the clock or silence, and the words never say
// someone "is available" or "is on a call", only that their door is open.
import type { Knock } from "./kinds";
import type { IconName } from "@/components/ui/kit";

export const ACTIVITIES = ["chai", "dinner", "catchup", "cook", "story", "song", "quiz"] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** Door lengths offered in the sheet (minutes). 30 is the default. */
export const DOOR_MINUTES = [15, 30, 60, 90] as const;
export const DEFAULT_DOOR_MINUTES = 30;

interface Preset {
  /** The chip and list label. */
  label: string;
  /** The line under "{Host}'s door is open". */
  line: string;
  /** "Maa is having chai. Join?" (the one push a one-person door sends). */
  doing: string;
  icon: IconName;
}

export const PRESETS: Record<Activity, Preset> = {
  chai: { label: "Chai", line: "Chai together", doing: "is having chai", icon: "coffee" },
  dinner: { label: "Dinner", line: "Dinner at the table", doing: "is sitting down to dinner", icon: "utensils" },
  catchup: { label: "Catch up", line: "A catch-up", doing: "has time for a catch-up", icon: "phone" },
  cook: { label: "Cook together", line: "Cooking together", doing: "is cooking", icon: "pot" },
  story: { label: "Story night", line: "Story night", doing: "is telling a story", icon: "moon" },
  song: { label: "Song game", line: "Song game", doing: "is starting a song game", icon: "music" },
  quiz: { label: "Family quiz", line: "Family quiz", doing: "is starting a family quiz", icon: "sparkle" },
};

/** The three chips on the Together card. */
export const CHIP_ACTIVITIES: Activity[] = ["chai", "dinner", "catchup"];

/** May this person see (and join) this knock? The host, or anyone when it is family-wide, or an invited person. */
export function canSeeKnock(k: Pick<Knock, "memberId" | "invites">, viewerId: string): boolean {
  if (k.memberId === viewerId) return true;
  return !k.invites || k.invites.length === 0 || k.invites.includes(viewerId);
}

/** Still open: before its `until`. */
export function isOpen(k: Pick<Knock, "until">, nowMs: number): boolean {
  return Date.parse(k.until) > nowMs;
}

/** The knocks this person may see right now. */
export function visibleKnocks<K extends Pick<Knock, "memberId" | "invites" | "until">>(knocks: K[], viewerId: string, nowMs: number): K[] {
  return knocks.filter((k) => isOpen(k, nowMs) && canSeeKnock(k, viewerId));
}

export interface Door {
  id: string;
  hostId: string;
  hostName: string;
  activity: Activity | null;
  note: string;
  until: string;
  /** Only for this viewer (a one-person "Can I sit with you?"). */
  justYou: boolean;
}

/** The line under "{Host}'s door is open": the preset's, else the host's own note. */
export function doorLine(d: Pick<Door, "activity" | "note">): string {
  return d.activity ? PRESETS[d.activity].line : d.note || "Come sit";
}

/**
 * The window's doors: those open to the viewer (not their own), newest first with
 * the ones only for them ahead, and the viewer's own open door.
 */
export function doorsFor(knocks: Knock[], viewerId: string, nameOf: (id: string) => string, nowMs: number): { doors: Door[]; myDoor: Door | null } {
  const toDoor = (k: Knock): Door => ({
    id: k.id,
    hostId: k.memberId,
    hostName: nameOf(k.memberId),
    activity: k.activity ?? null,
    note: k.note,
    until: k.until,
    justYou: k.memberId !== viewerId && (k.invites ?? []).length === 1 && k.invites![0] === viewerId,
  });
  const open = visibleKnocks(knocks, viewerId, nowMs);
  const mine = open.filter((k) => k.memberId === viewerId).sort((a, b) => b.at.localeCompare(a.at))[0];
  const doors = open
    .filter((k) => k.memberId !== viewerId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(toDoor)
    .sort((a, b) => Number(b.justYou) - Number(a.justYou));
  return { doors, myDoor: mine ? toDoor(mine) : null };
}

export type TogetherView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "doors"; mine: Door | null; first: Door | null; more: Door[] };

/**
 * What the Together card shows. Loading and error are their own states, and an error
 * never reads as "nobody is around": it only says the check failed.
 */
export function togetherView(data: { doors?: Door[]; myDoor?: Door | null } | null, failed: boolean, dismissed: ReadonlySet<string> = new Set()): TogetherView {
  if (!data) return failed ? { kind: "error" } : { kind: "loading" };
  const doors = (data.doors ?? []).filter((d) => !dismissed.has(d.id));
  const mine = data.myDoor ?? null;
  if (!mine && doors.length === 0) return { kind: "empty" };
  return { kind: "doors", mine, first: doors[0] ?? null, more: doors.slice(1) };
}

/** The one push for a one-person door: "Maa is having chai. Join?" */
export function doorPush(hostName: string, activity: Activity | null, note: string): string {
  const doing = activity ? PRESETS[activity].doing : note ? `opened the door: ${note}` : "opened the door for you";
  return `${hostName} ${doing}. Join?`;
}
