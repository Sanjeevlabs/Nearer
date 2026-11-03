# Work order

## C2 — Fresh-clone setup check for judges
**Branch:** `readme-setup-check` · **PR title:** `README: setup that works from a fresh clone`

Hackathon rule: judges must be able to run the project from its setup instructions.
1. In a clean directory, `git clone` the repo and follow **only** what the README says to run the app in **mock mode** (no secrets): install, build, start, open the demo family, run the tests.
2. Fix every step that fails or is missing — **only** in the README's setup/run section and `.env.example` (add missing variable names with safe placeholder values and one-line comments; never real values). Do **not** edit the README's story, feature, tagline, "Built with Meta" or "Third-party" sections.
3. Include: Node version (CI uses Node 20), `npm ci`, the exact mock commands (`MOCK=true NEXT_PUBLIC_MOCK=true npx next build` then `MOCK=true NEXT_PUBLIC_MOCK=true SESSION_SECRET=<any 40 chars> npx next start -p 3000`), demo sign-in (the "Try the demo family" button / code `NEARER-DEMO`), and `npx vitest run`. Mention that live mode needs Supabase + Meta keys (names only, from `.env.example`).
4. Acceptance: a second fresh clone following the new README reaches the demo family's window with zero extra steps; paste the exact command transcript (trimmed) in the PR description.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C2-readme-setup-check.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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

