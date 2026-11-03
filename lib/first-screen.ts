// What keeps the first screen from waiting forever. Pure helpers (no DOM, no React), so they are
// tested on their own: a request that never answers is cut off (timeouts), and the courtyard
// shows its content after a short wait even when a piece is still on its way.

/**
 * A request that has not answered by now is given up on (the person sees an error with Retry, never a skeleton).
 * Longer than the server's longest upstream limit (lib/timeouts.ts: 35 s for a Muse text call), so a slow
 * first Muse pick on /api/window or /api/today is not cut off and asked again. The screen itself never
 * waits this long: COURTYARD_PATIENCE_MS shows what has arrived.
 */
export const REQUEST_TIMEOUT_MS = 40_000;
/** An early request (started by the page's inline script) is waited for this long before a fresh one is made; the same limit, so a slow Muse answer is never asked for twice. */
export const EARLY_WAIT_MS = REQUEST_TIMEOUT_MS;
/** The courtyard stops holding its content back for the last piece after this long. */
export const COURTYARD_PATIENCE_MS = 4_000;

/** Reject with Error("timeout") when `p` has not settled within `ms`. The timer never outlives the answer. */
export function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * fetch that is aborted after `ms`, the body included, so a stalled connection ends as an error.
 * (The timer is left to run out: aborting a finished request does nothing.)
 */
export function fetchWithTimeout(f: typeof fetch, url: string, init: RequestInit = {}, ms = REQUEST_TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), ms);
  return f(url, { ...init, signal: ctl.signal });
}

export type PayloadStatus = "loading" | "ok" | "failed";

/**
 * Is the courtyard's body ready to show? When the cards and the courtyard payload are both in, yes
 * (so nothing slides down as pieces arrive); after `patience` it shows what it has either way, and the
 * rest fills in when it lands. A failed payload counts as in: its readers fetch for themselves.
 */
export function courtyardReady(input: { cardsLoaded: boolean; status: PayloadStatus | null; waitedMs: number; patience?: number }): boolean {
  if (input.waitedMs >= (input.patience ?? COURTYARD_PATIENCE_MS)) return true;
  return input.cardsLoaded && (input.status === null || input.status !== "loading");
}

/** What the "Everyone" row shows: the people, or (nobody but you) the way to add your family. */
export function everyoneView(otherPeople: number, presenceLoaded: boolean, presenceFailed: boolean): "empty" | "chips-loading" | "chips" {
  if (otherPeople === 0) return "empty";
  return presenceLoaded || presenceFailed ? "chips" : "chips-loading";
}

/** Whether to say the family could not be reached (with Retry): the courtyard payload failed, or the cards did. */
export function courtyardFailed(status: PayloadStatus | null, cardsFailed: boolean): boolean {
  return status === "failed" || cardsFailed;
}
