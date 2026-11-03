## C11 — Card safety follow-ups from the #93 privacy review
**Branch:** `card-safety` · **PR title:** `Cards can't be overwritten by anyone but their author; private covers stay private`

1. **Overwrite hole (security, highest priority).** `lib/db.ts` (~line 237) upserts cards on a client-supplied UUID (`app/api/cards/route.ts` ~line 249). `existingOwnCard` only skips when the author matches, so someone who learns another card's id (ids appear in `today_task.answers`, `question.answeredCardId`, kid_ask/bedtime docs) can overwrite that card, including a private one. Fix: insert-only for new ids; if the id exists and its author or family differs from the session, refuse (409) — never update. Test: member B posting with member A's card id cannot change A's card (live-DB path and memory path).
2. **Private covers.** `lib/media-gate.ts` matches only `media_ref`. A private voice note's `cover_ref` photo is served to anyone with the path. Include `cover_ref` in the gate (same audience as the card), unless that cover is also some other card's `media_ref` that the viewer may see. Test it.
3. **Index.** Add `create index if not exists cards_family_media_idx on cards (family_id, media_ref);` (and one for cover_ref if used) to `supabase/schema.sql`; say in the PR that the owner must run it in production.
4. **Care from a private note.** `app/api/care/route.ts` (~line 165) lets an addressee turn a private transcript into a family-visible care need. Keep it allowed, but show a one-line warning in that UI: "Everyone in the family will see this."
5. Tests: `npx vitest run` incl. tests/private-cards.test.ts; typecheck, lint, mock build, walk.

---
## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/…`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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
