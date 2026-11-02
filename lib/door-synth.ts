// The synthesised door sound: the FALLBACK for lib/door-sound.ts, used only when the
// recorded file cannot play (no Audio, a load error, a blocked play()). A key goes in,
// turns twice, the bolt drops, an old door creaks open. WebAudio; client only.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noise(ac: AudioContext, seconds: number): AudioBuffer {
  const buf = ac.createBuffer(
    1,
    Math.ceil(ac.sampleRate * seconds),
    ac.sampleRate,
  );
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** A short filtered burst: a click, a scrape, a thud. */
function burst(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  dur: number,
  type: BiquadFilterType,
  freq: number,
  gain: number,
  q = 1,
): void {
  const src = ac.createBufferSource();
  src.buffer = noise(ac, dur);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur);
}

/** A metallic ring: a few inharmonic partials, decaying fast. */
function ring(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  base: number,
  gain: number,
  dur = 0.25,
): void {
  for (const [ratio, amp] of [
    [1, 1],
    [2.76, 0.5],
    [5.4, 0.25],
  ] as const) {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.value = base * ratio;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain * amp, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur / ratio);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur);
  }
}

/** Low body of the bolt dropping into place. */
function thud(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  gain: number,
): void {
  const o = ac.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(140, at);
  o.frequency.exponentialRampToValueAtTime(55, at + 0.16);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + 0.25);
  burst(ac, out, at, 0.08, "lowpass", 900, gain * 0.8);
}

/** Wood on an old hinge: stick-slip friction, a resonant band that drifts. */
function creak(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  dur: number,
  gain: number,
): void {
  const o = ac.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(95, at);
  o.frequency.linearRampToValueAtTime(140, at + dur * 0.6);
  o.frequency.linearRampToValueAtTime(110, at + dur);
  const wobble = ac.createOscillator();
  wobble.frequency.value = 7;
  const wobbleDepth = ac.createGain();
  wobbleDepth.gain.value = 9;
  wobble.connect(wobbleDepth).connect(o.frequency);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 9;
  bp.frequency.setValueAtTime(650, at);
  bp.frequency.linearRampToValueAtTime(1150, at + dur * 0.7);
  bp.frequency.linearRampToValueAtTime(900, at + dur);
  // Stick-slip: the hinge catches ~28 times a second.
  const trem = ac.createOscillator();
  trem.type = "square";
  trem.frequency.value = 28;
  const tremDepth = ac.createGain();
  tremDepth.gain.value = 0.45;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.12);
  g.gain.setValueAtTime(gain, at + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  trem.connect(tremDepth).connect(g.gain);
  o.connect(bp).connect(g).connect(out);
  for (const n of [o, wobble, trem]) {
    n.start(at);
    n.stop(at + dur + 0.05);
  }
}

/** Key in, two turns, bolt, creak. ~1.7 s. Silent if audio isn't available. */
export function synthDoorOpen(): void {
  const ac = audio();
  if (!ac) return;
  const out = ac.createGain();
  out.gain.value = 0.55;
  out.connect(ac.destination);
  const t = ac.currentTime + 0.02;
  burst(ac, out, t, 0.09, "bandpass", 3200, 0.5, 2); // key slides in
  ring(ac, out, t + 0.07, 2300, 0.08);
  burst(ac, out, t + 0.32, 0.03, "highpass", 2500, 0.7); // first turn
  ring(ac, out, t + 0.32, 1700, 0.07, 0.15);
  burst(ac, out, t + 0.5, 0.03, "highpass", 2200, 0.7); // second turn
  thud(ac, out, t + 0.62, 0.6); // the bolt
  ring(ac, out, t + 0.64, 900, 0.06, 0.3);
  creak(ac, out, t + 0.82, 0.95, 0.22); // the door swings
}

/** Door pulled shut: a soft swing and the latch. */
export function synthDoorClose(): void {
  const ac = audio();
  if (!ac) return;
  const out = ac.createGain();
  out.gain.value = 0.5;
  out.connect(ac.destination);
  const t = ac.currentTime + 0.02;
  creak(ac, out, t, 0.45, 0.12);
  thud(ac, out, t + 0.45, 0.5);
  burst(ac, out, t + 0.47, 0.03, "highpass", 2600, 0.6);
}
