# Architecture

Nearer is one Next.js app backed by Supabase, hosted on Cloudflare Workers, with iOS and Android shells that load the same site.

## Overview

- **One Next.js app.** All pages and `/api/*` routes live in the same app. There are no separate queues or background workers.
- **Hosting on Cloudflare Workers** through the OpenNext adapter.
- **Supabase** for Postgres and private file storage.
- **Native shells** for iOS and Android that show the deployed site inside the app.
- **Demo and test mode** uses an in-memory mock store with the same scoping rules. Tests always run in mock mode.

## Web app and hosting

The app builds with a normal Next.js build, then adapts the output for Workers.

- Build, local preview in workerd, and deploy are separate scripts.
- Configuration includes a worker config file, an OpenNext adapter config, and a worker entry that also handles scheduled runs.
- Scheduled work runs inside the worker:
  - A daily scan that calls `/api/ritual-scan`.
  - A more frequent sweep that calls `/api/push/sweep` for overdue check-ins.
- Workers differences that shape the code:
  - In-memory state is per isolate and can reset at any time. Anything that must be shared lives in Postgres.
  - No filesystem at runtime. Bundled configs are imported through code.
  - No built-in image optimization. Bundled images are served as static assets.
  - No incremental revalidation cache. Pages are served from static assets.

## Data model

The material shows a family-scoped model centered on people, shared things, and per-family records.

- **Families.** Every family keeps its own space. A couple with children on both sides can belong to two homes, and children can switch between sides. Nothing crosses between homes unless someone shares it.
- **Members.** People in a family, with profiles, homes, languages, and relationships. The family tree labels extended family such as sister-in-law, cousin, and nephew.
- **Cards.** Photos, voice notes, videos, drawings, and other things a family shares, including the lane, albums, stars, and plays.
- **Kitchen.** Recipes taught by voice or scanned from a card.
- **Memories.** Memory Lane, stories, the Book, advice, and questions for the family.
- **Together.** Doors, sittings, events, visits, occasions, wishes, and gatherings.
- **Care and safety.** Care tasks, helpers, nearby contacts, and safety check-ins.
- **Docs.** Many small states live as rows in `family_docs` by kind, for example:
  - `kid_ask`, `bedtime_story`, `nudge`, `nudge_settings`, `today_task`
  - `presence`, `day_line`, `lamp` beats, `knock`, `sitting`
  - `need`, `event`, `event_dismiss`, `chitthi`, `card_listen`
  - `muse_call`, `muse_image_run`
- **Other tables shown in the material:**
  - `suggestions` for pending, approved, and rejected proposals
  - `public_shares` for revocable share links
  - `push_subscriptions` for device push subscriptions
  - `cron_state` for the daily scan cursor

Many screens are derived on read rather than stored, for example the window, lamp glow, waiting list, gifts shelf, festival dates, and event prompts.

## Tenancy: how data is scoped per family

- Every read and write is scoped to the session's family.
- Postgres enforces row-level scoping by `family_id`.
- Server routes enforce the family scope. Browser code never decides what family it can see on its own.
- Sessions use httpOnly, SameSite cookies.
- Switching sides is only allowed to a home where the same person already has a place. Other members' emails and internal person identifiers do not leave the server.
- Sharing outside the family is opt-in, through a frozen copy behind a long random token, marked `noindex`, and revocable. Export strips private fields.
- Games are server-authoritative, with server dice and shuffles and hidden cards masked before they reach the browser.

## Native apps

- iOS and Android apps are Capacitor shells around the deployed site.
- The WebView loads the production origin. The bundled web directory only provides the offline page.
- Native pieces include splash, status bar handling, haptics, native share, deep-link sign-in callbacks, back-button behavior, and push registration.
- Sign-in that cannot run inside an embedded WebView opens in the system browser and returns to the app callback.
- Push respects quiet hours and per-person settings. Some urgent safety messages are always delivered outside the normal cap.

## API route groups

Grouped from the route list. Names only; behavior not verified beyond the path names.

| Group | Example routes |
|---|---|
| Auth, session, invites | `/api/auth/start`, `/api/auth/verify`, `/api/session`, `/api/session/pass`, `/api/session/switch`, `/api/invites`, `/api/invites/peek` |
| Members and family structure | `/api/members`, `/api/members/[id]`, `/api/members/profile`, `/api/members/other-side`, `/api/sides`, `/api/relationships`, `/api/relationships/link`, `/api/kinship`, `/api/kids`, `/api/kid-ask`, `/api/bedtime`, `/api/pets` |
| Window and presence | `/api/window`, `/api/courtyard`, `/api/presence`, `/api/beacon`, `/api/lamp`, `/api/day-line`, `/api/waiting`, `/api/inbox`, `/api/weather`, `/api/festival-week` |
| Cards, lane, and memories | `/api/cards`, `/api/cards/[id]`, `/api/lane`, `/api/albums`, `/api/stars`, `/api/reactions`, `/api/plays`, `/api/book`, `/api/stories`, `/api/keeper`, `/api/ask`, `/api/today`, `/api/wishes` |
| Kitchen | `/api/kitchen`, `/api/kitchen/[id]`, `/api/kitchen/scan` |
| Together and gatherings | `/api/sit`, `/api/sit/room`, `/api/sit/token`, `/api/together`, `/api/gather`, `/api/gather/events`, `/api/gather/weekly-call`, `/api/rituals`, `/api/ritual-runs`, `/api/ritual-scan` |
| Care and safety | `/api/care`, `/api/safety` |
| Letters, nudges, push | `/api/letters`, `/api/letters/weekly`, `/api/nudges`, `/api/nudges/seen`, `/api/nudges/settings`, `/api/push/register`, `/api/push/settings`, `/api/push/sweep`, `/api/push/test`, `/api/push/vapid` |
| Media and model helpers | `/api/media/[...path]`, `/api/media/upload-url`, `/api/media/mock-upload`, `/api/media/mock-bytes`, `/api/transcribe`, `/api/translate`, `/api/muse/keep`, `/api/muse/portrait`, `/api/muse/restore`, `/api/stickers/cutout` |
| Suggestions, sharing, diagnostics | `/api/suggest`, `/api/suggestions`, `/api/suggestions/[id]/approve`, `/api/share`, `/api/export`, `/api/feedback`, `/api/metrics`, `/api/trace`, `/api/gifts`, `/api/habits` |

---

Written by Muse Spark (Meta) from the build log on 2026-11-03.
