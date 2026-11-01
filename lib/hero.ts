// The courtyard header photo's `sizes`: the app column is at most 480px wide with 20px gutters.
// Shared by the header <Photo> (components/courtyard.tsx) and the early preload (app/layout.tsx).
export const HERO_SIZES = "(min-width: 520px) 440px, calc(100vw - 40px)";

/** The first screen's photo is full-bleed: the whole column, never more than 480px. */
export const WINDOW_SIZES = "(min-width: 480px) 480px, 100vw";

/**
 * The photo a family sees on the first screen until it sets its own. THE ONE
 * PLACE TO SWITCH: after the owner runs scripts/gen-courtyard.mjs, change this
 * to "/demo/home-courtyard.jpg" (or home-balcony.jpg, home-window.jpg). It lives
 * here, not in lib/window-server.ts, only because the phone needs it before the
 * window's data arrives; window-server.ts re-exports it as DEFAULT_IMAGE.
 */
export const DEFAULT_IMAGE = "/demo/courtyard.jpg";

/** Height of the photo: about half the screen, never under 340px. */
export const WINDOW_PHOTO_HEIGHT = "max(340px, 52vh)";

const KEY = "aangan:hero";

/** The photo this phone showed last time, so the next load paints the right one at once. */
export function rememberedHero(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Another person or family: the last photo is not theirs. Runs on `aangan:auth` (sign-in, sign-out, switching). */
export function forgetHero(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
if (typeof window !== "undefined") window.addEventListener("aangan:auth", forgetHero);

export function rememberHero(ref: string): void {
  try {
    localStorage.setItem(KEY, ref);
  } catch {
    /* private mode */
  }
}
