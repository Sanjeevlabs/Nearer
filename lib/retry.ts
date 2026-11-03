// Bounded retry for idempotent reads. The host (Cloudflare Workers, free plan) cuts off a few percent
// of requests that go over its CPU limit and answers 503 instead of our response; the next try almost
// always goes through. Pure helpers (no DOM, no React), so the policy is tested on its own.
//
// Only GET/HEAD are ever retried. A write may have been applied before the cut-off, so a retry could
// do it twice: writes go through the upload queue (lib/upload-queue.ts), which keys by card id.

import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from "./first-screen";

/** Statuses that mean "the host or a proxy failed", not "the server said no". Our own 503 read-failed is one of them. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
/** Waits before retries 1, 2 and 3 (ms), each plus a random 0..JITTER_MS so a burst of cut-offs does not retry in lockstep. */
export const RETRY_DELAYS_MS = [200, 600, 1500];
export const RETRY_JITTER_MS = 150;

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/** Only reads are safe to repeat. */
export function isIdempotent(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

/**
 * Should the answer to attempt number `attempt` (0 = the first try) be tried again?
 * `outcome` is the HTTP status, or "network" when the request itself failed. 2xx/3xx/4xx never retry.
 */
export function shouldRetry(outcome: number | "network", attempt: number, method?: string, delays: readonly number[] = RETRY_DELAYS_MS): boolean {
  if (!isIdempotent(method)) return false;
  if (attempt >= delays.length) return false;
  return outcome === "network" || isRetryableStatus(outcome);
}

/** The wait before the retry that follows attempt `attempt` (0-based), jitter included. */
export function retryDelay(attempt: number, random: () => number = Math.random, delays: readonly number[] = RETRY_DELAYS_MS): number {
  return (delays[attempt] ?? delays[delays.length - 1] ?? 0) + Math.floor(random() * (RETRY_JITTER_MS + 1));
}

export interface RetryOptions {
  method?: string;
  /** Whole-call budget, retries included (default: the 40 s request timeout). */
  totalMs?: number;
  delays?: readonly number[];
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Run `attempt` (0 = first try; it gets the time left) until it returns something that is not a
 * cut-off, up to 3 retries and never past the overall budget. Resolves with the last Response
 * (even a 503, so the caller reads its status) or rejects with the last network error.
 */
export async function retryGet(attempt: (n: number, remainingMs: number) => Promise<Response>, opts: RetryOptions = {}): Promise<Response> {
  const total = opts.totalMs ?? REQUEST_TIMEOUT_MS;
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const started = now();
  for (let n = 0; ; n++) {
    let res: Response | null = null;
    let err: unknown;
    try {
      res = await attempt(n, Math.max(1, total - (now() - started)));
    } catch (e) {
      err = e;
    }
    const outcome = res ? res.status : "network";
    const wait = retryDelay(n, random, delays);
    if (!shouldRetry(outcome, n, opts.method, delays) || now() - started + wait >= total) {
      if (res) return res;
      throw err;
    }
    await sleep(wait);
  }
}

/**
 * The header that tells the service worker "the client will try again": it then passes a 5xx straight
 * through instead of retrying itself or answering with an old copy, so one read reaches the host at most
 * 4 times and a kept copy (served only on the last try or a network error) is never mistaken for fresh.
 */
export const CLIENT_RETRIES_HEADER = "x-nearer-retry";

/** `init` for attempt `n` (0-based): marked while more retries follow. */
export function attemptInit(n: number, init: RequestInit = {}, delays: readonly number[] = RETRY_DELAYS_MS): RequestInit {
  if (n >= delays.length) return init;
  const headers = new Headers(init.headers);
  headers.set(CLIENT_RETRIES_HEADER, "1");
  return { ...init, headers };
}

/** GET with the bounded retry and the 40 s overall timeout. The drop-in for `fetch(url, { cache: "no-store" })` on reads. */
export function fetchGet(url: string, init: RequestInit = {}, f: typeof fetch = (...a) => fetch(...a)): Promise<Response> {
  return retryGet((n, left) => fetchWithTimeout(f, url, attemptInit(n, { cache: "no-store", ...init }), left), { method: init.method });
}
