"use client";

// The first screen's picture of their home: their open space (a window, a
// balcony or a courtyard) under THEIR real sky right now, and the lamp, which
// hangs in the upper half and is a real button. Two renderers behind one
// interface; lib/hero.ts SCENE_RENDERER picks one. Nothing untrue is drawn:
// the sky follows lib/sky-state.ts (sun altitude, real moon phase, a weather
// layer only from a fetched code). No text is ever drawn on the picture.

import { useEffect, useRef, useState } from "react";
import { SCENE_RENDERER, WINDOW_PHOTO_HEIGHT, photoSceneCandidates, type SceneRenderer, type SceneSpace } from "@/lib/hero";
import { moonShadowPath } from "@/lib/sky";
import type { SkyState } from "@/lib/sky-state";
import { cn } from "@/lib/utils";

export interface SceneProps {
  sky: SkyState;
  space: SceneSpace;
  /** The viewer's own photo of their home (Settings, Your window, Photo), if any. */
  ownPhoto: string | null;
  /** Tap: light the lamp for them. Hold 600 ms: a heartbeat. */
  onLight: () => void;
  onHold: () => void;
  /** Bumps on each light / heartbeat for a soft ring. */
  pulseKey: number;
  /** Accessible name for the lamp button (says whether it is lit). */
  lampLabel: string;
  children?: React.ReactNode;
}

/* --------------------------------------------------------------- the sky */
const SKY: Record<SkyState["phase"], [string, string]> = {
  night: ["#101a33", "#2a3456"],
  dawn: ["#f2c7a5", "#cfe0f0"],
  day: ["#9cc8ec", "#e3f0f8"],
  dusk: ["#5b5a8a", "#f0b28a"],
};
const OVERCAST: Record<SkyState["phase"], [string, string]> = {
  night: ["#151a26", "#2a2f3c"],
  dawn: ["#c9c2bd", "#e2dfdc"],
  day: ["#b8c3cc", "#e5e9ec"],
  dusk: ["#6c6878", "#bba59a"],
};

/** Where the sun sits in the opening (0..1), east on the left; null below the horizon. */
function sunSpot(alt: number | null, az: number | null): { x: number; y: number } | null {
  if (alt === null || az === null || alt < -1) return null;
  const x = Math.max(0.12, Math.min(0.88, (az - 60) / 240));
  const y = Math.max(0.12, Math.min(0.82, 0.82 - (Math.max(0, alt) / 70) * 0.7));
  return { x, y };
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduce(mq.matches);
      const on = () => setReduce(mq.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    } catch {
      setReduce(true);
    }
  }, []);
  return reduce;
}

/** Stars at fixed, scattered spots (seeded, so every render matches the server's). */
const STARS = Array.from({ length: 26 }, (_, i) => ({ x: ((i * 97) % 100) / 100, y: ((i * 53) % 58) / 100, r: i % 5 === 0 ? 1.4 : 0.9, d: (i % 7) * 0.6 }));

/** The sky inside an opening of width w, height h. Ids are prefixed so two skies never clash. */
function SkyLayer({ sky, w, h, id, motion }: { sky: SkyState; w: number; h: number; id: string; motion: boolean }) {
  const grey = sky.weather === "cloud" || sky.weather === "rain" || sky.weather === "drizzle" || sky.weather === "thunder" || sky.weather === "fog" || sky.weather === "snow";
  const [top, bottom] = (grey ? OVERCAST : SKY)[sky.phase];
  const sun = sky.phase !== "night" ? sunSpot(sky.sunAltitude, sky.sunAzimuth) : null;
  const moonR = Math.min(w, h) * 0.075;
  const mx = w * 0.7;
  const my = h * 0.26;
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor="#fff6d8" />
          <stop offset="0.45" stopColor="#ffe7a8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffe7a8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${id}-sky)`} />
      {sky.stars &&
        STARS.map((s, i) => (
          <circle key={i} cx={s.x * w} cy={s.y * h} r={s.r} fill="#fff" opacity={0.8} className={motion ? "scene-twinkle" : undefined} style={motion ? { animationDelay: `${s.d}s` } : undefined} />
        ))}
      {sun && !grey && <circle cx={sun.x * w} cy={sun.y * h} r={Math.min(w, h) * 0.16} fill={`url(#${id}-sun)`} />}
      {sun && grey && <circle cx={sun.x * w} cy={sun.y * h} r={Math.min(w, h) * 0.08} fill="#fff" opacity={0.35} />}
      {sky.moonVisible && (
        <g transform={`translate(${mx - moonR} ${my - moonR})`} opacity={grey ? 0.55 : 1}>
          <circle cx={moonR} cy={moonR} r={moonR} fill="#f4efe1" />
          {sky.moon.illumination < 0.985 && <path d={moonShadowPath(moonR, { phase: sky.moon.phaseAngle / 360, illumination: sky.moon.illumination, waxing: sky.moon.waxing, name: sky.moon.name })} fill={top} opacity={0.92} />}
        </g>
      )}
      {(sky.weather === "cloud" || sky.weather === "rain" || sky.weather === "drizzle" || sky.weather === "thunder") && (
        <g fill="#ffffff" opacity={sky.phase === "night" ? 0.12 : 0.55} className={motion ? "scene-drift" : undefined}>
          <ellipse cx={w * 0.28} cy={h * 0.22} rx={w * 0.22} ry={h * 0.06} />
          <ellipse cx={w * 0.38} cy={h * 0.17} rx={w * 0.14} ry={h * 0.06} />
          <ellipse cx={w * 0.74} cy={h * 0.36} rx={w * 0.2} ry={h * 0.05} />
        </g>
      )}
      {sky.weather === "fog" && <rect y={h * 0.45} width={w} height={h * 0.55} fill="#fff" opacity={0.35} />}
    </g>
  );
}

/** Rain, drizzle or snow falling across the whole picture (drawn in front). */
function Particles({ sky, w, h, motion }: { sky: SkyState; w: number; h: number; motion: boolean }) {
  if (sky.weather !== "rain" && sky.weather !== "drizzle" && sky.weather !== "thunder" && sky.weather !== "snow") return null;
  const n = sky.weather === "drizzle" ? 18 : 30;
  const snow = sky.weather === "snow";
  return (
    <g className={motion ? (snow ? "scene-snow" : "scene-rain") : undefined} opacity={0.5} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const x = ((i * 61) % 100) / 100 * w;
        const y = ((i * 37) % 100) / 100 * h;
        return snow ? <circle key={i} cx={x} cy={y} r={1.6} fill="#fff" /> : <line key={i} x1={x} y1={y} x2={x - 2} y2={y + 9} stroke="#dfe8f2" strokeWidth={1} strokeLinecap="round" />;
      })}
    </g>
  );
}

/* --------------------------------------------------------------- the lamp */
/** A simple hanging lantern: a cord, a cap, a glass body. Glow 0..1 warms it. Centred at (x, y top of cord). */
function Lantern({ x, y, glow, cord }: { x: number; y: number; glow: number; cord: number }) {
  const lit = glow > 0;
  const by = y + cord;
  return (
    <g aria-hidden="true">
      <defs>
        <radialGradient id="lamp-halo">
          <stop offset="0" stopColor="#ffd88a" stopOpacity={0.75 * glow} />
          <stop offset="0.5" stopColor="#ffcf73" stopOpacity={0.28 * glow} />
          <stop offset="1" stopColor="#ffcf73" stopOpacity="0" />
        </radialGradient>
      </defs>
      {lit && <circle cx={x} cy={by + 22} r={46 + 30 * glow} fill="url(#lamp-halo)" />}
      <line x1={x} y1={y} x2={x} y2={by} stroke="var(--scene-line)" strokeWidth={1.2} />
      <path d={`M ${x - 9} ${by + 6} L ${x} ${by} L ${x + 9} ${by + 6} Z`} fill="var(--scene-frame)" stroke="var(--scene-line)" strokeWidth={1.2} strokeLinejoin="round" />
      <rect x={x - 11} y={by + 6} width={22} height={30} rx={6} fill={lit ? `rgba(255, 214, 140, ${0.35 + 0.6 * glow})` : "var(--scene-glass)"} stroke="var(--scene-line)" strokeWidth={1.2} />
      <line x1={x} y1={by + 6} x2={x} y2={by + 36} stroke="var(--scene-line)" strokeWidth={0.8} opacity={0.5} />
      {lit && <ellipse cx={x} cy={by + 22} rx={3.2} ry={5} fill="#fff1c9" opacity={0.6 + 0.4 * glow} />}
      <rect x={x - 7} y={by + 36} width={14} height={4} rx={2} fill="var(--scene-frame)" stroke="var(--scene-line)" strokeWidth={1.2} />
    </g>
  );
}

/** The lamp as a real button over the drawing: tap lights it, hold 600 ms sends a heartbeat. */
function LampButton({ left, top, onLight, onHold, pulseKey, label }: { left: string; top: string; onLight: () => void; onHold: () => void; pulseKey: number; label: string }) {
  const held = useRef<number | "held" | null>(null);
  return (
    <button
      type="button"
      data-ui="window-lamp-button"
      aria-label={label}
      title="Tap to light · hold for a heartbeat"
      className="absolute grid h-[64px] w-[56px] -translate-x-1/2 place-items-center rounded-full"
      style={{ left, top }}
      onPointerDown={() => {
        held.current = window.setTimeout(() => {
          held.current = "held";
          onHold();
        }, 600);
      }}
      onPointerUp={() => {
        if (held.current === "held") return void (held.current = null);
        if (held.current !== null) window.clearTimeout(held.current);
        held.current = null;
        onLight();
      }}
      onPointerLeave={() => {
        if (typeof held.current === "number") window.clearTimeout(held.current);
        held.current = null;
      }}
      onKeyDown={(e) => {
        // Keyboard: Enter or Space lights it (pointer events don't fire); H sends a heartbeat.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLight();
        } else if (e.key === "h" || e.key === "H") onHold();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span key={pulseKey} className={cn("block h-10 w-10 rounded-full", pulseKey > 0 && "lamp-ring")} aria-hidden="true" />
    </button>
  );
}

/* --------------------------------------------------------- the drawn scene */
const W = 390;
const H = 360;

/** The opening (where the sky shows) and the frame around it, per space. */
function Frame({ space, sky, motion }: { space: SceneSpace; sky: SkyState; motion: boolean }) {
  const petal = (n: number) => `var(--petal-${n})`;
  if (space === "balcony") {
    // A wide opening, a slim railing, two plant pots.
    return (
      <g>
        <svg x={0} y={0} width={W} height={H * 0.72} viewBox={`0 0 ${W} ${H * 0.72}`}>
          <SkyLayer sky={sky} w={W} h={H * 0.72} id="bal" motion={motion} />
        </svg>
        <rect x={0} y={H * 0.72} width={W} height={H * 0.28} fill="var(--scene-floor)" />
        <line x1={0} y1={H * 0.72} x2={W} y2={H * 0.72} stroke="var(--scene-line)" strokeWidth={1.2} />
        <g stroke="var(--scene-line)" strokeWidth={1.4}>
          <line x1={0} y1={H * 0.56} x2={W} y2={H * 0.56} />
          {Array.from({ length: 14 }, (_, i) => (
            <line key={i} x1={14 + i * 28} y1={H * 0.56} x2={14 + i * 28} y2={H * 0.72} />
          ))}
        </g>
        <rect x={0} y={0} width={W} height={10} fill="var(--scene-frame)" />
        <Pot x={44} y={H * 0.72} leaf={petal(2)} pot={petal(1)} />
        <Pot x={W - 60} y={H * 0.72} leaf={petal(2)} pot={petal(5)} small />
      </g>
    );
  }
  if (space === "courtyard") {
    // Two plain walls, an open sky above, a step and a single pot.
    return (
      <g>
        <svg x={0} y={0} width={W} height={H * 0.5} viewBox={`0 0 ${W} ${H * 0.5}`}>
          <SkyLayer sky={sky} w={W} h={H * 0.5} id="crt" motion={motion} />
        </svg>
        <path d={`M 0 ${H * 0.2} L 92 ${H * 0.34} L 92 ${H * 0.86} L 0 ${H}`} fill="var(--scene-wall-side)" stroke="var(--scene-line)" strokeWidth={1.2} />
        <path d={`M ${W} ${H * 0.2} L ${W - 92} ${H * 0.34} L ${W - 92} ${H * 0.86} L ${W} ${H}`} fill="var(--scene-wall-side)" stroke="var(--scene-line)" strokeWidth={1.2} />
        <rect x={92} y={H * 0.34} width={W - 184} height={H * 0.52} fill="var(--scene-wall)" stroke="var(--scene-line)" strokeWidth={1.2} />
        <path d={`M 160 ${H * 0.86} L 160 ${H * 0.56} Q 195 ${H * 0.46} 230 ${H * 0.56} L 230 ${H * 0.86}`} fill="var(--scene-door)" stroke="var(--scene-line)" strokeWidth={1.2} />
        <path d={`M 0 ${H} L 92 ${H * 0.86} L ${W - 92} ${H * 0.86} L ${W} ${H} Z`} fill="var(--scene-floor)" stroke="var(--scene-line)" strokeWidth={1.2} />
        <Pot x={110} y={H * 0.86} leaf={petal(2)} pot={petal(1)} />
        <Pot x={W - 140} y={H * 0.86} leaf={petal(2)} pot={petal(3)} small />
      </g>
    );
  }
  // The window (default): a wall, a tall arched opening, a sill with a pot.
  const ox = 95;
  const ow = W - 190;
  const oy = 46;
  const oh = H - 120;
  return (
    <g>
      <rect width={W} height={H} fill="var(--scene-wall)" />
      <svg x={ox} y={oy} width={ow} height={oh} viewBox={`0 0 ${ow} ${oh}`}>
        <clipPath id="win-clip">
          <path d={`M 0 ${oh} L 0 ${ow / 2} A ${ow / 2} ${ow / 2} 0 0 1 ${ow} ${ow / 2} L ${ow} ${oh} Z`} />
        </clipPath>
        <g clipPath="url(#win-clip)">
          <SkyLayer sky={sky} w={ow} h={oh} id="win" motion={motion} />
        </g>
      </svg>
      <path d={`M ${ox} ${oy + oh} L ${ox} ${oy + ow / 2} A ${ow / 2} ${ow / 2} 0 0 1 ${ox + ow} ${oy + ow / 2} L ${ox + ow} ${oy + oh}`} fill="none" stroke="var(--scene-frame)" strokeWidth={8} />
      <path d={`M ${ox} ${oy + oh} L ${ox} ${oy + ow / 2} A ${ow / 2} ${ow / 2} 0 0 1 ${ox + ow} ${oy + ow / 2} L ${ox + ow} ${oy + oh}`} fill="none" stroke="var(--scene-line)" strokeWidth={1.2} />
      <line x1={ox + ow / 2} y1={oy + 8} x2={ox + ow / 2} y2={oy + oh} stroke="var(--scene-frame)" strokeWidth={3} />
      <line x1={ox} y1={oy + oh * 0.55} x2={ox + ow} y2={oy + oh * 0.55} stroke="var(--scene-frame)" strokeWidth={3} />
      <rect x={ox - 18} y={oy + oh} width={ow + 36} height={10} rx={2} fill="var(--scene-frame)" stroke="var(--scene-line)" strokeWidth={1.2} />
      <rect x={0} y={oy + oh + 10} width={W} height={H - oy - oh - 10} fill="var(--scene-wall-low)" />
      <Pot x={ox + 18} y={oy + oh} leaf={petal(2)} pot={petal(1)} small />
      <Pot x={ox + ow - 48} y={oy + oh} leaf={petal(2)} pot={petal(5)} small />
    </g>
  );
}

function Pot({ x, y, leaf, pot, small }: { x: number; y: number; leaf: string; pot: string; small?: boolean }) {
  const s = small ? 0.8 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} stroke="var(--scene-line)" strokeWidth={1.2}>
      <path d="M 14 -26 Q 2 -46 10 -58 Q 18 -44 16 -26" fill={leaf} fillOpacity={0.55} />
      <path d="M 18 -26 Q 30 -50 22 -62 Q 14 -46 18 -26" fill={leaf} fillOpacity={0.4} />
      <path d="M 0 -26 L 32 -26 L 27 0 L 5 0 Z" fill={pot} fillOpacity={0.45} />
    </g>
  );
}

/** Where the lamp hangs in each space (x 0..1, top of the cord in px, cord length). */
const LAMP_AT: Record<SceneSpace, { x: number; top: number; cord: number }> = {
  window: { x: 0.5, top: 0, cord: 70 },
  balcony: { x: 0.2, top: 10, cord: 48 },
  courtyard: { x: 0.5, top: 0, cord: 56 },
};

export function DrawnScene({ sky, space, onLight, onHold, pulseKey, lampLabel, children }: SceneProps) {
  const motion = !useReducedMotion();
  const at = LAMP_AT[space];
  return (
    <div data-ui="window-scene" data-renderer="drawn" data-phase={sky.phase} className="window-scene relative w-full overflow-hidden" style={{ height: WINDOW_PHOTO_HEIGHT }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label={`A drawing of their home, ${sky.phase === "day" ? "in daylight" : sky.phase === "night" ? "at night" : `at ${sky.phase}`}`}>
        <Frame space={space} sky={sky} motion={motion} />
        <Lantern x={W * at.x} y={at.top} glow={sky.lampGlow} cord={at.cord} />
        <Particles sky={sky} w={W} h={H} motion={motion} />
        {sky.phase === "night" && <rect width={W} height={H} fill="#0b1020" opacity={0.18} />}
      </svg>
      <LampButton left={`${at.x * 100}%`} top={`${((at.top + at.cord - 8) / H) * 100}%`} onLight={onLight} onHold={onHold} pulseKey={pulseKey} label={lampLabel} />
      {children}
    </div>
  );
}

/* ---------------------------------------------------------- the photo scene */
/** A photo per space/phase/weather, best match first; only the lamp glow and particles drawn over it. No text. */
export function PhotoScene({ sky, space, ownPhoto, onLight, onHold, pulseKey, lampLabel, children }: SceneProps) {
  const motion = !useReducedMotion();
  // The viewer's own photo is a mode of its own: it shows as is. Otherwise the per-sky photos, best match first.
  const list = ownPhoto ? [ownPhoto] : photoSceneCandidates(space, sky.phase, sky.weather, null);
  const [i, setI] = useState(0);
  const src = list[Math.min(i, list.length - 1)];
  const at = LAMP_AT[space];
  return (
    <div data-ui="window-scene" data-renderer="photo" data-phase={sky.phase} className="window-scene relative w-full overflow-hidden bg-[var(--scene-wall)]" style={{ height: WINDOW_PHOTO_HEIGHT }}>
      {i < list.length && (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="Their home" className="absolute inset-0 h-full w-full object-cover" onError={() => setI((n) => n + 1)} />
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {sky.lampGlow > 0 && <circle cx={W * at.x} cy={at.top + at.cord + 22} r={60 + 40 * sky.lampGlow} fill="#ffcf73" opacity={0.25 * sky.lampGlow} />}
        {sky.stars && STARS.slice(0, 12).map((s, k) => <circle key={k} cx={s.x * W} cy={s.y * H * 0.5} r={s.r} fill="#fff" opacity={0.7} />)}
        <Particles sky={sky} w={W} h={H} motion={motion} />
      </svg>
      <LampButton left={`${at.x * 100}%`} top={`${((at.top + at.cord - 8) / H) * 100}%`} onLight={onLight} onHold={onHold} pulseKey={pulseKey} label={lampLabel} />
      {children}
    </div>
  );
}

/** The scene the one constant in lib/hero.ts selects; a viewer's own photo always shows as a PhotoScene. */
export function WindowScene(props: SceneProps & { renderer?: SceneRenderer }) {
  const renderer = props.ownPhoto ? "photo" : (props.renderer ?? SCENE_RENDERER);
  return renderer === "photo" ? <PhotoScene {...props} /> : <DrawnScene {...props} />;
}
