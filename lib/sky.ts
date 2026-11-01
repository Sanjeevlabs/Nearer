// The same sky (SPEC §30.1): where the sun is over their home right now and
// tonight's moon. Pure astronomy, no network: NOAA's solar-position
// approximation and the mean synodic month. Accurate to a degree or two and
// within a few hours on the phase, which is plenty for a window. Client + server.

const RAD = Math.PI / 180;
const SYNODIC = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

export interface SunPos {
  /** Degrees above the horizon (negative = below). */
  altitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

/** Sun position for a latitude/longitude at an instant. */
export function sunPosition(lat: number, lon: number, at = new Date()): SunPos {
  const ms = at.getTime();
  const day = (ms - Date.UTC(at.getUTCFullYear(), 0, 0)) / 86_400_000; // day of year with fraction
  const g = ((2 * Math.PI) / 365) * (day - 1 + (at.getUTCHours() - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const utcMin = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
  const tst = (((utcMin + eqt + 4 * lon) % 1440) + 1440) % 1440; // true solar time, minutes
  const ha = (tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const altitude = 90 - zen / RAD;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { altitude, azimuth: (az + 360) % 360 };
}

export interface MoonPhase {
  /** 0 = new, 0.5 = full, 1 = new again. */
  phase: number;
  /** Lit fraction of the disc, 0..1. */
  illumination: number;
  waxing: boolean;
  name: string;
}

export function moonPhase(at = new Date()): MoonPhase {
  const days = (at.getTime() - NEW_MOON_MS) / 86_400_000;
  const phase = (((days / SYNODIC) % 1) + 1) % 1;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const waxing = phase < 0.5;
  const name =
    illumination < 0.03 ? "New moon" : illumination > 0.97 ? "Full moon" : Math.abs(illumination - 0.5) < 0.06 ? (waxing ? "First quarter" : "Last quarter") : illumination < 0.5 ? (waxing ? "Waxing crescent" : "Waning crescent") : waxing ? "Waxing gibbous" : "Waning gibbous";
  return { phase, illumination, waxing, name };
}

/**
 * Where to draw the sun in the window's arch (0..1 across, 0..1 down),
 * east on the left. null when it's below the horizon.
 */
export function sunInArch(pos: SunPos): { x: number; y: number } | null {
  if (pos.altitude < -2) return null;
  // Map azimuth 60°..300° (east..west through south) across the arch.
  const x = Math.max(0.08, Math.min(0.92, (pos.azimuth - 60) / 240));
  const y = Math.max(0.08, Math.min(0.85, 0.85 - (Math.max(0, pos.altitude) / 70) * 0.77));
  return { x, y };
}

export type SolarPhase = "day" | "twilight" | "night";

/** Sunrise to sunset is day (the sun's centre above -0.833°, refraction included); below -6° (civil twilight over) is night; in between, neither. */
export function solarPhase(altitude: number): SolarPhase {
  if (altitude > -0.833) return "day";
  if (altitude > -6) return "twilight";
  return "night";
}

/** The glyph for a badge: the sun by day, the moon at night, nothing at twilight or without coordinates. */
export function skyGlyph(lat: number | undefined, lon: number | undefined, at = new Date()): "sun" | "moon" | null {
  if (lat === undefined || lon === undefined) return null;
  const p = solarPhase(sunPosition(lat, lon, at).altitude);
  return p === "day" ? "sun" : p === "night" ? "moon" : null;
}

/** Is it night (sun more than 6° below the horizon) at this place? null when we don't know where it is. */
export function isNightAt(lat: number | undefined, lon: number | undefined, at = new Date()): boolean | null {
  if (lat === undefined || lon === undefined) return null;
  return solarPhase(sunPosition(lat, lon, at).altitude) === "night";
}

/**
 * SVG path for the dark part of the moon disc (radius r, centred at r,r),
 * so the lit part shows through. Waxing lights the right side (northern sky).
 */
export function moonShadowPath(r: number, m: MoonPhase): string {
  const k = 1 - 2 * m.illumination; // ellipse x-scale for the terminator, 1..-1
  const rx = Math.abs(k) * r;
  const darkSide = m.waxing ? 0 : 1; // waxing: left half dark
  const sweepOuter = darkSide === 0 ? 0 : 1;
  const sweepInner = k > 0 ? (darkSide === 0 ? 0 : 1) : darkSide === 0 ? 1 : 0;
  return `M ${r} 0 A ${r} ${r} 0 0 ${sweepOuter} ${r} ${2 * r} A ${rx} ${r} 0 0 ${sweepInner} ${r} 0 Z`;
}
