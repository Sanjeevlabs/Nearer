// The key: a short, soft two-tick click when the key is slid home. Web Audio only, made from
// noise and a faint ring (no recording, no model, no creak); about 160 ms and quiet. Silent when
// the person asked for reduced motion or turned sound off (localStorage "nearer:sound" = "off").
// Also a tiny buzz on phones that have one. Client only.

/** One tick: when it starts (s), its length (s), the band it is filtered to (Hz) and how loud (0..1). */
export interface Tick {
  at: number;
  dur: number;
  freq: number;
  gain: number;
}

/** Two ticks, the second a little lower and softer: the key goes in, the key turns. */
export const KEY_TICKS: readonly Tick[] = [
  { at: 0, dur: 0.018, freq: 3400, gain: 0.5 },
  { at: 0.085, dur: 0.024, freq: 2300, gain: 0.38 },
];
/** Master level: quiet. */
export const KEY_LEVEL = 0.16;
/** How long the whole click lasts, tail included (s). */
export const KEY_TAIL = 0.07;

/** The longest the click can last, in ms (the tests hold it to the 300 ms budget). */
export function keyClickMs(ticks: readonly Tick[] = KEY_TICKS): number {
  return Math.round(Math.max(...ticks.map((t) => t.at + t.dur + KEY_TAIL)) * 1000);
}

/** Sound only when motion is welcome and sound has not been turned off. */
export function shouldPlayKey(o: { reducedMotion: boolean; muted: boolean }): boolean {
  return !o.reducedMotion && !o.muted;
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function reduced(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function muted(): boolean {
  try {
    return localStorage.getItem("nearer:sound") === "off";
  } catch {
    return false;
  }
}

function tick(ac: AudioContext, out: AudioNode, start: number, t: Tick): void {
  const at = start + t.at;
  // A click: a few milliseconds of noise through a band, falling fast.
  const n = Math.ceil(ac.sampleRate * t.dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = t.freq;
  f.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.setValueAtTime(t.gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + t.dur);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + t.dur);
  // The faint ring of metal after it.
  const o = ac.createOscillator();
  o.type = "sine";
  o.frequency.value = t.freq * 0.55;
  const rg = ac.createGain();
  rg.gain.setValueAtTime(t.gain * 0.18, at);
  rg.gain.exponentialRampToValueAtTime(0.0001, at + t.dur + KEY_TAIL);
  o.connect(rg).connect(out);
  o.start(at);
  o.stop(at + t.dur + KEY_TAIL);
}

/** The click and the buzz, when welcome. Never throws. */
export function playKeyClick(): void {
  if (typeof window === "undefined") return;
  if (!shouldPlayKey({ reducedMotion: reduced(), muted: muted() })) return;
  try {
    navigator.vibrate?.(12);
  } catch {
    /* no vibration */
  }
  try {
    const ac = audio();
    if (!ac) return;
    const out = ac.createGain();
    out.gain.value = KEY_LEVEL;
    out.connect(ac.destination);
    const start = ac.currentTime + 0.01;
    for (const t of KEY_TICKS) tick(ac, out, start, t);
  } catch {
    /* silent */
  }
}
