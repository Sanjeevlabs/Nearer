# Work order

## C4 — Translate the new strings
**Branch:** `translate-new-strings` · **PR title:** `New screens in every app language`

`lib/ui-strings/en.ts` gained keys today (sign-in "Sign in or sign up", signed-in-as / Not you, other-device link message, city suggestion "From your connection…" / "Use my location", the voice-first tagline, the Sounds switch, the "couldn't load / Try again" block, profile menu rows). Other languages fall back to English.
1. Compare `en.ts` with each of `ar, bn, es, gu, hi, kn, ml, mr, pa, ta, te, ur` (`lib/ui-strings/*.ts`). Add every missing key to each file. **Edit only the non-English files**; do not change `en.ts`.
2. Natural, warm, short wording a 70-year-old would understand; keep `{placeholders}` exactly; keep "Nearer" untranslated. Arabic and Urdu are RTL — no layout changes needed.
3. Add or extend a test that every non-English catalogue has every `en.ts` key used by the sign-in, settings and home screens (or all keys, if the repo's existing test style allows).
4. Merge the latest `main` in just before finishing (PR #75 may add more strings) and cover those keys too.
5. Acceptance: no missing keys in those files; tests pass. Note any string where you were unsure of the wording.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C4-translate-new-strings.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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

