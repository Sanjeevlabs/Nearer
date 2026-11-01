// A small JSON cache shared by every isolate in a data centre: the Cloudflare
// Cache API (caches.default) under a synthetic URL. A Worker isolate's own
// memory is cold on most requests; this lets one isolate's fetch of a slow,
// slow-changing thing (a city's coordinates, its weather) serve the others.
// Where the Cache API does not exist (Node, tests, `next dev`) every call
// quietly does nothing and callers keep their in-memory maps. Never throws.

interface EdgeCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

function store(): EdgeCache | null {
  try {
    const c = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
    return c ?? null;
  } catch {
    return null;
  }
}

const keyUrl = (key: string) => `https://edge-cache.aangan.invalid/${encodeURIComponent(key)}`;

export async function edgeGet<T>(key: string): Promise<T | undefined> {
  try {
    const c = store();
    if (!c) return undefined;
    const hit = await c.match(new Request(keyUrl(key)));
    return hit ? ((await hit.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function edgePut(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const c = store();
    if (!c) return;
    await c.put(new Request(keyUrl(key)), new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSeconds}` } }));
  } catch {
    /* a cache that will not take it is just a cache miss next time */
  }
}
