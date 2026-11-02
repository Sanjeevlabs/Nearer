// The sound of the door: a recorded key turning in a lock, the latch, a soft creak
// (public/sound/door-unlock.*, credits in public/sound/CREDITS.md). Played with an
// HTMLAudioElement that is preloaded on the first user interaction, so it is ready by the
// time the door moves. Silent when the person asked for reduced motion. If the file cannot
// play (no Audio, a load error, a blocked play()) the old WebAudio synthesis in
// lib/door-synth.ts plays instead. Client only.
import { synthDoorClose, synthDoorOpen } from "@/lib/door-synth";

export const DOOR_SOUND = {
  mp3: "/sound/door-unlock.mp3",
  ogg: "/sound/door-unlock.ogg",
} as const;
const VOLUME = 0.6;
/** Where the key turns in the recording; the phone ticks once here. */
export const KEY_TURN_MS = 350;

let el: HTMLAudioElement | null = null;
let broken = false;
let armed = false;

function reduced(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The audio element, created once; null when this browser has no Audio or it already failed. */
function element(): HTMLAudioElement | null {
  if (broken) return null;
  if (el) return el;
  try {
    if (typeof Audio === "undefined") return null;
    const a = new Audio();
    a.preload = "auto";
    a.volume = VOLUME;
    // mp3 first; ogg for the browsers that answer no to it.
    const mp3 = a.canPlayType("audio/mpeg") !== "";
    a.src = mp3 ? DOOR_SOUND.mp3 : DOOR_SOUND.ogg;
    a.addEventListener("error", () => {
      if (mp3 && a.src.endsWith(".mp3")) a.src = DOOR_SOUND.ogg;
      else broken = true;
    });
    el = a;
    return a;
  } catch {
    broken = true;
    return null;
  }
}

/** Preload the recording on the first tap, key press or touch. Safe to call more than once. */
export function armDoorSound(): void {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const go = () => {
    for (const ev of ["pointerdown", "keydown", "touchstart"])
      window.removeEventListener(ev, go);
    try {
      element()?.load();
    } catch {
      /* the fallback will cover it */
    }
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"])
    window.addEventListener(ev, go, { passive: true, once: true });
}

function play(fallback: () => void): void {
  const a = element();
  if (!a) return fallback();
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(fallback);
  } catch {
    fallback();
  }
}

/** Key, latch, creak. ~1.5 s. Silent under reduced motion. */
export function playDoorOpen(): void {
  if (typeof window === "undefined" || reduced()) return;
  play(synthDoorOpen);
  window.setTimeout(() => navigator.vibrate?.(12), KEY_TURN_MS);
}

/** The door pulled shut: the soft synthesised swing and latch (the recording is of unlocking). */
export function playDoorClose(): void {
  if (typeof window === "undefined" || reduced()) return;
  synthDoorClose();
}
