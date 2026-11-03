// Drop the service worker's kept pages and API copies from the window side. CacheStorage is shared per
// origin, so this works even when no worker controls the page (a hard reload, before the first claim),
// where posting "clear" to navigator.serviceWorker.controller silently does nothing.

const FAMILY_CACHE = /^aangan-(data|pages)-/;
/** Never hold sign-out longer than this for cache cleanup. */
export const SW_CLEAR_CAP_MS = 1500;

export async function clearSwCaches(store: CacheStorage | undefined = typeof caches === "undefined" ? undefined : caches): Promise<void> {
  if (!store) return;
  const keys = await store.keys();
  await Promise.all(keys.filter((k) => FAMILY_CACHE.test(k)).map((k) => store.delete(k)));
}

/** clearSwCaches, also tells the worker, never throws and never waits longer than the cap. */
export function clearSwCachesQuietly(capMs = SW_CLEAR_CAP_MS): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage("clear");
  } catch {
    /* no service worker */
  }
  return Promise.race([clearSwCaches().catch(() => undefined), new Promise<void>((r) => setTimeout(r, capMs))]);
}
