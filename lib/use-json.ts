"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCourtyardSlice } from "./courtyard-data";
import { dropEarly, takeEarly } from "./early";
import { EARLY_WAIT_MS, fetchWithTimeout, raceTimeout } from "./first-screen";

// Last good payload per URL: a route paints from it at once and refreshes in
// the background. Kept in memory and (small payloads) in sessionStorage.
const cache = new Map<string, unknown>();
const KEY = "aangan:json:";
const MAX_STORED = 400_000;

export function readCache<T>(url: string): T | null {
  if (cache.has(url)) return cache.get(url) as T;
  try {
    const raw = sessionStorage.getItem(KEY + url);
    if (raw) {
      const v = JSON.parse(raw) as T;
      cache.set(url, v);
      return v;
    }
  } catch {
    /* no sessionStorage, or a bad entry */
  }
  return null;
}

function writeCache(url: string, value: unknown): void {
  cache.set(url, value);
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= MAX_STORED) sessionStorage.setItem(KEY + url, raw);
  } catch {
    /* quota or private mode: memory only */
  }
}

/** Forget every cached payload (sign-in, sign-out, switching family). */
export function clearJsonCache(): void {
  cache.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(KEY)) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
// Which person/family the answers in flight belong to: a sign-in or a side switch moves it on,
// and an answer that arrives after that is thrown away (it was read for the last one).
let authGen = 0;
if (typeof window !== "undefined")
  window.addEventListener("aangan:auth", () => {
    authGen++;
    clearJsonCache();
    flights.clear();
    dropEarly();
  });

// Mounted readers (one per useJson on screen), so a write can make them refetch.
// A reader with a url is only told about writes that touch that url (or about every write).
const readers = new Map<() => void, string | null>();
let pending: ReturnType<typeof setTimeout> | null = null;
/** null: everything (a full invalidate is pending); else the url prefixes to refetch. */
let pendingKeys: Set<string> | null = new Set();

/** A reader asks to be told when something was written (the hook does; tests too). Returns the unsubscribe. */
export function subscribeInvalidate(fn: () => void, url: string | null = null): () => void {
  readers.set(fn, url);
  return () => {
    readers.delete(fn);
  };
}

function dropCached(prefixes: string[]): void {
  for (const k of Array.from(cache.keys())) if (prefixes.some((p) => k.startsWith(p))) cache.delete(k);
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(KEY) && prefixes.some((p) => k.slice(KEY.length).startsWith(p))) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * Something was written (a card posted, a reaction, an approval, a play): every
 * cached payload is dropped, so nothing deleted or changed can come back from
 * the cache, and every list on screen quietly refetches (coalesced, 200 ms).
 * With `keys` (url prefixes) only those payloads are dropped and only their
 * readers refetch: lighting the lamp touches the lamp and the window, nothing else.
 */
export function invalidateJson(keys?: string[]): void {
  // An answer read before this write is not shared with whoever mounts next.
  if (keys && keys.length) {
    for (const k of Array.from(flights.keys())) if (keys.some((p) => k.startsWith(p))) flights.delete(k);
  } else {
    flights.clear();
  }
  if (keys && keys.length) {
    dropCached(keys);
    if (pendingKeys) keys.forEach((k) => pendingKeys?.add(k));
  } else {
    clearJsonCache();
    pendingKeys = null;
  }
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const only = pendingKeys;
    pendingKeys = new Set();
    readers.forEach((url, r) => {
      if (!only || (url !== null && Array.from(only).some((k) => url.startsWith(k)))) r();
    });
    if (!only && typeof window !== "undefined") window.dispatchEvent(new Event("aangan:changed"));
  }, 200);
}

/** Writes that change only a few payloads: path -> the url prefixes to refetch. */
const SCOPED_WRITES: [RegExp, string[]][] = [[/^\/api\/lamp$/, ["/api/lamp", "/api/window"]]];

export function scopeOfWrite(url: string): string[] | null {
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    /* keep as given */
  }
  return SCOPED_WRITES.find(([re]) => re.test(path))?.[1] ?? null;
}

/** Writes that are not a change to anything shown: the "I opened Nearer" heartbeat and pure computations. */
const QUIET_WRITES = /^\/api\/(transcribe|stickers\/cutout|muse\/|translate|kitchen\/scan|auth\/start|media\/upload-url|session\/switch$)/;

export function isChangingWrite(url: string, method: string | undefined, body: unknown): boolean {
  const m = (method ?? "GET").toUpperCase();
  if (m === "GET" || m === "HEAD") return false;
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    /* keep as given */
  }
  if (!path.startsWith("/api/")) return false;
  // Only the "here" heartbeat on /api/presence is quiet; sharing a moment changes the window.
  if (path === "/api/presence" && typeof body === "string" && body.includes('"here"')) return false;
  // Moving to another side (or person) changes nothing: the caller announces it with "aangan:auth", which re-reads everything once.
  if (path === "/api/sides" && typeof body === "string" && body.includes('"switch"')) return false;
  return !QUIET_WRITES.test(path);
}

/**
 * Make every successful write through fetch (any component, not only postJson)
 * invalidate the cache. Call once on the client (components/providers.tsx).
 */
export function watchWrites(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const w = window as typeof window & { __aanganWatched?: boolean };
  if (w.__aanganWatched) return () => undefined;
  w.__aanganWatched = true;
  const original = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original.call(window, input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined);
      if (res.ok && isChangingWrite(url, method, init?.body)) invalidateJson(scopeOfWrite(url) ?? undefined);
      // The session is gone: nothing cached may paint for the next person.
      if (res.status === 401 && new URL(url, "http://x").pathname.startsWith("/api/")) clearJsonCache();
    } catch {
      /* never break a request for bookkeeping */
    }
    return res;
  };
  return () => {
    window.fetch = original;
    w.__aanganWatched = false;
  };
}

// A fetch started early (prefetchJson), shared with every hook that mounts a moment later.
const flights = new Map<string, Promise<{ data: unknown; stale: boolean; failed: boolean; status?: number }>>();

/** Start fetching `url` now (before the screen that reads it has mounted); the hook picks up the same request. */
export function prefetchJson(url: string): void {
  if (flights.has(url)) return;
  const p = revalidate(url).finally(() => {
    // Keep the answer briefly so a hook mounting just after still shares it.
    setTimeout(() => flights.delete(url), 1500);
  });
  flights.set(url, p);
}

/**
 * One refresh of `url`. A good response replaces the cache. A failed one keeps
 * whatever was cached: `stale` is true (show a quiet "offline" hint), and
 * `failed` only when there is nothing at all to show.
 */
const RETRYABLE = new Set([502, 503, 504]);

export async function revalidate<T>(url: string, f: typeof fetch = (...a) => fetch(...a)): Promise<{ data: T | null; stale: boolean; failed: boolean; status?: number }> {
  const gen = authGen;
  let status: number | undefined;
  try {
    // The first screen's request may already be on its way (lib/early.ts).
    const early = takeEarly(url);
    // Nothing waits forever: a request that does not answer in time ends as a failure (a retry card, never a skeleton).
    const ask = () => fetchWithTimeout(f, url, { cache: "no-store" });
    let res = early ? await raceTimeout(early, EARLY_WAIT_MS).catch(ask) : await ask();
    // The host sometimes cuts one request off (a 503 under its CPU limit): one quiet retry.
    if (RETRYABLE.has(res.status)) {
      await new Promise((r) => setTimeout(r, 250));
      res = await ask();
    }
    if (!res.ok) {
      status = res.status;
      throw new Error(String(res.status));
    }
    const json = (await res.json()) as T;
    // Read for the last person or family: never cached, never shown.
    if (gen !== authGen) return { data: null, stale: false, failed: false };
    writeCache(url, json);
    return { data: json, stale: false, failed: false };
  } catch {
    const kept = readCache<T>(url);
    return { data: kept, stale: kept !== null, failed: kept === null, status };
  }
}

/**
 * Fetch JSON for a room; `reload` after a write. Null while loading.
 * Stale-while-revalidate: the last good payload for the URL shows at once and
 * is refreshed in the background; `stale` marks data that could not be
 * refreshed. `every` (ms) also refetches quietly while the page is visible:
 * on an interval and when the tab comes back. Inside the courtyard, the
 * payload comes from the one shared GET /api/courtyard (lib/courtyard-data.tsx)
 * and this hook does not fetch.
 */
export function useJson<T>(wanted: string | null, opts?: { every?: number }): { data: T | null; stale: boolean; failed: boolean; notFound: boolean; reload: () => Promise<void> } {
  const shared = useCourtyardSlice(wanted);
  const url = shared ? null : wanted;
  const every = opts?.every;
  // Memory only at first, so the first client render matches the server's (null).
  const [data, setData] = useState<T | null>(() => (url && cache.has(url) ? (cache.get(url) as T) : null));
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const live = useRef(true);
  const load = useCallback(async (quiet: boolean, mount = false) => {
    if (!url) return;
    if (!quiet) {
      setFailed(false);
      setNotFound(false);
    }
    const gen = authGen;
    // A first load shares a request already in flight (prefetchJson); a refresh always asks again.
    // Two readers of one url mounting together (the shell's and a room's) make one request, not two.
    if (mount && !quiet && !flights.has(url)) prefetchJson(url);
    const early = quiet ? undefined : (flights.get(url) as Promise<{ data: T | null; stale: boolean; failed: boolean; status?: number }> | undefined);
    const r = early ? await early : await revalidate<T>(url);
    if (!live.current || gen !== authGen) return;
    if (r.data !== null) setData(r.data);
    setStale(r.stale);
    setFailed(!quiet && r.failed);
    setNotFound(!quiet && r.failed && r.status === 404);
  }, [url]);
  useEffect(() => {
    live.current = true;
    const cached = url ? readCache<T>(url) : null;
    if (cached) setData(cached);
    void load(false, true);
    return () => {
      live.current = false;
    };
  }, [load, url]);
  const reload = useCallback(() => load(false), [load]);
  // Another person or side: nothing of the last one may stay on screen; read it again (one request, shared).
  useEffect(() => {
    if (!url) return;
    const onAuth = () => {
      setData(null);
      setStale(false);
      prefetchJson(url);
      void load(false);
    };
    window.addEventListener("aangan:auth", onAuth);
    return () => window.removeEventListener("aangan:auth", onAuth);
  }, [url, load]);
  // A write elsewhere on the page: refetch quietly so nothing shown is stale.
  useEffect(() => {
    if (!url) return;
    return subscribeInvalidate(() => void load(true), url);
  }, [url, load]);
  useEffect(() => {
    if (!url || !every) return;
    const tick = () => {
      if (!document.hidden) void load(true);
    };
    const timer = setInterval(tick, every);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [url, every, load]);
  if (shared) return { data: (shared.data ?? null) as T | null, stale: false, failed: false, notFound: false, reload: shared.reload };
  return { data, stale, failed, notFound: notFound && data === null, reload };
}

/** POST JSON; returns parsed body or null on failure. */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown, method = "POST"): Promise<T | null> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    // A write through fetch is already noticed by watchWrites; this covers a page that never installed it.
    if (typeof window !== "undefined" && !(window as typeof window & { __aanganWatched?: boolean }).__aanganWatched) invalidateJson(scopeOfWrite(url) ?? undefined);
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** "12 min ago", "3 h ago", "yesterday". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
