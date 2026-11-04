## Final polish — two tasks, one PR
**Branch:** `final-polish` · Do task 1 first (app code), then task 2 (scripts only; videos are not committed).

### 1. A clean top edge on iPhone
Founder bug (iPhone home-screen app; `appleWebApp.statusBarStyle: "black-translucent"` in app/layout.tsx): on every screen the area under the iOS status bar looks hazy/foggy, and the window's top pills (avatar, bell, time) look faded.
- Window scene `.win-cloud` blobs (app/globals.css: blur 26px, white .55) drift across the top in daytime: keep clouds out of the top ~20% of the sky and lower their opacity.
- Sticky headers with `.frost`/`.glass` backdrop-filter extend under the status bar via `marginTop: calc(-16px - env(safe-area-inset-top))` (components/ui/kit.tsx ~323): give the safe-area strip a solid background token; blur only below it.
- Top pills use `bg-black/30 backdrop-blur-md`: make them crisp (solid semi-opaque).
- On the window, "Slide to go inside, to the whole family." overlaps the first-visit card's footnote just above the key bar: reserve space so nothing renders under that line at 390×844 and 360×740.
- Keep window CLS ≤ 0.05 (scripts/perf-vitals.py). Attach before/after Playwright screenshots (`devices['iPhone 14']`) of /, /lane, /kitchen, /settings.

### 2. Demo video: one family, ninety seconds
The re-cut in #78 was rejected and reverted. Rebuild with `scripts/demo-reel/` (local MOCK build, fixed clock, synthetic data; narration Meta MMS-TTS `facebook/mms-tts-eng` only; run `python3 scripts/demo-reel/v2.py --check-vo`). Fix selectors for the current UI (dock = mic + house, VoiceCard, Kitchen chef, habit history, window intro card shown once then dismissed). Human pacing, short warm captions, no business or metrics words, never open a store checkout.
1. "Talk, don't type." Arjun signs in and lands straight on Maa & Papa's window (purpose line).
2. He lights the lamp.
3. Maa's voice note plays as a music card with Words and translation (Muse Voice Transcribe + Muse Spark).
4. Key → family page → own picture → add a photo; Muse writes the caption.
5. Kitchen: a recipe taught by voice (picture, ingredients, calories); Surprise me returns a full recipe.
6. **Notification moment (3–4 s):** a real-looking adult (synthetic, made with Muse Image via lib/muse-image.ts; `META_API_KEY` from the environment only, never written to a file; at most 3 images) looking at a phone showing the banner with the exact copy from lib/push/copy.ts for the chai/door event, composited with ffmpeg; tap → call screen → "Arjun joined" on Maa's side. No brand logos.
7. The morning-walk habit and its history.
8. Dadi's story for the grandchildren; a "Just for Maa" private note.
9. End card: "Nearer — far from home, never far from them." + "Built with Meta Muse models".
Output (not committed; out/ is gitignored): 16:9 1920×1080 and 9:16 1080×1920 MP4s ≤ 25 MB each, burned-in captions, .srt, a 6-frame contact sheet. Check every frame for loading skeletons, errors or wrong screens and re-record. Commit only script changes; attach the MP4s (or a link) to the PR.

---
## How to work on this PR (Codex)
This is a draft PR opened as a work order. Build on this branch. When done: delete this task file in your last commit, mark the PR ready for review, and stop. Do not merge.
- Merge the latest `main` before your final push.
- Commits as `Sanjeevlabs <novstar89@gmail.com>`, no Co-Authored-By, Codex or Claude lines. Never push to `main`, never force-push.
- Every AI model called at runtime must be a Meta model. Public repo: product code and product docs only, nothing about the business side. Synthetic demo data only.
- UI copy warm and short; semantic text classes; touch targets ≥ 44 px; light mode only.
- Before marking ready: `npm ci && npm run typecheck && npm run lint && npx vitest run` and `MOCK=true NEXT_PUBLIC_MOCK=true npx next build` pass; `docs/ui-inventory.csv` only from CI's `ui-inventory` artifact; never loosen tests.
