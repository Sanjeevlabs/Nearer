// Nearer offline shell. Hand-written, no dependencies.
//  - static files (/_next/static, /demo, /icons, /home, /window): stale-while-revalidate
//  - pages: network first, then the last copy, then /offline.html
//  - /api GETs: network first, then the last copy (never media, session, auth or push)
//  - push: shows the notification the server sent; a tap focuses Nearer (or opens it) at data.url
// Pages and API copies are family data: the app posts "clear" on sign-in / sign-out.
const VERSION = "v2"; // v2: drops the retired courtyard photos v1 cached
const STATIC = `aangan-static-${VERSION}`;
const DATA = `aangan-data-${VERSION}`;
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png"];
const STATIC_PREFIXES = ["/_next/static/", "/demo/", "/icons/", "/home/", "/window/"];
const NEVER = ["/api/media", "/api/session", "/api/auth", "/api/transcribe", "/api/push"];

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

// ---------------------------------------------------------------- push
// The server sends { title, body, url, tag } (lib/push/webpush.ts). Every push must show a
// notification (browsers, and iOS in particular, drop the subscription otherwise).
// Nothing here is cached or logged; the text is the only thing that leaves the push service.
function inApp(url) {
  try {
    const u = new URL(url || "/", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: typeof d.body === "string" ? d.body : "",
    icon: "/brand/mark-96.png",
    badge: "/brand/mark-96.png",
    data: { url: inApp(d.url) },
  };
  if (typeof d.tag === "string" && d.tag) options.tag = d.tag;
  event.waitUntil(self.registration.showNotification(typeof d.title === "string" && d.title ? d.title : "Nearer", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(inApp(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        try {
          if ("navigate" in open) await open.navigate(target);
        } catch {
          /* an uncontrolled page cannot be navigated; focusing is still right */
        }
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

// The browser rotated the subscription: save the new one for whoever is signed in here.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/api/push/vapid", { cache: "no-store" });
        if (!res.ok) return;
        const { key } = await res.json();
        const s = key.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        const j = sub.toJSON();
        await fetch("/api/push/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "webpush", subscription: { endpoint: j.endpoint, keys: j.keys } }) });
      } catch {
        /* the next visit re-subscribes (lib/web-push.ts refreshSubscription) */
      }
    })(),
  );
});
