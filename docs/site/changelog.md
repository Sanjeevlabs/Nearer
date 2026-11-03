# Changelog

What changed in Nearer, newest first. Each entry is grouped by its PR number.

## Recent changes

### #62 - Demo close-out and story
Demo lets a room of judges in. README tells Arjun and Maa's story. Build log through 3 Nov, with 55 languages everywhere.

### #61 - Stay signed in on host hiccups
Early fetches retry a 503 once. Session sync tries again instead of signing you out.

### #60 - Faster first visit and side switch
First visit loads faster, and switching sides is faster.

### #59 - Family polish
Home photos and the Iyer side. Voice memories with stars and search, plus Hindi prompts for elders.

### #58 - Home page refresh
Current screenshots with honest feature lines.

### #57 - Demo door arrival
In the demo, you can see the door arrive on the other side.

### #56 - Closer and more truthful
Together on the window, consent before calls, honest states, and five rooms.

### #55 - Quiet retry on 503
One quiet retry when the host cuts a request off, in the data loader and the service worker.

### #54 - Walk waits for tabs
Walk waits for the room's tab row to fill before counting it.

### #53 - Safe room tabs
Room tabs wait until the family has loaded, so a child never sees the grown-ups' tabs.

### #52 - Light mode, home film, safe loading
Light only on every device, plus the new home film. A child never sees the grown-ups' tabs while loading.

### #51 - Steadier structured calls
Structured calls get room to reason, with tolerant JSON and a logged reason when they fall back.

### #50 - Warmer look, lighter start
A warmer, premium look with clear room headers and a lighter first screen.

### #49 - Ask, Book, and weekly memory
Ask the family with answers in their own voices. The Book you can print, and a weekly memory.

### #48 - Lamp, check-in, and honest status
The lamp says 'thinking of you', plus a morning check-in. Stay signed in, with an error beacon and honest metrics.

### #47 - One-minute home film
Home page adds the one-minute film.

### #46 - Faster rooms and clearer inbox
Faster Kitchen, Care and Family. The inbox shows who and what needs you.

### #45 - Consistent sheets, no repeats
Every sheet closes the same easy way, and nothing is shown twice.

### #43 - Scripted demo recording
Added a scripted product demo recording.

### #42 - Fast first paint
First screen paints fast again.

### #41 - Live window and meaningful lamp
Window shows a live scene of their home, a lamp that means something, and a faster first screen.

### #40 - A real door
A photographed door with a soft real unlock sound.

### #39 - Build docs site
Build docs at docs.nearer.site.

### #38 - Book waits for members
Book waits for the family's real member list before asking for chapters, so no 404 on demo copies.

### #37 - Smaller window chunk
Moved BottomSheet to `components/ui/bottom-sheet.tsx`, so the window chunk no longer pulls poster code.

### #36 - Push notifications
A gentle note when family sends you something.

### #35 - Calmer inbox and sending
For you inbox with one recipient picker, calmer room bar, our own reactions, and send that works abroad.

### #34 - Mobile-first and nearer.site only
Mobile-first sizing, deterministic UI inventory, nearer.site only.

### #32 - Aangan is now Nearer
Aangan is now Nearer: the window between two homes.

### #31 - Kids and fridge updates
Dropped doorframes, ages for every member, and grown-ups add to the fridge.

### #30 - Simpler first screen
One bottom bar, home page first on phones, and the lamp as a real photo.

### #29 - Kid-first home
Kid-first home with bedtime story, Ask, Fridge wall, height marks, and Kids tab.

### #28 - Sit together
Venues with seats, shared background, JaaS rooms, and home and venue photos.

### #27 - Simpler Courtyard
Courtyard with one way to plan, one dismiss pattern, and one link on the festival strip.

### #26 - Habits and faster reads
Together habits, window one-wave read, and bounded catch-up.

## Other changes

Changes without a PR number in the log, newest first:

- Merge pull request #25 from stage-25-state-speed
- Merge state audit into the parallel window: presence by time window, expired check-ins, nudges in the same wave
- Glance and dock share one waiting list
- `--live-base` prints API wall time against a deployed origin
- Share weather and the holiday feed across isolates
- Courtyard and festival week read shared data once, in one wave
- Window starts every independent read at once
- Added `listDocsMany` and a bounded `dbListCards`
- Signed-in member is loaded once per request
- Count database round trips and their sequential depth
- Staleness tests with a fake clock past each TTL
- `docs/STATE.md` lists every badge, notice and status line, where it lives and when it clears
- Presence is read by time window
- Purged delivered voice-note schedule rows; a month-old care need stops nagging from the tile
- Festival step ticks keyed by family, festival and year
- Merge pull request #24 from stage-24-first-screen
- Order previews are single-use: the spent marker is a database row
- Events and dismissals read from the database on every live read
- One waiting list feeds the dock dot and the glance tile
- Client cache: a write invalidates and refetches; sign-in, sign-out and switches clear every copy
- Daily purge of expired rows; open check-ins close as no reply after 48 h
- Build log: stage 24
- Settings confirms before deleting reactions, wishes and listens
- Settings holds drafts with Save, Discard and status; unsaved-changes banner
- First screen with one full-bleed home photo, lamp and voice rows, tappable Safe & sound sheet, and reduced Settings

---

Written by Muse Spark (Meta) from the build log on 2026-11-03.
