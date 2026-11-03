# What Nearer is and how it's built

## What Nearer is

Nearer is **the window between two homes**.

It opens onto the people you love: their live time, weather and sky, a **Safe & sound** that says they are well, and a **lamp** you light so they know you are thinking of them. When you want more than a glance you **Sit together** at a venue, like a kitchen table, courtyard, or balcony, where the video room is already there.

Nothing crosses between homes unless someone shares it.

Nearer is calm by design: no stories, status, counts, comments, or infinite feed.

Values, in priority order:

- **Needed** — elders give and have a role
- **Heard** — acknowledgement
- **Present** — together at the same time
- **Remembered** — memories
- **Never watched** — no monitoring, no guilt

## Who it is for

Nearer is built for families split by distance: two homes, one window.

The first focus is the parent far away. Every screen either lets the family **ask** a parent for what only they have, lets the parent **give** and see that it landed, or keeps them **able to give**.

Kids and grandparents get the same window: a child's day reaches a grandparent in words and pictures, and a grandparent can ask the children for the one thing only they can give.

The app itself is in English. What the family shares — voices, recipes, questions, care notes — reaches each person in their own language: 55 languages, including Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Spanish, Arabic, and Chinese.

## The app and the rooms

The first screen is the window onto the parents' home: Safe & sound, a voice note, a video call, and a way to send them something.

Inside, a floating dock holds three things:

- **Talk to `<person>`** — voice-first reply to whoever you last heard from
- **Camera** — share a photo or short video from today
- **House** — opens the five rooms

The five rooms:

| Room | What is inside |
|---|---|
| **Memories** | Memory Lane, Stories |
| **Kitchen** | Recipes |
| **Care** | Send something, Care tasks, Helpers, Nearby |
| **Family** | Family tree, The Book, Advice, Portrait |
| **Celebrations** | Coming up, Occasions, Visits, Holidays, Play |

## The Muse helper

**Muse** is the family agent behind Nearer. It drafts the morning letter, keeps recipes and stories, suggests what to send, translates voices, recipes, questions, and notes, and transcribes voice notes.

Muse is **never a family member**: it writes down, translates, asks, and proposes, and it always brings people back to each other. It never chats in place of children, never posts as a person, and never gives medical advice.

Every Muse output is schema-checked, grounded in the family's own data, and logged to the family's *What Muse did* page. Agents propose, people approve.

## Hosting, data, and native apps

Nearer is one Next.js app, with no queues or workers:

- **Hosting:** Next.js PWA on Cloudflare Workers
- **Data:** Supabase with Postgres, private storage, and row-level scoping by `family_id`
- **Sign-in:** email code; invite codes let someone take a place the family made for them
- **Two homes:** a couple and their children can belong to both sides and switch between them; each side keeps its own space
- **Native apps:** Android and iOS shells are listed in the package, plus the installed web app for push

## Tests and checks

- `npm run dev` — local dev server in mock mode
- `npm run lint` — secret scan and logic checks
- `npm run typecheck` — `tsc --noEmit`
- `npm run test:mock` — mock-mode unit and smoke tests, with no network
- About 105 test files, about 837 test cases

## Learn more

- [Architecture](/docs/architecture)
- [Muse](/docs/muse)
- [Privacy and safety](/docs/privacy-and-safety)
- [Performance](/docs/performance)
- [Notifications](/docs/notifications)
- [Changelog](/docs/changelog)

---

Written by Muse Spark (Meta) from the build log on 2026-11-02.
