// Nearer offline shell. Hand-written, no dependencies.
//  - static files (/_next/static, /demo, /icons, /home, /window): stale-while-revalidate
//  - pages: network first; on a 5xx or network error (the host's CPU cut-off) up to 2 retries (300, 900 ms), then the last
//    copy of that page (kept per URL, 30 at most), then /retry.html (reloads itself, then a calm "Try again"). Offline: /offline.html.
//    The raw host error page never reaches the person. Decisions live in sw-core.js (tested).
//  - /api GETs: network first, then the last copy (never media, session, auth or push)
//  - push: shows the notification the server sent; a tap focuses Nearer (or opens it) at data.url
// Pages and API copies are family data: the app posts "clear" on sign-in / sign-out.
const VERSION = "v6"; // v6: offline and retry pages served as fresh responses (the host redirects .html); v5: /api retries left to the app when it marks them; v4: page retries, kept page copies, /retry.html; v3: one retry on 502/503/504; v2 dropped the retired courtyard photos
importScripts("/sw-core.js");
const PAGES = `aangan-pages-${VERSION}`;
const STATIC = `aangan-static-${VERSION}`;
const DATA = `aangan-data-${VERSION}`;
const SHELL = ["/offline.html", "/retry.html", "/sw-core.js", "/manifest.webmanifest", "/icons/icon-192.png"];
const STATIC_PREFIXES = ["/_next/static/", "/demo/", "/icons/", "/home/", "/window/", "/brand/"];
const RETRY = [502, 503, 504];
const NEVER = ["/api/media", "/api/session", "/api/auth", "/api/transcribe", "/api/push"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== DATA && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(Promise.all([caches.delete(DATA), caches.delete(PAGES)]));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A static file: the kept copy at once, refreshed in the background. No copy yet: fetch, and once more if the host cut it off.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const get = async () => {
    let res = await fetch(req.clone()).catch(() => null);
    if (!res || res.status >= 500) {
      await sleep(300);
      res = (await fetch(req.clone()).catch(() => null)) || res;
    }
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  };
  if (hit) {
    get().catch(() => null);
    return hit;
  }
  return (await get()) || Response.error();
}

// A page: retry, then this page's kept copy, then the self-retrying page. Never the host's error page.
async function page(event) {
  const req = event.request;
  const cache = await caches.open(PAGES);
  const url = new URL(req.url);
  const keep = NearerSW.cacheablePage(url.pathname);
  const out = await NearerSW.navigate(
    () => fetch(req),
    async () => (keep ? await cache.match(url.href) : null),
    sleep,
  );
  if (out.kind === "network") {
    if (keep && out.res.ok && out.res.type !== "opaqueredirect" && !out.res.redirected) {
      const html = (out.res.headers.get("content-type") || "").includes("text/html");
      if (html) {
        const copy = out.res.clone();
        event.waitUntil(
          (async () => {
            await cache.delete(url.href);
            await cache.put(url.href, copy);
            for (const k of NearerSW.overflow((await cache.keys()).map((r) => r.url))) await cache.delete(k);
          })(),
        );
      }
    }
    return out.res;
  }
  if (out.kind === "copy") return out.res;
  if (out.kind === "offline") return (await shellPage("/offline.html")) || Response.error();
  return (await shellPage("/retry.html")) || (await shellPage("/offline.html")) || Response.error();
}

// The host answers /retry.html and /offline.html with a redirect to /retry and /offline, so the kept copy is a
// redirected response, which a browser refuses as the answer to a page load. Hand back a fresh copy of its body.
async function shellPage(path) {
  const kept = await caches.match(path);
  if (!kept) return null;
  return new Response(await kept.blob(), { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function networkFirst(req, fallback) {
  const cache = await caches.open(DATA);
  // The app's own retry layer (lib/retry.ts) marks a request it will try again: pass a 5xx straight through,
  // so retries never multiply and an old copy is never served as if it were fresh. Unmarked (the last try,
  // or a caller without retries): one quick retry here, then the last copy.
  const clientRetries = req.headers.get("x-nearer-retry") === "1";
  try {
    let res = await fetch(req);
    if (RETRY.includes(res.status) && !clientRetries) {
      await new Promise((r) => setTimeout(r, 250));
      res = await fetch(req);
      if (RETRY.includes(res.status)) {
        const kept = await cache.match(req);
        if (kept) return kept;
      }
    }
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (clientRetries) throw err;
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
    event.respondWith(page(event));
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
