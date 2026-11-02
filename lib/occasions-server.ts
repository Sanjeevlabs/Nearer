// Occasions, server side: ritual configs from rituals/*.json (data, never
// logic), member birthdays, national days, and the festivals of the
// traditions this family celebrates (lib/holidays.ts). Birthdays always
// count. Server only.
import { RITUAL_FILES } from "@/rituals";
import { daysUntilBirthday } from "./family";
import { bundledHolidays, cachedHolidays, countryForZones, holidaysFor, DEFAULT_LAMP_HOUR, type HolidayItem, type HolidayDeps, type HolidaySource } from "./holidays";
import { cleanTitle, visibleHolidays, type CalHoliday, type OccasionConfig } from "./occasion-calendar";
import { getRitualSettings, type RitualSettings } from "./occasion-settings";
import { loadRitualConfig } from "./rituals";
import type { Member } from "./schemas";

export interface Occasion {
  slug: string;
  title: string;
  date: string;
  days: number;
  memberId: string | null;
}

export interface ServerRitualConfig extends OccasionConfig {
  lampHour?: number;
}

/** Every valid config in rituals/*.json (bundled); a bad file is skipped, not fatal. */
export function ritualConfigs(): ServerRitualConfig[] {
  const out: ServerRitualConfig[] = [];
  for (const { name, json } of [...RITUAL_FILES].sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const c = loadRitualConfig(json);
      out.push({
        slug: c.slug,
        title: c.title,
        cultureNotes: c.cultureNotes,
        steps: c.steps,
        ...(c.lampHour !== undefined ? { lampHour: c.lampHour } : {}),
        ...(c.accent ? { accent: c.accent } : {}),
        ...(c.lampAccent ? { lampAccent: c.lampAccent } : {}),
        ...(c.greeting ? { greeting: c.greeting } : {}),
      });
    } catch {
      console.error("[occasions] skipped invalid ritual config", name);
    }
  }
  return out;
}

/** A linked ritual config's lampHour wins over the pattern's. */
export function withRitualLampHours(items: HolidayItem[], configs: ServerRitualConfig[]): HolidayItem[] {
  return items.map((h) => {
    if (h.kind !== "festival") return h;
    const c = h.ritual ? configs.find((x) => x.slug === h.ritual) : undefined;
    return { ...h, lampHour: c?.lampHour ?? h.lampHour ?? DEFAULT_LAMP_HOUR };
  });
}

export interface FamilyHolidays {
  country: string;
  source: HolidaySource;
  settings: RitualSettings;
  /** Every mapped holiday for the country (the settings sheet lists these). */
  all: HolidayItem[];
  /** Only what this family's calendar shows. */
  visible: HolidayItem[];
}

/**
 * `preloaded.settings`: a caller that started the settings read before it knew
 * the members (so the read ran alongside theirs, not after) hands it in.
 */
export async function familyHolidays(familyId: string, members: Pick<Member, "tz">[], deps: HolidayDeps = {}, preloaded: { settings?: Promise<RitualSettings> | RitualSettings } = {}): Promise<FamilyHolidays> {
  const country = countryForZones(members.map((m) => m.tz));
  const [settings, feed] = await Promise.all([preloaded.settings ?? getRitualSettings(familyId), holidaysFor(country, deps)]);
  const all = withRitualLampHours(feed.items, ritualConfigs());
  return { country, source: feed.source, settings, all, visible: visibleHolidays(all, settings) };
}

/**
 * familyHolidays for the first screen: never waits on the calendar feed. What
 * this isolate has cached (or the bundled calendar) answers now; a stale or
 * missing feed is refreshed in the background (`refresh`, default: just start
 * it) so the next request has it.
 */
export async function familyHolidaysNow(familyId: string, members: Pick<Member, "tz">[], settings: Promise<RitualSettings> | RitualSettings, refresh: (work: () => Promise<unknown>) => void = (w) => void w().catch(() => undefined)): Promise<FamilyHolidays> {
  const country = countryForZones(members.map((m) => m.tz));
  let feed = cachedHolidays(country);
  if (!feed) {
    refresh(() => holidaysFor(country));
    feed = bundledHolidays(country);
  }
  const s = await settings;
  const all = withRitualLampHours(feed.items, ritualConfigs());
  return { country, source: feed.source, settings: s, all, visible: visibleHolidays(all, s) };
}

/**
 * The next occasion to wish for inside `within` days: birthdays, plus the
 * given festivals (already filtered to the family's choice). National days
 * sit on the calendar but nobody is asked for a wish.
 */
export function nextOccasion(members: Member[], now = new Date(), within = 30, holidays: CalHoliday[] = []): Occasion | null {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: Occasion[] = [];
  for (const h of holidays) {
    if (h.kind !== "festival") continue;
    const days = Math.round((Date.parse(`${h.date}T00:00:00Z`) - start) / 86_400_000);
    if (days >= 0) out.push({ slug: h.key, title: cleanTitle(h.title), date: h.date, days, memberId: null });
  }
  for (const m of members) {
    const days = daysUntilBirthday(m.birthday, now);
    if (!Number.isFinite(days)) continue;
    const d = new Date(start + days * 86_400_000).toISOString().slice(0, 10);
    out.push({ slug: "birthday", title: `${m.displayName || m.firstName}'s birthday`, date: d, days, memberId: m.id });
  }
  return out.filter((o) => o.days <= within).sort((a, b) => a.days - b.days)[0] ?? null;
}

/** nextOccasion with the family's own calendar looked up. */
export async function nextOccasionFor(familyId: string, members: Member[], now = new Date(), within = 30, holidays?: Promise<Pick<FamilyHolidays, "visible">>): Promise<Occasion | null> {
  const { visible } = await (holidays ?? familyHolidays(familyId, members)).catch(() => ({ visible: [] as HolidayItem[] }));
  return nextOccasion(members, now, within, visible);
}
