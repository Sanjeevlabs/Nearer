// A gate in front of fetch for sign-out. Sessions slide: any /api response may carry a renewed
// Set-Cookie. A poll still in flight when DELETE /api/session clears the cookie could land AFTER the
// clear and sign the person straight back in. Closing the gate aborts every in-flight /api request
// (the browser drops its response, cookie included) and refuses new ones, except the calls sign-out
// itself makes (DELETE /api/session, and /api/push/* to forget this device). Client only.

type Fetch = typeof fetch;

function target(input: RequestInfo | URL, init?: RequestInit): { path: string; method: string } {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  let path = raw;
  try {
    path = new URL(raw, "http://local.invalid").pathname;
  } catch {
    /* keep raw */
  }
  return { path, method };
}

export interface FetchGate {
  fetch: Fetch;
  close(): void;
  isClosed(): boolean;
}

export function createFetchGate(base: Fetch): FetchGate {
  const ctl = new AbortController();
  let closed = false;
  const gated: Fetch = (input, init) => {
    const { path, method } = target(input, init);
    if (!path.startsWith("/api/")) return base(input, init);
    // Sign-out's own calls pass through, open or closed.
    if ((method === "DELETE" && path === "/api/session") || path.startsWith("/api/push/")) return base(input, init);
    if (closed) return Promise.reject(new DOMException("signed out", "AbortError"));
    const signal = init?.signal && typeof AbortSignal.any === "function" ? AbortSignal.any([init.signal, ctl.signal]) : (init?.signal ?? ctl.signal);
    return base(input, { ...init, signal });
  };
  return {
    fetch: gated,
    close() {
      closed = true;
      ctl.abort();
    },
    isClosed: () => closed,
  };
}

type W = typeof window & { __nearerGate?: FetchGate };

/** Wrap window.fetch once, at app start. */
export function installFetchGate(): void {
  if (typeof window === "undefined") return;
  const w = window as W;
  if (w.__nearerGate) return;
  const gate = createFetchGate(window.fetch.bind(window));
  w.__nearerGate = gate;
  window.fetch = gate.fetch;
}

/** Stop every in-flight /api request and refuse new ones (until the page reloads). */
export function closeFetchGate(): void {
  if (typeof window !== "undefined") (window as W).__nearerGate?.close();
}
