# Work order

## C5 — Less CPU per request (Cloudflare free plan cuts requests over 10 ms)
**Branch:** `cpu-per-request` · **PR title:** `Lighter requests: fewer polls, less work per call`

The app runs on Cloudflare Workers' free plan, which stops a request that uses more than **10 ms of CPU**. Measured on the live site during one full walk of the app (3 Nov): median CPU per request **9–10 ms**, p90 **23 ms**, and about **7% of requests were cut off**. Heaviest and most frequent routes:

| Route | Calls in one walk | CPU median / max |
|---|---|---|
| `/api/waiting` | 88 | 18 ms / 464 ms |
| `/api/courtyard` | 8–13 | 42–67 ms / 598 ms |
| `/api/window` | 10–15 | 37–39 ms / 476 ms |
| `/api/inbox` | 4–7 | 22–31 ms |
| `/api/session` | many | (on every page) |

Goal: same screens, same data, same behaviour — but fewer requests and less CPU per request.
1. **Fewer calls.** Find why `/api/waiting` is called ~88 times in one walk (polling interval, duplicate readers, refetch on focus/visibility, re-mount loops). Share one request between readers (lib/use-json.ts already dedupes flights — check it covers this), lengthen polls that don't need to be fast, stop polling in hidden tabs. Same for any other route polled more often than once a minute.
2. **Less work per call.** Profile the handlers of `/api/courtyard`, `/api/window`, `/api/waiting`, `/api/inbox`, `/api/session?family=1` in mock mode: add `scripts/cpu-bench.mjs` (or `.ts` via tsx) that calls each route handler N times against the seeded demo family and reports CPU per call with `process.cpuUsage()`. Then cut the work: avoid re-parsing the same rows with Zod more than once per request, avoid sorting/filtering whole lists when only the newest few are needed, memoise per-request derived data, move work that doesn't change per request (static tables, regexes, catalogues) to module scope.
3. **Do not change** what any screen shows, any API response shape, security checks (session/membership checks must still run on every request), or the time limits in `lib/timeouts.ts`.
4. Put before/after numbers from `cpu-bench` (median and p90 per route) and the per-walk call counts (count requests in `scripts/walk.py` — add a request counter if needed) in the PR description. Target: `/api/waiting` calls per walk at least halved; median handler CPU down at least 30% on the five routes.
5. Tests: existing round-trip and API tests must still pass; add tests for any polling/dedupe rule you change.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C5-cpu-per-request.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

Rules (from AGENTS.md — non-negotiable):
- Merge the latest `main` into this branch before your final push if `main` moved.
- Commits as `Sanjeevlabs <novstar89@gmail.com>`. **No** `Co-Authored-By`, Codex or Claude lines. Small commits. Never push to `main`, never force-push.
- Next.js 16 + React 19, TypeScript strict, Tailwind, Zod. **Every AI model called at runtime must be a Meta model** (lint enforces it). No Meta/Muse logos.
- Public repo: product code and product docs only, nothing about the business side. Synthetic demo data only.
- UI copy: warm and short, no India-only words, never "Circle", never "Aangan" (internal keys like `aangan:*` stay). Semantic text classes only (no `text-[Npx]`), touch targets ≥ 44 px, light mode only.
- Before marking ready: `npm ci && npm run typecheck && npm run lint && npx vitest run` and `MOCK=true NEXT_PUBLIC_MOCK=true npx next build` all pass, and CI is green.
- `docs/ui-inventory.csv` is generated: if CI's "UI inventory is current" step fails, download that run's `ui-inventory` artifact and commit it. Never hand-edit it.
- Never skip, disable or loosen a test to get CI green.
- Update this PR's description at the end: what changed, why, how you tested, anything you could not verify.

