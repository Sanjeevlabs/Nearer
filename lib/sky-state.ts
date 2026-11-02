// What the window draws over their home, right now, from things that are true:
// the sun's altitude at THEIR city (lib/sky.ts, NOAA), tonight's moon (real
// synodic phase), the Open-Meteo weather code (only if it was fetched) and the
// lamp. Pure and deterministic for a given instant: client + server, tested.
import { glowFrom } from "./lamp";
import { moonPhase, solarPhase, sunPosition } from "./sky";
import { groundedLayers } from "./window";
import { hourIn } from "./zones";
import { phaseFor, type DayPhase } from "./weather";

export type SkyPhase = DayPhase;
export type WeatherLayer = "clear" | "cloud" | "rain" | "drizzle" | "fog" | "snow" | "thunder";

export interface SkyState {
  phase: SkyPhase;
  /** The sun over their city, degrees above the horizon; null without coordinates. */
  sunAltitude: number | null;
  /** Degrees clockwise from north; null without coordinates. */
  sunAzimuth: number | null;
  moon: {
    /** Lit fraction 0..1. */
    illumination: number;
    /** 0..360: 0 new, 90 first quarter, 180 full, 270 last quarter. */
    phaseAngle: number;
    waxing: boolean;
    name: string;
  };
  /** Night at THEIR end: the only time the window draws (or mentions) the moon. */
  moonVisible: boolean;
  /** Stars: night there and no rain or storm in the fetched weather. */
  stars: boolean;
  /** The weather layer, only from a fetched code; null when we don't know (then nothing is drawn). */
  weather: WeatherLayer | null;
  /** The lamp: 1 within 24 h of being lit, fading to 0 at 72 h. */
  lampGlow: number;
}

/** Open-Meteo WMO weather_code -> what the scene draws. */
export function weatherLayer(code: number | null | undefined): WeatherLayer | null {
  if (code === null || code === undefined || !Number.isFinite(code)) return null;
  if (code <= 1) return "clear";
  if (code <= 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "cloud";
}

/**
 * Day phase from the sun's altitude: above 6° day; -6°..6° dawn (morning) or
 * dusk (afternoon/evening, by azimuth); below -6° night.
 */
export function phaseFromSun(altitude: number, azimuth: number): SkyPhase {
  if (altitude > 6) return "day";
  if (solarPhase(altitude) === "night") return "night";
  return azimuth < 180 ? "dawn" : "dusk";
}

/** The kind the older Weather type used, so groundedLayers can vouch for the layers drawn. */
const LEGACY_KIND: Record<WeatherLayer, "clear" | "clouds" | "fog" | "rain" | "storm" | "snow"> = { clear: "clear", cloud: "clouds", fog: "fog", rain: "rain", drizzle: "rain", snow: "snow", thunder: "storm" };

export function skyState(i: { lat?: number | null; lon?: number | null; tz: string; now: Date; weatherCode?: number | null; lampLitAt?: string | null }): SkyState {
  const known = typeof i.lat === "number" && typeof i.lon === "number";
  const sun = known ? sunPosition(i.lat as number, i.lon as number, i.now) : null;
  const phase = sun ? phaseFromSun(sun.altitude, sun.azimuth) : phaseFor(hourIn(i.tz, i.now));
  const m = moonPhase(i.now);
  const weather = weatherLayer(i.weatherCode);
  // groundedLayers is the one place that decides what may be drawn from the weather and the hour.
  const layers = groundedLayers(weather ? ({ kind: LEGACY_KIND[weather] } as Parameters<typeof groundedLayers>[0]) : null, phase, []);
  const drawn: WeatherLayer | null = weather === null ? null : weather === "clear" || weather === "snow" || weather === "fog" ? weather : layers.includes("rain") || layers.includes("clouds") ? weather : null;
  return {
    phase,
    sunAltitude: sun ? Math.round(sun.altitude * 10) / 10 : null,
    sunAzimuth: sun ? Math.round(sun.azimuth) : null,
    moon: { illumination: Math.round(m.illumination * 100) / 100, phaseAngle: Math.round(m.phase * 3600) / 10, waxing: m.waxing, name: m.name },
    moonVisible: phase === "night",
    stars: layers.includes("stars"),
    weather: drawn,
    lampGlow: glowFrom(i.lampLitAt ?? null, i.now.getTime()),
  };
}
