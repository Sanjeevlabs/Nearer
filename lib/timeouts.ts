// Hard time limits for every call the server makes to another service. Without them a stalled
// upstream (database, model host, mail) keeps the request open until the platform kills it, which
// the person sees as a page that never loads. With them the call fails fast, the route answers
// 503 or its fallback, and the client's own retry takes over. Server only.

/** Database (Supabase REST/RPC): a healthy call is well under a second. */
export const DB_TIMEOUT_MS = 8_000;
/** Text and vision model calls: live answers take up to ~25 s (reasoning models). Whole call, not per attempt: a timeout is never retried. */
export const MODEL_TIMEOUT_MS = 35_000;
/** Speech to text and image generation: larger payloads, slower models. */
export const MEDIA_MODEL_TIMEOUT_MS = 60_000;
/** Anything else small (mail, push, storage reads). */
export const SERVICE_TIMEOUT_MS = 10_000;
/** Reading a family photo (≤5 MB) from storage for a Muse image call. */
export const MEDIA_READ_TIMEOUT_MS = 20_000;

function combine(own: AbortSignal | undefined | null, timer: AbortSignal): AbortSignal {
  if (!own) return timer;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([own, timer]);
  // No AbortSignal.any: wire both into one controller by hand (never drop the limit).
  const ctl = new AbortController();
  const stop = (s: AbortSignal) => () => ctl.abort(s.reason);
  if (own.aborted) ctl.abort(own.reason);
  else if (timer.aborted) ctl.abort(timer.reason);
  own.addEventListener("abort", stop(own), { once: true });
  timer.addEventListener("abort", stop(timer), { once: true });
  return ctl.signal;
}

/** A signal that aborts after `ms`, or when the caller's own signal aborts, whichever is first. */
export function deadline(ms: number, signal?: AbortSignal | null): AbortSignal {
  return combine(signal, AbortSignal.timeout(ms));
}

/** Did this call end because a time limit ran out (or was aborted)? Such a call is not retried: the same host rarely answers on a second try, and the wait would stack. */
export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * `fetch` that can never outlive `ms`. Keeps the caller's own signal (in `init` or on a Request).
 * Our own limit surfaces as an AbortError: postgrest-js retries a TimeoutError as a network error
 * (four tries with back-off, ~39 s for an 8 s limit) but treats an AbortError as final.
 */
export function fetchWithTimeout(ms: number, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const own = init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
    const timer = AbortSignal.timeout(ms);
    try {
      return await base(input, { ...init, signal: combine(own, timer) });
    } catch (e) {
      if (timer.aborted && !own?.aborted) throw new DOMException(`timeout after ${ms} ms`, "AbortError");
      throw e;
    }
  };
}
