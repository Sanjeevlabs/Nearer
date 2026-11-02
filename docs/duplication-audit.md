# Duplication audit: nothing shown twice

Source: `docs/ui-inventory.csv` (every visible item per screen), checked against the code. Rule: each block of content has ONE primary home, plus at most one compact pointer elsewhere. A pointer is a single line or a single button that leads to the home. It never repeats the content.

Screens: "window" is the closed-door first screen, "courtyard" is the family page behind the door (the dock shows only there and in the rooms).

## Decisions

| Content | Primary home | One compact pointer | Removed from | Status |
|---|---|---|---|---|
| Next occasion (birthday, festival) | Celebrations > Coming up (`/gather`) | Window: the one "Next" line (weekly call or next occasion, whichever is first) | Courtyard "Coming up" slide; courtyard "Plan / Not now" card for the next occasion (it is already on `/gather`) | Done |
| Weekly call | Celebrations > Coming up, "Our weekly call" (set, change, add to calendar, start) | Window: the same "Next" line | Nothing to remove: no other screen shows it | Already compliant |
| Lamp | Window (the lamp, lit or not, heartbeats) | None | Courtyard glow ring on each person's photo and its "lamp lit today" label | Done |
| Latest voice note from the other home | Window, "Their latest voice" (and the person's page for everything they sent) | Inbox + bell dot when it is addressed to you and unplayed | Courtyard "Now in the family" voice slide | Done |
| Waiting for you (voice notes, questions, kids' asks, Today answers, care tasks, nudges) | Inbox (`/inbox`, "For you") | The bell dot on the dock and the bell on the window | Nothing removed: courtyard cards that are listed as waiting (Today, kids' asks, a question for you) are where the inbox sends you to answer, so they stay as the answer, not as a second list | Kept on purpose |
| Voice-note entry points | The dock mic (to anyone) | The person's page (mic is pre-addressed to them), reply buttons next to the thing being answered (Today, a kid's ask, fridge, a question, a festival wish) | See below | Kept |
| Person's day | Courtyard Everyone strip, full-screen day (photos, voice, a line about today) | Window "Safe and sound" rows open a compact sheet (rhythm, check-ins) | Nothing: two different views (what they shared vs. whether they are up and about) | Kept, flagged for the owner |
| Kids' fridge | Family > Kids page (all of it) | Courtyard strip of the six latest + "All" | Nothing | Kept |

## What was found and what changed

### 1. Voice-note entry points
Today, a voice note can start from: the dock mic, the window's "Reach them > Voice note", the person's page (dock mic addressed to them), a person's day sheet, kid-home "Tell", and many "answer by voice" / "reply by voice" buttons.

Keep: dock mic, person page, reply buttons. A reply button earns its place because it carries context (what is being answered). The window's "Voice note" stays because the closed-door window has no dock (exactly one bottom bar there, the key). The person's day sheet "Voice note" is the same door as the person's page, opened from a tap on their face, so it is a pointer, not a copy.

Removed: nothing. The courtyard no longer has a second "latest voice" card (see 4), which was the only entry that duplicated the window.

### 2. Waiting items
`lib/glance.ts` waitingItems() is the one list. Its homes are the inbox and the bell dot. The window has the bell link only (no list). The people picker orders "waiting" people first, which is the reply path, not a list.

Courtyard cards that are also inbox kinds (Today answer, "Asked by the kids", "A question for you") are not removed. The inbox links to them (`href: "/"`) as the place to answer. Removing them would break the inbox's links. If the owner wants them gone the inbox must open the answer sheet directly; that touches the inbox files, so it is out of scope here.

### 3. Next occasion
Before: the window's "Next" line, the Celebrations page, the courtyard "Coming up" carousel slide, and the courtyard "Plan" prompt for the next birthday (the same prompt shows on `/gather`).

After: window line (pointer) and Celebrations (home). The courtyard keeps only prompts for something happening now or soon ("live", "soon" event prompts: picking a time, today's event).

Left for the owner: the festival-week header on the courtyard ("Diwali is in N days", teach the steps, record your wish). It is a second place for the next festival, but it is also the only place a non-lead adult or a child gets "Ask <lead> how we do it, by voice". Moving it needs a decision about where that action lives.

### 4. Latest voice
Before: window "Their latest voice", the courtyard voice slide, the person's page "Voices", Memories. After: the courtyard slide is gone. The courtyard stays one scroll shorter and the voice is one tap from the window or the person.

### 5. Lamp
The lamp is the window's single object. The courtyard drew a second, unrelated "lamp" (a gold glow ring around each photo, class `kutumb-lamp`) for "was active today". Removed the ring, its animation and its label. The line under each face ("shared today", "here today", or their city) stays: it is a status word, not a lamp.

### 6. Weekly call
Window "Next" line and the Celebrations card only. No courtyard copy. No change needed.

## Other repeats found in the inventory (not changed)
- Fridge (courtyard and `/bond/kids`): a strip of six with "All" vs the full grid: this is already home plus pointer.
- "Answer by voice" / "Play <child>'s question" on the courtyard and on `/bond/kids`: the same ask. Primary should be one of them; `/bond/kids` is outside this change, so the courtyard card stays.
- "Share these words": a share action on three different pieces of content, not a repeat.
- `/lane` (Everyone filter) and the courtyard Everyone strip: different jobs (filter vs. people).
- Settings tabs repeat "Sign out" four times; left for a settings pass.
- `kid-home` shows on both inventory screens for a child: same screen in two states, not a repeat.

## How to keep it true
Before adding a block to a screen, find it here. If it already has a home, add a pointer (one line or one button) or nothing. Run `npm run ui:inventory` and read the diff: a label that shows up on a second screen is a repeat until it is listed above with a reason.
