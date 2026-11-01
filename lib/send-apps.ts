// "Send something" → the apps a family already uses, by category, for the
// recipient's home country (data/send-apps.json). Links only: Nearer places
// nothing; the app or site takes over. Client-safe.
import { z } from "zod";
import raw from "../data/send-apps.json";
import traditions from "../data/traditions.json";

const AppSchema = z.object({
  name: z.string().min(1).max(40),
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "https only")
    .refine((u) => !new URL(u).search && !new URL(u).hash, "no query or fragment (no tracking or referral parameters)"),
});
const CategorySchema = z.object({ id: z.string().regex(/^[a-z-]+$/), label: z.string().min(1).max(30), icon: z.string().min(1) });

export const SendAppsSchema = z
  .object({
    categories: z.array(CategorySchema).min(1),
    countries: z.record(z.object({ name: z.string().min(1), apps: z.record(z.array(AppSchema).max(1)) })),
  })
  .refine((d) => Boolean(d.countries["*"]), "needs a '*' fallback")
  .refine((d) => Object.values(d.countries).every((c) => Object.keys(c.apps).every((k) => d.categories.some((cat) => cat.id === k))), "every app list names a known category");

export type SendApps = z.infer<typeof SendAppsSchema>;
export type SendApp = z.infer<typeof AppSchema>;

export const SEND_APPS: SendApps = SendAppsSchema.parse(raw);

const ZONES = (traditions as { zones: { match: string; country: string }[] }).zones.map((z) => ({ re: new RegExp(z.match), country: z.country }));

/** The country code for a time zone (data/traditions.json zones), or null. */
export function countryForTz(tz: string | null | undefined): string | null {
  if (!tz) return null;
  return ZONES.find((z) => z.re.test(tz))?.country ?? null;
}

/** Categories with their apps for a country (falling back to '*'); empty categories are left out. */
export function appsFor(country: string | null): { country: string; name: string; categories: { id: string; label: string; icon: string; apps: SendApp[] }[] } {
  const key = country && SEND_APPS.countries[country] ? country : "*";
  const c = SEND_APPS.countries[key];
  return {
    country: key,
    name: c.name,
    categories: SEND_APPS.categories.map((cat) => ({ ...cat, apps: c.apps[cat.id] ?? [] })).filter((cat) => cat.apps.length > 0),
  };
}
