# Work order

## C1 — Fix the flaky native sign-in test
**Branch:** `fix-native-test-flake` · **PR title:** `Test: native sign-in link routing is reliable`

`tests/native.test.ts` → "in the native app › routes appUrlOpen and closes the sign-in browser" failed once on CI (expected `['/auth/callback?code=z']`, got `[]`, test took ~1.1 s) and passed on re-runs.
1. Reproduce: run it in a loop (`for i in $(seq 1 50); do npx vitest run tests/native.test.ts || break; done`), also under load (`npx vitest run --pool=threads --maxWorkers=1` and in parallel with the full suite).
2. Find the real cause (likely the test asserts before an async listener/dynamic import in `lib/native.ts` has run, or relies on real timers). Fix the **test** (await the right promise / use `vi.waitFor` / fake timers deterministically). Change `lib/native.ts` only if the app itself has a real race — then explain it in the PR.
3. Acceptance: 50 consecutive local passes; CI green.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C1-fix-native-test-flake.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

Rules (from AGENTS.md — non-negotiable):
- Merge the latest `main` into this branch before your final push if `main` moved.
- Commits as `Sanjeevlabs <novstar89@gmail.com>`. **No** `Co-Authored-By`, Codex or Claude lines. Small commits. Never push to `main`, never force-push.
- Next.js 16 + React 19, TypeScript strict, Tailwind, Zod. **Every AI model called at runtime must be a Meta model** (lint enforces it). No Meta/Muse logos.
- Public repo: no strategy, competitor, money or partner text. Synthetic demo data only.
- UI copy: warm and short, no India-only words, never "Circle", never "Aangan" (internal keys like `aangan:*` stay). Semantic text classes only (no `text-[Npx]`), touch targets ≥ 44 px, light mode only.
- Before marking ready: `npm ci && npm run typecheck && npm run lint && npx vitest run` and `MOCK=true NEXT_PUBLIC_MOCK=true npx next build` all pass, and CI is green.
- `docs/ui-inventory.csv` is generated: if CI's "UI inventory is current" step fails, download that run's `ui-inventory` artifact and commit it. Never hand-edit it.
- Never skip, disable or loosen a test to get CI green.
- Update this PR's description at the end: what changed, why, how you tested, anything you could not verify.

