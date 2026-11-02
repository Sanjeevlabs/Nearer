# Performance

How Nearer stays fast on a phone: less to download, fewer reads before the first screen, and small caches that clear quickly.

## What loads first

- The hero photo has loading priority. Other images do not.
- The window and the courtyard read in two database waves. The build log notes this was six and eight waves before.
- The catch-up sentence is bounded, so a model call never holds the first screen.
- Past runs in the build log record courtyard LCP 6.0 s → 1.2 s with CLS 0.37 → 0, and 18 → 6 API calls. Window LCP 3.6 s → 0.7 s with CLS 0. Images 312 → 82 KB in the same pass.

## What is prerendered

- Pages are prerendered and served from static assets. Nearer uses no revalidation, so no extra cache bucket is needed.
- Link previews use static images. The recipe page title and description are still per recipe.
- Ritual configs are bundled at build time.
- The few bundled demo photos are served as-is from static assets, edge-cached. There is no built-in image optimizer in this setup.
- Reliability helpers noted in the build log: upload queue with retry, stale-while-revalidate, per-section boundaries, and a service worker.

## Caching

Reads come from the database first on every public view. On top of that:

| Cache | Where | Rule |
|---|---|---|
| List cache, `useJson` | Browser memory and `sessionStorage` (`aangan:json:*`, small payloads only) | Any successful write drops all of it; lists refetch once 200 ms later, coalesced. A 401 drops it. Sign-in, sign-out, or switching family or person drops it. Between a write and the refetch is about a quarter of a second. |
| Cards snapshot, courtyard payload | Browser memory | Same write and auth-change invalidation as above. |
| Last first-screen photo, `aangan:hero` | Browser | Set when the window loads. Removed on auth change, so the next family never paints the last family's photo. |
| Weather, geocoding, holiday feed | Server, shared across isolates | Cached with deadlines. The weather cache notes 30 min / 24 h / 10 min for a miss. Public data only. |
| Model output cache | Server | Cached outputs may be recomputed per isolate. |

## Smaller downloads

- **Shared JavaScript** means what every route loads: the build's root main files plus the chunks of the root layout. It is measured gzipped, as a server would send it. The default budget is 220 KB. The build log records shared JS 272 → 202 KB gz.
- Images use responsive `sizes`, AVIF/WebP, and blur placeholders, with no layout shift.
- Fonts load with subset and `display: swap`. Two families only.
- Motion loads through `LazyMotion` with `domAnimation`, so the motion bundle stays small.
- Waveforms are plain DOM bars, 64 or fewer, with precomputed peaks. The live analyser runs only while recording or playing.
- At most two `backdrop-filter` layers are visible at once, with a solid fallback when unsupported.

## Budgets and checks

- `node scripts/perf-budget.mjs` checks shared client JS against the budget. It fails when the total is over budget, and when the manifests do not say where the shared chunks are.
- `scripts/perf-vitals.py` checks page weight and Core Web Vitals.
- Targets in the design system: Lighthouse mobile performance ≥ 90, accessibility ≥ 95, interaction under 100 ms.
- `scripts/walk.py` fails on sideways overflow, text over 34px outside `data-display`, and text under 12px at 360 and 390pt.

---

Written by Muse Spark (Meta) from the build log on 2026-11-02.
