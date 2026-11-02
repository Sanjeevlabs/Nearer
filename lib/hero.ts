// The courtyard header's `sizes`: the app column is at most 480px wide with 20px gutters.
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
export const DEFAULT_IMAGE = "/demo/home-courtyard.jpg";

/** Height of the photo: under half the screen (44vh, 260-400px), so the name and the lamp row fit above the fold on a phone. */
export const WINDOW_PHOTO_HEIGHT = "clamp(260px, 44vh, 400px)";

const KEY = "aangan:hero";

/** Bundled demo photos an older build remembered (the yellow courtyard, the old door): never painted early again. */
export function isRetiredHero(ref: string | null | undefined): boolean {
  return Boolean(ref && /^\/demo\/(home-)?courtyard/.test(ref));
}

/** The photo this phone showed last time, so the next load paints the right one at once. Stale demo values are dropped. */
export function rememberedHero(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    if (isRetiredHero(v)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return v;
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
  if (isRetiredHero(ref)) return;
  try {
    localStorage.setItem(KEY, ref);
  } catch {
    /* private mode */
  }
}
