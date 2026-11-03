## C12 — Push notifications that actually arrive (web + Android/iOS app)
**Branch:** `push-everywhere` · **PR title:** `One person's moment reaches the family: push for the lamp, walks, chai and more`

Goal (owner): cross-interaction. A timely action by one person should reach the others at once, so they react. Without phone notifications the app feels incomplete.

What exists (read first): `lib/push/*` (send.ts, events.ts with pushLight / pushBeat / pushDoor / pushAddressed / pushAsk / pushHelp / pushMorning, policy.ts quiet hours, prefs.ts, copy.ts, webpush.ts VAPID, fcm.ts FCM HTTP v1), `app/api/push/{register,settings,sweep,test,vapid}`, `lib/native.ts` (Capacitor), `capacitor.config.ts`, `public/sw.js` push handler. Push is dormant in production until secrets exist.

1. **Audit and report** in `docs/push.md`: every event that sends today, who receives it, quiet-hours/hold rules, which secrets/config each channel needs (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, FCM_SERVICE_ACCOUNT, Firebase `google-services.json`, iOS APNs key in Firebase, bundle id `site.nearer.app`), and an owner checklist with exact steps to create them (names only, never values).
2. **Fill the gaps** (server side, through `routePush` and the existing prefs/quiet-hours):
   - Lamp lit → the person(s) at the window ("Arjun lit your lamp") — verify it fires for live families.
   - Together habit tick → the other habit members ("Maa went for her walk") — once per person per day, not on untick.
   - Open your door / chai invite → invited people ("Dadi is having chai — join?"), and "X joined you" back to the host.
   - Voice note / photo addressed to someone → them (respect #93 privacy: never put private text in the payload; short neutral copy).
   - Reply or reaction to your card → you (batched: at most one push per card per hour).
   - Someone joined the family by link → the owner/admins.
   Every push deep-links (data.url) to the exact screen. Copy goes in `lib/push/copy.ts`, warm and short, translated keys in en only (others fall back).
3. **Native app:** wire `@capacitor/push-notifications` registration in `lib/native.ts` (ask permission after the first meaningful action, not at launch), send the FCM token to `/api/push/register`, handle tap → navigate to data.url, foreground notifications shown in-app. Android: notification channel "Family", small icon. iOS: capability notes in docs/push.md. Build check: `npx cap sync` succeeds for android (add to CI only if fast).
4. **Web/PWA:** make sure the SW push + `/api/push/vapid` registration works on Android Chrome and installed iOS PWA (16.4+); prompt from Settings and after first lamp/chai action.
5. **Never** send to the actor, to removed members, to the demo family's real devices, or during the recipient's quiet hours (hold and deliver in the morning digest as today).
6. Tests: one test per event (recipient set, copy, deep link, privacy, quiet hours, batching); `npx vitest run`, typecheck, lint, mock build, walk. Mock mode logs pushes instead of sending; add `/api/push/test` usage to docs.

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
