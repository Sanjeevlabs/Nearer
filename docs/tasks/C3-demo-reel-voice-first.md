# Work order

## C3 — Re-cut the hackathon video for the voice-first app
**Branch:** `demo-reel-voice-first` · **PR title:** `Product demo recording: voice first, no door`

The app changed today: the bottom bar is **Voice + House** only, the entrance **door is removed** (after the key slide the family page fades in), the home page leads with **"Talk, don't type."**, and there is a compact profile menu. The demo recording scripts are in `scripts/demo-reel/` (`v2.py`, `shots.py`, `record.py`, `assemble.sh`, `captions.py`, `run.sh`).
**Start after PR #74 (home page pictures) merges**, then merge `main` into this branch.
1. Read the scripts. Update shots and captions to the current UI: no door shot or door wording; lead with voice (Maa's voice note with its words and translation), the window, the lamp, the open door for chai (the **Together** "open your door" feature still exists — that one stays), Dadi's stories for the grandchildren, the kitchen taught by voice, Occasions.
2. Narration must stay **Meta MMS-TTS** (`facebook/mms-tts-eng`) — no other TTS. Run `python3 scripts/demo-reel/v2.py --check-vo` and make every line fit its shot.
3. Record against a local **mock** build with the fixed clock the scripts use. Synthetic data only. Never open a store checkout.
4. Output (not committed; `out/` is gitignored): 16:9 1920×1080 and 9:16 1080×1920 MP4s, ≤ 25 MB each, burned-in captions, plus `.srt`. Attach a 5-frame contact sheet and the MP4s (or a link) to the PR.
5. Commit only script changes. Keep the video and captions about the product only: no business, fundraising or usage-number wording.

## How to work on this PR (Codex)
This is a draft PR opened as a work order. **Build on this branch** (check it out, commit, push to it). When done: delete this task file (`docs/tasks/C3-demo-reel-voice-first.md`) in your last commit, mark the PR ready for review, and stop. **Do not merge.**

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

