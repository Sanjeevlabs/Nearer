import { z } from "zod";
import { COURSES, EVENT_KINDS, GAME_KINDS, HELPER_ROLES, PLACE_KINDS, PROJECT_KINDS, STORY_AGES, STORY_THEMES, NEED_KINDS, NEED_STATUSES, PET_SPECIES, PRESENCE_MOMENTS, PRIORITIES, RECURRENCE, SAFETY_KINDS, SITTING_REASONS } from "./kind-values";

export { COURSES, EVENT_KINDS, HELPER_ROLES, PLACE_KINDS, PROJECT_KINDS, STORY_AGES, STORY_THEMES, NEED_KINDS, NEED_STATUSES, PET_SPECIES, PRESENCE_MOMENTS, PRIORITIES, RECURRENCE, SAFETY_KINDS, SITTING_REASONS };

// Schemas for the family's "living" records: Kitchen, presence, care,
// local helpers, sittings and the weekly question. They share one table
// (family_docs, jsonb) and are validated here on every read and write, so a
// new room costs a schema, not a migration. Clients import types only.

const iso = z.string().datetime();
const id = z.string().min(1).max(80);

// ---------- Kitchen ----------
export const IngredientSchema = z.object({
  item: z.string().min(1).max(80),
  /** Exactly as the cook said it: "a fistful", "two small katoris". */
  said: z.string().max(80).default(""),
  /** A cautious everyday equivalent for someone abroad: "≈ ½ cup". Never invented precision. */
  approx: z.string().max(40).default(""),
});

export const StepSchema = z.object({
  text: z.string().min(1).max(400),
  /** The cook's own warning or secret, kept in their voice. */
  tip: z.string().max(200).default(""),
});

export const RecipeSchema = z.object({
  id,
  title: z.string().min(1).max(80),
  /** The family member whose recipe this is. */
  cookId: id,
  /** Who wrote it down, if not the cook ("I'm writing down Maa's recipe"). */
  addedBy: z.string().nullable().default(null),
  course: z.enum(COURSES).default("main"),
  /** Minutes, when known. Never invented by Muse. */
  prepMins: z.number().int().min(0).max(1440).nullable().default(null),
  cookMins: z.number().int().min(0).max(1440).nullable().default(null),
  /** Before you start: soak, chop, grind ("soak the dal 30 min"). */
  prepWork: z.array(z.string().min(1).max(160)).max(12).default([]),
  /** How you know it's right: "Thick enough to coat a spoon; smells of ghee." */
  outcome: z.string().max(240).default(""),
  /** The voice note it was taught in (a card), if any. */
  voiceCardId: z.string().nullable().default(null),
  /** A video of it being made (a card), if any. */
  videoCardId: z.string().nullable().default(null),
  coverRef: z.string().nullable().default(null),
  /** The photo of the recipe card it was read from ("In Maa's handwriting"), if scanned. */
  scanRef: z.string().max(512).nullable().default(null),
  /** One line of why it matters: "Every Sunday in Kanpur, after the market." */
  memory: z.string().max(240).default(""),
  serves: z.string().max(40).default(""),
  ingredients: z.array(IngredientSchema).max(40).default([]),
  steps: z.array(StepSchema).max(30).default([]),
  lang: z.string().default("en"),
  /** Who structured it: the cook by hand, or Muse from the voice note. */
  madeBy: z.enum(["family", "muse"]).default("family"),
  createdAt: iso,
});

export const AttemptSchema = z.object({
  id,
  recipeId: id,
  memberId: id,
  photoRef: z.string().nullable().default(null),
  note: z.string().max(240).default(""),
  /** Family members who blessed this attempt (the cook's blessing matters most). */
  blessedBy: z.array(id).default([]),
  createdAt: iso,
});

// ---------- Presence (a parent's day, felt from far away) ----------
export const PresenceMomentSchema = z.enum(PRESENCE_MOMENTS);

export const PresenceSchema = z.object({
  id,
  memberId: id,
  moment: PresenceMomentSchema,
  note: z.string().max(120).default(""),
  at: iso,
});

/** Opt-in, owned by the parent: who is told, and only when the day is unusually quiet. */
export const CareSettingsSchema = z.object({
  id, // = memberId of the parent
  memberId: id,
  quietAlert: z.boolean().default(false),
  /** The one family member the parent chose to be told. */
  tellMemberId: z.string().nullable().default(null),
  /** Hours past their usual first moment before a gentle note (default 3). */
  graceHours: z.number().int().min(1).max(12).default(3),
  /** Opening the app counts as "in the courtyard" for the family. */
  shareVisits: z.boolean().default(true),
  updatedAt: iso,
});

// ---------- Care circle ----------
export const NeedSchema = z.object({
  id,
  /** Whose need (usually a parent). */
  forMemberId: id,
  askedBy: id,
  title: z.string().min(1).max(120),
  kind: z.enum(NEED_KINDS).default("other"),
  when: z.string().max(60).default(""),
  status: z.enum(NEED_STATUSES).default("open"),
  priority: z.enum(PRIORITIES).default("normal"),
  /** Optional due date-time for the board's ordering and nudges. */
  dueAt: iso.nullable().default(null),
  recurring: z.enum(RECURRENCE).default("none"),
  /** A task can be for a pet ("Bruno's vet visit"). */
  petId: z.string().nullable().default(null),
  /** Every change, who and when: the ticket's timeline. */
  history: z.array(z.object({ at: iso, by: z.string(), what: z.string().max(160) })).max(100).default([]),
  /** The family member taking responsibility (often abroad). */
  claimedBy: z.string().nullable().default(null),
  /** The local helper who will actually go. */
  helperId: z.string().nullable().default(null),
  /** Note for the parent, already in their language. */
  noteForParent: z.string().max(240).default(""),
  doneAt: iso.nullable().default(null),
  createdAt: iso,
});

// ---------- Safe & sound (owned by the person it protects) ----------
export const SafetySettingsSchema = z.object({
  id, // = memberId
  memberId: id,
  enabled: z.boolean().default(false),
  /** The people she chose. Nobody else ever sees her check-ins. */
  watchers: z.array(id).max(12).default([]),
  paused: z.boolean().default(false),
  updatedAt: iso,
});

export const SafetyCheckinSchema = z.object({
  id,
  memberId: id,
  kind: z.enum(SAFETY_KINDS),
  note: z.string().max(120).default(""),
  /** Heading / journey: when she expects to arrive. */
  etaAt: iso.nullable().default(null),
  /** When she closed it ("Home safe", "Landed", "I'm okay now"). */
  closedAt: iso.nullable().default(null),
  /** True when nobody replied and the daily scan (or a read) closed it after 48 h: not a sign of life. */
  noReply: z.boolean().optional(),
  /** Only ever on "I need help", only if she chose to send it; dropped after 24 h. */
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000), at: iso }).nullable().default(null),
  at: iso,
});

// ---------- Stories (the kids' corner) ----------
export const StorySchema = z.object({
  id,
  /** Who told it: usually a grandparent. */
  tellerId: id,
  /** The voice (or video) card it was told in. */
  cardId: id,
  title: z.string().min(1).max(80),
  theme: z.enum(STORY_THEMES).default("other"),
  ages: z.enum(STORY_AGES).default("all"),
  summary: z.string().max(200).default(""),
  lang: z.string().default("en"),
  /** The child's request it answers (a `question` with topic "story"). */
  questionId: z.string().nullable().default(null),
  madeBy: z.enum(["family", "muse"]).default("family"),
  createdAt: iso,
});

// ---------- Together (family projects from templates) ----------
export const ProjectTaskSchema = z.object({
  id,
  text: z.string().min(1).max(140),
  assignee: z.string().nullable().default(null),
  done: z.boolean().default(false),
});
export const QuizItemSchema = z.object({
  q: z.string().min(4).max(160),
  options: z.array(z.string().min(1).max(60)).min(2).max(4),
  answer: z.number().int().min(0).max(3),
  /** Where the answer comes from (grounding): "Dadi's recipe", "the family tree". */
  from: z.string().max(60).default(""),
});
export const ProjectSchema = z.object({
  id,
  templateId: z.string().nullable().default(null),
  title: z.string().min(1).max(80),
  kind: z.enum(PROJECT_KINDS),
  createdBy: id,
  /** The day it happens (a visit, a quiz night) or is due. */
  dueAt: iso.nullable().default(null),
  /** For a visit: who is coming home, and to whom. */
  visitorId: z.string().nullable().default(null),
  hostIds: z.array(id).max(12).default([]),
  tasks: z.array(ProjectTaskSchema).max(40).default([]),
  quiz: z.array(QuizItemSchema).max(12).default([]),
  status: z.enum(["active", "done"]).default("active"),
  createdAt: iso,
});

// ---------- Games (turn-based, server-authoritative) ----------
const int = z.number().int();
export const GameStateSchema = z.object({
  /** Ludo: per player, each piece's progress: -1 in the yard, 0-55 on the way, 56 home. */
  tokens: z.array(z.array(int.min(-1).max(56)).max(4)).max(4).default([]),
  /** The roll waiting to be moved, if any. */
  dice: int.min(1).max(6).nullable().default(null),
  /** The last roll, so everyone sees what was thrown. */
  lastRoll: int.min(1).max(6).nullable().default(null),
});
export const GameSchema = z.object({
  id,
  game: z.enum(GAME_KINDS),
  players: z.array(id).min(2).max(4),
  turn: int.min(0).max(3).default(0),
  /** Move counter: a stale client's move is refused, not merged. */
  moves: int.min(0).default(0),
  status: z.enum(["playing", "done"]).default("playing"),
  winner: id.nullable().default(null),
  state: GameStateSchema,
  lastMove: z.object({ by: id, text: z.string().max(80), at: iso }).nullable().default(null),
  createdBy: id,
  createdAt: iso,
  updatedAt: iso,
});

// ---------- Albums (Muse sorts photos into events) ----------
export const AlbumSchema = z.object({
  id,
  title: z.string().min(1).max(80),
  event: z.enum(EVENT_KINDS),
  cardIds: z.array(id).max(2000).default([]),
  startAt: iso,
  endAt: iso,
  coverId: z.string().nullable().default(null),
  madeBy: z.enum(["muse", "family"]).default("muse"),
  /** Set when a person renames or rearranges it; Muse then leaves it alone. */
  fixedBy: z.string().nullable().default(null),
  createdAt: iso,
});

// ---------- Around home (places that matter near a parent's home) ----------
export const PlaceSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  kind: z.enum(PLACE_KINDS).default("other"),
  /** Whose home it's around (a member of that household). */
  nearMemberId: id,
  /** Coordinates of a public place (or the home, if the family chooses). */
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  /** Google place ID, which the Maps terms allow us to keep. */
  googlePlaceId: z.string().max(300).nullable().default(null),
  note: z.string().max(240).default(""),
  /** The family's own photos and voice notes from this place. */
  cardIds: z.array(id).max(200).default([]),
  addedBy: id,
  createdAt: iso,
});

// ---------- Pets (part of a home) ----------
export const PetSchema = z.object({
  id,
  name: z.string().trim().min(1).max(40),
  species: z.enum(PET_SPECIES).default("dog"),
  /** The person they live with; the pet belongs to that person's home. */
  livesWith: id,
  photoRef: z.string().nullable().default(null),
  /** MM-DD birthday or "gotcha day", optional. */
  birthday: z.string().regex(/^(\d{2}-\d{2})?$/).default(""),
  note: z.string().max(160).default(""),
  addedBy: id,
  createdAt: iso,
});

// ---------- Local helpers (trusted people near a parent's home) ----------
export const HelperSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  role: z.enum(HELPER_ROLES).default("other"),
  /** The parent whose home they serve (shared by everyone in that home). */
  forMemberId: id,
  phone: z.string().max(30).default(""),
  /** When they're usually available: "Mon–Sat, 8–11 am". */
  hours: z.string().max(60).default(""),
  note: z.string().max(160).default(""),
  /** On this home's trusted-nearby list: the people to call first if something is wrong. */
  emergency: z.boolean().default(false),
  /** They agreed to be listed (asked by whoever added them). */
  consent: z.boolean().default(false),
  addedBy: id,
  createdAt: iso,
});

/**
 * Who handles what for a home ("Arjun handles groceries for Maa & Papa").
 * A new need of that kind goes straight to them. id = `${forMemberId}:${kind}`.
 */
export const DutySchema = z.object({
  id,
  forMemberId: id,
  kind: z.enum(NEED_KINDS),
  memberId: id,
  updatedAt: iso,
});

/** Siblings take turns being the one who checks in this week. */
export const RotaSchema = z.object({
  id, // = forMemberId
  forMemberId: id,
  order: z.array(id).min(1).max(12),
  startWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updatedAt: iso,
});

// ---------- Sit together ----------
export const SittingSchema = z.object({
  id,
  reason: z.enum(SITTING_REASONS),
  title: z.string().min(1).max(80),
  hostId: id,
  startsAt: iso,
  invites: z.array(id).default([]),
  recipeId: z.string().nullable().default(null),
  note: z.string().max(200).default(""),
  /** The moment kept afterwards: a card in Memory Lane. */
  keptCardId: z.string().nullable().default(null),
  /** RSVPs: who said they'll be there, and who can't make it. */
  going: z.array(id).default([]),
  cantMake: z.array(id).default([]),
  createdAt: iso,
});

/** "Come sit with me" — a knock on the courtyard door, not a meeting. */
export const KnockSchema = z.object({
  id,
  memberId: id,
  note: z.string().max(80).default(""),
  at: iso,
  until: iso,
});

// ---------- The weekly question (story keeper) ----------
export const QuestionSchema = z.object({
  id,
  toMemberId: id,
  text: z.string().min(4).max(200),
  /** Language the question is written in (the elder's own). */
  lang: z.string().default("en"),
  /** Optional: a grandchild asked this, Muse only phrased it. */
  askedBy: z.string().nullable().default(null),
  topic: z.enum(["story", "recipe", "wisdom", "blessing", "song", "place"]).default("story"),
  answeredCardId: z.string().nullable().default(null),
  madeBy: z.enum(["family", "muse"]).default("muse"),
  /** Advice & blessings category (data/advice-categories.json); null = classify from the text. */
  category: z.string().max(40).nullable().default(null),
  createdAt: iso,
});

export const WALLS = ["jodhpur", "jaipur", "chettinad", "goa", "kerala", "lime"] as const;

// ---------- The window (LITE): what each person sees of the other home ----------
export const WINDOW_LAYERS = ["steam", "rain", "leaves", "birds", "stars", "clouds", "lamp", "breeze"] as const;
/** What you stand at when Aangan opens: a window, a balcony, or inside the courtyard. */
export const FIRST_SCENES = ["window", "balcony", "courtyard"] as const;
/** Flower pots on the sill, along the railing, or by the courtyard wall (up to three). */
export const POTS = ["marigold", "rose", "jasmine", "geranium", "moneyplant", "succulent"] as const;
export const WindowViewSchema = z.object({
  /** One per viewer: the son chooses what his window shows, the parents theirs. */
  id,
  memberId: id,
  /** A family photo (card id) or a bundled demo image. Resolved server-side. */
  cardId: z.string().nullable().default(null),
  imageRef: z.string().max(300).nullable().default(null),
  /** "still" = the photo as is; "living" = Muse composed gentle motion over it. */
  style: z.enum(["still", "living"]).default("living"),
  layers: z.array(z.enum(WINDOW_LAYERS)).max(4).default([]),
  /** One quiet line Muse wrote from what really happened there today. */
  line: z.string().max(140).default(""),
  madeBy: z.enum(["family", "muse"]).default("family"),
  /** Safe & sound: how long someone may be quiet (in their daytime) before their dot turns amber. */
  quietAfterHours: z.number().int().min(2).max(12).default(4),
  /** Who's at your window: at most two people (default: the parents on the other side). */
  people: z.array(id).max(2).default([]),
  /** The colour of the wall around the window (SPEC §30.1). */
  wall: z.enum(WALLS).default("jodhpur"),
  /** The first screen: window (default), balcony or courtyard. */
  scene: z.enum(FIRST_SCENES).default("window"),
  /** Up to three flower pots, in the order chosen. */
  pots: z.array(z.enum(POTS)).max(3).default([]),
  /** A photo of their actual home (a media ref this family owns) as the view; null = the living album. */
  homePhoto: z.string().max(300).nullable().default(null),
  /** With a home photo: let family photos cross-fade in now and then. */
  mixAlbum: z.boolean().default(true),
  updatedAt: iso,
});

// ---------- The light in the window (SPEC §30.1, §30.4): one per home ----------
export const LampSchema = z.object({
  /** The household id (lib/households.ts). */
  id,
  litAt: iso.nullable().default(null),
  litBy: z.string().nullable().default(null),
  /** Hold the lamp: a slow heartbeat sent to this home, played on their next open. */
  beats: z.array(z.object({ from: id, at: iso })).max(20).default([]),
  /** Per member: the last heartbeat they've felt. */
  felt: z.record(z.string(), iso).default({}),
  updatedAt: iso,
});

// ---------- Partner connections (Send something): sealed tokens, one per member + account ----------
export const PartnerTokenSchema = z.object({
  id,
  memberId: id,
  account: z.string().min(1).max(40),
  /** AES-GCM sealed token set. Never returned to a client, never logged. */
  sealed: z.string().min(1).max(8000),
  connectedAt: iso,
});

// ---------- Chitthi: a voice note that arrives at their morning (SPEC §30.4) ----------
export const ChitthiSchema = z.object({
  /** The card id. Hidden from everyone but its author until deliverAt. */
  id,
  deliverAt: iso,
  authorId: id,
  createdAt: iso,
  /** "letter" = a written letter to the whole family (A letter from the courtyard): no card, the words are here. */
  kind: z.enum(["voice", "letter"]).default("voice"),
  title: z.string().max(60).optional(),
  body: z.string().max(900).optional(),
  lang: z.enum(["en", "hi"]).optional(),
});

// ---------- A spent one-time order preview (a preview places one order, on any Worker) ----------
export const PreviewUsedSchema = z.object({
  /** `preview-<nonce>`: the nonce sealed inside the preview id. */
  id,
  memberId: id,
  at: iso,
});

// ---------- A line about today: one short line on your own day, gone at your midnight ----------
export const DayLineSchema = z.object({
  /** The author's member id: one line per person, replaced when they write a new one. */
  id,
  memberId: id,
  text: z.string().trim().min(1).max(80),
  /** End of the author's local day; after this the line is no longer shown. */
  until: iso,
  createdAt: iso,
});

// ---------- Today: one shared task for both homes, done only when both answer ----------
export const TodayAnswerSchema = z.object({ memberId: id, cardId: z.string().min(1), at: iso });
export const TodayTaskSchema = z.object({
  id,
  /** YYYY-MM-DD in the parents' zone: their day is the family's day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  promptId: z.string().max(40),
  /** The prompt each side sees, already personal ("one thing you miss about Arjun"). */
  forParents: z.string().max(160),
  forChildren: z.string().max(160),
  /** The two homes this task joins (member ids). */
  parents: z.array(id).max(6),
  children: z.array(id).max(12),
  answers: z.array(TodayAnswerSchema).max(20).default([]),
  completedAt: iso.nullable().default(null),
  madeBy: z.enum(["family", "muse"]).default("muse"),
  createdAt: iso,
});

// ---------- Muse call log (what powered by Muse actually did) ----------
export const MuseCallSchema = z.object({
  id,
  purpose: z.string().max(120),
  model: z.string().max(80),
  cached: z.boolean().default(false),
  ok: z.boolean().default(true),
  ms: z.number().int().min(0).default(0),
  cost: z.number().min(0).default(0),
  at: iso,
});

// ---------- Muse Image renders (portraits, restored photos) ----------
/** One render, kept or not: the family's daily allowance counts these. */
export const MuseImageRunSchema = z.object({
  id,
  kind: z.enum(["portrait", "restore"]),
  by: id,
  /** Who is in a portrait (member ids). Empty for a restore. */
  people: z.array(id).max(10).default([]),
  style: z.string().max(20).default(""),
  /** A sample painted on the device because Muse was off (no model call). */
  sample: z.boolean().default(false),
  /** The card it became, once a person tapped Keep. */
  keptCardId: z.string().nullable().default(null),
  at: iso,
});

// ---------- Nudges: one gentle batch a day at the recipient's 8 AM, never a stream ----------
export const NUDGE_KINDS = ["heard", "blessed", "shared", "occasion", "call", "letter"] as const;
export const NudgeSchema = z.object({
  id,
  toMemberId: id,
  kind: z.enum(NUDGE_KINDS),
  /** Plain words, no counts. `{m:<memberId>}` is a person, resolved to the viewer's word for them at render. */
  text: z.string().min(1).max(120),
  href: z.string().max(200),
  at: iso,
  /** The recipient's next 8 AM local after `at`. */
  deliverAfter: iso,
  deliveredAt: iso.nullable().default(null),
  channel: z.enum(["email", "inapp"]).nullable().default(null),
  /** When the recipient opened the list (only they ever see it). */
  seenAt: iso.nullable().default(null),
});

/** Per member: id is the member id. Default (no doc): email on if they have one, up to 3 a week. */
export const NudgeSettingsSchema = z.object({
  id,
  email: z.boolean().default(true),
  maxPerWeek: z.number().int().min(0).max(3).default(3),
});

// ---------- The fixed weekly call: one per family, a named ritual ----------
/** "Sunday chai": the same hour every week, in the zone it was set in. */
export const WeeklyCallSchema = z.object({
  id: z.literal("weekly-call"),
  /** 0 = Sunday … 6 = Saturday, in `tz`. */
  weekday: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  /** IANA zone the weekday and time are meant in (the elders' home, usually). */
  tz: z.string().min(1).max(64),
  hostId: z.string().min(1),
  name: z.string().max(40).optional(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});

// ---------- Together habits: one shared habit, ticked daily, in words and never in scores ----------
export const HabitSchema = z.object({
  id,
  /** "Morning walk". Free text, 40 characters. */
  name: z.string().trim().min(1).max(40),
  /** Each person's own wall clock: 7 AM where they are. */
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59).default(0),
  createdBy: id,
  createdAt: iso,
  /** Who joined (member ids). */
  members: z.array(id).max(60).default([]),
  archivedAt: iso.nullable().default(null),
});

/** One person's tick for one of their local days. id = "<habitId>:<memberId>:<YYYY-MM-DD>", so a double tap is one row. */
export const HabitTickSchema = z.object({
  id: z.string().min(1).max(200),
  habitId: id,
  memberId: id,
  /** The ticker's local day (their own zone), YYYY-MM-DD. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  at: iso,
});

// ---------- Children (kid mode, bedtime stories, "Ask Dadi", height marks) ----------
/**
 * A grandparent's (or parent's) bedtime story for one child. `cardId` is the voice
 * card; a row with `cardId: null` is only that person saying "not now" for the day
 * (one prompt a day), and is never shown to the child.
 */
export const BedtimeStorySchema = z.object({
  id,
  forMemberId: id,
  byMemberId: id,
  cardId: z.string().min(1).max(80).nullable().default(null),
  at: iso,
  title: z.string().max(80).default(""),
});

/** A child's question or request ("another story"), for a grandparent to answer by voice. */
export const KidAskSchema = z.object({
  id,
  fromMemberId: id,
  /** Who it is for; null = any of the child's grandparents or parents. */
  toMemberId: z.string().nullable().default(null),
  /** The question as a voice note (a card), if spoken. */
  cardId: z.string().nullable().default(null),
  text: z.string().max(200).default(""),
  askedAt: iso,
  answeredCardId: z.string().nullable().default(null),
  answeredAt: iso.nullable().default(null),
  topic: z.enum(["question", "story"]).default("question"),
});

/** One mark on the doorframe. Just a number and a date: nothing is compared or judged. */
export const HeightMarkSchema = z.object({
  id,
  memberId: id,
  cm: z.number().min(30).max(220),
  at: iso,
  byMemberId: id,
  note: z.string().max(60).default(""),
});

export type BedtimeStory = z.infer<typeof BedtimeStorySchema>;
export type KidAsk = z.infer<typeof KidAskSchema>;
export type HeightMark = z.infer<typeof HeightMarkSchema>;

export const DOC_SCHEMAS = {
  recipe: RecipeSchema,
  attempt: AttemptSchema,
  presence: PresenceSchema,
  care_settings: CareSettingsSchema,
  need: NeedSchema,
  helper: HelperSchema,
  rota: RotaSchema,
  duty: DutySchema,
  pet: PetSchema,
  story: StorySchema,
  album: AlbumSchema,
  place: PlaceSchema,
  project: ProjectSchema,
  game: GameSchema,
  safety_settings: SafetySettingsSchema,
  safety_checkin: SafetyCheckinSchema,
  sitting: SittingSchema,
  knock: KnockSchema,
  question: QuestionSchema,
  muse_call: MuseCallSchema,
  window_view: WindowViewSchema,
  today_task: TodayTaskSchema,
  lamp: LampSchema,
  chitthi: ChitthiSchema,
  partner_token: PartnerTokenSchema,
  day_line: DayLineSchema,
  preview_used: PreviewUsedSchema,
  weekly_call: WeeklyCallSchema,
  muse_image_run: MuseImageRunSchema,
  nudge: NudgeSchema,
  nudge_settings: NudgeSettingsSchema,
  habit: HabitSchema,
  habit_tick: HabitTickSchema,
  bedtime_story: BedtimeStorySchema,
  kid_ask: KidAskSchema,
  height_mark: HeightMarkSchema,
} as const;

export type DocKind = keyof typeof DOC_SCHEMAS;
export type DocOf<K extends DocKind> = z.infer<(typeof DOC_SCHEMAS)[K]>;

export type Habit = DocOf<"habit">;
export type HabitTick = DocOf<"habit_tick">;
export type Recipe = DocOf<"recipe">;
export type Attempt = DocOf<"attempt">;
export type Presence = DocOf<"presence">;
export type PresenceMoment = z.infer<typeof PresenceMomentSchema>;
export type CareSettings = DocOf<"care_settings">;
export type Need = DocOf<"need">;
export type Helper = DocOf<"helper">;
export type Rota = DocOf<"rota">;
export type Duty = DocOf<"duty">;
export type Pet = DocOf<"pet">;
export type Story = DocOf<"story">;
export type Album = DocOf<"album">;
export type Place = DocOf<"place">;
export type Project = DocOf<"project">;
export type Game = DocOf<"game">;
export type GameState = z.infer<typeof GameStateSchema>;
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;
export type QuizItem = z.infer<typeof QuizItemSchema>;
export type SafetySettings = DocOf<"safety_settings">;
export type SafetyCheckin = DocOf<"safety_checkin">;
export type Sitting = DocOf<"sitting">;
export type Knock = DocOf<"knock">;
export type Question = DocOf<"question">;
export type MuseCall = DocOf<"muse_call">;
export type WindowView = DocOf<"window_view">;
export type Lamp = DocOf<"lamp">;
export type Chitthi = DocOf<"chitthi">;
export type DayLine = DocOf<"day_line">;
export type WeeklyCall = DocOf<"weekly_call">;
export type MuseImageRun = DocOf<"muse_image_run">;
export type Nudge = DocOf<"nudge">;
export type NudgeKind = (typeof NUDGE_KINDS)[number];
export type NudgeSettings = DocOf<"nudge_settings">;
export type Wall = (typeof WALLS)[number];
export type WindowLayer = (typeof WINDOW_LAYERS)[number];
export type FirstScene = (typeof FIRST_SCENES)[number];
export type Pot = (typeof POTS)[number];
export type TodayTask = DocOf<"today_task">;
