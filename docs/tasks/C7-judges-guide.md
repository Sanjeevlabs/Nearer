# Work order

## C7 — A "For judges" section and an architecture page
**Branch:** `judges-guide` · **PR title:** `README: a two-minute guide for judges`

**Start after PR #77 (README setup) merges**, then merge `main` into this branch. Edit only a new README section and a new `docs/architecture.md`; do not touch the README setup section (#77), the story, the tagline or the third-party section.
1. Add `## For judges (2 minutes)` near the top of README.md: the live link (https://nearer.site), "Try the demo family" (no sign-up), the 6 things to try in order (window: their sky and local time; light the lamp; Maa's voice note with its words and translation; slide the key to the family page; Kitchen: a recipe taught by voice; For you inbox), and where Meta's models do the work in each.
2. `docs/architecture.md` with a Mermaid diagram (renders on GitHub): browser/PWA and Capacitor shell → Cloudflare Worker (Next.js via OpenNext) → Supabase (Postgres, Auth, Storage) and the Muse provider chain (Meta Model API: Muse Spark, Muse Voice Transcribe, Muse Image → failover Muse Spark Open on Baseten → Modal), SAM on Modal for cut-outs, Open-Meteo for weather. Then short sections, each sourced from the code (cite file paths): request path and session checks (lib/auth.ts, lib/sessions.ts), time limits (lib/timeouts.ts), spend cap (grep the ledger / add_spend), every Muse call logged in "What Muse did", Zod validation with fallbacks, the security review findings already listed in docs or the PR history, test count (run `npx vitest run` and state the number and date).
3. Link `docs/architecture.md` from the judges section. Plain, warm language; no business or fundraising wording; numbers only if you measured them.
4. Acceptance: README renders on GitHub with the Mermaid diagram; every claim in the architecture page points at a file; lint passes.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C7-judges-guide.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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

