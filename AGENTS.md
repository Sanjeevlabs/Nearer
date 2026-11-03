# AGENTS.md — Nearer

Solo Indie-track hackathon entry. Public repo. Deadline 4 Nov 2026, 9:00 PM ET.

Read docs/PRD.md before any task; it overrides earlier instructions; build only the milestone I name; stop after each milestone.

## Meta-only models (hackathon rule)

Every AI model this project calls at runtime, on the server or in the browser, must be a Meta model. Organizers' wording: "Every AI model your project calls at runtime must be a Meta model."

- Models we use: Muse Spark, Muse Voice Transcribe, Muse Image, Muse Spark Open (Baseten/Modal failover), SAM 2.1 / SAM 3, and Meta MMS-TTS (`facebook/mms-tts-eng`) for the demo-video narration.
- It covers browser ML and media pipelines too: no virtual backgrounds, background blur, noise-suppression or segmentation models (no MediaPipe, TensorFlow.js, ONNX models from other vendors), and no other vendor's TTS/STT. A built-in browser/system voice that is not a model call is fine.
- Scripts count (`scripts/`, demo reel included). `npm run lint` fails on known non-Meta packages, hosts and model downloads; do not weaken it.
- No Meta or Muse logos anywhere. Model names appear as plain text only.
- Third-party assets (fonts, images, audio, models) must be licensed for this use and listed in the README with their source.
- Commit incrementally in small commits; judges read the history.

## Rules

- No secrets or real family data in code, logs, or assets. Synthetic or self-owned test assets only.
- `META_API_KEY` comes from the environment only. Never write it to any file.
- Rituals are data-driven: festival specifics live in `rituals/*.json`. Never branch on a festival or culture in `lib/` or `app/`.
- Muse Image: style cards, paint family portraits, restore old photos. Portraits are painted (never photorealistic) and marked "Painted by Muse"; restorations are marked "Restored by Muse". Never invent events or people outside the family. Cache every output.
- No elaborate frameworks or dashboards. A guardrail costing over ~1h gets a cheaper version.
- Commits as Sanjeevlabs (novstar89@gmail.com), no Claude/Co-Authored-By/session trailers. Never push to main, never force-push, never tag. PRs are merged only when the owner says.

## Commands

- `npm run dev` — local dev server.
- `npm run lint` — secret scan + no hard-coded festivals in app logic.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run test:mock` — mock-mode unit + smoke tests.
- `npm run ui:inventory` — regenerate docs/ui-inventory.csv/.xlsx (every visible UI item per screen) against a mock build on :4600 (`BASE=...` to override). Run it and commit docs/ui-inventory.* whenever UI is added or removed; CI fails if the CSV is stale. Verdicts are hand-edited in docs/ui-inventory.verdicts.json.
- `npm run eval:golden` — manual live golden eval. Needs `META_API_KEY`. Never in CI.
- Deploy: Cloudflare Workers via OpenNext, `npm run cf:deploy` (see docs/DEPLOY.md).

## Conventions

- TypeScript strict. Zod validates every model response: one retry, then a safe fallback card. No raw model text reaches the UI.
- Uploads: images ≤5 MB; video ≤30s and ≤25 MB with a client-side thumbnail.
- Auto-dating: EXIF/file metadata first; model date only as fallback; never the future.
- Supabase RLS scoped by `family_id`. One seeded demo family (`demo-family`). No full auth flow for V1.
- Demo languages: English + Hindi. Card content carries the language.
- Design: HIG-inspired, content-first. Tokens live in `app/tokens.css` (8pt grid, warm palette, light + dark). System font stack only. Tailwind + shadcn-style `components/ui` for speed; no custom design system. Every screen has empty, loading (skeleton, never blank spinner), and error (graceful fallback card) states. Motion 150-300ms, honor `prefers-reduced-motion`. Touch targets >=44px. Polish is time-boxed to 3 Nov.
- `BUILD_LOG.md` updated daily — the demo must show only work built during the event.

## Guardrail policy (never cut)

Schema validation, spend cap (USD 120, refuses past the cap), mock-mode tests.
