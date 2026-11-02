// Requests the first screen needs, started by the inline script in app/layout.tsx
// (EARLY_FETCH) while the HTML is still parsing, seconds before any bundle has
// loaded. Whoever reads a URL first takes its request; later readers fetch as usual.
// Client only.

type Early = Record<string, { at: number; p: Promise<Response> }>;
type W = typeof window & { __nearerEarly?: Early };

/** Older than this, an early answer is not used (the page has been open a while). */
const FRESH_MS = 15_000;

/** The early request for `url`, once (null when there is none, it was taken, or it is stale). */
export function takeEarly(url: string): Promise<Response> | null {
  if (typeof window === "undefined") return null;
  const all = (window as W).__nearerEarly;
  const e = all?.[url];
  if (!all || !e) return null;
  delete all[url];
  if (performance.now() - e.at > FRESH_MS) return null;
  return e.p;
}

/** Forget every early request (a sign-in, sign-out or switch: they were made for the last person). */
export function dropEarly(): void {
  if (typeof window !== "undefined") (window as W).__nearerEarly = {};
}

/** GET `url` (no-store), answered by its early request when there is one; a failed early request is retried here. */
export function fetchFirst(url: string): Promise<Response> {
  const fresh = () => fetch(url, { cache: "no-store" });
  const early = takeEarly(url);
  return early ? early.catch(fresh) : fresh();
}

/**
 * The inline script (kept tiny and dependency-free: it runs before anything else).
 * Only on "/" for someone who already stepped inside this tab (aangan:entered):
 * the session with its family, the window and the waiting list, and behind an
 * open door the courtyard's payload and the cards too.
 */
export const EARLY_FETCH = `if(e&&location.pathname==="/"&&window.fetch&&window.performance){var E=window.__nearerEarly={},t=performance.now(),g=function(u){E[u]={at:t,p:fetch(u,{cache:"no-store",priority:"low"})};E[u].p.catch(function(){})};g("/api/session?family=1");if(o){g("/api/courtyard");g("/api/cards")}g("/api/window");g("/api/waiting")}`;
