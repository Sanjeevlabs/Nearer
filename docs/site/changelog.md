# Changelog

This page lists recent changes, newest first. Each entry is grouped by its PR number.

## Recent changes

### #37 BottomSheet move
Moved `BottomSheet` into `components/ui/bottom-sheet.tsx`. The window chunk no longer pulls in poster code.

### #36 Push notification for family sends
Added push notifications. You get a gentle note when family sends you something.

### #35 For You inbox and sending
Updated the For You inbox with one recipient picker, a calmer room bar, and our own reactions. Sending now works abroad.

### #34 Mobile-first sizing and UI inventory
Added mobile-first sizing and a deterministic UI inventory. App is `nearer.site` only.

### #32 Aangan is now Nearer
Renamed Aangan to Nearer: the window between two homes.

### #31 Kids ages and fridge
For Kids: dropped doorframes, added ages for every member, and let grown-ups add to the fridge.

### #30 First screen update
First screen now has one bottom bar, shows the home page first on phones, and shows the lamp as a real photo.

### #29 Kid-first home
Added a kid-first home with bedtime story, Ask, Fridge wall, height marks, and a Kids tab.

### #28 Sit together venues
Added Sit together venues with seats and a shared background, plus home and venue photos.

### #27 Courtyard planning
Courtyard now has one way to plan, one dismiss pattern, and one link on the festival strip.

### #26 Together habits and window reads
Added Together habits, a one-wave read for the window, and a bounded catch-up.

## Other changes

Earlier commits without a PR tag:

- **Window and shared reads:** start independent reads at once. Courtyard and festival week read shared data once, in one wave. Weather and holiday feed are shared and never waited on long.
- **Presence and check-ins:** presence is read by time window. Expired check-ins are handled, open check-ins close as no reply after 48 h, with daily purge of expired rows.
- **Waiting list:** glance and dock share one waiting list. The dock dot and glance tile read the same list. Events and dismissals use the database on every live read.
- **Cache and database:** a write invalidates and refetches the client cache. Sign-in, sign-out and switches clear copies. Added round-trip counts, `listDocsMany`, and bounded card listing. Festival step ticks are keyed by family, festival and year.
- **First screen and family room:** one full-bleed home photo with lamp and voice rows under it, tappable Safe and sound sheet, and boxes in order. Family room split into Tree and Homes, with homes, how close, and pets. Add someone is a sheet.
- **Settings:** nothing auto-saves. Each section holds a draft with Save, Discard and status, plus an unsaved-changes banner. Confirm before deleting reactions, wishes and listens.
- **Window place and sky:** true sky and place with solar phase for sun and moon, geocode by country, and per-city cache. No stale active from an old heartbeat.
- **Care and Send:** Send something is no longer a tab. `/send` keeps its Care eyebrow. Purged delivered voice-note rows. A month-old care need stops nagging from the tile. One most-used app per category per country.
- **Performance:** shared bundle reduced from 272 KB to 201 KB gz by loading later what is not needed yet. Courtyard hero painted from the server shell, festival week rides in the courtyard payload, skeletons drawn as their own nodes, plus bundle budget and vitals in CI.
- **Weekly call and stories:** one weekly-call seed and schema, family-story prompts, and copy fixes for counts and last-seen.
- **Docs and checks:** `docs/STATE.md` lists badges, notices and status lines. Staleness tests use a fake clock past each TTL. `perf-vitals --live-base` prints API wall time. Seed script includes courtyard, balcony and window photo prompts.

---

Written by Muse Spark (Meta) from the build log on 2026-11-02.
