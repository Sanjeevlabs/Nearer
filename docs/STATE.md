# What the app remembers, and when it forgets

Every badge, dot, notice and status line in Nearer, where it lives, what sets it, what clears it,
and how long it can be wrong. Written for the next person to check against the code.

How to read the "where" column:

- **Postgres** means a row in `family_docs` (kind in brackets) or its own table. Every Worker sees it.
- **Derived** means nothing is stored: the screen works it out from other rows each time it is asked,
  so there is nothing to clear and nothing to go stale.
- **Browser** means `localStorage` or `sessionStorage` on one phone or laptop.
- **Process memory** means a variable inside one running Worker. Workers share no memory, so the next
  request may land somewhere that never heard of it. Nothing that must be right lives only there.

In mock mode (tests, local demo) Postgres rows are held in one in-memory map with the same rules.

The daily clean-up is `lib/purge.ts`, called for each family from `/api/ritual-scan` (cron, 09:00 UTC).
Every list below also hides an expired row on read, so a missed cron run never shows a stale thing.
The numbers are in one place: `TTL` in `lib/purge.ts`.

## The inventory

| Thing you see | Where it lives | What sets it | What clears it | How long it can be wrong |
|---|---|---|---|---|
| Dot on the mic in the dock | Derived. `GET /api/waiting` (same list as the tile below) | Anything waiting for you | Acting on the thing (see "Waiting for you") | Until the next fetch: every 60 s, when the app returns to the screen, and straight after any write you make |
| Glance tile "Waiting for you" | Derived. `waitingItems()` in `lib/glance.ts`, loaded by `lib/waiting-server.ts`; `/api/waiting` calls it | A voice note, photo or video sent to you; a question asked of you; a child's ask for you (below); someone answered today's question; a care need you took on; a nudge for you | Voice: you play it, or you send something back to the sender (or to everyone) after theirs. Question: a card answers it. Child's ask: someone answers it by voice. Today: you answer, or it completes. Care: it is marked done, or it is a month old. Nudge: you open it (tap the tile) or play the card it points at | Same as the dot. Voice notes older than 30 days and needs older than 30 days drop out by themselves |
| "Leo asked you something" (a child's ask, in Waiting for you and the dock dot) | Postgres (`kid_ask`). Derived into the same list: `waitingItems()` in `lib/glance.ts` (kind `kid`), read by the window and `GET /api/waiting` | A child's "Ask" (a voice question, or "Another one?" after a bedtime story). Goes to the person it names, else to any of the child's parents and grandparents (`lib/kids.ts` `openAsksFor`). The question's own voice note is not also counted as a voice note | Someone it is for answers it by voice (`POST /api/kid-ask` `answer`: sets `answeredCardId`, and saves the answer as a Story titled with the question). Not cleared by playing the question | Same as the dot: next fetch (60 s, on return, after any write) |
| "Asked by the kids" card on the courtyard | Derived from `kid_ask` (`GET /api/kid-ask`) | The same open asks | Same as above: gone once answered | Same |
| The child's own asks on their screen | Postgres (`kid_ask`) | The child | An answered ask stops showing 3 days after it was answered. A child can have 5 open asks | None |
| Bedtime prompt, "Tonight's story for Vihaan" (courtyard) | Derived from `bedtime_story` rows (`bedtimePrompt()` in `lib/kids.ts`), only for someone who is a parent or grandparent of a child | The viewer has not recorded a story or said "Not now" yet today (their own day). Picks the child they told least recently | Recording a story, or "Not now" (`POST /api/bedtime`; a "Not now" is a `bedtime_story` row with no voice, `skip-<person>-<day>`). Back the next day | None: read from the rows and the clock |
| Tonight's story (kid-home) | Postgres (`bedtime_story`) | A parent or grandparent records one for the child | Playable at any hour (bedtime is the suggestion, not a lock). Shown for 7 days, then rests. "Not now" rows are never shown to the child | None (clock) |
| "From the kids" tile (the window) | Derived (`kidsTile()` in `lib/kids.ts`) from cards whose author is a kid, or that a grown-up added for a kid (`isKidCard`; `isKid` is the age under 13 when a birth year is known, else access `child` or a child profile with plain member access), skipping a child's spoken questions | A child's photo, drawing or voice note, newer than the viewer's previous visit (a week back if there was none) | The viewer's next visit moves the line; it taps through to `/lane?from=kids` | Same as the window: until its next read |
| Fridge (courtyard strip and Kids tab) | Derived: the newest kid cards, i.e. cards a kid shared, plus cards a grown-up added "for" a kid (`cards.for_member_id`, set by "Add to the fridge"; the route refuses anyone who is not a kid of this family) | A child's photo, voice or video, or a grown-up's photo of a child's drawing | Time (newer cards push it out off the strip). The card itself is removed like any card; `for_member_id` clears if the child leaves | None |
| Nudges ("Maa heard your note", "the call is tomorrow") | Postgres (`nudge`) | The routes that cause them (play, bless, share) and the daily scan (occasion, call, letter) | `seenAt` is set by: tapping the tile, `POST /api/nudges/seen`, or playing the card it points at. Stops waiting after 2 days (occasion, call) or 7 days (heard, blessed, shared, letter) from when it was due. Deleted 30 days after delivery (or after being queued, if never delivered) | Not shown before the recipient's 8 AM. Email is sent once at delivery and cannot be unsent |
| Nudge settings | Postgres (`nudge_settings`) | The person, in Settings | The person | Never stale: it is a setting |
| Today: "answered" | Postgres (`today_task`) | Each person's answer | Not cleared: the finished task is kept, it is part of the memory book. Every answer is open to everyone at once (nothing is sealed, no streak) | Never stale: the state is read from the answers |
| Lamp glow | Derived from `lamp.litAt` and the newest card from that home. Full when lit, fades to nothing at 2 h (`LAMP_GLOW_HOURS`) | Lighting the lamp, sending a voice, photo or call | Time | None (computed from the clock on every read) |
| Heartbeats between homes | Postgres (`lamp.beats`) | Holding the lamp | Felt once (`felt`), expire after 2 days on read, trimmed from the row by the daily scan | None |
| "In Nearer" heartbeat (`presence`, moment `here`) | Postgres (`presence`) | Opening Nearer (at most one every 30 min, only if the person shares visits) | Deleted after 15 days. A heartbeat is the only sign of life for at most 6 h: after that the line reads "quiet since" | Up to 30 min between beats |
| Their day (the window: "Maa · chai, 7:10 AM" or "nothing shared yet today") | Derived from the moments they chose to share today (`presence`, never the automatic "here") and their own safety check-ins | Sharing a moment; making a check-in | Their local midnight | None. Nothing is inferred from opening Nearer, the lamp, the clock or silence: no dot, no "asleep", no "quiet since" |
| The "Everyone" row, "active 12 min ago" | Derived from the same newest sign of life | | | None |
| Safety check-in, open or closed | Postgres (`safety_checkin`) | "Heading home", "Travelling", "I need help" | The person closes it, or starts a new one. **Open for 48 h: closed as "no reply"** (`noReply`, location dropped). Closed ones are deleted after 30 days | None: the 48 h rule is applied on every read and stored by the daily scan |
| Check-in location | Inside the check-in | "I need help" with location | Hidden after 24 h on read | None |
| Suggestions (pending / approved / rejected) | Postgres table `suggestions` | The scan and the agents | A grown-up approves or rejects. **Pending for 21 days: withdrawn (rejected)**. Approved and rejected stay as the record | The list shows only `pending` |
| Wish and lead requests (`request_wish`, `request_lead`) | Suggestions, shown only to the person named | | As above | |
| Weekly letter draft | A suggestion, then Postgres (`chitthi`, kind `letter`) once approved | Approval | The courtyard card shows it for 7 days after it arrives (worked out in the browser from its delivery time); the row itself stays so the letter can be read again | Up to a page refresh at the 7-day mark |
| Scheduled voice note | Postgres (`chitthi`, kind `voice`) | Choosing "arrives in the morning" | Visible to others from `deliverAt`. The row is deleted 7 days after delivery | None |
| Event prompts ("Plan a celebration?", "Pick a time") | Derived from events, the calendar and what you dismissed | | Dismiss writes `event_dismiss`; the prompt goes when the event is planned, picked or past | None |
| Event dismissals | Postgres (`event_dismiss`) | The person pressing "not now" | Deleted the day after the event date in the key (60 days after, if the key has no date) | None. With the database live, every read comes from the database, never from this Worker's copy |
| Events | Postgres (`event`) | Planning | Cancelled or kept as history | Same: database first |
| Festival header and week | Derived from the calendar and `rituals/*.json` | | Time | None |
| Festival steps ticks | Browser (`localStorage`) key `aangan:festival-steps:<family>:<festival>:<year>` | Ticking a step | Next year is a different key; earlier years and the old un-keyed key are removed when the sheet opens | Per phone by design. Never carries into another family or year |
| Open door (`knock`: "{Host}'s door is open", the Together card, Time together) | Postgres (`knock`, with `activity`, `invites`, `seenAt`) | "Open your door": what, who (everyone or chosen people), 15/30/60/90 min. Seen only by the host and the people invited (everyone when `invites` is empty), in `GET /api/sit`, the token and room routes and the window's `doors`/`myDoor` | Hidden at `until` on read; "Close door" or the host leaving the call deletes it; deleted by the daily scan; a new door replaces yours. "Not now" hides it on that device only (`sessionStorage`); the host is never told | Up to one window poll (60 s); the call page re-checks every 60 s and ends the room when it is gone |
| "Maa is having chai. Join?" push | Nothing kept but `knock.seenAt` | A door opened for exactly one person | Sent once; `seenAt` stops any resend. Dropped (not saved for 8 AM) in quiet hours or past the daily cap | None |
| "How to listen" on a voice note (experiment): "Arjun: just listen" | Postgres (`card_listen`, id = the card) | The sender, optionally, when the note is for particular people | Kept with the card | None. Added to the card by `GET /api/cards` and For you only for its addressees; never a nudge |
| "Remind me to ask" (experiment) | Postgres (`nudge`, kind `reminder`, to yourself) | "Remind me to ask" on a voice note or an event from someone else: tomorrow, in 3 days or next week, with an optional note | Settings, My reminders (change or delete); it shows in For you from 8 AM on its day, then waits a week; never emailed or pushed, no weekly limit | None. Only ever listed for the person who set it |
| Two touches meet (experiment): the shared glow | Nowhere. Supabase Realtime Presence on `touch:{hmac}` (the window's `touchChannel`), joined only while a finger is on the lamp, at most 30 s | Both people holding their lamp at the same moment | Letting go leaves the channel; presence drops on disconnect | None: presence is live, never stored. Off in mock mode (no Realtime): the hold is the heartbeat only |
| Sitting (planned session) | Postgres (`sitting`) | Planning | Hidden 3 h after it starts; deleted 7 days after it started | None |
| Care need status (open / claimed / done) | Postgres (`need`) | The care board | Done by a person. Not deleted: it is the ticket history | Tile stops showing a need after 30 days |
| Gifts shelf ("your recipe was cooked") | Derived each week from cards, plays, attempts | | Time | None |
| "Since yesterday" lines | Derived from the visit before this one (`presence`) and what changed in between | | The next visit moves the line | None |
| Day line ("At the temple with Papa") | Postgres (`day_line`) | The person | `until` is the end of their local day; hidden on read, deleted by the daily scan | None |
| Muse call log | Postgres (`muse_call`) | Every model call | Deleted after 90 days | |
| Muse portrait / restore runs | Postgres (`muse_image_run`) | | Kept (the daily allowance counts them) | |
| Order preview already used | Postgres (`preview_used`) | Confirming an order (an insert that fails on a repeat) | Deleted after a day | None. Was a process map: two taps on two Workers could both order |
| Window view, weekly call, care settings, safety settings | Postgres | The person | The person | Settings: never stale |
| Rate-limit buckets (`lib/auth.ts`, `lib/otp.ts`, `lib/day-line.ts`, `lib/stickers-server.ts`) | Process memory | Each request | The window slides; the Worker restarting empties them | **Per Worker**: the real limit is looser than the number in the code when traffic spreads across Workers. Best-effort by design. Sign-in codes are also limited by the auth provider |
| Weather and geocode caches (`lib/weather.ts`) | Process memory | A lookup | 30 min / 24 h / 10 min for a miss | Public data only |
| OAuth discovery caches and used-state set (`lib/partners/oauth.ts`) | Process memory | | Discovery documents are public. The used-state set is a replay guard on top of the signed, expiring flow cookie | Per Worker, harmless |
| Cron cursor (`lib/cron-state.ts`) | Postgres (`cron_state`) when live; process memory in mock | The scan | | |
| Public share links | Postgres (`public_shares`); the database is read first on every public view | Sharing | Revoking | None |
| Client list cache (`useJson`) | Browser memory and `sessionStorage` (`aangan:json:*`, only small payloads) | Every fetch | **Any successful write** drops all of it and the lists on screen refetch once (200 ms later, coalesced). A 401 drops it. Sign-in, sign-out, switching family or person (`aangan:auth`) drops it | Between a write and the refetch (about a quarter of a second) |
| Cards snapshot (`useFamilyCards`) | Browser memory | | Same events as above; also cleared on `aangan:auth` | Same |
| Courtyard payload (`/api/courtyard`) | Browser memory | | Refetched on any write and on `aangan:auth` | Same |
| `aangan:hero` (last first-screen photo) | Browser (`localStorage`) | The window loading | Removed on `aangan:auth`, so the next family never paints the last family's photo | |
| `aangan:entered`, `aangan:door` | Browser (`sessionStorage`) | Stepping into the app / opening the door | End of the tab session; `entered` also removed on sign-in. They hold no family data | |
| `aangan:auth-intent`, welcome note | Browser | Starting sign-in | Used once, then removed | |
| Muse card "not now" (`SLOT_DISMISS_KEY`) | Browser (`localStorage`) | The person | After two weeks. **Not keyed by family**: it is per phone | A second family on the same phone shares it. Left as is: it only hides a suggestion |

## `aangan:auth`

One window event: "who is signed in, or which family, just changed". It clears the client caches above
and the viewer provider reloads the session. Every place that signs in, signs out, switches person or
switches family dispatches it; `tests/use-json-invalidate.test.ts` fails if a new one does not.
A full reload to `/` is not enough on its own, because `sessionStorage` survives a reload.

## The daily purge, in one list

Knocks past `until` · nudges 30 days after delivery · event dismissals after the event date · day lines
past `until` · sittings 7 days after they started · open check-ins older than 48 h closed as "no reply" ·
closed check-ins after 30 days · Muse call logs after 90 days · heartbeats and moments after 15 days ·
lamp beats after 2 days · pending suggestions withdrawn after 21 days · delivered voice-note schedule
rows after 7 days · spent order-preview ids after a day. Children's asks and bedtime stories are not purged by age: they go when a child or the person who made them leaves (`deleteDocsForMember`), or with a demo copy.

If you add a thing that expires, give it: a clear path when it is acted on or a TTL, a read-time filter,
a line in `purgeExpired`, a row in the table above, and a test in `tests/purge.test.ts`.

## Not done, on purpose

- Rate limits are not shared across Workers. Doing it would cost a database write on every request.
  The limits that guard money or sign-in have a second line (the spend cap, the auth provider).
- Presence rows are not rolled up. They are read by time window (last 16 days, up to 3000 rows) instead of
  "newest 500", which a dozen people's heartbeats would fill in a day. The 15-day purge bounds the table.
- The Muse card dismissal is not keyed by family (see the table).
- Nobody sees the nudge list as a screen: nudges reach people through the "Waiting for you" tile and
  the morning email. `GET /api/nudges` exists for a future list.
- `supabase/schema.sql` now allows the `preview_used` kind: re-run its constraint statement on the live database. The same goes for `bedtime_story` and `kid_ask` (children's rituals). `height_mark` is retired (1 Nov): it stays in that list so old rows parse, and nothing reads or writes it.
- Run before deploy: `alter table cards add column if not exists for_member_id text references members(id) on delete set null;` (in `supabase/schema.sql`). Adding to the fridge fails without it; nothing else does.
- `supabase/schema.sql` now allows the `card_listen` kind ("How to listen"): re-run its constraint statement on the live database. Until then a label is not kept (the voice note still sends).
- "Something only you would notice" (a Muse draft from a person's own approved facts) is deferred: not built.
- Birthdays: `members.birthday` stays plain text, now "YYYY-MM-DD" when the year is known and "MM-DD" when not (`lib/birthday.ts`). No SQL needed.
