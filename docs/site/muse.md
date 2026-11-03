# Muse

Muse is the family's helper. It is never a family member, never a chatbot, and never a tab.

It shows up as **one quiet offer in context**, and everything it makes is seen by a person before the family sees it.

## Models

| Model | What it is for |
|---|---|
| `muse-spark-1.3` | Text and vision. Captions, translation, questions, recipes, stories, care notes, plans, albums, kinship terms, festival dates, and the window line. |
| `muse-voice-transcribe-1.0` | Writing down voice memories, wishes, blessings, stories, and requests, with timings for the words-along view. |
| `muse-image-1.0` | Painting a group portrait and restoring old photos. |

Vision uses of `muse-spark-1.3` are captions from photos or video, and reading recipe cards.

## Where Muse helps

| Screen | What Muse does |
|---|---|
| Add sheet, photo or video | Writes a caption from what is visible and dates it. Photo metadata comes first. Muse is only a fallback for dating, and never dates in the future. |
| Add sheet, a single photo | “Old photo? Let Muse restore it.” Cleans scratches and fading and keeps faces. Shows original and restored side by side. |
| Voice, everywhere | Writes down every voice memory, wish, blessing, story, and request. |
| Anything someone said or wrote | Translates the whole card at once so each person can read it in their own language. Covers 55 languages. |
| Family page, Today | Chooses today’s shared question for both homes. |
| Family room, Family portrait | Paints one group portrait from profile photos or chosen family photos, in watercolour, oil, pencil, or festive illustration. Preview first. |
| Kitchen, teach by voice | Turns a spoken recipe into a card in the cook’s own measures. Holds only what was said or written. |
| Kitchen, scan a recipe card | Reads a handwritten or printed card in any language into the recipe editor for checking. The photo stays on the recipe. |
| Story keeper | One gentle question a week per elder, in their language, never repeated. |
| Stories | Labels a story a grandparent told by title, theme, and ages, and offers story prompts. |
| Care | Turns a spoken request into a task, and writes a reassurance note for the parent in their language. |
| Gathering | Drafts the plan for a family call or visit, and a playlist for it. |
| Send something | Suggests what to send, such as groceries, a cake, or a gift. A person sends it. |
| Memory Lane albums | Sorts photos into event albums and titles them. A person can rename, and Muse leaves it alone. |
| Family tree | Kinship terms in each person’s language. |
| Occasions | Dates for festivals that move each year, search-grounded. |
| The window | One quiet line from what really happened at the other home today. |

These are not model calls: holding a voice memory until 7:30 AM for the morning letter, the weekly “Muse made this for you” offer, and gathering daily answers into chapters in The Book.

## Guardrails

- **One offer per screen.** If a screen already has one, a new idea waits for another screen.
- **A person reviews first.** Text drafts open in the normal editor. Images show a preview with Keep and Try again. Nothing is posted automatically.
- **Never invents people or events.** Captions describe the pixels. Recipes hold only what was said or written. Portraits paint only the people chosen, from their own photos.
- **Labelled.** Anything Muse painted or restored says so in the image itself and in every viewer: “Painted by Muse” or “Restored by Muse.”
- **Checked output.** Structured output is Zod-validated, with one retry, then a safe fallback. No raw model text reaches the screen.
- **Grounding-checked.** Recipes and questions are checked against what was said and against repeats.
- **Cached by input.** The same input is not paid for twice.
- **Spend cap.** Calls are refused past the shared USD 120 spend cap. Each portrait and restore is checked against the cap before the call.
- **What Muse did log.** Every call is logged to the family’s *What Muse did* page with purpose, model, latency, cost, and whether it was cached. Logs are deleted after 90 days.
- **Works with Muse off.** In mock mode each feature shows a fixed or on-device sample, labelled “Sample: Muse is off.”

## Guardrails for portraits and restores

- Portraits are always in a painted style. There is no photorealistic option.
- The mark is drawn into the pixels, bottom-right, before anything is kept.
- At most 10 people, all in this family, from the family’s own media only.
- Teens and children never start a portrait. A grown-up may include a child only if they are the child’s parent or share a home with them.
- 5 portraits and 10 restores per family per day.
- A render becomes a card only through Keep, which sets the card’s source as `muse-portrait` or `muse-restored`. A plain upload cannot claim either source.

---

Written by Muse Spark (Meta) from the build log on 2026-11-03.
