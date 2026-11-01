// Which country a member lives in, for looking up the right city (there is more
// than one Amritsar, Bengaluru and Aurora). From the explicit country field when
// a member has one, else their time zone through data/traditions.json. Pure.
import traditionsRaw from "../data/traditions.json";

const ZONES = (traditionsRaw as { zones: { match: string; country: string }[] }).zones.map((z) => ({ re: new RegExp(z.match), country: z.country }));

/** ISO country code ("IN") or null when it is not known: never a guess. */
export function countryOfTz(tz: string | null | undefined): string | null {
  if (!tz || tz === "UTC") return null;
  return ZONES.find((z) => z.re.test(tz))?.country ?? null;
}

export function countryOfMember(m: { tz?: string | null; country?: string | null } | undefined): string | null {
  const explicit = m && typeof m.country === "string" && /^[A-Za-z]{2}$/.test(m.country) ? m.country.toUpperCase() : null;
  return explicit ?? countryOfTz(m?.tz);
}
