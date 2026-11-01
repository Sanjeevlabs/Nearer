// Nearer offline shell. Hand-written, no dependencies.
//  - static files (/_next/static, /demo, /icons, /home, /window): stale-while-revalidate
//  - pages: network first, then the last copy, then /offline.html
//  - /api GETs: network first, then the last copy (never media, session or auth)
// Pages and API copies are family data: the app posts "clear" on sign-in / sign-out.
const VERSION = "v1";
const STATIC = `aangan-static-${VERSION}`;
const DATA = `aangan-data-${VERSION}`;
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png"];
const STATIC_PREFIXES = ["/_next/static/", "/demo/", "/icons/", "/home/", "/window/"];
const NEVER = ["/api/media", "/api/session", "/api/auth", "/api/transcribe"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(caches.delete(DATA));
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await fresh) || Response.error();
}

async function networkFirst(req, fallback) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (fallback ? await fallback() : Response.error());
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/")) {
    if (NEVER.some((p) => path.startsWith(p))) return;
    event.respondWith(networkFirst(req, null));
  } else if (STATIC_PREFIXES.some((p) => path.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(req));
  } else if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, () => caches.match("/offline.html")));
  }
});
