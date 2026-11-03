# What Nearer is and how it's built

## What Nearer is

Nearer is **the window between two homes**.

Arjun lives in Bengaluru. His parents, Maa and Papa, live in Amritsar, 1,600 km away. At 8 PM he opens Nearer and sees their window: their sky right now, the time there, and what they chose to share today. He taps the **lamp**, and Maa's phone says *Arjun is thinking of you*. Maa has opened her door for chai; he joins with his voice, and nothing starts until he taps.

That is the whole product: a window that keeps parents **needed, not monitored**. The app shows only what someone chose to share. Nothing is inferred from app use, the clock, or silence.

Calm by design: no feed, no counts, no status.

## Who it is for

Nearer keeps your parents needed. The first screen is the window onto the parents' home:

- **Their day** — their time, sky, and what they shared
- **The lamp** — a 2-hour glow and a thinking-of-you note, never a check-in
- **Spend a little time together** — an open door for chai, dinner, or a story, joined only after a tap

Values, in priority order:

- **Needed** — elders give and have a role
- **Heard** — acknowledgement
- **Present** — together at the same time, by invitation
- **Remembered** — memories
- **Never watched** — no monitoring, no guilt, no streaks

The app itself is in English. What the family shares reaches each person in their own language: 55 languages, including Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Spanish, Arabic and Chinese.

Every family keeps its own space. A married couple and their children belong to **both** sides: Priya opens on the Iyer side, Arjun on the Sharma side, and the children switch between sides. Nothing crosses between homes unless someone shares it.

## The five rooms

Slide the key and you are inside. The house opens five rooms:

| Room | Tabs |
|---|---|
| **Living Room** | Time together · Coming up · Occasions (wishes and the Chorus) |
| **Memories** | Memory Lane (photos and voice memories, starred, searchable) · Stories · The Book · Advice · Ask the family |
| **Kitchen** | Recipes (taught by voice, scanned from a card) |
| **Our People** | Family tree · Homes · Kids · Visits |
| **Care** | Care tasks · Helpers · Nearby (who to call first) |

Two synthetic demo families are included: `demo-family` (Sharma) and `demo-iyer` (Iyer). Live at `nearer.site` with the demo code `NEARER-DEMO`.

## The app underneath

One Next.js 16 PWA, with no queues or workers:

- Next.js 16 PWA on Cloudflare Workers via OpenNext
- Supabase for Postgres, private Storage, and RLS by `family_id`
- Sign-in with an email code; invite codes let someone take a place the family made for them
- 43 pages and 99 API routes in this build

Every read and write is scoped to the session's family. Server routes use a server-only key that never reaches the browser.

## The Muse helper

Every model called at runtime is a Meta model. Muse is the family's helper, but it is **never a family member**: it writes down, translates, asks and proposes, and it always brings people back to each other.

It never chats with lonely parents in place of their children, never posts as a person, and never gives medical advice.

| Meta model | Where it works |
|---|---|
| `muse-voice-transcribe` | Every voice note, wish, blessing, recipe lesson, story answer, and spoken request for help |
| `muse-spark-1.3` structured output | Recipe scribe, story keeper, care tasks, translation into 55 languages, captions, kinship terms, playlists, festival dates |
| `muse-image-1.0` | Painted family portrait and old-photo restore, marked in the pixels |
| `muse-spark-1.3` vision | Scan a handwritten or printed recipe card into the recipe editor |

Safety rules:

- **One door** in `lib/muse.ts`: validated structured output, one retry, then a safe fallback
- Grounding checks reject invented ingredients or repeated questions
- Cached by input, so the same recipe or translation is never done twice
- Every call is logged to the family's *What Muse did* page
- Agents propose, people approve

## Native apps and hosting

- The same Next.js app ships as a PWA and as native wrappers
- The repo includes Capacitor for Android and iOS, with `cap:sync`, `cap:android`, `cap:ios`, and `android:apk` scripts
- Push reaches the Android app, the installed web app, and the iOS app once configured
- Hosting is Cloudflare Workers for the app and Supabase for data and private media

## Tests and checks

- 128 test files, about 1047 test cases
- `npm run test:mock` — mock-mode unit and smoke tests, no network
- `npm run lint` — secret scan and no hard-coded festivals in app logic
- `npm run typecheck` — `tsc --noEmit`

## Where to go next

- [Architecture](/docs/architecture)
- [Muse](/docs/muse)
- [Privacy and safety](/docs/privacy-and-safety)
- [Performance](/docs/performance)
- [Notifications](/docs/notifications)
- [Changelog](/docs/changelog)

---

Written by Muse Spark (Meta) from the build log on 2026-11-03.
