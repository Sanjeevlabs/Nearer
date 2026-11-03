import { z } from "zod";
import { EVENT_KINDS, LISTEN_WAYS } from "./kind-values";
import { ADDRESSED_TO_MAX, CARD_NOTE_MAX, CARD_PLACE_MAX } from "./card-limits";
import { LANG_CODES } from "./languages";
import { BIRTHDAY_RE, validBirthday } from "./birthday";

/** A birthday a person typed: "MM-DD" or "YYYY-MM-DD" (1900 to today, never the future), or "" to clear it. */
export const BirthdayInput = z.string().regex(BIRTHDAY_RE).refine((v) => validBirthday(v), "invalid-birthday");

// Caption may only reference tagged members (enforced in lib/grounding.ts).
export const CaptionSchema = z.object({
  caption: z.string().min(10).max(280),
  language: z.string().min(2).max(8),
  names: z.array(z.string()).default([]),
  takenAt: z.string().datetime().nullable(),
  /** What kind of moment this is, from what's visible (sorts it into an album). */
  event: z.enum(EVENT_KINDS).catch("everyday").default("everyday"),
});

export const TranscriptSchema = z.object({
  transcript: z.string().min(1),
  summary: z.string().min(5).max(500),
  language: z.string().min(2).max(8),
});

export const TranscriptSegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().min(1),
});

export const VoiceTranscriptSchema = TranscriptSchema.extend({
  segments: z.array(TranscriptSegmentSchema).default([]),
});

export const TranslationSchema = z.object({
  text: z.string().min(1),
  language: z.string().min(2).max(8),
});

export const PlaySchema = z.object({
  id: z.string(),
  familyId: z.string(),
  cardId: z.string(),
  memberId: z.string(),
  playedAt: z.string().datetime(),
});

export const ReactionKindSchema = z.enum(["love", "laugh", "bless"]);

export const ReactionSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  cardId: z.string(),
  memberId: z.string(),
  kind: ReactionKindSchema,
  createdAt: z.string().datetime(),
});

export const CreatePlayRequestSchema = z.object({
  cardId: z.string().min(1),
  memberId: z.string().min(1),
});

export const CreateReactionRequestSchema = z.object({
  cardId: z.string().min(1),
  memberId: z.string().min(1),
  kind: ReactionKindSchema,
});

export const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  targetLang: z.string().min(2).max(8),
});

// Transcription arrives as multipart bytes (see /api/transcribe); there is
// no JSON transcription contract by design — no audio id can stand in for
// the recording.

export const RitualStepSchema = z.object({
  key: z.string(),
  kind: z.enum(["photo", "audio", "video", "text"]),
  prompt: z.string(),
  cardTemplate: z.string(),
});

export const RitualConfigSchema = z.object({
  slug: z.string(),
  title: z.string(),
  cultureNotes: z.string(),
  steps: z.array(RitualStepSchema).min(1),
});

/** muse-portrait / muse-restored: made by Muse Image from the family's own photos, always labelled. */
export const CardSourceSchema = z.enum(["upload", "today", "glasses", "ritual", "agent", "muse-portrait", "muse-restored"]);

export const CardSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  type: z.enum(["photo", "audio", "video"]),
  caption: z.string(),
  summary: z.string().default(""),
  lang: z.string(),
  takenAt: z.string().datetime(),
  ritualSlug: z.string().nullable().default(null),
  source: CardSourceSchema.default("upload"),
  mediaRef: z.string().nullable().default(null),
  peaks: z.array(z.number().min(0).max(1)).default([]),
  palette: z.array(z.string()).default([]),
  transcript: z.string().default(""),
  transcriptLang: z.string().default("en"),
  segments: z.array(TranscriptSegmentSchema).default([]),
  /** Member who shared it. Null for legacy rows. */
  authorId: z.string().nullable().default(null),
  /** Optional album art for a voice note (a photo ref). */
  coverRef: z.string().nullable().default(null),
  /** Who a voice note was spoken to: member ids, comma-joined (one person, a home, or a mix). Null = the whole family. */
  addressedTo: z.string().max(ADDRESSED_TO_MAX).nullable().default(null),
  /** Where it was taken, as the sharer wrote it ("Amritsar"). Optional. */
  place: z.string().max(CARD_PLACE_MAX).default(""),
  /** A short handwritten-style note under the print. Optional; falls back to the caption. */
  note: z.string().max(CARD_NOTE_MAX).default(""),
  /** A kid this belongs to on the fridge, set when a grown-up photographs their drawing for them (member id). Null otherwise. */
  forMemberId: z.string().nullable().optional(),
  /** "How to listen", added by GET /api/cards only for the card's addressees (never stored on the card). */
  listen: z.enum(LISTEN_WAYS).optional(),
});

export const MemberRoleSchema = z.enum(["elder", "adult", "child"]);

/**
 * What a person may do in the family (separate from their generation), see
 * lib/permissions.ts: owner (exactly one, the creator) > admin (up to 3 with
 * the owner) > member; teen (13-17) shares, voices, wishes and tells stories;
 * child (0-12) is a profile only. Elder mode is a setting, not a role.
 */
export const AccessSchema = z.enum(["owner", "admin", "member", "teen", "child"]);

/** Joiners wait ("pending") until an owner/admin lets them in. */
export const MemberStatusSchema = z.enum(["active", "pending"]);

export const DisplayLangSchema = z.enum(LANG_CODES);

export const MemberSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  firstName: z.string(),
  displayName: z.string(),
  role: MemberRoleSchema,
  lang: z.string().default("en"),
  displayLang: DisplayLangSchema.default("en"),
  tz: z.string().default("UTC"),
  /** The city they live in, as they'd say it ("Amritsar"). Shown on the window; never tracked. */
  city: z.string().max(60).default(""),
  /** "YYYY-MM-DD" when the year is known, "MM-DD" when it is not, "" when nobody has added it yet (no fake dates). See lib/birthday.ts. */
  birthday: z.string().regex(BIRTHDAY_RE).default(""),
  homeImageRef: z.string().nullable().default(null),
  homePalette: z.array(z.string()).default([]),
  /** Portrait used for the person's album. */
  photoRef: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  access: AccessSchema.default("member"),
  status: MemberStatusSchema.default("active"),
  /**
   * The same person in another family's space (a married couple and their
   * children belong to both sides). Set by the server only, never by a client.
   */
  personId: z.string().max(64).nullable().default(null),
});

export const DisplayLangRequestSchema = z.object({
  memberId: z.string().min(1),
  displayLang: DisplayLangSchema,
});

export const CreateCardRequestSchema = z.object({
  /** Client-made UUID: a retry after a lost response returns the existing card. */
  id: z.string().uuid().optional(),
  type: z.enum(["photo", "audio", "video"]),
  caption: z.string().max(280).default(""),
  lang: z.string().min(2).max(8).default("en"),
  takenAt: z.string().datetime(),
  // Muse-made sources are set only by /api/muse/keep, from a real render.
  source: CardSourceSchema.exclude(["muse-portrait", "muse-restored"]).default("upload"),
  mediaRef: z.string().nullable().default(null),
  peaks: z.array(z.number().min(0).max(1)).max(128).default([]),
  palette: z.array(z.string()).max(5).default([]),
  transcript: z.string().max(2000).default(""),
  transcriptLang: z.string().min(2).max(8).default("en"),
  segments: z.array(TranscriptSegmentSchema).max(64).default([]),
  /** Comma-joined member ids (a whole family of any size); null = everyone. */
  addressedTo: z.string().max(ADDRESSED_TO_MAX).nullable().default(null),
  place: z.string().trim().max(CARD_PLACE_MAX).default(""),
  note: z.string().trim().max(CARD_NOTE_MAX).default(""),
  /** "Add to the fridge": the kid it is for. The route checks they are a kid of this family. */
  forMemberId: z.string().max(64).nullable().default(null),
  /** "How to listen": only with addressees; kept apart from the card (family_docs card_listen). */
  listen: z.enum(LISTEN_WAYS).optional(),
  replyToCardId: z.string().min(1).max(100).optional(),
});

export const HomeImageRequestSchema = z.object({
  memberId: z.string(),
  mediaRef: z.string(),
  palette: z.array(z.string()).max(5).default([]),
});

// Guided Bond adds: relation is the word the family picked (mother, father,
// sister…); canonicalKind drives the BFS resolver. Never a festival/culture.
export const RelationKindSchema = z.enum(["parent", "child", "spouse", "sibling"]);

export const RelationshipSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  memberId: z.string(),
  relationMemberId: z.string(),
  relation: z.string().min(1).max(40),
  canonicalKind: RelationKindSchema,
});

export const TimeZoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "unknown-time-zone");

export const CreateRelationshipRequestSchema = z.object({
  memberId: z.string().min(1),
  newMemberName: z.string().trim().min(1).max(40),
  /** Omitted → inferred from the relation (a parent of an adult is an elder). */
  newMemberRole: MemberRoleSchema.optional(),
  relation: z.string().min(1).max(40),
  tz: TimeZoneSchema.optional(),
  birthday: BirthdayInput.refine((v) => v !== "").optional(),
});

/** Edit a person in the tree (name, role, where they live, birthday). */
export const UpdateMemberRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  role: MemberRoleSchema.optional(),
  tz: TimeZoneSchema.optional(),
  birthday: BirthdayInput.optional(),
  /** Admin only. */
  access: AccessSchema.optional(),
});

export type Caption = z.infer<typeof CaptionSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type VoiceTranscript = z.infer<typeof VoiceTranscriptSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type Translation = z.infer<typeof TranslationSchema>;
export type Play = z.infer<typeof PlaySchema>;
export type Reaction = z.infer<typeof ReactionSchema>;
export type ReactionKind = z.infer<typeof ReactionKindSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type RelationKind = z.infer<typeof RelationKindSchema>;

// Agents write suggestions; actions execute ONLY on approval.
export const SuggestionStatusSchema = z.enum(["pending", "approved", "rejected", "done"]);

export const SuggestionSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  goal: z.string(),
  payload: z.record(z.unknown()).default({}),
  status: SuggestionStatusSchema.default("pending"),
  createdAt: z.string().datetime(),
});

export const CreateSuggestionRequestSchema = z.object({
  goal: z.string().min(1).max(500),
  payload: z.record(z.unknown()).default({}),
});

export const AgentRunSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  goal: z.string(),
  tools: z.array(z.string()).default([]),
  status: z.string().default("done"),
  createdAt: z.string().datetime(),
});

// Wishes AND blessings (kind: wish|blessing).
export const WishKindSchema = z.enum(["wish", "blessing"]);

export const WishSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  ritualRunId: z.string().nullable().default(null),
  cardId: z.string().nullable().default(null),
  memberId: z.string(),
  kind: WishKindSchema,
  createdAt: z.string().datetime(),
});

export const CreateWishRequestSchema = z.object({
  ritualRunId: z.string().nullable().default(null),
  cardId: z.string().nullable().default(null),
  memberId: z.string().min(1),
  kind: WishKindSchema,
});

export const RitualRunSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  ritualSlug: z.string(),
  occasionDate: z.string(),
  status: z.enum(["open", "collecting", "delivered", "done"]).default("open"),
  createdAt: z.string().datetime(),
});

export const DailyRoleSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  memberId: z.string(),
  roleDate: z.string(),
  prompt: z.string(),
});

export const GatherSessionSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  title: z.string().default(""),
  startsAt: z.string(),
  invites: z.array(z.string()).default([]),
  playlist: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type Wish = z.infer<typeof WishSchema>;
export type RitualRun = z.infer<typeof RitualRunSchema>;
export type DailyRole = z.infer<typeof DailyRoleSchema>;
export type GatherSession = z.infer<typeof GatherSessionSchema>;
export type DisplayLang = z.infer<typeof DisplayLangSchema>;
export type Access = z.infer<typeof AccessSchema>;
export type MemberStatus = z.infer<typeof MemberStatusSchema>;

/** A recorded consent, e.g. a parent letting their teen have an account. */
export const ConsentSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  memberId: z.string(),
  parentMemberId: z.string().nullable(),
  kind: z.enum(["teen-account"]),
  method: z.enum(["parent-session-code"]),
  createdAt: z.string(),
});
export type Consent = z.infer<typeof ConsentSchema>;
export type RitualConfig = z.infer<typeof RitualConfigSchema>;
export type Card = z.infer<typeof CardSchema>;
export type CardSource = z.infer<typeof CardSourceSchema>;
export type Member = z.infer<typeof MemberSchema>;
