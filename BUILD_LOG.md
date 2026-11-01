# BUILD_LOG.md — Nearer (Meta Global AI Developer Hackathon, Indie track)

## 28 Oct 2026 — CRITICAL FIX 1: real media to models (recipes 06_muse_voice/01, 01_api_fundamentals/07)

- Voice (06_muse_voice/01 `utils.py transcribe_recording` + `transcribe_file.py`): the client transcodes recordings to mono 16-bit WAV 16 kHz (`blobToWav16k`, recipe engine format) and uploads the bytes as multipart `audio`; the server forwards them as the `audio` file part with the JSON `request` part (`mode: PUSH_TO_TALK`, `model: muse-voice-transcribe-1.0` — config updated to the recipe's public name, `audioEncoding: WAV`) and parses the response `turns[].startMs` into timed lyric segments. Cache key = sha256 of the audio bytes. Missing bytes or endpoint failure → fixed `"Transcript unavailable"` (share disabled, record-again prompt) — no model-written transcript anywhere.
- Vision (01_api_fundamentals/07 cells 5–7/10): photos travel to `muse-spark-1.3` as `image_url` data-URL parts inside a USER message (`buildVisionMessages`); video sends up to 3 client-captured key frames (`extractVideoFrames`). The vision prompt constrains names to the uploader's `taggedNames`. The live path requires images — without media there is no model call, only the fixed fallback. `/api/cards` JSON path never calls a model; multipart grounds empty photo/video captions from bytes. `TranscribeRequestSchema` (audio-id JSON contract) deleted by design.
- Tests: new `tests/fix1-media.test.ts` (5 tests) asserts the live transcribe request body contains the audio file bytes + recipe params, turns→segments timing, USER-role `image_url` parts, and unavailable-without-bytes. Updated `m2-voice` (multipart) + `m2-language` (bytes) tests.
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 80 passed + 3 skipped, `npm run build` ok (32 routes). Live-model cost this fix: USD 0 (mock only).

## 28 Oct 2026 — CRITICAL FIX 2: signed-URL storage (private bucket, media survives reload)

- Private `family-media` bucket (schema already private, deny-by-default RLS): the server mints short-lived URLs only — `POST /api/media/upload-url` → Supabase `createSignedUploadUrl` (client PUTs bytes direct), `GET /api/media/[...path]` → 307 redirect to a 1-hour `createSignedUrl`. Callers keep the synchronous `resolveMediaUrl`: `storage:<path>` refs map to the proxy. Mock backend (in-memory bytes + `/mock-upload`, `/mock-bytes`) keeps tests and mock dev working; live Supabase persists across reloads. Recipes: none new (storage, not model) — no cookbook recipe applies.
- Client pipeline (`lib/media-client.ts`) uploads every processed photo/video/voice note/home image via `uploadToStorage` and prefers the `storage:` ref, keeping the session blob for instant preview. JSON card creation persists `mediaRef`, so storage refs land in the DB.
- Tests: `tests/fix2-storage.test.ts` (4 tests: issue→PUT→GET round trip, empty/unknown rejection, proxy path-traversal guard, filename sanitization).
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 84 passed + 3 skipped, `npm run build` ok (36 routes). Live-model cost this fix: USD 0.

## 28 Oct 2026 — CRITICAL FIX 3: session auth, ownership, rate limits, cron secret (no cookbook recipe — access control)

- `lib/auth.ts` (new): invite code → `POST /api/session` mints an httpOnly (`Secure` in prod, `SameSite=Lax`, 30-day) HMAC-SHA256 session cookie (`SESSION_SECRET`), payload `{familyId, memberId, exp}` with timing-safe verify. `GET /api/session` (who am I), `DELETE` (logout), `POST /api/session/switch` (same-family viewer switching without re-entering the code). Welcome shows the code gate only when no session exists; the viewer switcher syncs the cookie.
- Every API route requires the session (`requireSession` → 401) with family scoping; write routes enforce member ownership (`requireMember` → 403) — plays/reactions/wishes/privacy/display-lang/home-image/relationships-anchor/invites-family/media-paths. Model routes (transcribe/translate/suggest/cards/gather/suggestions) rate-limit per session at 30/min (`checkRateLimit` → 429). `/api/ritual-scan` GET requires `Authorization: Bearer` + `CRON_SECRET` (Vercel cron); manual POST uses a session.
- Documented, labelled demo backdoor: `AANGAN-DEMO` redeems a session for the synthetic demo family only (real families use Privacy-generated expiring codes). Logged here as a conscious V1 tradeoff for the judged demo.
- Tests: `tests/fix3-auth.test.ts` (5 tests: HMAC sign/verify/tamper/expiry, exchange + HttpOnly flag + bad-code 403, 401s, 30→429 per-session with a second member unaffected, cron 401/200 + session POST). All pre-existing route tests updated to send session cookies (incl. new 403 cross-member cases). New env names in `.env.example`: `SESSION_SECRET`, `CRON_SECRET`.
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 89 passed + 3 skipped (incl. 5 new auth tests), `npm run build` ok (39 routes). Live-model cost this fix: USD 0.

## 28 Oct 2026 — CRITICAL FIX 4: vercel.json region bom1 (no recipe — deploy config)

- Region moved `iad1` → `bom1` (family + judges in India). Verified: lint + typecheck + 90 passed + build ok (39 routes). No code change, no live cost.

## 28 Oct 2026 — Design reset + Supabase wiring (autonomous P0 run)

- Design reset per the flat-courtyard spec (replaces the glass-heavy look): Ground #F6F2EC, ink #1C1917, secondary #57534E, hairlines #E2D9CE, one accent #9A3412. Now Playing ground #2A211C, played waveform #FDBA74. Instrument Serif (titles/captions/lyrics) + Inter (UI) via next/font. Radii 6–8px; no pills except the 44px round play button; glass only on sheets/mini-player. Removed the adaptive wash (wash.tsx deleted).
- Home: date eyebrow, "Good {daypart}, <name>" 38px serif, "Record for them" button, elder role banner, one hero memory (full-width art, dark caption band, serif quote, 44px play, white waveform, duration, Heard line), Today shelf, "This day, years ago" 2-up grid, "Coming up" as hairline rows with "Send a wish" text actions. Profile menu (avatar button, top-right) holds the demo viewer switcher + language select + links to Family Bond / Privacy / Agent trace.
- Flat tab bar with hairline top: Home / Lane / [+ dark rounded rect] / Rituals / Gather. Language + viewer switcher live in the profile menu, off the header.
- Now Playing is a full-screen dark sheet: the waveform IS the scrubber (pointer drag + arrow keys; live AnalyserNode canvas when real audio plays, stored peaks otherwise), current lyric 26px serif white with muted neighbours, reactions as accent text buttons. Mini-player stays glass.
- Memory cards are flat (6px art, serif caption, plain-text Heard line). Welcome keeps its full-bleed image + flat bottom card. Add sheet stays a glass sheet (allowed). Buttons: dark rounded rect primary, outlined secondary.
- Supabase wiring: new `lib/supabase.ts` (server-only service-role client; never imported by client components) + `lib/db.ts` async adapter with the same shapes as `lib/store.ts`. All API routes (cards, members, display-lang, home-image, plays, reactions) go through it. Live only when keys exist AND MOCK!=="true"; any error falls back to the mock store. Tests import `lib/store.ts` directly and run with MOCK=true (vitest env), so they never touch the network. Dev goes live by setting MOCK=false in .env.local (human-owned file — not edited here). `.env.example` already lists all vars; no new env var added.
- Cookbook note: D:\refs\meta-model-cookbook does not exist on this machine, so the referenced recipes could not be read. Proceeding from the PRD-described behaviors; each milestone below logs which recipe-intent it follows. Fallback logged, run continues.
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 54 passed + 2 skipped (live golden eval, live M2 check), `npm run build` ok (16 routes, next/font fetched fine). Live-model cost this milestone: USD 0 (no live calls).
- Visual self-QA: blocked — this sandbox denies all listen sockets, so `next dev` cannot bind and no Playwright run is possible here. Verified via production build + code inspection instead; needs your eyes in the browser.

## 28 Oct 2026 — M3: Memory Lane, Family Bond tree, kinship resolver

- Kinship resolver (`lib/kinship.ts`): deterministic BFS over guided Bond edges → labelled path key (e.g. `leo>father>arjun>mother>dadi`) → cache keyed by (path, display_lang). The model (translate pipeline) runs ONLY on a cache miss; English needs no model call. Recipe-intent followed: structured output for the term (via the existing translate JSON contract). Relation words are family data (mother/father/sister…), canonical kinds (parent/child/spouse/sibling) drive BFS only.
- Store + Supabase: `relationships` table read/write + `kinship_cache` read/write in `lib/db.ts` (mock-memory fallback preserved); new schemas `RelationshipSchema`/`CreateRelationshipRequestSchema`. New routes: `/api/relationships` GET/POST (guided add creates member + edge; 409 on duplicate name, 404 on unknown anchor), `/api/kinship` GET (from/to/lang → path + terms + cached flag).
- Memory Lane (`/lane`): chips All/Voices/Rituals/Bonds (Bonds = `source:"agent"` Bond welcome cards; decided as the simplest tag satisfying the PRD — no festival logic), season+year chapters ("Winter 2024"; meteorological seasons, northern-hemisphere simplification logged), vertical hairline spine, keepsakes at varied widths (every third spans the row), flat caption panels on photos. Server cards + demo shelves merged, newest first. Loading skeletons + error + empty states.
- Family Bond (`/bond`, linked from the profile menu): guided add ("Add <name> as <anchor>'s <relation>"), auto layered SVG tree by BFS generation (spouses share a generation) with 300ms branch-grow animation (respects reduced-motion via the global rule), "Welcome to the family" bloom + a Bond welcome card (source agent), and a viewer-relative kinship lookup ("To Leo, this person is… father’s mother").
- New maintained test `tests/m3-kinship.test.ts` (5 tests: BFS self/direct/two-hop/reverse, unconnected → family with zero model calls, miss-once-then-cache incl. no-model English, relationships API create/duplicate/unknown).
- Decisions: Bond cards carry `source:"agent"` so the Lane Bonds chip has a deterministic filter; relation word list is a fixed UI vocabulary (data, not culture logic).
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 59 passed + 2 skipped, `npm run build` ok (19 routes incl. /lane, /bond, /api/kinship, /api/relationships). Live-model cost this milestone: USD 0. Visual self-QA: same sandbox block as above — build + code inspection only; needs your eyes at 390px/1440px.

## 28 Oct 2026 — M4: agent runtime, ritual agent, Rituals calendar

- Agent runtime (`lib/agent.ts`): `runAgent(goal, tools, maxSteps=6)` — mock keyword planner in MOCK mode, live tool-calling loop against muse-spark-1.3 otherwise (max 6 steps, spend-cap guard, one plain-JSON final contract; falls back to a no-action run instead of throwing). Recipe-intents followed: basic agent loop (02_agent_patterns/01), tool calling (01_api_fundamentals/03), short cacheable system prompt + low 600-token budget for routine turns (reasoning-effort intent /06). Seven PRD tools in `lib/agent-tools.ts` (read_family_graph, query_lane, create_card, schedule_notification, request_wish, assign_daily_role, create_gather_session) — all read/draft-only; agents NEVER persist. Every run logs an agent_run (trace page); live ledger records cost.
- Suggestions + approval: `suggestions` store/table + `/api/suggestions` GET/POST (agent loop runs on POST, each step persisted as pending) + `/api/suggestions/[id]/approve` POST (the ONLY place proposals become actions: create_card / assign_daily_role / request_wish / schedule_notification-acknowledge / create_gather_session / assemble_reel; decision=reject marks rejected without executing; 409 on double-review). UI: `components/suggestions.tsx` flat "Aangan suggests · Review / Approve" cards, surfaced on Rituals + Trace.
- Ritual agent (`lib/ritual-agent.ts`, pure + tested): 7 days before an occasion → open run + request wishes (members) and blessings (elders); day 3 → remind the missing; occasion day → deliver run + "assemble reel" suggestion; elders get daily roles every day (deterministic per-lang prompts cycled by day-of-year — no model call in the scan path). `/api/ritual-scan` executes the plan (Vercel Cron target); idempotent (ensure/get-or-create runs, roles unique per member+day).
- Rituals calendar (`/rituals`): birthdays from the family graph + every config in `rituals/*.json` + `data/movable-dates.json` fixture (CLEARLY labelled in UI and file; live search-grounding wiring moves to M6). Month chapters, hairline rows with date/detail/run-status + "Send a wish" text actions; guide steps listed per config. Trace page (`/trace`, profile-menu link): spend total + recent runs + suggestions log; loading/error states.
- DB: suggestions/agent_runs/wishes/ritual_runs/daily_roles/gather_sessions tables via `lib/db.ts` (mock-memory fallback preserved; RLS already deny-by-default in schema). New maintained test `tests/m4-agent.test.ts` (6 tests: mock planner mapping ×2, no-direct-writes, pure scan windows, fixture date, idempotent scan + suggest→approve→409).
- Decisions: role prompts are deterministic data tables (not model output) so the daily scan costs $0; reject supported from day one.
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 65 passed + 2 skipped, `npm run build` ok (25 routes). Live-model cost this milestone: USD 0. Visual self-QA blocked (sandbox sockets) — build + code inspection only.

## 28 Oct 2026 — M5: Birthday Reel, Gather, privacy set

- Birthday Reel (`/reel` + `/reel/[runId]`, `components/reel.tsx`, `lib/reel.ts`): segmented progress, each wish/blessing plays with synced lyrics via the existing player, "Happy birthday, <viewer-relative term>" (kinship lookup; falls back to the celebrant name), "Reply with voice" (opens the Add voice tab with reel context — the posted card auto-links as a wish on the run), petal effect (CSS, reduced-motion safe). Pure tested sequencing: oldest-first segments joined to members + cards (`buildReelSegments`); title helper. CHECKPOINT: P0 is fully green — no P1 started.
- Gather (`/gather`): plan-a-date form, per-member local times (Intl with each member's tz), invites, Lane-derived playlist curated by muse-spark-1.3 (`curatePlaylist` in `lib/llm.ts`, structured output, mock-first, never invents card ids), "Start together" (local marker + plays the first track; synced multi-device playback stays P1 — logged). New `/api/gather` GET/POST.
- Privacy set (`/privacy`, profile-menu link): in-app disclosure ("Demo mode…"), "Remove my memories" (DELETE `/api/privacy/cards` — deletes attributable traces; UI states shared family cards stay), "Leave family" (DELETE `/api/privacy/membership` — removes member + edges + traces), expiring invites (`/api/invites` GET/POST, 6-char codes, 7-day expiry; service-role only). Store + Supabase coverage in `lib/db.ts`. Decisions: cards have no per-card owner in the schema, so they belong to the shared pool and survive both actions — the UI says exactly this.
- New maintained test `tests/m5-reel-gather.test.ts` (7 tests: reel order/joins/title, mock playlist + no invented ids, gather POST, traces delete + 404s, leave + re-leave 404, invite format/expiry/listing, wish-card linking).
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 72 passed + 2 skipped, `npm run build` ok (32 routes). Live-model cost this milestone: USD 0. Visual self-QA blocked (sandbox sockets) — build + code inspection only.

## 28 Oct 2026 — M6: evals, README, seed script, demo photos, live-model retrofit

- README.md (new): run commands, env vars, "Built during the hackathon", "Meta AI tooling used" (model → feature), "AI-assistance disclosure".
- Seed script `scripts/seed.mjs` (written AND run): 4 consistent demo-family photos (Dadi, Leo, Aria, group) via `muse-image-1.0` into `public/demo/` + `family.json` manifest. Series consistency = one identical CHARACTER block + one STYLE suffix reused verbatim in every prompt. Provider returned WebP, so files are `.webp` by magic-byte detection (script handles both). Labelled AI-generated in `public/demo/README.md`; surfaced on the Bond page as "Demo photos · AI-generated" (never inside real cards). `tests/demo-assets.test.ts` extended (manifest + magic-byte checks). Also fixed a CRLF loader bug in `scripts/gen-courtyard.mjs` shared by both seed scripts.
- Live evals: `npm run eval:golden` now actually works — fixed two real defects it exposed: (a) `vitest.config.ts` forces `MOCK=true`, which overrode the outer env, so every prior "live" run silently ran in mock (new `vitest.live.config.ts` without the forced flag; `scripts/eval-golden.mjs` loads `.env.local` CRLF-safe and uses it); (b) muse-spark-1.3 reasons ~500 tokens before answering, so the 300/500-token caps truncated every reply to null and tripped the fallback — caption budget 300→2000, translate default→1500. New `tests/live-cache.test.ts` (gated, skipped in mock/CI): second identical translate served from cache at $0 — PASSES live ($0.01 then $0.00).
- Golden result: 9/9 PASS, total $0.09. One more real find on the way: the model returns `"language": "Hindi"`, which the display layer routes on by exact code — added `normalizeLangCode` in `lib/llm.ts` (Hindi→hi, Devanagari→hi-deva, Hinglish→hi-latn, English→en, fallback-safe) applied to caption/transcript/translation outputs + unit tests.
- Ritual scan is now Vercel-Cron-ready: `vercel.json` daily 9am cron + GET handler on `/api/ritual-scan` (POST retained for manual runs).
- Known gaps (not started, logged, run continues): live search-grounding for movable festival dates (fixture stays labelled; needs a search API), Playwright screenshots (sandbox denies all listen sockets — `next dev` cannot bind; verified via `next build` + code inspection; needs your eyes at 390px/1440px), `D:\refs\meta-model-cookbook` absent so recipe-intents were implemented from PRD descriptions.
- Decisions: estimated live spend uses documented flat rates ($0.01/image, $0.01/chat call — provider returns no cost field); `MOCK=false` in `.env.local` is yours to flip (untouched); no new env vars needed.
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 75 passed + 3 skipped, `npm run build` ok (32 routes), `npm run eval:golden` 9/9 PASS + cache check PASS. Live-model cost this milestone: ~USD 0.19 (4 images $0.04 + golden $0.09 + cache $0.01 + probes/debug ~$0.05). Running total this autonomous run: ~USD 0.20 (prior milestones $0).


## 27 Oct 2026 — Day 1: foundation

- Chose Option A: Next.js 14 + TypeScript PWA, Supabase for DB/storage, Vercel deploy.
- Scaffolded app shell (Memory Lane timeline page, PWA manifest) with plain, reduced-motion-safe styling.
- Built one LLM client (`lib/llm.ts`): provider routing via config (Meta default, Baseten only with confirmed credits), all model IDs in config, hash cache, USD 120 spend cap, mock mode.
- Added Zod schemas with one-retry-then-fallback; grounding subset check; upload caps (image ≤5 MB, video ≤30s/≤25 MB + thumbnail); EXIF-first auto-dating.
- Added ritual engine (loads any festival config) + Diwali and birthday configs.
- Added Supabase schema with family-scoped RLS + seeded demo family.
- Added mock-mode unit tests (LLM cache/cap/fallback/routing, rituals), E2E smoke (upload → timeline), golden set (9 synthetic cases) + manual live eval script.
- Added CI (lint, typecheck, mock tests only) and `vercel.json`.
- Demo languages: English + Hindi. Baseten stays optional.
- Design standard locked: tokens in `app/tokens.css`, Tailwind + shadcn-style ui, system stack, light/dark mode, skeleton/empty/error states on every screen, polish time-boxed to 3 Nov.
- Next: `npm install`, Vercel first deploy, Supabase project + schema, then LLM live captioning check.
- Verified 27 Oct: `npm install` green (workspace-local cache; sandbox blocks default npm cache and all listen sockets, so `next dev` cannot bind here — used `next build` instead). `npm run lint` ok. `npm run typecheck` ok. `npm run test:mock`: 13 passed, 1 skipped (live golden eval). `npm run build` ok; `/` prerendered with both seeded demo cards present in static HTML.
- Still yours: `vercel --prod`, create Supabase project + run `supabase/schema.sql`, set `META_API_KEY`, then `npm run eval:golden`.
- Sandbox notes for future sessions: run npm/npx from `D:\Aangan` (never `\\?\`-prefixed cwd, breaks postinstall scripts); set `TEMP`/`TMP` to `D:\Aangan\.tmp` for vitest workers.

## 28 Oct 2026 — M1: design system, Welcome, Home shell, Add sheet, media pipeline

- Saved the approved PRD verbatim as `docs/PRD.md` (single source of truth); `AGENTS.md` now points at it. Approved adjustments applied: Birthday Reel M4→M5, M4 uses a labelled cached movable-date fixture (live grounding→M6), seed script written M6/run M7, no P1 before the M5 checkpoint. Demo languages: English + Hindi only.
- Discarded the old UI. New: tokens in `app/tokens.css` (warm light-first palette + dark, glass spec, espresso/outline pills, serif display); adaptive 3-glow wash (`components/wash.tsx`, still under reduced motion); glass primitives (`components/ui/glass.tsx`); glass tab bar Home·Lane·Add·Rituals·Gather with raised centre Add (`components/tab-bar.tsx`).
- Welcome screen (`components/welcome.tsx`): full-bleed home image (per-member → family default → illustrated `CourtyardArt` fallback), bottom glass card with greeting, serif "Welcome to <first>'s Aangan", warm signal line (MOCK until M2/M4), Change home + Step inside. Shown once per session; home colors seed the wash.
- Home shell (`components/home.tsx`): elder "Today's role" (MOCK until M4) vs "From Dadi", Voices, Today (API-backed session uploads), This day years ago, Coming up (computed from member birthdays), Record-for-them one tap away, viewer switcher (Dadi/Arjun/Leo/Aria). Lane/Rituals/Gather tabs render honest Soon placeholders.
- Client media pipeline: validate → exifr EXIF date + Make/Model → canvas re-encode (strips all EXIF incl. GPS) → dominant palette → waveform peaks → session store → POST /api/cards (Zod-validated). Glasses badge when Make/Model names Meta/Ray-Ban/Oakley or the manual toggle is on. Video ≤30s/≤25MB with client thumbnail.
- Mock-first storage: `lib/media-session.ts` is the single swap seam (session blobs + metadata-only server store); object URLs do not survive reload — disappears with Supabase. New routes: `/api/cards` GET/POST, `/api/members` GET, `/api/members/home-image` POST.
- Added deps: framer-motion (sheet/tab motion), exifr (EXIF read). i18n dictionary (en+hi) for M1 chrome; Ask tab uses static starters until M2; Voice tab is an M2 placeholder.
- Verified 28 Oct: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 28 passed + 1 skipped (live golden eval), `npm run build` ok. Live-model cost this milestone: USD 0 (no live calls; mock only).
- Still yours: create the Supabase project + run schema (mock-first until you confirm), `vercel --prod`, set `META_API_KEY`.

## 28 Oct 2026 — M1 visual-review fixes (4 items)

- Welcome no longer renders the tab bar (new `chromeHidden` shell flag, set while Welcome is up); its card uses `max(2rem, env(safe-area-inset-bottom))` so both buttons stay visible.
- Desktop phone column: shell content is now `max-w-[480px]` centred; Welcome renders inside the same 480px column over the adaptive wash (nothing full-bleed beyond it); Add sheet capped at 440px. Note: this narrows the PRD's "full-bleed image" to full-bleed *within the column*.
- Fallback courtyard is now photorealistic via Muse Image (`scripts/gen-courtyard.mjs`, precursor of the M6 seed script): `public/demo/courtyard.jpg`, 960×960 JPEG, 133,563 bytes (≤300 KB), verified on inspection — arched wooden doorway, potted plants, morning light, no people/text/numbers — plus the AI-generated notice in `public/demo/README.md`. SVG courtyard kept as the offline onError fallback. Key read from the environment only; never printed or written.
- Foundation correction: `lib/config.ts` image model was `muse-image-style` (404s); the documented Model API id is `muse-image-1.0` (verified against Meta docs via two sources: OpenAI-compatible `POST /v1/images/generations`, flat $0.01/image).
- Cost: provider returned usage `{input_tokens: 10471, output_tokens: 1282}` with no cost field; billed at the documented flat rate → **USD 0.01** for 1 image. Spend-cap ledger wiring for image calls lands with the M6 seed script.
- New maintained test `tests/demo-assets.test.ts` (asset exists, JPEG, ≤300 KB, notice present). Fixes #1/#2 are visual and not coverable by the node-only vitest harness — verified via build; needs your eyes in the browser.
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 30 passed + 1 skipped, `npm run build` ok. `package.json` untouched by the one-off sharp conversion (installed `--no-save`, uninstalled after).
- Unstyled-tab-bar report (browser screenshot): investigated — production CSS provably contains all app styles (`.glass`, `wash-glow`, `backdrop-filter`, `bg-espresso`, `--wash-1`, `.shelf`), layout imports `globals.css`, no `pages/` shadow. No repo defect found; cause is almost certainly a stale `next dev` process or cached CSS in the tab (dev server cannot be reproduced in this sandbox — listen sockets blocked). Asked for dev restart + hard refresh + fresh screenshot.

## 29 Oct 2026 — M2: voice + Heard loop, reactions, Now playing + synced lyrics, memory cards

- Voice pipeline: Add-sheet Voice tab records via MediaRecorder (first-record consent checkbox, remembered in localStorage), decodes duration + waveform peaks client-side (`processVoiceBlob`), transcribes via `/api/transcribe` (muse-voice-transcribe model id; live uses the chat endpoint with a description, raw-audio upload wiring lands with Supabase), then posts an `audio` card carrying the original transcript + `transcriptLang` + `segments`. Ask tab now shows model-suggested questions (`/api/suggest`, cached per member + display_lang) above the static starters, with skeleton/empty states.
- Heard loop: `plays(card, member, played_at)` in the mock store + `/api/plays` GET/POST (Zod, 404s unknown card/member). Playing any card records a play; cards and Now Playing show a glass chip with the latest other-member play, e.g. "Grandma heard this · 09:14" (deterministic UTC HH:MM, kinship-aware: Grandma / Dadi / दादी per display_lang).
- Reactions: exactly three (Love, Laugh, Bless), rendered as text ("Leo laughed at this"), never counts — `setReaction` replaces the member's prior kind. `/api/reactions` GET/POST. Bless carries the voice-reply label; long-press on a card or the Bless button opens voice reply (tap still plays/reacts; a long-press guard prevents the tap that follows).
- Now Playing: `PlayerProvider` in the shell — full glass sheet (big square art, artwork-tinted wash, scrubber, glass control pill, Heard chip, reactions, transcript + translated note) plus a glass mini-player app-wide (collapses above the tab bar, expands on tap). Real uploads play through `<audio>` with Web Audio AnalyserNode live frequency waves; demo cards without audio bytes run a simulated clock over stored peaks. Synced lyrics use model segment timestamps when the display language matches the source, else per-sentence estimates over the translated transcript; the translated view loads behind a skeleton so Hindi is never flashed untranslated.
- Memory cards: captions render in the viewer's `display_lang` via `/api/translate` (skeleton while loading, `translatedNote` marker when translated). `needsDisplayText` gates calls: en translates Devanagari only, hi-deva translates Latin only, hi-latn transliterates Devanagari only. Video cards with an empty caption are grounded by Muse Spark video understanding server-side in `/api/cards` and dated EXIF/file first, model date only as fallback, never the future.
- Three-way display_lang (carried over from the M1→M2 language choice): `en` | `hi-latn` | `hi-deva` drives UI strings, captions, transcripts, synced lyrics, role prompts, signal lines, kinship names and question suggestions; originals are always stored and translations cached per card text + lang (server-side shared store/ledger in `lib/llm-server.ts`, USD 120 cap enforced). `members.display_lang` defaults `en`; legacy `lang` stays in sync (hi-deva → hi).
- Live-call fix found by verification: muse-spark-1.3 spends ~500 reasoning tokens before answering, so `max_tokens: 500` truncated suggest/transcribe responses to `content: null` and the guardrail fell back to mock (working as designed). `liveJson` now takes a token budget: 2000 for suggest/transcribe, 500 for translate/caption.
- Verified 29 Oct: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 54 passed + 2 skipped (live golden eval, live M2 check), `npm run build` ok with new routes `/api/plays /api/reactions /api/transcribe /api/translate /api/suggest`. New maintained tests: `tests/m2-voice.test.ts` (14: plays, reactions, estimator, gating, mock routes) and `tests/m2-language.test.ts` (10); `tests/m2-live.test.ts` is RUN-gated like the golden eval. Live-model cost this milestone: **USD 0.02** ledgered (translate $0.01 live-verified EN output with no Devanagari; suggest $0.01 live-verified real model questions) + a few length-truncated attempts at the old 500-token budget that correctly fell back to mock.
- What is visible: at 390px the 480px-max column fills the phone; at 1440px the same column centres over the wash — Home shelves (role, From Grandma/Dadi/दादी, Voices incl. new voice cards, Today, years-ago, Coming up), translated cards with Heard chips + reaction rows, voice Ask suggestions, full Now Playing + mini-player. Verified via build only (sandbox blocks listen sockets, so no browser run here) — needs your eyes for motion, waves, and recorder permission flow.
- Still missing (M3+): Memory Lane, Family Bond tree + kinship resolver, agent runtime, Birthday Reel, Gather, Supabase backend (session blobs + metadata store remain the swap seam; object URLs don't survive reload), raw-audio upload to the transcribe model, push notifications. Still yours: `vercel --prod`, Supabase project + schema, `META_API_KEY` already in `.env.local` (never committed).

## 28 Oct 2026 � CRITICAL FIX 5: live search-grounded movable dates (recipe 01_api_fundamentals/10)

- `lib/movable-dates.ts` (new): `POST https://api.meta.ai/v1/responses` with `tools: [{type: "web_search"}]`, year-aware prompt; parses the last non-empty `message` part with an ISO date in the requested year. Per-(slug,year) in-memory cache + `ritual_configs` DB persistence; fixture fallback when no key/mock/live fails. `resolveMovableDates` rolls stale (>7d past) dates to next year. Probe verified LIVE: Diwali 2026 ? 2026-11-08 at USD 0.01.
- `/api/rituals` + `/api/ritual-scan` use the resolver instead of the static fixture (mock unchanged, still fixture-labelled).
- Tests: `tests/fix5-grounding.test.ts` (5 tests: fixture fallback without key, year validation, cache dedup, stale roll-forward, resolver honors cache). No new env vars.
- Verified: `npm run lint` ok, `npm run typecheck` ok, `npm run test:mock` 95 passed + 3 skipped, `npm run build` ok (39 routes). Live-model cost this fix: ~USD 0.04 (1 verify + parser debug probes).
## 29 Oct 2026 · Stage 1: family tree fixes + 29 languages

- Tree: adding a relative of *anyone* in your family now works (it was limited to yourself, returned 403); the anchor is checked against the session's family and new people land in that family (they used to land in the demo family). People can be edited (name, generation, where they live, birthday) and removed; a person with their own account manages themselves.
- No fake data: new people get an empty birthday instead of 1 Jan, and the generation is inferred from the relation (a parent of an adult is an elder), editable afterwards.
- Languages: one registry (`lib/languages.ts`) of 29 languages (Indian and world). The app stays English; voices, captions and notes are translated by Muse into each reader's language. Searchable language picker in Settings. The database constraint now accepts any registered code.
- Mock mode no longer swaps unknown text for a placeholder phrase: it returns the family's own words.
- Verified: lint ok, typecheck ok, tests 117 passed + 3 skipped, production build ok.

## 29 Oct 2026 · Stage 2: the living rooms (Kitchen, Sit together, Care circle + Village, presence)

- Foundation: one validated document table (`family_docs`, jsonb) behind the new rooms; every kind has a Zod schema (`lib/kinds.ts`) checked on read and write, family-scoped, a bad row is skipped and logged. `lib/muse.ts` is the single door for new Muse calls: structured output, one retry, safe fallback, cached by input, spend cap, and a `muse_call` log row per call.
- Kitchen: an elder teaches by voice (the composer now has purposes: recipe, answer, need, wish); Muse writes the recipe card in the cook's own measures with a cautious "≈" for kitchens abroad; a grounding check rejects any card with ingredients the cook didn't say. Whole-card translation per reader, cached. "I made this" with a photo; the cook blesses attempts (you can't bless your own). Grandchildren can ask an elder for a recipe.
- Questions for elders (`/api/keeper`): family asks and the weekly Muse question, answered by voice.
- Presence: a parent shares their day in one tap ("Chai · On the verandah"); opening Aangan can count as "in the courtyard" if they allow it (30-min throttle). Children see each parent's day at the top of their courtyard. The quiet-day note is opt-in, owned by the parent, goes to one chosen person, and is judged against the parent's own usual first-moment hour plus grace, never at night.
- Care circle: needs open → claimed → done; Muse writes the reassurance note in the parent's language; whose week it is to check in; the parent's **Village** (trusted local people: groceries, house help, driver, gas booking, neighbour) with call buttons; a spoken request becomes a task (feeling unwell always becomes "someone visit me", never advice).
- Sit together (replaces the meeting-style Gather): a reason (chai, cook together with a recipe, story night, festival, songs, just sit), the hours when everyone is awake, each person's local time on every sitting, a "come sit with me" open door, a no-account video room, and an .ics download.
- Demo family seeded relative to *Dadi's* clock so the demo always reads as her real day.
- Verified: lint ok, typecheck ok, tests 133 passed + 3 skipped, production build ok.

## 29 Oct 2026 · Stage 3: powered by Muse, made visible

- *What Muse did* (`/trace`): every Muse step in a sentence ("Wrote up Dadi's recipe from a voice note") with model, latency, cost and cache status; agent runs and proposals below. Linked from the rooms sheet and Settings. Demo entries are labelled as sample activity.
- Story keeper runs in the daily scan: one gentle question per elder per week, in their language, never repeated; asks, never chats.
- Elder mode (PRD cut, now in): larger text and targets, on by default for the grandparent generation, switchable in Settings.
- Removed the manual "Taken with Meta glasses" toggle: glasses photos are still recognised from camera metadata (EXIF Make/Model), but the app no longer lets anyone claim it by hand.
- README: the rooms, and a "Built with Meta" section mapping each Muse model to the features it powers and the safety rails around it.
- Verified: lint ok, typecheck ok, tests 134 passed + 3 skipped, production build ok; Playwright QA of every new screen as a grandchild (Leo) and as a grandparent (Dadi), no page errors.

## 29 Oct 2026 · Stage 4: homes, not one person · the living tree

- Households (`lib/households.ts`): a home is a couple (or one adult) plus the children who live with them. A child's two parents count as a couple even if nobody added "husband" (families add "mother" and "father" separately).
- The dock talks to a home: "Talk to Maa & Papa", or "Reply to Dadi & Dada" when they're waiting on you. Otherwise it picks the far home you've spoken to least recently, so a quieter home doesn't drift (recency alone keeps you talking to the same person). The composer picks whole homes or any mix of people; voice notes can address a household.
- Courtyard: one card per far home ("Maa & Papa's evening · 7:40 PM in India") with each parent's latest moment. Care circle forms around a home: both parents' days, needs for either, one shared Village, one "whose week" rota. Helpers serve the whole home on the server too.
- Family tree as a living tree: the eldest couple is the trunk rooted in the ground, children are branches, partners graft on as twigs, grandchildren are leaves (leaf-shaped frames). In-laws grow as their own trunk and their branch reaches their child. Tidy-tree layout (no overlaps at any size), fits a phone down to 72% and scrolls beyond.
- Fix: on a live database the demo family's relationships were dropped as soon as one new relationship existed (tree flattened to a row) and demo portraits were missing (initials). Live rows now merge with the seeded graph; SQL seeds the edges and portraits too.
- Demo: Dada joins Dadi at home in India. People without photos get a warm monogram instead of a grey box.
- Verified: lint ok, typecheck ok, tests 140 passed + 3 skipped, production build ok; browser QA on the demo and on a nine-person, two-grandparent-home family.

## 29 Oct 2026 · Stage 5: roles, care duties, complete CRUD, spec v2

- Access roles (admin / member / child), separate from generation, in one permissions table (`lib/permissions.ts`) enforced by the routes; the family always keeps an admin (role changes, removals and leaving are guarded). Settings → People & roles.
- Care duties: "who handles what" per home; a new need of that kind goes straight to that person, with a note to the parent in their language.
- Every gap from the CRUD audit closed: edit/delete voice notes and photos (author; admin can remove), edit/delete recipes (cook), delete attempts, take back a blessing, withdraw or skip questions, undo a shared moment, edit/withdraw needs, edit Village contacts, leave the rota, revoke invites, link two existing people and remove a link, take back a reaction, RSVP and reschedule sittings.
- Product spec v2 (kept private): every screen's operations and states, Care as a ticket tracker, Safe & sound (no tracking), pets, extended family, brand.
- Verified: lint ok, typecheck ok, tests 152 passed + 3 skipped, production build ok; role-based UI probe (admin vs child) matches the rules; no page errors.

## 29 Oct 2026 · Stage 6: Care board, extended family, pets

- Care is a ticket tracker per home: To do · In progress · Done this week; filters (All, Mine, Unassigned, Urgent, kind); each person's open load at the top; compact rows (kind tag, priority dot, due, for whom, assignee). Ticket sheet: kind, for whom, priority, due, repeats, assign to any family member (not children), the Village person who'll go, Start / Done / Cancel / Re-open, the note the parent sees, and a timeline of every change. Recurring tasks roll forward when done. Setup tab: whose week, who handles what, the Village.
- New kinds: bills (reminder only), health visits (logistics only), pets. Pet words win over "appointment" in spoken requests.
- Extended family: uncles, aunts and cousins are added through a parent ("Chachu is Papa's brother"); the tree puts siblings in the same generation and under the same grandparents; plain-English kinship for uncle/aunt/cousin/nephew/niece/in-laws.
- Pets: part of a home (lives with someone), add/edit/remove on the Family page, shown on the home's card, can be the subject of care tasks. Demo: Bruno with Dadi, Mochi with Dad.
- Courtyard shows "N care tasks for you".
- Verified: lint ok, typecheck ok, tests 157 passed + 3 skipped, build ok; browser QA of board, ticket sheet, setup, and an extended family with an uncle, cousin, aunt and a pet; no page errors.

## Stage 7: Safe & sound

- **What:** a check-in room owned by the person it protects (spec §7). Home safe, Heading home (15–90 min ETA), Travelling (2–18 h), Out late, I need help. Emergency card with the local number from the person's time zone (112 / 911 / 999 / 000 …).
- **Privacy rules (enforced in `/api/safety`, tested):** off by default; only the person turns it on, picks watchers (family members only), pauses or turns it off; only chosen watchers ever receive their check-ins; location is accepted only with "I need help", only if they tick "send where I am, once", is cleared when they tap "I'm okay", and is stripped from reads after 24 h. No background tracking.
- **Alerts only for a missed promise:** Heading home overdue 20 min after ETA; Travelling overdue 2 h after; or explicit help. Everything else is one quiet line on the Courtyard. A new check-in closes the previous open one.
- **Courtyard:** `SafetyWatch` shows alerts first (with "See location" and the emergency number for *their* country), calm statuses as one line, and gives the traveller a one-tap "Home safe / Landed / I'm okay".
- **Demo:** Aria (Chicago) shares with Dad and Dadi; last check-in "Home safe 2 h ago".
- **Not yet:** push/SMS notifications (in-app only), escalation chains, scheduled "check on me at 11 pm" timers. Push is the real gap for production; needs web-push + a cron that evaluates overdue states server-side.
- Tests: `tests/safety.test.ts` (state machine, 24 h TTL, emergency numbers, visibility, pause, location-only-on-help). 164 passed.

## Stage 8: Constellation, Care polish, Kitchen library, sharing

- **Family constellation** (`lib/constellation.ts`, `components/constellation.tsx`) replaces the living tree. You at the centre; parents up, siblings sideways, partner beside, children down; one ring per kinship step. Each group anchored to its direction; damped, capped wedges. One line per person + adjacent couple lines → no crossings (tested for every centre). Tap to re-centre; labels follow the centre (Mother-in-law, Cousin, Niece…). Full screen, zoom, "Add to {person}". Proud header (family name, people, generations, homes, time zones). Client-side 4:5 poster PNG (`lib/poster.ts`).
- **Demo family grown** to 9: Mom (Priya), Bua (Kavya, Bangalore), Fufa (Rahul), cousin Anaya. Demo family named "Sharma". Gendered demo links so labels read naturally.
- **Care**: neutral heading ("Care · Parents' home"); parents get the shared board and can add/assign tasks; anyone (parents too) can take one; quick "Add a task" row. "Village" → **Local helpers**: grouped contact book, call/WhatsApp, hours, helped-count, Android contact picker; plumber/electrician roles. Client-only render on Care (server/client time strings).
- **Kitchen library**: shelves per cook (elders → you → others), search, course filter, illustrated covers by course when there's no photo (`components/recipe-art.tsx`), tile menus to edit/delete. New recipe fields: course, prep/cook minutes, prep work, outcome, video. `create` action (typed recipe; write one down for someone → they're the cook, `addedBy` can still edit). One editor for new/edit (`components/recipe-editor.tsx`), recipe page redesigned (stats row, voice/video, before you start, tickable ingredients, method, how you know it's right). Six more demo recipes.
- **Sharing & export**: `public_shares` (SQL) + `lib/shares.ts`; `/api/share` (create/list/revoke), public `/r/[token]` (frozen copy, noindex, view count, quiet CTA). Share sheet: WhatsApp, link, image card, text. Settings: download family data (`/api/export`, JSON; no emails/Muse logs/locations) and "Shared outside the family" with Stop.
- Docs: product spec updated (kept private).
- Re-run `supabase/schema.sql` (new demo members/links, `public_shares`, `bump_share_views`).
- Tests: 175 passed. Prod smoke: 7 rooms × 3 members, no page errors.

## Stage 9: Stories (kids' corner) + Together templates; research audit

- **Research audit** (SPEC §18): ikigai/Okinawa, Hilbrand, Baldassar, Gottman, Carstensen vs. what's built. Closed here: grandparent story time, doing things together (moai), physical copresence (plan a visit), word a day, homework hour. Still open: family news + digest, "one good thing", bids metric, life-story chapters, warm-repair nudges.
- **Stories** (`/stories`, `lib/stories.ts`, `/api/stories`): elders tell by voice (new recorder purpose "Tell a story"); Muse only labels (title, theme, ages, one line), never writes the story; shelves per teller with night-sky covers by theme (`components/story-art.tsx`); **Bedtime mode** (one teller's stories in a row, sleep timer 10/20/30/off, then stops); kids ask for a story (reuses `question` topic "story" → shows on the elder's courtyard as "Tell it"); edit/remove by teller or admin. Children's courtyard gets a "story from Dadi" door. Four original demo stories (Hindi, with translations) by Dadi and Dada; Leo's pending request to Dada.
- **Together** (`/together`, `/together/[id]`, `lib/together-templates.ts`, `lib/together.ts`, `/api/together`): 12 data-driven templates across Play/Make/Learn/Celebrate/Visit; start → project with an editable task list (add, edit, tick, assign anyone incl. parents, delete), finish, delete (creator/admin); Book it as a Sit together; **Family quiz** written by Muse from the family's own recipes, people and pets, grounding-checked (mock is deterministic from data); **visit countdown** on the traveller's and the hosts' courtyards. Demo: "Arjun comes home" (12 days) and "The family cookbook".
- Unicode-aware word matching for Hindi (JS `\b` is ASCII-only).
- SQL: `family_docs` kind check adds `story`, `project`. Tests: 182 passed.

## Stage 10: Albums (Muse sorts photos) + Around home

- **Local news dropped** (SPEC §17.3), replaced by Around home.
- **Albums** (SPEC §21, `lib/albums.ts`, `/api/albums`, `components/albums.tsx`, `/lane/album/[id]`): the same Muse vision call that captions a photo now returns `event` (wedding · ritual · festival · birthday · gathering · trip · food · nature · school · everyday; junk → everyday). Upload files the photo into an event album (same kind within 36 h) and Muse titles it from captions with a grounding check on names. Memory Lane gets an Albums row (Apple-Memories-style covers, kind filter, "sort my older photos"); album page: grid, slideshow, rename/kind, cover, remove, move, merge, delete (photos stay). A person's fix marks the album `fixedBy`. No face recognition, no people albums. Classifier words are culture-neutral (no festival or deity names in logic).
- **Around home** (SPEC §22, `lib/places.ts`, `/api/places`, `components/neighbourhood.tsx`, `components/look-around.tsx`, `/around`): places around a parent's home (temple, market, school, tea stall…) with the family's own photos and voices; illustrated neighbourhood (ours, people-free); Muse suggests places the family already mentions, quoting their words (grounded); pin by pasting a Google Maps link or "I'm there now"; **Look around** in Google's live Photorealistic 3D / Street View via Maps JS with `NEXT_PUBLIC_GOOGLE_MAPS_KEY` (browser key, referrer-restricted). Per Map Tiles API policies nothing is pre-fetched, stored or derived; Street View never in print or promo video. Without a key: "Open in Google Maps".
- Not verifiable from this sandbox (network allowlist): the live Google 3D/Street View path. It's behind the key and loads only on tap.
- Demo: a "Sunday morning in the courtyard" album (4 photos), three places around Dadi & Dada's home.
- SQL: kind check adds `album`, `place`. Tests: 188 passed.

## Stage 11: Five spaces, plaque cards, calm Home, Settings in tabs

- From the A-grade UX review (7.1 → target 8.5): **13 rooms → 5 spaces** (Home, Memories, Kitchen, Care, Family; `lib/spaces.ts`). Every route stays; a room's own page shows its space's rooms as one quiet row of tabs. Around home opens from a person's page; *What Muse did* moved into Settings.
- **Home**: one "now" card, never a stack (open door > your move > story > visit > far home's day; safety always shows), then the latest voice.
- **Plaque cards** (`components/plaque.tsx`), modelled on a song plaque: one inset photo, the words, a thin time line, one button, and the note's own waveform drawn as a code. Videos now **play inline** (they were stills before).
- **Settings** in three tabs (You · Family · Privacy); deep links (#invite, #roles, #privacy) open the right tab.

## Stage 12: Together cut to five + games

- Together keeps five activities: plan a visit, family quiz, family cookbook, a word a day, birthday surprise.
- **Ludo, tic-tac-toe, Match the family** (`lib/games.ts`, `/api/games`, `/together/play/[id]`): turn-based across homes, one move whenever you open the app. Server-authoritative (crypto dice and shuffles, turn + move-count checks, stale move → 409, hidden memory cards masked). Round Ludo board in the constellation's dots-and-lines language; memory cards are the family's own faces. "Your move" is a Home now-card.
- SQL: kind check adds `game`. Tests: 197 passed.

## Stage 13: Two courtyards, one door; the wider family

- Each family keeps its own Aangan; a couple and their children belong to both, linked by a server-set `personId` (SPEC §25). Side switcher on Home; *Both sides* on Family; *Add my family* creates the other side with only your own home in it, plus an invite. Joining another family's invite with an existing account adds your place on that side.
- **Your circles**: at home · close family · wider family (in-laws, cousins, aunts and uncles), labelled from the tree.
- Demo: Iyer side (Nani, Nana, Mama, Mami, cousin Diya, two voice notes) and Chachu, Chachi, cousin Kabir on the Sharma side.
- Security fixes: invite codes can't claim admins or account holders; the persona switcher is demo-only; other members' emails and `personId` never reach the browser; exact email match (`ilike` treated `_`/`%` as wildcards); invite revoke exact match; email unique per family.
- SQL: `members.person_id` + index; email uniqueness per family. Tests: 206 passed.

## Stage 14: Cleanup + security and rules review

- Removed dead code (unused skeleton component, legacy `MemoryCard` export). README: five spaces, two sides, security model.
- Security review and Meta-usage review: SPEC §26.

## Stage 15: Parents first (SPEC §28)

- Research (Gruenewald 2007, Moorman & Stokes 2013, Bangerter & Fingerman 2014, KOMP, Storyworth): design for parents feeling *useful*, letting them *give*, and showing them it landed.
- **Menu** around the hero: Home · **Ask** · **Library** · Care · Family. Parents see Home · Library ("what you've given") · Care · Family. Promise on the landing: "Keep your parents needed."
- **Ask** (`/ask`): pick a parent, ask for a recipe, a story, advice or a blessing; waiting and answered lists. Keeper asks gain `wisdom` and `blessing` topics.
- **Advice & blessings** (`/advice`): answers kept with their question, by the parent who gave them.
- **Parent's Home**: asks first (family before Muse's weekly question), "What you gave this week" (`/api/gifts`, `lib/gifts.ts`: recipes cooked, stories and answers heard; words, never counts), "Your family today", share your day, ask for help.
- **Share your day** for children and grandchildren too (at work, school, home, cooked your recipe, thinking of you).
- **One game**: tic-tac-toe and Match the family removed; Ludo redrawn as the classic cross board with four yards, star squares and coloured home paths; "Play on a call".
- **Pots**: the Family page opens with one pot per home, a stick per person with their face (painted silhouette without a photo), the parents' homes first; the constellation follows as "How we're related".
- Home: "Coming up" only for a parent's birthday within 30 days. Tests: 207 passed.
- Revision after feedback: the menu is one grouped list (For Dadi & Dada, What they've given, Family, Settings), every feature one tap away (lib/menu.ts); pots replaced by Home by home cards; Your circles restored. Tests: 208 passed.

## 30 Oct 2026 · Stage 16: the window and the door
- LITE window as first screen (both ways): far home, city, local time, Open-Meteo weather, living sky layers grounded in facts, Muse-composed line, latest voice, Today line, Talk / Call / Door.
- Door: synthesised key + bolt + creak (WebAudio), wooden leaves swing into the family courtyard.
- Family courtyard: Today card, four rooms (Memories, Library, Care, Family) as sheets, Sit together live card with in-app call, a voice from home music card, today's role, coming up (festival + birthdays), from the years.
- Today: Muse picks a daily task for both homes; sealed answers; lamps streak; occasion photo asks. Replaces games and Together activities (Ludo unlinked; visits kept).
- Local circle for every home with consent, emergency numbers by zone; linked from Safe & sound.
- Node family tree replaces the constellation. Lucide icons. Demo family rework: son and parents at the centre, cities on members.
- Tests: 220 (window, weather, today sealing/streak, circle consent, tree layout).

## 30 Oct 2026 · Stage 16 revision
- Talk/Video call for whoever is in the other home (picker, no assumed roles); Kutumb replaces "Door"; haveli door; Indian default window art.
- Safe & sound dots on the window (green / amber after a chosen 2–8 h in their day / asleep at night) + a Next step line.
- Kutumb: five tiles, sheets per room, profile photo opens everything + settings; dock voice button with picker; confusing rows removed.
- Muse made invisible on everyday screens; story ideas to retell; "Trusted nearby" (was local circle).

## 31 Oct 2026 · Stage 21: the demo keeps what you add
- Root cause of "uploads don't work" on the live demo: demo writes lived in Worker memory, and Cloudflare serves requests from different isolates.
- Each demo visitor now gets their own copy of the seed in the database (both sides, `demo-v-<id>`), reused while their cookie lasts; uploads go to the private bucket under that family. Strangers never see each other's uploads. A cookie on the seed itself is sent back to the door. Copies are capped per hour and purged with their media after 48 h by the daily cron.
- One place per job: removed the You chip's photo/voice buttons (the dock does that), the 550 ms recorder on a held Bless, and the courtyard's second "record a wish" (Coming up keeps it).
- CI: a navigation walk in Chromium visits every room tab as a parent, an adult child and a child (scripts/walk.py).
- Tests: 431 (sandbox ids, copy integrity, enter/reuse/switch, purge). Copy rows checked against schema.sql on a local Postgres.

## 31 Oct 2026 · Stage 22: evidence-led closeness, and speed
- Research brief (relationship science, rituals, prompts, speed) → Festival Week (data-driven; elder leads the steps, children ask, lamp takes the festival colour), window glance strip (awake now · waiting for you · next · our call), the fixed weekly call ritual with .ics, "Do You Know?" story prompts, batched nudges (≤3/week, recipient's morning, email when configured) with a weekly letter digest; copy audit removed counts and "last seen" wording.
- Speed: courtyard LCP 6.0 s → 1.2 s, CLS 0.37 → 0, 18 → 6 API calls; shared JS 272 → 202 KB gz; images 312 → 82 KB; perf budget + vitals in CI. Reliability: upload queue with retry, stale-while-revalidate, per-section boundaries, service worker.
- Tests: 661. Schema check vs code kinds enforced by a test.

## 1 Nov 2026 · Stage 24: the first screen, for real
- First screen: the home photo, full-bleed and large; the drawn window/balcony/courtyard scenes, pots and the family slideshow are gone. One small time/weather badge (sun or moon only by their real solar time; weather only when fetched). Lamp and latest voice as rows under the photo. Safe & sound rows open a sheet with the person's day, moments and check-ins. Window LCP 3.6 s → 0.7 s, CLS 0.
- Care room without "Send something"; one app per category per country. Family room split into Tree and Homes; Settings into You/Window/People/Privacy.
- Settings never auto-save: every section has Save/Discard with status; actions stay immediate with confirms.
- Lint now fails if runtime code or dependencies reach any non-Meta model vendor.
- Tests: 701.

## 1 Nov 2026 · Stage 25–26: speed live, state that clears, Together habits
- Live: window and courtyard read in two database waves (was six and eight); weather, geocoding and the holiday feed cached across isolates with deadlines; Muse's catch-up sentence bounded so a model call never holds the first screen.
- Every badge and status has one source, clears when acted on, and expires (docs/STATE.md); a daily purge removes expired rows.
- Together habits: one family habit ("Morning walk · 7 AM"), anyone joins, "Maa and Priya walked today", the lamp glows when everyone has; words, never scores.
- UI inventory: docs/ui-inventory.csv/.xlsx generated from the running app (987 rows, 36 screens); CI fails when the UI changes without regenerating it.
- Tests: 784.

## 1 Nov 2026 · Stage 35: renamed to Nearer

- 1 Nov: renamed to Nearer, tagline "the window between two homes". Every visible string, page title, manifest, share image, email, i18n table and the README now say Nearer.
- Native: appId, Android package and URL scheme `com.sanjeevlabs.nearer`; the deep link is `com.sanjeevlabs.nearer://auth/callback` (update the Supabase redirect list). Domain: `nearer.sanjeevlabs.com` only; the old host is retired, not redirected.
- Demo code is `NEARER-DEMO`; the server still accepts the old demo code for old links.
- Kept on purpose so sessions and deploys survive: the Worker name, `aangan:*` storage keys, the `aangan_session` cookie, IndexedDB, bucket and table names, Modal app names.
