## C9 — Kitchen: photos back, one-step add, and "Surprise me"
**Branch:** `kitchen-photos-easy-add` · **PR title:** `Kitchen: every recipe has a picture, adding one takes a minute, and Muse can surprise you`

Owner feedback: the Kitchen went voice-first, but nobody can feel a recipe without seeing it. "Add a recipe" feels like a long form. Bring the pictures and recipe details back, make adding near-effortless, and add an on-demand chef.

1. **Pictures and details back.** Read `git log -p -- app/kitchen components/*recipe* lib/recipe*` (and #64/#75) to find what the Kitchen list and recipe page showed before the voice-first change: the default illustrated recipe art (`app/kitchen/recipe-art.tsx`, `public/demo/*`), the recipe list cards, "Taught by" / who added it, "Cooked by the family", time, servings. Restore them. Every recipe card shows a picture: the family's photo if any, otherwise the existing default illustrated art for that dish type (never blank).
2. **Add a recipe in one step.** Replace the long form with one sheet: a big mic ("Tell us the recipe"), a "Add a photo" button (camera or library, optional), and "Or type it" (one free-text box). One button: Save. Muse (Meta model via the existing Muse wrapper, spend cap and trace; mock mode returns a canned structured recipe) turns what was said/typed/photographed into the structured recipe: title, ingredients with quantities, steps, time, servings, and **calories per serving (labelled "about", estimated)**. Show the result as an editable preview the cook can fix in place (tap a line to edit), then Save. Reuse `lib/recipe-scan.ts` / `app/api/kitchen/scan` for photos of written recipes and the existing voice transcription path; Zod-validate the model output with the existing fallback. Required fields from the person: none beyond the recording/text.
3. **Ingredient pictures.** Each ingredient line shows a small picture: map common ingredients to a bundled icon set (add simple, original SVG or emoji-free glyphs for ~40 common ingredients; generic fallback). No live image generation per ingredient.
4. **Surprise me (on-demand chef).** A "Surprise me" button on the Kitchen page opens a short sheet: what's in the fridge (optional text or voice), taste (mild / spicy, sweet / savoury chips), diet (vegetarian, vegan, no onion-garlic, gluten-free…), calories target (optional), time available, servings. Prefill from the family's saved preferences if they exist (store the last answers per member in the existing family_docs as kind `kitchen-prefs`). Muse generates one recipe in the same structured shape (with "about N kcal per serving"), shown with the default art; "Keep it" saves it to the family Kitchen marked "Idea from Muse", "Another" asks again. Label clearly that calories and nutrition are estimates, not medical advice. One Muse call per tap, behind the spend cap.
5. Keep every existing recipe working (old recipes without calories just don't show the line). Tests: Zod schema for the structured recipe and the surprise request; mock-mode flow tests for add-by-voice, add-by-photo, add-by-text and surprise; walk.py covers Kitchen list → recipe → Add (sheet opens, mock save) → Surprise me (mock result, Keep it).

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
