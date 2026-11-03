// Intl formatter construction is much more expensive than formatting a date.
// Cache the formatter only, never the date or family data. Bound the cache
// because time zones can come from saved profiles.
export function zonedFormatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const cache = new Map<string, Intl.DateTimeFormat>();
  return (timeZone: string): Intl.DateTimeFormat => {
    const cached = cache.get(timeZone);
    if (cached) return cached;
    const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    if (cache.size < 64) cache.set(timeZone, formatter);
    return formatter;
  };
}

export const dateInZone = zonedFormatter("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
export const clockInZone = zonedFormatter("en-US", { hour: "numeric", minute: "2-digit" });
