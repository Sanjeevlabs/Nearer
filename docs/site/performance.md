# Performance

How Nearer stays fast on phones: fewer requests, small JavaScript, small images, and caches that clear on write.

## Reads start together

- The first screen starts all its reads at once. One request carries the session, the family, and how everyone is related.
- The window and the courtyard read in two database waves.
- Switching sides is instant, with no reload.
- Lists refresh by polling, not by holding connections open. Waiting lists refetch every 60 s, when the app returns to the screen, and straight after any write you make. An open door is hidden within one window poll, and the call page re-checks every 60 s.
- The home-page film loads only when someone presses play.
- A page or data request retries once when the host cuts a request off under its CPU limit.
- Reliability helpers listed in the build history are an upload queue with retry, stale-while-revalidate, per-section boundaries, and a service worker. Their current settings are not verified.

## What is prerendered

- Docs pages are written as `docs/site/*.md` and prerendered by `app/docs`.
- Ritual configs are bundled through `rituals/index.ts`.
- Link previews use static images. A per-recipe image is not rendered at request time.
- There is no revalidation. Prerendered pages are served from static assets.
- Images are served as-is from static assets. The exact image weight budget is not verified.

## Caching

Server code keeps small public-data caches in process memory. On Workers each isolate has its own copy, so a cache can reset at any time.

| Cache | Where | How long |
|---|---|---|
| Weather and geocode lookups | Process memory | 30 min / 24 h, and 10 min for a miss |
| Holiday feed, weather, geocoding deadlines | Cached across isolates with deadlines | Exact deadlines are not verified |
| Model output cache | Process memory, may be recomputed per isolate | Not verified |

The browser keeps small UI caches so back-and-forth visits do not refetch everything:

- Client list cache (`useJson`): browser memory and `sessionStorage` under `aangan:json:*`, only small payloads. Any successful write drops all of it and lists refetch once, 200 ms later, coalesced. A 401 drops it. Sign-in, sign-out, switching family or person (`aangan:auth`) drops it. Between a write and the refetch is about a quarter of a second.
- Cards snapshot (`useFamilyCards`): browser memory, cleared on the same write and auth events.
- Courtyard payload (`/api/courtyard`): browser memory, refetched on any write and on `aangan:auth`.
- `aangan:hero`, the last first-screen photo: browser `localStorage`, removed on `aangan:auth` so the next family never paints the last family's photo.

## Bundle and loading choices

- `next/image` everywhere, with responsive `sizes`, AVIF/WebP, `priority` on the hero only, and blur placeholders. No layout shift is the aim.
- Fonts use `next/font`, two families, subset, with `display: swap`.
- Motion goes through `LazyMotion` plus `domAnimation`, so the motion bundle stays small.
- Waveforms are plain DOM bars, 64 or fewer, with precomputed peaks. A live analyser runs only while recording or playing.
- At most two `backdrop-filter` layers are visible at once, with a solid fallback when unsupported.

## Budgets and checks

- Shared JavaScript budget is checked by `node scripts/perf-budget.mjs`.
- Shared means what every route loads: the build's root main files plus the chunks of the root layout in `app/layout`.
- Files are read from the output of `next build` and gzipped as a server would send them. The default budget in the script is 220 KB.
- The check fails when the total is over budget, and when the manifests do not say where the shared chunks are.
- Page weight and Core Web Vitals are checked by `scripts/perf-vitals.py`. Its current limits are not verified.
- The design target listed in the inputs is Lighthouse mobile performance 90 or higher. Other current numeric targets for load, shift, or interaction are not verified.

---

Written by Muse Spark (Meta) from the build log on 2026-11-03.
