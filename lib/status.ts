// Safe & sound at a glance (SPEC §29.12): is the other home OK right now?
// Built only from activity people already share in Nearer (opening it,
// a moment, a voice note, a check-in). A web app can't see general phone
// use, so the words say "in Nearer". Pure (client + server).
import { hourIn } from "./zones";

export type Alive = "active" | "quiet" | "asleep" | "unknown" | "private";

/** Default: quiet this long while they're awake turns the dot amber. Each viewer can change it. */
export const QUIET_HOURS = 4;
export const QUIET_CHOICES = [2, 3, 4, 6, 8] as const;

export function aliveState(lastActive: string | null, tz: string, opts: { shares: boolean; now?: Date; quietAfter?: number } = { shares: true }): Alive {
  if (!opts.shares) return "private";
  const now = opts.now ?? new Date();
  const h = hourIn(tz, now);
  const night = h >= 22 || h < 7;
  if (!lastActive) return night ? "asleep" : "unknown";
  const hours = (now.getTime() - Date.parse(lastActive)) / 3_600_000;
  if (hours <= (opts.quietAfter ?? QUIET_HOURS)) return "active";
  // Overnight silence is sleep, not worry: no 3 AM amber.
  return night ? "asleep" : "quiet";
}

export const ALIVE_LOOK: Record<Alive, { dot: string; word: string }> = {
  active: { dot: "#3ccf7a", word: "Active" },
  quiet: { dot: "#f5a524", word: "Quiet" },
  asleep: { dot: "#8a93b8", word: "Asleep" },
  unknown: { dot: "#9a948c", word: "Not seen yet" },
  private: { dot: "#9a948c", word: "Private" },
};
