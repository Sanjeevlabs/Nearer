// Hard time limits for every call the server makes to another service. Without them a stalled
// upstream (database, model host, mail) keeps the request open until the platform kills it, which
// the person sees as a page that never loads. With them the call fails fast, the route answers
// 503 or its fallback, and the client's own retry takes over. Server only.

/** Database (Supabase REST/RPC): a healthy call is well under a second. */
export const DB_TIMEOUT_MS = 8_000;
/** Text and vision model calls: live answers take up to ~25 s (reasoning models). */
export const MODEL_TIMEOUT_MS = 35_000;
/** Speech to text and image generation: larger payloads, slower models. */
export const MEDIA_MODEL_TIMEOUT_MS = 60_000;
/** Anything else small (mail, storage reads). */
export const SERVICE_TIMEOUT_MS = 10_000;

/** A signal that aborts after `ms`, or when the caller's own signal aborts, whichever is first. */
export function deadline(ms: number, signal?: AbortSignal | null): AbortSignal {
  const timer = AbortSignal.timeout(ms);
  if (!signal) return timer;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timer]) : signal;
}

/** `fetch` that can never outlive `ms`. Keeps any signal the caller passed. */
export function fetchWithTimeout(ms: number, base: typeof fetch = fetch): typeof fetch {
  return (input, init) => base(input, { ...init, signal: deadline(ms, init?.signal) });
}
