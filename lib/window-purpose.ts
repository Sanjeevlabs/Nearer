// Why the window exists, said on the window (pure helpers, tested).
// The first screen is a calm look at the other home; the key steps inside to the family page.

/** localStorage key: set once the first-visit card was dismissed on this device. */
export const WINDOW_INTRO_KEY = "nearer:window-intro-v1";

/** How far (px) a press may travel and still count as a tap on the key. */
export const TAP_SLOP = 6;

/** Show the first-visit card: only once the window has loaded, and only if it was never dismissed. */
export function showWindowIntro(stored: string | null | undefined, ready: boolean): boolean {
  return ready && stored !== "1";
}

/** Who the window looks onto, for the lines about it. Names from data, else a plain fallback. */
export function whoLooksOnto(names: string, viewerRole: string | undefined): { who: string; known: boolean } {
  const n = names.trim();
  if (n) return { who: n, known: true };
  return { who: viewerRole === "elder" ? "your family" : "your parents", known: false };
}

/** Total travel of a press: the furthest the pointer has been from where it went down (never the step since the last move). */
export function travelSoFar(prev: number, downX: number, x: number): number {
  return Math.max(prev, Math.abs(x - downX));
}

/** A press on the key: a tap (barely moved) opens; a slide opens past 80%; anything else springs back. */
export function keyOutcome(travelPx: number, progress: number): "open" | "back" {
  return travelPx < TAP_SLOP || progress > 0.8 ? "open" : "back";
}
