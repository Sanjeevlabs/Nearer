# Muse

Muse is the family's helper, never a family member, chatbot, or tab. It appears as one quiet offer in context, and everything it makes is seen by a person before the family sees it.

## Models

| Model | What it is for |
|---|---|
| `muse-spark-1.3` | Text and structured output: Today's question, translations, recipes from voice, story questions and labels, care tasks and notes, gather plans and playlists, send suggestions, album sorting, kinship terms, movable festival dates, window line |
| `muse-spark-1.3` vision | Seeing photos and cards: captions for photos and video, reading a handwritten or printed recipe card |
| `muse-voice-transcribe-1.0` | Writing down every voice note, wish, blessing, story, and request, with timings for the words-along view |
| `muse-image-1.0` | Painting one group portrait and restoring old photos |
| `meta-models/muse-spark-open-1026` | Open variant used for text, vision, and transcription |

## Where Muse helps, by screen

| Where | What Muse does | Model |
|---|---|---|
| Add sheet, photo or video | Writes a caption from what is visible and dates it, photo metadata first, never the future | `muse-spark-1.3` vision |
| Add sheet, single photo | "Old photo? Let Muse restore it": cleans scratches and fading, keeps faces, original and restored side by side | `muse-image-1.0` |
| Voice notes, everywhere | Transcribes voice notes, wishes, blessings, stories, and requests | `muse-voice-transcribe-1.0` |
| Anything someone said or wrote | Translates the whole card at once, in the person's own language, 29 languages | `muse-spark-1.3` |
| Morning letter | Suggests holding a voice note until 7:30 AM their time when it is night where they are | none, rule only |
| Family page, Today | Chooses today's shared question for both homes | `muse-spark-1.3` |
| Family page, Now in the family | "Muse made this for you": at most one card, weekly, a portrait or "this day, N years ago" from a real photo | none, offer only |
| Family room, Family portrait | Paints one group portrait in watercolour, oil, pencil, or festive illustration, preview then Keep or Try again | `muse-image-1.0` |
| Kitchen, teach by voice | Turns a spoken recipe into a card in the cook's own measures, grounding-checked | `muse-spark-1.3` |
| Kitchen, scan a recipe card | Reads a handwritten or printed card in any language into the recipe editor; the photo stays on the recipe | `muse-spark-1.3` vision |
| Story keeper | One gentle question a week per elder, in their language, never repeated | `muse-spark-1.3` |
| Stories | Labels a story a grandparent told and offers story prompts | `muse-spark-1.3` |
| Care | Turns a spoken request into a task, and writes a reassurance note in their language | `muse-spark-1.3` |
| Gathering | Drafts the plan for a family call or visit, and a playlist for it | `muse-spark-1.3` |
| Send something | Suggests what to send; a person sends | `muse-spark-1.3` |
| Memory Lane albums | Sorts photos into event albums and titles them; a person can rename | `muse-spark-1.3` |
| The Book | Gathers the parents' daily answers into chapters, in their own voice | none, grouping only |
| Family tree | Kinship terms in each person's language | `muse-spark-1.3` |
| Occasions | Dates for festivals that move each year, search-grounded | `muse-spark-1.3` |
| The window | One quiet line from what really happened at the other home today | `muse-spark-1.3` |

## Guardrails

- **One offer per screen.** If a screen already has one, a new idea waits.
- **A person reviews first.** Drafts open in the normal editor. Images show a preview with Keep / Try again. Nothing is posted automatically.
- **Never invents people or events.** Captions describe the pixels. Recipes hold only what was said or written. Portraits paint only the people chosen, from their own photos.
- **Labelled.** Anything painted or restored says so in the image and in every viewer: "Painted by Muse" or "Restored by Muse".
- **One door, checked output.** Zod-validated structured output, one retry, then a safe fallback. No raw model text reaches the UI.
- **Cached by input.** The same recipe or translation is not paid for twice.
- **Spend-capped.** Calls are refused past the shared spend cap.
- **Every call is logged** to *What Muse did*: purpose, model, latency, and whether it was cached. Call logs are kept 90 days.
- **Works with Muse off.** Each feature shows a fixed or on-device sample, labelled "Sample: Muse is off".

## Guardrails for portraits and restores

- Portraits are always a painted style. There is no photorealistic option.
- The mark is drawn into the pixels before anything is kept.
- At most 10 people, all in this family, from the family's own photos.
- Teens and children never start a portrait. A grown-up may include a child only if they are the child's parent or share a home with them.
- 5 portraits and 10 restores per family per day. Each render is checked against the spend cap first.
- A render becomes a card only through Keep, which sets the card's source.

---

Written by Muse Spark (Meta) from the build log on 2026-11-02.
