# Work order

## C8 — Questions only an elder can answer
**Branch:** `elder-questions` · **PR title:** `Story prompts: questions only Dadi can answer`

Nearer's thesis is that parents are needed, not monitored. Add a small set of prompts that ask elders for family history only they know.
1. Read `lib/story-ideas.ts` and wherever the daily/weekly elder prompts and "Today" prompts are defined (grep for the existing prompt lists and their tests). Add 6–8 new prompts in the same format and tone, for example: where your grandparents lived and what they did; the name of the house or street you grew up on; how your parents met; a family recipe or song that came from your grandmother; the journey when the family moved; what your family name means or where it comes from. Keep them warm, short, answerable by voice in a minute.
2. **Never** ask about caste, gotra, religion, money, health or illness, or anything about someone's death or abuse. Do not invent ancestors or names. Each prompt must be skippable like the existing ones.
3. If the existing prompts have Hindi (or other language) versions, add matching versions in the same files and style; otherwise English only.
4. Extend the existing prompt tests (validation of the prompt list, Muse choice validated against the list) to include the new prompts.
5. Acceptance: tests pass; the new prompts appear in the rotation in mock mode.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C8-elder-questions.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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

