# Architecture

Nearer is one Next.js app. The same app serves the web pages and the API routes.

## How it runs

- The app runs on Cloudflare Workers through the OpenNext adapter.
- A plain `next build` is used for the web build. A separate Workers build adapts the output for Workers.
- There is one Next.js app, with no separate queues or workers.
- Data lives in Supabase: Postgres plus private Storage, with row-level security by `family_id`.
- Ritual configs are bundled with the app. There is no filesystem at runtime and no image optimizer on Workers.

## Data model

The inputs show these main pieces:

- **Families:** each family keeps its own space. Two homes stay separate unless someone shares between them.
- **Members:** people in a family, including children and elders.
- **Cards:** everyday photos, voices and videos, including Memory Lane and Stories.
- **`family_docs`:** one shared table for many small things, separated by kind. Kinds shown include `kid_ask`, `bedtime_story`, `nudge`, `nudge_settings`, `today_task`, `lamp.beats`, `presence`, `safety_checkin`, `chitthi`, `event`, `event_dismiss`, `knock`, `sitting`, `need`, `day_line`, `muse_call`, `muse_image_run`, `preview_used`, `push_settings` and `cron_state`.
- **Own tables:** some things have their own tables, including `cards`, `members`, `suggestions`, `push_subscriptions` and `public_shares`.
- **Relationships and structure:** member links, sides, kinship terms, albums, kitchen recipes, care needs, gatherings, sittings and safety check-ins appear as routes and stored rows. Details not shown in the inputs are marked as *not verified*.

A daily scan calls `/api/ritual-scan` for each family and cleans up expired rows. Reads also hide expired rows, so a missed run does not show stale things.

## Tenancy: scoped per family

- Every read and write is scoped to the session's `familyId`.
- Postgres access is limited by `family_id`.
- A married couple and their children can belong to both sides, and children can switch between sides. Nothing crosses between homes unless someone shares it.
- Switching homes only works where the same person already has a place. Other members' emails and internal person ids do not leave the server.
- Sharing outside the family is opt-in, as a frozen copy behind a revocable token. Export strips emails, model logs and safety locations.

## Native apps

- iOS and Android ship as a Capacitor 8 shell around the deployed site.
- The native WebView loads the production origin. Capacitor plugins add native behavior to that page.
- The web directory is `public/` only, so `public/offline.html` can show when the network is down.
- Native pieces include splash, status bar, haptics, deep links for sign-in callbacks, native share, push registration, external links in the in-app browser, offline handling and Android back-button behavior.

## What lives where

- **Postgres:** shared truth every Worker can see. Includes `family_docs` rows, cards, members and the other tables above.
- **Derived:** computed on each read from other rows. Nothing is stored, so nothing goes stale. Examples include lamp glow, safe and sound state and waiting lists.
- **Browser:** `localStorage` or `sessionStorage` on one device, plus small in-memory client caches that refetch after writes. Used for festival step ticks, last photos, door state and list caches.
- **Process memory:** variables inside one Worker isolate. Workers share no memory, so rate-limit buckets, weather caches and similar caches are per isolate and best-effort. Nothing that must be right lives only there.
- In mock mode, Postgres rows are held in one in-memory map with the same rules.

## API route groups

Main groups from the route list:

| Area | Routes |
|---|---|
| Sign-in, session and invites | `/api/auth/start`, `/api/auth/verify`, `/api/session`, `/api/session/switch`, `/api/invites`, `/api/invites/peek` |
| Members and family structure | `/api/members*`, `/api/relationships*`, `/api/sides`, `/api/kinship`, `/api/pets`, `/api/privacy/*` |
| Window, courtyard and waiting | `/api/window`, `/api/courtyard`, `/api/waiting`, `/api/inbox`, `/api/gifts`, `/api/day-line`, `/api/weather`, `/api/festival-week` |
| Cards, lane, albums and stories | `/api/cards*`, `/api/lane`, `/api/albums`, `/api/stories`, `/api/reactions`, `/api/book` |
| Kitchen and care | `/api/kitchen*`, `/api/care`, `/api/safety`, `/api/presence`, `/api/lamp`, `/api/habits` |
| Kids and bedtime | `/api/kids`, `/api/kid-ask`, `/api/bedtime` |
| Gather and sit together | `/api/gather*`, `/api/sit`, `/api/sit/room`, `/api/sit/token`, `/api/together` |
| Letters, nudges and push | `/api/letters*`, `/api/nudges*`, `/api/push/*` |
| Rituals, suggestions and today | `/api/rituals`, `/api/ritual-scan`, `/api/ritual-runs`, `/api/suggestions*`, `/api/suggest`, `/api/today`, `/api/keeper`, `/api/wishes`, `/api/plays`, `/api/trace` |
| Media and files | `/api/media/*`, `/api/media/upload-url`, `/api/media/mock-upload`, `/api/media/mock-bytes` |
| Sharing, export and helpers | `/api/share`, `/api/export`, `/api/transcribe`, `/api/translate`, `/api/muse/*`, `/api/stickers/cutout` |
| Other listed groups | `/api/partners*`, `/api/sides`, `/api/nearby` is *not verified* — see route list for exact paths |

---

Written by Muse Spark (Meta) from the build log on 2026-11-02.
