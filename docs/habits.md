# Where the family walk lives

“Morning walk · 7 AM” lives in the family's `family_docs` table as a
`habit` document. It stores the name, local time, creator, and
the IDs of people who joined. Starting creates a new document. Renaming
or changing the time updates that same document. Joining or leaving changes
its member list. Archiving hides it from the active card and keeps the record.
The habit document keeps its last 200 actions, with the person, timestamp,
local date, and any changed name or time. Undoing a check mark keeps both
actions in this history. Check marks and their history update together.

Each check mark is a separate `habit_tick` document, keyed by habit ID,
member ID, and date. Ticking twice on the same day uses the same key.
Unticking clears the check mark for that day. Joining, leaving, editing,
and archiving do not clear the check marks.

The date comes from the person’s own time zone, so two people may be
checking off different dates at the same instant. If the zone is unknown,
the server uses UTC. The daily cleanup removes check marks older than
60 days, including check marks for archived habits.

The history sheet (`GET /api/habits?history=<id>`) is family-scoped and
session-checked. It reads one bounded query of the last 50 days of check
marks for the 7-week calendars, plus the habit's capped activity list.

See `app/api/habits/route.ts` for actions, `lib/habits.ts` for local dates
and check-mark keys, `lib/family-docs.ts` for storage, and `lib/purge.ts`
for cleanup.

For a live database, apply the `save_habit_action` function and grants from
`supabase/schema.sql` before shipping the updated app.
