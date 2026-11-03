// Stepping inside: after the key is slid home the window gives way to the family page, with a
// quick calm fade (no door, nothing swings). Pure helpers, so the behaviour is tested without a DOM.

/** sessionStorage key: "open" once this person has stepped into the family page this session. */
export const HOUSE_KEY = "aangan:door";
/** The fade into the family page, in ms. Never more than 250. */
export const ENTER_MS = 200;
/** How far the page rises while it fades in, in px. */
export const ENTER_RISE = 8;
/** After the key reaches the end, the short beat before the page changes (ms). */
export const UNLOCK_BEAT_MS = 120;

export interface EntryMotion {
  /** Fade length in ms; 0 means the page just changes. */
  ms: number;
  /** Rise in px while fading in. */
  rise: number;
}

/** Reduced motion: instant. Otherwise a short fade and a small rise. */
export function entryMotion(reducedMotion: boolean): EntryMotion {
  return reducedMotion ? { ms: 0, rise: 0 } : { ms: ENTER_MS, rise: ENTER_RISE };
}

/** The beat between the key arriving and the page changing: none under reduced motion. */
export function unlockBeat(reducedMotion: boolean): number {
  return reducedMotion ? 0 : UNLOCK_BEAT_MS;
}

/** What sessionStorage holds for a state. */
export function houseValue(inside: boolean): "open" | "closed" {
  return inside ? "open" : "closed";
}

/** Whether a stored value means "inside". Anything else (including nothing) means the window. */
export function isInside(stored: string | null | undefined): boolean {
  return stored === "open";
}

/** Which screen a signed-in grown-up sees. */
export function screenAfterUnlock(inside: boolean): "window" | "family" {
  return inside ? "family" : "window";
}
