# Nearer

**The window between two homes.**

Arjun lives in Bengaluru. His parents, Maa and Papa, live in Amritsar, 1,600 km away. At 8 PM he opens Nearer and sees their window: their sky right now, the time there, and what they chose to share today ("Maa · visitors, 7:00 PM"). He doesn't call to check. He looks. He taps the **lamp**, and Maa's phone says *Arjun is thinking of you*. Maa has **opened her door** for chai; he joins with his voice, and nothing starts until he taps. Last week she taught him her dal by voice, in Hindi; Muse wrote it down as a recipe in English. On Sunday he cooked it, and Maa saw *Arjun cooked your dal*. Diwali is in five days: Dadi (Maa, to his children) leads, the kids record their wishes, and on the day the **Chorus** plays them one after another. Her voice stays in **Memories**, starred, searchable and in the family's Book.

That is the whole product: **a window between two homes** that keeps parents **needed, not monitored**. Nothing is inferred from app use, the clock or silence: the app shows only what someone chose to share.

Values, in priority order: **Needed** (elders give and have a role) · **Heard** (acknowledgement) · **Present** (together at the same time, by invitation) · **Remembered** (memories) · **Never watched** (no monitoring, no guilt, no streaks, no sealed answers). Calm by design: no feed, no counts, no status.

The app itself is in English. What the family shares (voices, recipes, questions, notes) reaches each person in their own language: 55 languages, including Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Spanish, Arabic and Chinese (`lib/languages.ts`). Elders see prompts in their own language, in large type, while they record.

Live: https://nearer.site (tap *Try the demo family*, or use the code `NEARER-DEMO`). To see both homes, open a door as Arjun, tap *Demo: see it arrive on their side*, and scan the code on a second phone: it becomes Maa in the same demo family.

### One hero: the parent far away

**Nearer keeps your parents needed.** Older adults who rarely feel useful to others have about three times the odds of disability and death over seven years (Gruenewald et al., MacArthur Study, 2007); grandparents who only *receive* help have the most depressive symptoms, those who give have the fewest (Moorman & Stokes, 2013). So every screen either lets the family **ask** a parent for what only they have, lets the parent **give** and see that it landed, or brings them **together** by invitation.

The first screen is the window onto the parents' home: **Their day** (their time, sky and what they shared), the **lamp** (a 2-hour glow and a "thinking of you" note; never a check-in), and **Spend a little time together** (an open door for chai, dinner, a story; join with audio or video only after a tap). Slide the key and you're inside; the house opens five rooms:

| Room | Tabs |
|---|---|
| **Living Room** | Time together · Coming up · Occasions (wishes and the Chorus) |
| **Memories** | Memory Lane (photos and voice memories, ⭐ starred, searchable) · Stories · The Book · Advice · Ask the family |
| **Kitchen** | Recipes (taught by voice, scanned from a card) |
| **Our People** | Family tree · Homes · Kids · Visits |
| **Care** | Care tasks · Helpers · Nearby (who to call first) |

### Two homes, one window

Every family keeps its own space. A married couple and their children belong to **both** sides: Priya opens on the Iyer side, Arjun on the Sharma side, and the children switch between Dadi's side and Nani's. Nothing crosses between homes unless someone shares it. *Add my family* creates the other side with only your own home inside it, plus an invite for your parents. In-laws, siblings and cousins get their own circle on the Family page, labelled from the family's own tree (sister-in-law, cousin, nephew).

## Built during the hackathon

Solo Indie-track entry, Meta Global AI Developer Hackathon. Deadline 4 Nov 2026, 9:00 PM ET.

Everything in this repo was built during the event window (27 Oct – 4 Nov 2026); see [BUILD_LOG.md](BUILD_LOG.md) for the day-by-day record. Stack: Next.js 16 PWA on Cloudflare Workers (OpenNext; see [docs/DEPLOY.md](docs/DEPLOY.md)), Supabase (Postgres + private Storage + RLS by `family_id`), one Next.js app, no queues or workers. Sign-in is an email code; invite codes let someone take a place the family made for them. Two synthetic demo families (`demo-family` = Sharma, `demo-iyer` = Iyer) open with the public demo code.

Run it:

- `npm install`, then `npm run dev` — local dev server (mock mode unless `.env.local` sets keys + `MOCK=false`).
- `npm run lint` — secret scan + no hard-coded festivals in app logic.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run test:mock` — mock-mode unit + smoke tests (no network, no cost).
- `npm run eval:golden` — manual live golden eval. Needs `META_API_KEY`. Never in CI.
- `node scripts/seed.mjs` — generates the consistent demo-family photos (needs `META_API_KEY`).

Environment (see `.env.example`; never commit `.env.local`):

- `META_API_KEY` — Meta model calls. Environment only, never written to any file.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project.
- `SUPABASE_SECRET_KEY` — server-only service-role key for route handlers.
- `MOCK` — `true` keeps the in-memory mock store (tests always run mock); set `false` for live Supabase dev.

## Built with Meta: Muse, powered backstage

Every model called at runtime is a Meta model. Muse is the family's helper, but it is **never a family member**: it writes down, translates, asks and proposes, and it always brings people back to each other. It never chats with lonely parents in place of their children, never posts as a person, and never gives medical advice.

| Meta model | Where it works in Nearer |
|---|---|
| `muse-voice-transcribe` | Every voice note, wish, blessing, recipe lesson, story answer and spoken request for help (segment timestamps drive synced lyrics) |
| `muse-spark-1.3` · structured output | **Recipe scribe**: a spoken recipe → a card in the cook's own measures, grounding-checked so no ingredient is invented (`lib/kitchen.ts`) |
| | **Story keeper**: one gentle question a week per elder, in their language, never repeated (`lib/keeper.ts`) |
| | **Care**: a spoken need → a task; a reassurance note for the parent in their language (`lib/care.ts`) |
| | **Translation into 55 languages**: voices, recipes (the whole card at once), questions, notes |
| | Memory-card captions incl. video understanding, kinship terms, Gather playlists, the ritual agent's tool-calling loop, search-grounded movable festival dates |
| `muse-image-1.0` | **Family portrait**: one painted group portrait from the family's own photos (watercolour, oil, pencil, festive), marked "Painted by Muse" in the pixels, kept only on Keep (`lib/muse-image.ts`, `/portrait`) |
| | **Restore an old photo** from the add sheet, side by side with the original, marked "Restored by Muse" |
| | Seed script: fallback courtyard + demo-family photos in `public/demo/` (labelled AI-generated; never inside real cards) |
| `muse-spark-1.3` · vision | **Scan a recipe card**: a handwritten or printed card in any language → the recipe editor for checking (`lib/recipe-scan.ts`) |

Every place Muse appears, and the rule of one offer per screen: [docs/MUSE.md](docs/MUSE.md).

How it is kept safe and cheap:

- **One door** (`lib/muse.ts`): Zod-validated structured output, one retry, then a safe fallback. No raw model text reaches the UI.
- **Grounding checks** reject output that isn't supported by what was said (recipes), or that repeats (questions).
- **Cached** by input, so the same recipe or translation is never paid for twice. USD 120 spend cap, refused past the cap.
- **Every call is logged** to the family's *What Muse did* page: purpose, model, latency, cost, cached or not.
- **Agents propose, people approve.** Nothing an agent suggests runs without a person tapping approve.
- Baseten-hosted **Muse Spark Open** (`meta-models/muse-spark-open-1026`): with `BASETEN_API_KEY` set, any failed Muse text or vision call retries there automatically; `MUSE_PROVIDER=baseten` makes it primary. Each host gets only its own key.

## Security model

- **Tenancy:** every read and write is scoped to the session's `familyId`; Postgres RLS by `family_id`; server routes use the service-role key, which never reaches the browser.
- **Sessions:** httpOnly, SameSite=Lax, HMAC-signed cookies. Email OTP is rate-limited. Invite codes expire in 7 days and can never open an admin or someone with their own account. The persona switcher only works in the synthetic demo families.
- **Two sides:** switching is only to a home where the *same person* (server-set `personId`) already has a place. Other members' emails and the `personId` never leave the server.
- **Games** are server-authoritative: dice and shuffles use `crypto.randomInt`, every move is checked for turn and move count, and hidden memory cards are masked before they reach the browser.
- **Sharing** is opt-in, a frozen copy behind a 144-bit token, `noindex`, revocable. Export strips emails, Muse logs and safety locations.
- **AI:** every Muse output is schema-validated with a grounding check and a safe fallback; spend-capped; logged.

Privacy: the window shows only what someone chose to share. App opens, the lamp and the clock are never read as "all good", "asleep" or "available". The "quiet morning" note exists only if the parent turns it on, and goes to the one person they chose. Calls start only after a tap on a consent screen (audio-only always offered). Nothing is tracked.

## Third-party models and assets

- **Meta models only at runtime.** Muse Spark, Muse Voice Transcribe, Muse Image and Muse Spark Open (Baseten/Modal) in the app; SAM 2.1 / SAM 3 where segmentation is used. No virtual-background, blur or noise-suppression ML runs in calls: the venue photo is a plain CSS frame around the video. `npm run lint` enforces this.
- **Demo narration:** Meta MMS-TTS (`facebook/mms-tts-eng`), run locally with `transformers` (`scripts/demo-reel/v2.py`). Licence: CC-BY-NC 4.0, so non-commercial use only; it voices the hackathon demo video, not the app.
- Video calls use Jitsi (JaaS), which is a transport, not an AI model, with its ML features switched off.
- Demo photos and the fallback courtyard are AI-generated (Muse Image) and labelled in `public/demo/README.md`. Any other third-party asset is licensed for this use and listed here with its source.

## AI-assistance disclosure

This entry was built with AI coding assistants (Claude Code and Muse Code), as the hackathon rules allow; every model the app itself calls at runtime is a Meta model (Muse Spark, Muse Voice Transcribe, Muse Image via the Meta Model API, with Muse Spark Open on Baseten/Modal as failover). With those assistants, scaffolding, UI implementation, the LLM client, ritual/agent logic, tests, and docs were drafted with agents and verified by the human via `lint` + `typecheck` + mock tests + production builds. Demo photos and the fallback courtyard are AI-generated and labelled as such in `public/demo/README.md`. All family data is synthetic; no real family data, no real people, no real events. No health advice anywhere in the app.

## Build notes

Nearer (codename Aangan during development). Internal storage keys, the session cookie, Modal app names and the Cloudflare Worker name keep the codename on purpose, so existing sessions and secrets survive the rename.
