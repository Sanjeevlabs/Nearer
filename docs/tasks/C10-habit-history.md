## C10 — Habits: a history you can trust
**Branch:** `habit-history` · **PR title:** `Together habits keep a history: who did it, which day, and what changed`

Owner question: the family page shows a shared habit ("Morning walk, 7 AM"). If someone unticks or resets it, what happens, where is it stored, and how does the family see "you walked today" or "you walked on Monday"?

Today: `lib/habits.ts` (DEFAULT_HABIT, ticks keyed `tickId(habitId, memberId, day)`, HABIT_TICK_KEEP_DAYS = 60, actions create/join/leave/rename/retime/archive/tick/untick), `app/api/habits/route.ts`, `app/kitchen/together-habit.tsx`, storage in `family_docs`.

1. **Write it down first** (the owner wants to understand it): add `docs/habits.md` explaining in plain words where a habit and its ticks are stored (table, kind, keys), what each action does to the stored data, how "today" is decided (each person's own time zone, `dayIn`), and how long ticks are kept. Cite file paths.
2. **History, never silent loss.** Every action (tick, untick, rename, retime, join, leave, archive, create) appends an entry to a per-habit activity log (`family_docs` kind `habit-log`, or an array on the habit doc if that is the existing pattern; bounded to the last 200 entries): who, what, when (ISO + the actor's local day), before → after for rename/retime. Untick removes today's tick but the log keeps "Asha unticked Morning walk, 3 Nov". Archive keeps ticks and log readable.
3. **What people see.** On the habit card: today's line stays ("Maa and you walked today"). Tap the card → a "History" sheet: a 7-week dot calendar per person (filled = done that day in their time zone) and the activity log newest first ("Mon 3 Nov · Maa walked · 7:12 AM her time"; "Sun 2 Nov · Arjun changed the time from 7:00 to 6:30"). A one-line streak/total in words ("Maa walked 5 of the last 7 days") — facts only, no shaming copy.
4. **Daily line.** Where the window/family page shows the habit, say "You walked today" / "You last walked on Monday" from the stored ticks (no new heavy queries: reuse the payload the card already loads; keep /api/window and /api/courtyard CPU flat).
5. Tests: every action appends the right log entry; untick + re-tick same day; time-zone edge (a tick at 11:30 PM in one zone vs another); log cap; history API is family-scoped and session-checked; walk.py opens the History sheet.

---
## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/…`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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
