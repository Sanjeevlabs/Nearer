## C13 — Kitchen chef, labels and invite cap
**Branch:** `kitchen-chef` · **PR title:** `Surprise me is a real chef: full recipe, calories per ingredient, a picture; invites capped at 10`

Follow-ups from the #91 and #95 reviews, decided by the owner.

1. **Label for Muse recipes.** A recipe saved from Surprise me must never say "Taught by you" (`app/kitchen/[id]/page.tsx` ~line 97). Show **"Idea from Muse · kept by {name}"** (name = who tapped Keep it; "you" for the viewer), and on the Kitchen list a small "Idea from Muse" tag. Recipes the family recorded keep "Taught by {name}".
2. **One voice-consent path.** `RecipeMic` duplicates the voice-consent logic. Reuse the existing shared consent helper/component (the one the voice sheet / VoiceCard path uses; grep for the consent key) so consent is asked once per person for every recording. No behaviour change beyond that.
3. **Surprise me = an intelligent chef.** Keep the sheet (fridge, taste, diet, calories target, time, servings; prefs saved per member). Muse (Meta model via the existing wrapper, spend cap, Zod with fallback) returns ONE complete recipe:
   - title, short why-you'll-like-it line;
   - ingredients, each with **quantity + unit and estimated kcal for that quantity**;
   - steps with times; total time; servings;
   - **kcal per serving = sum of ingredients ÷ servings, computed in code** (not trusted from the model; show "about"); flag if over the person's calorie target;
   - **diet check in code**: if any ingredient breaks the chosen diet (vegetarian: no meat/fish/egg; vegan: also no dairy/honey; no onion-garlic; gluten-free: no wheat/barley/rye/semolina/maida), ask Muse once more with the violation named; if still violating, show the recipe with a clear warning rather than silently;
   - **a picture**: one Muse Image call for the dish (existing `lib/muse-image.ts`, behind the spend cap, cached by recipe), falling back to the default recipe art if it fails or the cap is hit. Generate it only on Keep it (not on every Another) to save spend.
   - The preview shows ingredient icons, per-ingredient kcal, per-serving kcal and the estimates note ("Calories are estimates, not medical advice").
4. **Invite cap.** Chai / open-door invites (`pushSittingInvite`, `pushDoorNow`, and the sitting/door schemas + UI picker) allow at most **10** people. Enforce in the schema (Zod max 10), the API (400 above 10), and the picker (disable after 10 with "Up to 10 people").
5. Tests: label logic; kcal sum/serving math; diet checker cases; Surprise me fallback paths (bad JSON, cap hit, image failure); invite cap (schema, API, push recipients ≤10). `npx vitest run`, typecheck, lint, mock build, walk.

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
