// Festival Week: the seven days before a festival the family keeps. Pure
// (client + server). Everything festival-specific (title, steps, colour,
// greeting) comes from rituals/*.json and data/*.json; nothing here names a
// festival. Returns null when no kept festival falls in the window.
import { addDays, cleanTitle, daysBetween, occasionsInRange, visibleHolidays, type CalHoliday, type OccasionChoices, type OccasionStep } from "./occasion-calendar";
import type { Card, Member } from "./schemas";

/** How many days ahead the week starts. */
export const FESTIVAL_WEEK_DAYS = 7;
const MAX_PHOTOS = 6;

/** What a ritual config contributes (a subset of rituals/*.json). */
export interface FestivalRitual {
  slug: string;
  title: string;
  steps: OccasionStep[];
  accent?: string;
  lampAccent?: string;
  greeting?: string;
}

export type FestivalMode = "lead" | "ask" | "wish";

export interface FestivalWeek {
  slug: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  daysLeft: number;
  /** Card tint (#rrggbb), from the ritual JSON; null = neutral. */
  accent: string | null;
  greeting: string | null;
  /** The family's own photos of this festival from past years, newest year first. */
  pastPhotos: string[];
  /** Who leads this year: the eldest elder, or the host. */
  lead: string;
  stepsForLead: string[];
  /** What a child asks the lead, as a sentence. */
  askForChildren: string;
  /** Lamp ring glow (#rrggbb) for the week, from the ritual JSON; null = the usual glow. */
  lampAccent: string | null;
  /** What this viewer is invited to do. */
  mode: FestivalMode;
}

/** What GET /api/festival-week sends: the week plus the run its wishes gather on. */
export interface FestivalWeekPayload extends FestivalWeek {
  ritualRunId: string | null;
  viewerWished: boolean;
}

export interface FestivalWeekInput {
  /** The viewer's local day, YYYY-MM-DD. */
  today: string;
  /** Every mapped holiday (festivals link a ritual config by `ritual`). */
  holidays: CalHoliday[];
  /** The family's choices: only festivals they keep are in play. */
  choices: OccasionChoices;
  configs: FestivalRitual[];
  cards: Pick<Card, "id" | "type" | "takenAt" | "ritualSlug" | "mediaRef" | "coverRef">[];
  /** In the family's tree order (oldest generation first). */
  members: Pick<Member, "id" | "role" | "access" | "status">[];
  viewerId: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven"];

/** 0 -> "today", 1 -> "tomorrow", 4 -> "in four days". Words, never a count. */
export function daysInWords(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${WORDS[days] ?? String(days)} days`;
}

/**
 * Who leads: the eldest elder (no ages are stored, so the first elder in the
 * family's tree order), else the host (owner, then admin, then the first
 * grown-up). Pending invitations lead only if nobody else can.
 */
export function pickLead(members: Pick<Member, "id" | "role" | "access" | "status">[]): string | null {
  const pool = members.some((m) => m.status === "active") ? members.filter((m) => m.status === "active") : members;
  const elder = pool.find((m) => m.role === "elder");
  if (elder) return elder.id;
  const host = pool.find((m) => m.access === "owner") ?? pool.find((m) => m.access === "admin") ?? pool.find((m) => m.role === "adult") ?? pool[0];
  return host?.id ?? null;
}

/** The family's own photos from earlier years of this festival, newest year first, at most six. */
export function pastPhotoIds(cards: FestivalWeekInput["cards"], slug: string, year: number): string[] {
  return cards
    .filter((c) => c.ritualSlug === slug && (c.type === "photo" || c.type === "video") && (c.mediaRef || c.coverRef) && Number(c.takenAt.slice(0, 4)) < year)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
    .slice(0, MAX_PHOTOS)
    .map((c) => c.id);
}

export function festivalWeek(input: FestivalWeekInput): FestivalWeek | null {
  const { today, holidays, choices, configs, cards, members, viewerId } = input;
  const kept = visibleHolidays(holidays, choices).filter((h) => h.kind === "festival" && h.ritual);
  const lead = pickLead(members);
  if (!lead) return null;
  const upcoming = occasionsInRange([], kept, today, addDays(today, FESTIVAL_WEEK_DAYS));
  for (const o of upcoming) {
    const h = kept.find((x) => x.key === o.slug && x.date === o.date);
    const config = h && configs.find((c) => c.slug === h.ritual);
    if (!h || !config || config.steps.length === 0) continue;
    const title = cleanTitle(h.title) || cleanTitle(config.title);
    const viewer = members.find((m) => m.id === viewerId);
    const mode: FestivalMode = viewer?.role === "child" ? "ask" : viewer?.role === "elder" || viewerId === lead ? "lead" : "wish";
    return {
      slug: config.slug,
      title,
      date: o.date,
      daysLeft: daysBetween(today, o.date),
      accent: config.accent && HEX.test(config.accent) ? config.accent : null,
      greeting: config.greeting ?? null,
      pastPhotos: pastPhotoIds(cards, config.slug, Number(o.date.slice(0, 4))),
      lead,
      stepsForLead: config.steps.map((s) => s.prompt),
      askForChildren: `How do we celebrate ${title} at home? Tell us what to do, step by step.`,
      lampAccent: HEX.test(config.lampAccent ?? "") ? (config.lampAccent as string) : config.accent && HEX.test(config.accent) ? config.accent : null,
      mode,
    };
  }
  return null;
}

/* ------------------------------------------------- the steps checklist ticks */
// The ticks live in the browser (localStorage), keyed by family + festival +
// year, so they neither carry into next year's festival nor into another
// family's copy (a demo visitor's copy has its own family id).
export const STEP_TICKS_PREFIX = "aangan:festival-steps:";

export function stepTicksKey(familyId: string, slug: string, date: string): string {
  return `${STEP_TICKS_PREFIX}${familyId}:${slug}:${date.slice(0, 4)}`;
}

/** Remove ticks from earlier years and the old un-keyed format (`<slug>:<full date>`). Returns how many went. */
export function pruneStepTicks(store: Pick<Storage, "length" | "key" | "removeItem">, year: string): number {
  const stale: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !k.startsWith(STEP_TICKS_PREFIX)) continue;
    const parts = k.slice(STEP_TICKS_PREFIX.length).split(":");
    // Current format: <familyId>:<slug>:<year>. Anything else (old format, other year) goes.
    if (!(parts.length === 3 && parts[2] === year)) stale.push(k);
  }
  for (const k of stale) store.removeItem(k);
  return stale.length;
}
