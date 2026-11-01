# Aangan — the family courtyard

"Far apart, still together." Most family apps make parents feel cared for; Aangan makes them feel **needed**.

Values, in priority order: **Needed** (elders give and have a role) · **Heard** (acknowledgement) · **Present** (together at the same time) · **Remembered** (memories) · **Never watched** (no monitoring, no guilt).

Aangan is calm by design: no stories, status, counts, comments, or infinite feed. **Aangan keeps a family going:** what elders know is passed down, things are done together across continents, and aging parents are cared for without being watched.

The app itself is in English. What the family shares (voices, recipes, questions, care notes) reaches each person in their own language: 29 languages, including Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Spanish, Arabic, Chinese and more (`lib/languages.ts`).

### One hero: the parent far away

**Aangan keeps your parents needed.** Older adults who rarely feel useful to others have about three times the odds of disability and death over seven years (Gruenewald et al., MacArthur Study, 2007); grandparents who only *receive* help have the most depressive symptoms, those who give have the fewest (Moorman & Stokes, 2013). So every screen either lets the family **ask** a parent for what only they have, lets the parent **give** and see that it landed, or keeps them **able to give**.

The first screen is the window onto the parents' home (safe & sound, a voice note, a video call, send them something). Slide the key and you're in the courtyard; the house in the dock opens the five rooms:

| Room | Tabs |
|---|---|
| **Memories** | Memory Lane (everyday photos and voices) · Stories |
| **Kitchen** | Recipes |
| **Care** | Send something (their apps by category, plus Muse's ideas) · Care tasks · Helpers · Nearby |
| **Family** | Family tree · The Book · Advice · Portrait |
| **Celebrations** | Coming up · Occasions (photos and voices from every birthday, wedding and festival) · Visits · Holidays · Play |

### Two courtyards, one door

Every family keeps its own Aangan. A married couple and their children belong to **both** sides: Priya opens on the Iyer side, Arjun on the Sharma side, and the children switch between Dadi's side and Nani's. Nothing crosses between Aangans unless someone shares it. *Add my family* creates the other side with only your own home inside it, plus an invite for your parents. In-laws, siblings and cousins get their own circle on the Family page, labelled from the family's own tree (sister-in-law, cousin, nephew).

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

| Meta model | Where it works in Aangan |
|---|---|
| `muse-voice-transcribe` | Every voice note, wish, blessing, recipe lesson, story answer and spoken request for help (segment timestamps drive synced lyrics) |
| `muse-spark-1.3` · structured output | **Recipe scribe**: a spoken recipe → a card in the cook's own measures, grounding-checked so no ingredient is invented (`lib/kitchen.ts`) |
| | **Story keeper**: one gentle question a week per elder, in their language, never repeated (`lib/keeper.ts`) |
| | **Care**: a spoken need → a task; a reassurance note for the parent in their language (`lib/care.ts`) |
| | **Translation into 29 languages**: voices, recipes (the whole card at once), questions, notes |
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
- **Two sides:** switching is only to an Aangan where the *same person* (server-set `personId`) already has a place. Other members' emails and the `personId` never leave the server.
- **Games** are server-authoritative: dice and shuffles use `crypto.randomInt`, every move is checked for turn and move count, and hidden memory cards are masked before they reach the browser.
- **Sharing** is opt-in, a frozen copy behind a 144-bit token, `noindex`, revocable. Export strips emails, Muse logs and safety locations.
- **AI:** every Muse output is schema-validated with a grounding check and a safe fallback; spend-capped; logged.

Privacy: presence is only what a parent chooses to share. The "quiet day" note is opt-in and owned by the parent, goes to the one person they chose, and is judged against their own usual rhythm. Nothing is tracked.

## AI-assistance disclosure

This entry was built with AI coding assistants (Claude Code and Muse Code), as the hackathon rules allow; every model the app itself calls at runtime is a Meta model (Muse Spark, Muse Voice Transcribe, Muse Image via the Meta Model API, with Muse Spark Open on Baseten/Modal as failover). With those assistants, scaffolding, UI implementation, the LLM client, ritual/agent logic, tests, and docs were drafted with agents and verified by the human via `lint` + `typecheck` + mock tests + production builds. Demo photos and the fallback courtyard are AI-generated and labelled as such in `public/demo/README.md`. All family data is synthetic; no real family data, no real people, no real events. No health advice anywhere in the app.
