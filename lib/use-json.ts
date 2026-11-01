"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCourtyardSlice } from "./courtyard-data";

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
if (typeof window !== "undefined") window.addEventListener("aangan:auth", clearJsonCache);

// Mounted readers (one per useJson on screen), so a write can make them refetch.
const readers = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | null = null;

/** A reader asks to be told when something was written (the hook does; tests too). Returns the unsubscribe. */
export function subscribeInvalidate(fn: () => void): () => void {
  readers.add(fn);
  return () => {
    readers.delete(fn);
  };
}

/**
 * Something was written (a card posted, a reaction, an approval, a play): every
 * cached payload is dropped, so nothing deleted or changed can come back from
 * the cache, and every list on screen quietly refetches (coalesced, 200 ms).
 */
export function invalidateJson(): void {
  clearJsonCache();
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    readers.forEach((r) => r());
    if (typeof window !== "undefined") window.dispatchEvent(new Event("aangan:changed"));
  }, 200);
}

/** Writes that are not a change to anything shown: the "I opened Nearer" heartbeat and pure computations. */
const QUIET_WRITES = /^\/api\/(transcribe|stickers\/cutout|muse\/|translate|kitchen\/scan|auth\/start|media\/upload-url)/;

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
      if (res.ok && isChangingWrite(url, method, init?.body)) invalidateJson();
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

/**
 * One refresh of `url`. A good response replaces the cache. A failed one keeps
 * whatever was cached: `stale` is true (show a quiet "offline" hint), and
 * `failed` only when there is nothing at all to show.
 */
export async function revalidate<T>(url: string, f: typeof fetch = (...a) => fetch(...a)): Promise<{ data: T | null; stale: boolean; failed: boolean }> {
  try {
    const res = await f(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as T;
    writeCache(url, json);
    return { data: json, stale: false, failed: false };
  } catch {
    const kept = readCache<T>(url);
    return { data: kept, stale: kept !== null, failed: kept === null };
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
export function useJson<T>(wanted: string | null, opts?: { every?: number }): { data: T | null; stale: boolean; failed: boolean; reload: () => Promise<void> } {
  const shared = useCourtyardSlice(wanted);
  const url = shared ? null : wanted;
  const every = opts?.every;
  // Memory only at first, so the first client render matches the server's (null).
  const [data, setData] = useState<T | null>(() => (url && cache.has(url) ? (cache.get(url) as T) : null));
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  const load = useCallback(async (quiet: boolean) => {
    if (!url) return;
    if (!quiet) setFailed(false);
    const r = await revalidate<T>(url);
    if (!live.current) return;
    if (r.data !== null) setData(r.data);
    setStale(r.stale);
    setFailed(!quiet && r.failed);
  }, [url]);
  useEffect(() => {
    live.current = true;
    const cached = url ? readCache<T>(url) : null;
    if (cached) setData(cached);
    void load(false);
    return () => {
      live.current = false;
    };
  }, [load, url]);
  const reload = useCallback(() => load(false), [load]);
  // A write elsewhere on the page: refetch quietly so nothing shown is stale.
  useEffect(() => {
    if (!url) return;
    return subscribeInvalidate(() => void load(true));
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
  if (shared) return { data: (shared.data ?? null) as T | null, stale: false, failed: false, reload: shared.reload };
  return { data, stale, failed, reload };
}

/** POST JSON; returns parsed body or null on failure. */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown, method = "POST"): Promise<T | null> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    // A write through fetch is already noticed by watchWrites; this covers a page that never installed it.
    if (typeof window !== "undefined" && !(window as typeof window & { __aanganWatched?: boolean }).__aanganWatched) invalidateJson();
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
