# Work order

## C6 — Accessibility pass on the main screens
**Branch:** `a11y-pass` · **PR title:** `Every main screen passes an accessibility check`

**Start after PR #75 merges** (it touches many screens), then merge `main` into this branch.
1. Add `@axe-core/playwright` as a devDependency (check `scripts/lint.mjs`'s dependency allowlist and add it there if needed) and an axe check to `scripts/walk.py` (or a new `scripts/a11y.py` run in CI after the walk) for the main screens at 390×844, for the demo personas the walk already uses: home page `/home`, sign-in, window, family page (after the key slide), voice sheet, profile menu, Memory Lane, Kitchen, a recipe, Stories, Care, For you, Settings, kid home.
2. Fix every **serious** and **critical** violation (labels, roles, contrast against the black-and-white tokens, focus order, names on icon-only buttons, headings order, `lang`/`dir` on RTL pages). Don't restyle the design; fix semantics and contrast within the existing tokens.
3. Fail CI on serious/critical violations from then on. List any you could not fix and why.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C6-a11y-pass.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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

