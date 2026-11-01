// When is everyone awake at once? Half-hour slots over the next ~36 hours,
// "awake" = 7 AM to 10 PM in each person's own zone. Pure (client + server).
import { isAwake } from "./zones";

export interface Window {
  start: Date;
  end: Date;
}

const SLOT = 30 * 60_000;

export function awakeWindows(zones: string[], from = new Date(), hours = 36): Window[] {
  const t0 = Math.ceil(from.getTime() / SLOT) * SLOT;
  const out: Window[] = [];
  let open: number | null = null;
  for (let t = t0; t <= t0 + hours * 3_600_000; t += SLOT) {
    const all = zones.length > 0 && zones.every((z) => isAwake(z, new Date(t)));
    if (all && open === null) open = t;
    if ((!all || t === t0 + hours * 3_600_000) && open !== null) {
      if (t - open >= SLOT) out.push({ start: new Date(open), end: new Date(t) });
      open = null;
    }
  }
  return out;
}

/** Up to n good start times: the start of each shared window (≥1h), at least 1h away. */
export function suggestTimes(zones: string[], from = new Date(), n = 3): Date[] {
  const soonest = from.getTime() + 60 * 60_000;
  const picks: Date[] = [];
  for (const w of awakeWindows(zones, from, 72)) {
    if (w.end.getTime() - w.start.getTime() < 60 * 60_000) continue;
    const start = Math.max(w.start.getTime(), Math.ceil(soonest / SLOT) * SLOT);
    if (w.end.getTime() - start < 30 * 60_000) continue;
    picks.push(new Date(start));
    if (picks.length >= n) break;
  }
  return picks;
}

/** A video room both sides can open with no account. Unguessable per sitting/knock. */
export function roomUrl(id: string, info?: { provider: string; domain: string; appId?: string }): string {
  const room = `Nearer-${id.replace(/[^a-zA-Z0-9-]/g, "")}`;
  return info?.provider === "jaas" && info.appId ? `https://${info.domain}/${info.appId}/${room}` : `https://meet.jit.si/${room}`;
}

/** A downloadable calendar entry (.ics) for one sitting. */
export function icsFor(input: { id: string; title: string; start: Date; minutes?: number; description?: string; url?: string }): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(input.start.getTime() + (input.minutes ?? 60) * 60_000);
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nearer//Sit together//EN",
    "BEGIN:VEVENT",
    `UID:${input.id}@aangan`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(input.title)}`,
    input.description ? `DESCRIPTION:${esc(input.description)}` : "",
    input.url ? `URL:${input.url}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
