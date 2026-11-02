# Where Muse appears

Muse is the family's helper, never a family member, a chatbot or a tab. It
shows up as **one quiet offer in context**, and everything it makes is seen
by a person before the family sees it.

## The rules

- **One offer per screen.** At most one Muse offer on any screen. If a screen
  already has one, a new idea waits for another screen.
- **A person reviews first.** Drafts open in the normal editor; images show a
  preview with Keep / Try again. Nothing is posted automatically.
- **Never invents people or events.** Captions describe the pixels; recipes
  hold only what was said or written; portraits paint only the people chosen,
  from their own photos.
- **Labelled.** Anything Muse painted or restored says so in the image itself
  and in every viewer ("Painted by Muse", "Restored by Muse").
- **Safe and cheap.** One door per model (`lib/muse.ts`, `lib/muse-image.ts`,
  `lib/recipe-scan.ts`): Zod-validated, one retry, then a safe fallback;
  cached by input; refused past the shared spend cap; every call logged to
  *What Muse did*.
- **Works with Muse off.** In mock mode (no key) each feature shows a fixed or
  on-device sample, labelled "Sample: Muse is off".

## Every place, by screen

| Where | What Muse does | Model | Code |
|---|---|---|---|
| Add sheet, photo or video | Writes a caption from what is visible and dates it (photo metadata first, Muse only as a fallback, never the future) | `muse-spark-1.3` vision | `app/api/cards/route.ts`, `lib/dating.ts` |
| Add sheet, a single photo | **"Old photo? Let Muse restore it"**: scratches and fading cleaned, faces kept; original and restored side by side; Keep restored / Keep original | `muse-image-1.0` | `components/muse-restore.tsx`, `app/api/muse/restore` |
| Voice memories, everywhere | Writes down every voice memory, wish, blessing, story and request, with timings for the words-along view | `muse-voice-transcribe-1.0` | `lib/llm.ts`, `app/api/transcribe` |
| Anything someone said or wrote | Reaches each person in their own language (29 languages), the whole card at once | `muse-spark-1.3` | `app/api/translate`, `lib/kitchen.ts` |
| Morning letter | Suggests holding a voice memory until 7:30 AM their time when it is night where they are (a rule on their time zone, no model) | none | `components/add-sheet.tsx` |
| Family page, Today | Chooses today's shared question for both homes | `muse-spark-1.3` | `lib/today-server.ts` |
| Family page, "Now in the family" | **"Muse made this for you"**: at most one card, weekly: a portrait of all of you, or "this day, N years ago" from a real photo. ✕ hides it for two weeks | none (offer only) | `components/muse-slot.tsx`, `lib/muse-slot.ts` |
| Family room, Family portrait | **Paints one group portrait** from profile photos (or a chosen family photo each), in watercolour, oil, pencil or a festive illustration. Preview, then Keep or Try again | `muse-image-1.0` | `app/portrait`, `app/api/muse/portrait`, `lib/muse-portrait.ts` |
| Kitchen, teach by voice | Turns a spoken recipe into a card in the cook's own measures, grounding-checked | `muse-spark-1.3` | `lib/kitchen.ts` |
| Kitchen, scan a recipe card | **Reads a handwritten or printed card** in any language into the recipe editor for checking; the photo stays on the recipe ("In Maa's handwriting") | `muse-spark-1.3` vision | `components/recipe-scan.tsx`, `lib/recipe-scan.ts` |
| Story keeper | One gentle question a week per elder, in their language, never repeated | `muse-spark-1.3` | `lib/keeper.ts` |
| Stories | Labels a story a grandparent told (title, theme, ages) and offers story prompts | `muse-spark-1.3` | `lib/stories.ts`, `lib/story-ideas.ts` |
| Care | Turns a spoken request into a task, and writes a reassurance note for the parent in their language (care dictation) | `muse-spark-1.3` | `lib/care.ts` |
| Gathering | Drafts the plan for a family call or visit, and a playlist for it | `muse-spark-1.3` | `lib/gather-plan.ts`, `app/api/gather` |
| Send something | Suggests what to send (groceries, a cake, a gift); a person sends | `muse-spark-1.3` | `lib/partners/suggest.ts` |
| Memory Lane albums | Sorts photos into event albums and titles them; a person can rename and Muse leaves it alone | `muse-spark-1.3` | `lib/albums.ts` |
| The Book | Gathers the parents' daily answers into chapters, in their own voice | none (grouping) | `app/api/book` |
| Family tree | Kinship terms in each person's language (Dadi, Nani, Mama...) | `muse-spark-1.3` | `lib/kinship.ts` |
| Occasions | Dates for festivals that move each year, search-grounded | `muse-spark-1.3` | `lib/movable-dates.ts` |
| The window | One quiet line from what really happened at the other home today | `muse-spark-1.3` | `lib/window-server.ts` |

## Guardrails for Muse Image (portraits and restores)

- Always a painted style for portraits; there is no photorealistic option.
- The mark is drawn into the pixels (bottom-right) before anything is kept.
- At most 10 people, all in this family, photos resolved on the server from
  the family's own media only.
- Teens and children never start a portrait. A grown-up may include a child
  only if they are the child's parent or share a home with them.
- 5 portraits and 10 restores per family per day; each render is checked
  against the spend cap before the call.
- A render becomes a card only through **Keep** (`/api/muse/keep`), which sets
  the card's source (`muse-portrait`, `muse-restored`). A plain upload can't
  claim either source.
