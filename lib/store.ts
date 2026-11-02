import { weekStartOf } from "./week";
import { seedDemoRooms } from "./demo-rooms";
import { resetDocs } from "./family-docs";
import type { z } from "zod";
import { DEMO_IYER_MEMBERS, DEMO_MEMBERS } from "./family";
import {
  AgentRunSchema,
  CardSchema,
  DailyRoleSchema,
  GatherSessionSchema,
  MemberSchema,
  PlaySchema,
  ReactionSchema,
  RelationshipSchema,
  RitualRunSchema,
  SuggestionSchema,
  WishSchema,
  type AgentRun,
  type Consent,
  type Card,
  type DailyRole,
  type GatherSession,
  type Member,
  type Play,
  type Reaction,
  type ReactionKind,
  type Relationship,
  type RitualRun,
  type Suggestion,
  type Wish,
} from "./schemas";

// Demo backing store. Supabase replaces this when the project is confirmed;
// the function shapes stay the same. Accepts schema *input* so Zod defaults
// apply at the boundary.
let cards: Card[] = [];
let members: Member[] = [];
let plays: Play[] = [];
let reactions: Reaction[] = [];
let relationships: Relationship[] = [];
const kinshipCache = new Map<string, string>();
let suggestions: Suggestion[] = [];
let agentRuns: AgentRun[] = [];
let wishes: Wish[] = [];
let ritualRuns: RitualRun[] = [];
let dailyRoles: DailyRole[] = [];
let gatherSessions: GatherSession[] = [];

export function listCards(): Card[] {
  return [...cards].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export function addCard(input: z.input<typeof CardSchema>): Card {
  const card = CardSchema.parse(input);
  cards = cards.filter((c) => c.id !== card.id);
  cards.push(card);
  return card;
}

export function clearCards(): void {
  cards = [];
}

export function listPlays(cardId?: string): Play[] {
  const all = [...plays].sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  return cardId ? all.filter((p) => p.cardId === cardId) : all;
}

export function addPlay(input: z.input<typeof PlaySchema>): Play {
  const play = PlaySchema.parse(input);
  plays = plays.filter((p) => p.id !== play.id);
  plays.push(play);
  return play;
}

export function clearPlays(): void {
  plays = [];
}

export function listReactions(cardId?: string): Reaction[] {
  const all = [...reactions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return cardId ? all.filter((r) => r.cardId === cardId) : all;
}

// One per member per card: a second reaction from the same member replaces
// the first — never a count, only the latest kind.
export function setReaction(input: z.input<typeof ReactionSchema>): Reaction {
  const reaction = ReactionSchema.parse(input);
  reactions = reactions.filter((r) => !(r.cardId === reaction.cardId && r.memberId === reaction.memberId));
  reactions.push(reaction);
  return reaction;
}

export function clearReactions(): void {
  reactions = [];
}

export function reactionKinds(): ReactionKind[] {
  return ["love", "laugh", "bless"];
}

export function listMembers(): Member[] {
  return [...members];
}

// Mock-only append for guided Bond adds (live path writes to Supabase).
export function mockAddMember(input: z.input<typeof MemberSchema>): Member {
  const member = MemberSchema.parse(input);
  members = members.filter((m) => m.id !== member.id);
  members.push(member);
  return member;
}

export function getMember(id: string): Member | undefined {
  return members.find((m) => m.id === id);
}

export function setMemberHome(
  memberId: string,
  homeImageRef: string,
  homePalette: string[],
): Member | undefined {
  const member = members.find((m) => m.id === memberId);
  if (!member) return undefined;
  member.homeImageRef = homeImageRef;
  member.homePalette = homePalette;
  return { ...member };
}

export function setMemberDisplayLang(memberId: string, displayLang: Member["displayLang"]): Member | undefined {
  const member = members.find((m) => m.id === memberId);
  if (!member) return undefined;
  member.displayLang = displayLang;
  member.lang = displayLang.split("-")[0];
  return { ...member };
}

const familyNames = new Map<string, string>([
  ["demo-family", "Sharma"],
  ["demo-iyer", "Iyer"],
]);

export function createFamily(id: string, name: string): void {
  familyNames.set(id, name);
}

export function familyName(id: string): string | undefined {
  return familyNames.get(id);
}


/** Every family space this person belongs to (one row per family), by personId. */
export function findMembersByPerson(personId: string): Member[] {
  return members.filter((m) => m.personId === personId).map((m) => ({ ...m }));
}

export function findMemberByEmail(email: string): Member | undefined {
  const e = email.trim().toLowerCase();
  const found = members.find((m) => (m.email ?? "").toLowerCase() === e);
  return found ? { ...found } : undefined;
}

export interface MemberPatch {
  firstName?: string;
  displayName?: string;
  role?: Member["role"];
  access?: Member["access"];
  status?: Member["status"];
  tz?: string;
  city?: string;
  birthday?: string;
  photoRef?: string | null;
  email?: string | null;
  personId?: string | null;
}

export function updateMemberProfile(memberId: string, patch: MemberPatch): Member | undefined {
  const member = members.find((m) => m.id === memberId);
  if (!member) return undefined;
  if (patch.displayName !== undefined) member.displayName = patch.displayName;
  if (patch.role !== undefined) member.role = patch.role;
  if (patch.access !== undefined) member.access = patch.access;
  if (patch.status !== undefined) member.status = patch.status;
  if (patch.birthday !== undefined) member.birthday = patch.birthday;
  if (patch.email !== undefined) member.email = patch.email;
  if (patch.firstName !== undefined) member.firstName = patch.firstName;
  if (patch.tz !== undefined) member.tz = patch.tz;
  if (patch.city !== undefined) member.city = patch.city;
  if (patch.photoRef !== undefined) member.photoRef = patch.photoRef;
  if (patch.personId !== undefined) member.personId = patch.personId;
  return { ...member };
}

export function seedDemo(): void {
  seedDemoRooms();
  clearCards();
  // ---- Occasions (Celebrations → Occasions). Synthetic: invented moments, demo photos reused. ----
  const photo = (id: string, authorId: string | null, takenAt: string, mediaRef: string, caption: string, extra: Partial<z.input<typeof CardSchema>> = {}) =>
    addCard({ id, familyId: "demo-family", type: "photo", caption, lang: "en", takenAt, mediaRef, authorId, source: "upload", ...extra });
  const voice = (id: string, authorId: string | null, takenAt: string, caption: string, transcript: string, extra: Partial<z.input<typeof CardSchema>> = {}) =>
    addCard({ id, familyId: "demo-family", type: "audio", caption, lang: "en", takenAt, authorId, source: "ritual", transcript, transcriptLang: "en", segments: [{ start: 0, end: 6, text: transcript }], ...extra });
  // Diwali last year, every home's lamps.
  photo("demo-diya-1", null, "2025-10-20T13:30:00.000Z", "/demo/lamp-lit.jpg", "Diyas lit together, miles apart.", { summary: "Ritual card from the Festival of Lights guide.", ritualSlug: "diwali", mediaRef: null });
  photo("demo-diwali-rangoli", "dadi", "2025-10-20T11:00:00.000Z", "/demo/venues/courtyard.jpg", "Rangoli at the door before the first lamp.", { ritualSlug: "diwali", place: "Amritsar" });
  photo("demo-diwali-sparklers", "priya", "2025-10-20T15:10:00.000Z", "/demo/family-leo.webp", "Vihaan's first sparkler, held very far away.", { ritualSlug: "diwali", place: "Bengaluru" });
  photo("demo-diwali-2024-lamps", "arjun", "2024-11-01T14:20:00.000Z", "/demo/family-group.webp", "Every balcony lit, a year earlier.", { ritualSlug: "diwali", place: "Bengaluru" });
  // Arjun's birthday: the family sang, and every home sent a wish.
  voice("demo-bday-1", null, "2026-07-30T12:00:00.000Z", "परिवार ने मिलकर जन्मदिन का गीत गाया।", "", { summary: "Birthday ritual voice note.", lang: "hi", ritualSlug: "birthday", segments: [] });
  voice("demo-wish-dadi-arjun", "dadi", "2026-07-30T01:00:00.000Z", "Jeete raho, beta.", "Jeete raho, beta. On this day you arrived in the rain, and you have been bringing good news ever since.", { coverRef: "/demo/family-dadi.webp" });
  voice("demo-wish-dada-arjun", "dada", "2026-07-30T01:20:00.000Z", "Happy birthday from your Papa.", "Happy birthday, Arjun. Take the day off from worrying about us. We are fine, and we are proud.", { coverRef: null });
  voice("demo-wish-aria-arjun", "aria", "2026-07-30T02:30:00.000Z", "Happy birthday Papa!", "Happy birthday Papa! I made you a card, it's under your pillow. Don't look yet!", { coverRef: "/demo/portrait-aria.webp" });
  photo("demo-wish-priya-arjun", "priya", "2026-07-29T18:40:00.000Z", "/demo/portrait-dad.webp", "Cake at midnight, as promised.", { place: "Bengaluru" });
  addRitualRun({ id: "birthday:2026-07-30", familyId: "demo-family", ritualSlug: "birthday", occasionDate: "2026-07-30", status: "done", createdAt: "2026-07-20T00:00:00.000Z" });
  for (const [member, cardId, kind] of [
    ["dadi", "demo-wish-dadi-arjun", "blessing"],
    ["dada", "demo-wish-dada-arjun", "blessing"],
    ["aria", "demo-wish-aria-arjun", "wish"],
    ["priya", "demo-wish-priya-arjun", "wish"],
  ] as const)
    addWish({ id: `wish-${cardId}`, familyId: "demo-family", ritualRunId: "birthday:2026-07-30", cardId, memberId: member, kind, createdAt: "2026-07-30T03:00:00.000Z" });
  // A cousin's wedding in Jaipur (the album is seeded in demo-rooms).
  photo("demo-wed-mandap", "arjun", "2025-12-06T12:30:00.000Z", "/demo/family-group.webp", "Everyone at the mandap, nobody looking at the camera.", { place: "Jaipur", note: "Cousin Meera's wedding." });
  photo("demo-wed-silk", "priya", "2025-12-06T09:10:00.000Z", "/demo/family-dadi.webp", "Maa in the silk she wore at her own wedding.", { place: "Jaipur" });
  photo("demo-wed-mehendi", "priya", "2025-12-05T14:00:00.000Z", "/demo/portrait-aria.webp", "Anika's first mehendi, drying in the sun.", { place: "Jaipur" });
  photo("demo-wed-baraat", "arjun", "2025-12-06T15:45:00.000Z", "/demo/portrait-dad.webp", "Dancing in the baraat till the band gave up.", { place: "Jaipur" });

  // The kids' side of the house: what Vihaan and Anika shared lately (lib/demo-rooms.ts seeds their asks and bedtime story).
  const mins = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  photo("demo-kid-leo-drawing", "leo", mins(5 * 60), "/demo/drawing-leo.webp", "My house, with the sun and all of us.", { place: "Bengaluru", note: "I drew this for Maa." });
  photo("demo-kid-leo-top", "leo", mins(26 * 60), "/demo/family-leo.webp", "My top spun for a whole minute.", { place: "Bengaluru" });
  voice("demo-kid-aria-whistle", "aria", mins(9 * 60), "I can whistle now!", "Maa, I can whistle now! Listen. Fweeeet. Papa says it sounds like a kettle.", { source: "upload", coverRef: "/demo/portrait-aria.webp", addressedTo: "dadi" });
  voice("demo-kid-leo-ask", "leo", mins(3 * 60), "A question for Maa", "Maa, how did you and Papa meet?", { source: "upload", coverRef: "/demo/portrait-leo.webp", addressedTo: "dadi" });
  voice("demo-bedtime-dadi-aria", "dadi", mins(20 * 60), "The little elephant and the moon", "Once there was a little elephant who wanted to touch the moon. Every night she walked a little further, and every night the moon stayed just out of reach. Then one evening she stopped at the river, and there was the moon, sleeping in the water. She put in her trunk, very gently, and the moon wobbled and smiled. Goodnight, little one.", { source: "upload", coverRef: "/demo/family-dadi.webp", addressedTo: "aria" });

  // A few real-looking listens so a parent's "your gifts this week" isn't empty
  // in the demo: each is someone hearing something Maa or Papa gave.
  const h = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  for (const [id, cardId, memberId, at] of [
    ["play-priya-elephant", "demo-story-elephant", "priya", h(14)],
    ["play-arjun-advice", "demo-dadi-advice-1", "arjun", h(30)],
    ["play-arjun-blessing", "demo-dada-bless-1", "arjun", h(50)],
    ["play-priya-morning", "demo-from-dadi-1", "priya", h(3)],
  ] as const)
    addPlay({ id, familyId: "demo-family", cardId, memberId, playedAt: at });

  // This week's letter from the courtyard, waiting for a grown-up (invented; only the family's names).
  addSuggestion({
    id: "demo-weekly-letter",
    familyId: "demo-family",
    createdAt: new Date().toISOString(),
    goal: "Send this week's letter?",
    payload: {
      action: "weekly_letter",
      title: "A letter from the courtyard",
      body: "Dear family,\n\nMaa's voice note about the rain reached you all, and Priya and Arjun both stopped to listen. Papa told Vihaan and Anika a story, and Kavya and Rohan asked for it again.\n\nThe lamp was lit and the courtyard was full of you, even from far away.\n\nWith love, from all of us at home.",
      lang: "en",
      weekStart: weekStartOf(),
      factCount: 8,
    },
  });
}

export function resetDemo(): void {
  members = [...DEMO_MEMBERS, ...DEMO_IYER_MEMBERS].map((m) => MemberSchema.parse(m));
  clearPlays();
  clearReactions();
  clearRelationships();
  kinshipCache.clear();
  suggestions = [];
  agentRuns = [];
  wishes = [];
  ritualRuns = [];
  dailyRoles = [];
  gatherSessions = [];
  clearInvites();
  consents = [];
  clearMovableCache();
  resetDocs();
  seedDemo();
}

// Agent proposals: actions execute ONLY on approval via Review / Approve.
export function listSuggestions(status?: Suggestion["status"]): Suggestion[] {
  const all = [...suggestions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return status ? all.filter((s) => s.status === status) : all;
}

export function addSuggestion(input: z.input<typeof SuggestionSchema>): Suggestion {
  const s = SuggestionSchema.parse(input);
  suggestions = suggestions.filter((x) => x.id !== s.id);
  suggestions.push(s);
  return s;
}

export function setSuggestionStatus(id: string, status: Suggestion["status"]): Suggestion | undefined {
  const s = suggestions.find((x) => x.id === id);
  if (!s) return undefined;
  s.status = status;
  return { ...s };
}

export function listAgentRuns(): AgentRun[] {
  return [...agentRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addAgentRun(input: z.input<typeof AgentRunSchema>): AgentRun {
  const r = AgentRunSchema.parse(input);
  agentRuns.push(r);
  return r;
}

export function listWishes(runId?: string): Wish[] {
  const all = [...wishes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return runId ? all.filter((w) => w.ritualRunId === runId) : all;
}

export function addWish(input: z.input<typeof WishSchema>): Wish {
  const w = WishSchema.parse(input);
  wishes = wishes.filter((x) => x.id !== w.id);
  wishes.push(w);
  return w;
}

export function listRitualRuns(): RitualRun[] {
  return [...ritualRuns].sort((a, b) => a.occasionDate.localeCompare(b.occasionDate));
}

export function addRitualRun(input: z.input<typeof RitualRunSchema>): RitualRun {
  const r = RitualRunSchema.parse(input);
  ritualRuns = ritualRuns.filter((x) => x.id !== r.id);
  ritualRuns.push(r);
  return r;
}

export function setRitualRunStatus(id: string, status: RitualRun["status"]): RitualRun | undefined {
  const r = ritualRuns.find((x) => x.id === id);
  if (!r) return undefined;
  r.status = status;
  return { ...r };
}

export function dailyRoleOn(memberId: string, roleDate: string): DailyRole | undefined {
  return dailyRoles.find((d) => d.memberId === memberId && d.roleDate === roleDate);
}

export function listDailyRoles(): DailyRole[] {
  return [...dailyRoles];
}

export function assignDailyRole(input: z.input<typeof DailyRoleSchema>): DailyRole {
  const existing = dailyRoleOn(input.memberId, input.roleDate);
  if (existing) return existing;
  const d = DailyRoleSchema.parse(input);
  dailyRoles.push(d);
  return d;
}

export function listGatherSessions(): GatherSession[] {
  return [...gatherSessions].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

// Privacy set: full deletes, no tombstones. Cards belong to the shared
// family pool (no per-card owner in the schema) and are kept; everything
// attributable to the member — wishes, reactions, plays, daily roles — is
// fully deleted.
export function deleteMemberTraces(memberId: string): { wishes: number; reactions: number; plays: number; roles: number } {
  const count = {
    wishes: wishes.filter((w) => w.memberId === memberId).length,
    reactions: reactions.filter((r) => r.memberId === memberId).length,
    plays: plays.filter((p) => p.memberId === memberId).length,
    roles: dailyRoles.filter((d) => d.memberId === memberId).length,
  };
  wishes = wishes.filter((w) => w.memberId !== memberId);
  reactions = reactions.filter((r) => r.memberId !== memberId);
  plays = plays.filter((p) => p.memberId !== memberId);
  dailyRoles = dailyRoles.filter((d) => d.memberId !== memberId);
  return count;
}

export function removeMemberCompletely(memberId: string): boolean {
  const exists = members.some((m) => m.id === memberId);
  if (!exists) return false;
  members = members.filter((m) => m.id !== memberId);
  consents = consents.filter((c) => c.memberId !== memberId);
  relationships = relationships.filter((r) => r.memberId !== memberId && r.relationMemberId !== memberId);
  plays = plays.filter((p) => p.memberId !== memberId);
  reactions = reactions.filter((r) => r.memberId !== memberId);
  wishes = wishes.filter((w) => w.memberId !== memberId);
  dailyRoles = dailyRoles.filter((d) => d.memberId !== memberId);
  return true;
}

export interface Invite {
  id: string;
  code: string;
  familyId: string;
  expiresAt: string;
  /** Who made the code: an owner/admin's invite lets people straight in. */
  createdBy: string | null;
}

let invites: Invite[] = [];

export function listInvites(): Invite[] {
  return [...invites];
}

export function createInvite(code: string, expiresAt: string, familyId = "demo-family", createdBy: string | null = null): Invite {
  const invite: Invite = { id: crypto.randomUUID(), code, familyId, expiresAt, createdBy };
  invites.push(invite);
  return invite;
}

export function clearInvites(): void {
  invites = [];
}

// Consents (a parent letting their teen have an account). Mirrors the
// consents table in supabase/schema.sql.
let consents: Consent[] = [];

export function addConsent(c: Consent): Consent {
  consents.push(c);
  return c;
}

export function listConsents(familyId: string): Consent[] {
  return consents.filter((c) => c.familyId === familyId);
}

// Movable-date persistent cache: (slug, year) -> grounded ISO date + sources.
// Backed by the ritual_configs row live; memory here for mock/tests.
const movableCache = new Map<string, { date: string; sources: string[] }>();

export function getMovableCache(slug: string, year: number): { date: string; sources: string[] } | undefined {
  return movableCache.get(`${slug}:${year}`);
}

export function setMovableCache(slug: string, year: number, date: string, sources: string[]): void {
  movableCache.set(`${slug}:${year}`, { date, sources });
}

export function clearMovableCache(): void {
  movableCache.clear();
}

export function addGatherSession(input: z.input<typeof GatherSessionSchema>): GatherSession {
  const g = GatherSessionSchema.parse(input);
  gatherSessions = gatherSessions.filter((x) => x.id !== g.id);
  gatherSessions.push(g);
  return g;
}

// Guided Family Bond edges + the viewer-relative kinship cache
// (path + display_lang -> terms). The model runs only on a cache miss.
export function listRelationships(): Relationship[] {
  return [...relationships];
}

export function addRelationship(input: z.input<typeof RelationshipSchema>): Relationship {
  const rel = RelationshipSchema.parse(input);
  relationships = relationships.filter((r) => r.id !== rel.id);
  relationships.push(rel);
  return rel;
}

export function clearRelationships(): void {
  relationships = [];
  // Seed the demo graph: Arjun's mother is Maa.
  addRelationship({
    id: "rel-arjun-dadi",
    familyId: "demo-family",
    memberId: "arjun",
    relationMemberId: "dadi",
    relation: "mother",
    canonicalKind: "parent",
  });
  // Maa and Papa share one home in India; Papa is Arjun's father.
  addRelationship({ id: "rel-dadi-dada", familyId: "demo-family", memberId: "dadi", relationMemberId: "dada", relation: "husband", canonicalKind: "spouse" });
  addRelationship({ id: "rel-arjun-dada", familyId: "demo-family", memberId: "arjun", relationMemberId: "dada", relation: "father", canonicalKind: "parent" });
  // Priya is Arjun's wife; Kavya (Bangalore) is his sister, married to Rahul,
  // with a daughter, Anaya. Enough family for the constellation to mean something.
  addRelationship({ id: "rel-arjun-priya", familyId: "demo-family", memberId: "arjun", relationMemberId: "priya", relation: "wife", canonicalKind: "spouse" });
  addRelationship({ id: "rel-arjun-kavya", familyId: "demo-family", memberId: "arjun", relationMemberId: "kavya", relation: "sister", canonicalKind: "sibling" });
  addRelationship({ id: "rel-kavya-rahul", familyId: "demo-family", memberId: "kavya", relationMemberId: "rahul", relation: "husband", canonicalKind: "spouse" });
  addRelationship({ id: "rel-kavya-anaya", familyId: "demo-family", memberId: "kavya", relationMemberId: "anaya", relation: "daughter", canonicalKind: "child" });
  addRelationship({ id: "rel-priya-leo", familyId: "demo-family", memberId: "priya", relationMemberId: "leo", relation: "son", canonicalKind: "child" });
  addRelationship({ id: "rel-priya-aria", familyId: "demo-family", memberId: "priya", relationMemberId: "aria", relation: "daughter", canonicalKind: "child" });
  // Arjun is their father too, which makes Maa and Papa their grandparents in the tree (kids' rituals, lib/kids.ts).
  addRelationship({ id: "rel-arjun-leo", familyId: "demo-family", memberId: "arjun", relationMemberId: "leo", relation: "son", canonicalKind: "child" });
  addRelationship({ id: "rel-arjun-aria", familyId: "demo-family", memberId: "arjun", relationMemberId: "aria", relation: "daughter", canonicalKind: "child" });
  // Rohan, Arjun's younger brother in London, with Sneha and their son Kabir:
  // cousins and in-laws, not just the household.
  addRelationship({ id: "rel-arjun-rohan", familyId: "demo-family", memberId: "arjun", relationMemberId: "rohan", relation: "brother", canonicalKind: "sibling" });
  addRelationship({ id: "rel-rohan-sneha", familyId: "demo-family", memberId: "rohan", relationMemberId: "sneha", relation: "wife", canonicalKind: "spouse" });
  addRelationship({ id: "rel-rohan-kabir", familyId: "demo-family", memberId: "rohan", relationMemberId: "kabir", relation: "son", canonicalKind: "child" });
  addRelationship({ id: "rel-sneha-kabir", familyId: "demo-family", memberId: "sneha", relationMemberId: "kabir", relation: "son", canonicalKind: "child" });

  // Priya's side, the Iyer family.
  const I = "demo-iyer";
  const rel = (id: string, a: string, b: string, relation: string, canonicalKind: Relationship["canonicalKind"]) => addRelationship({ id, familyId: I, memberId: a, relationMemberId: b, relation, canonicalKind });
  rel("rel-i-nani-nana", "iyer-nani", "iyer-nana", "husband", "spouse");
  rel("rel-i-priya-nani", "iyer-priya", "iyer-nani", "mother", "parent");
  rel("rel-i-priya-nana", "iyer-priya", "iyer-nana", "father", "parent");
  rel("rel-i-priya-arjun", "iyer-priya", "iyer-arjun", "husband", "spouse");
  rel("rel-i-priya-leo", "iyer-priya", "iyer-leo", "son", "child");
  rel("rel-i-priya-aria", "iyer-priya", "iyer-aria", "daughter", "child");
  rel("rel-i-arjun-leo", "iyer-arjun", "iyer-leo", "son", "child");
  rel("rel-i-arjun-aria", "iyer-arjun", "iyer-aria", "daughter", "child");
  rel("rel-i-priya-karthik", "iyer-priya", "iyer-karthik", "brother", "sibling");
  rel("rel-i-karthik-meera", "iyer-karthik", "iyer-meera", "wife", "spouse");
  rel("rel-i-karthik-diya", "iyer-karthik", "iyer-diya", "daughter", "child");
  rel("rel-i-meera-diya", "iyer-meera", "iyer-diya", "daughter", "child");
  // Vihaan and Anika are Arjun's children.
  for (const kid of ["leo", "aria"]) {
    addRelationship({
      id: `rel-${kid}-arjun`,
      familyId: "demo-family",
      memberId: kid,
      relationMemberId: "arjun",
      relation: "father",
      canonicalKind: "parent",
    });
  }
}

export function getKinshipTerms(path: string, displayLang: string): string | undefined {
  return kinshipCache.get(`${path}::${displayLang}`);
}

export function setKinshipTerms(path: string, displayLang: string, terms: string): void {
  kinshipCache.set(`${path}::${displayLang}`, terms);
}

if (relationships.length === 0) clearRelationships();

if (cards.length === 0) seedDemo();
if (members.length === 0) members = [...DEMO_MEMBERS, ...DEMO_IYER_MEMBERS].map((m) => MemberSchema.parse(m));

// ---- Edit / delete operations (stage 5 CRUD) ----
export function revokeInvite(code: string, familyId: string): boolean {
  const before = invites.length;
  invites = invites.filter((i) => !(i.code.toUpperCase() === code.toUpperCase() && i.familyId === familyId));
  return invites.length < before;
}

export function updateCard(id: string, patch: { caption?: string; transcript?: string; segments?: Card["segments"] }): Card | undefined {
  const card = cards.find((c) => c.id === id);
  if (!card) return undefined;
  if (patch.caption !== undefined) card.caption = patch.caption;
  if (patch.transcript !== undefined) card.transcript = patch.transcript;
  if (patch.segments !== undefined) card.segments = patch.segments;
  return { ...card };
}

export function deleteCard(id: string): boolean {
  const before = cards.length;
  cards = cards.filter((c) => c.id !== id);
  plays = plays.filter((p) => p.cardId !== id);
  reactions = reactions.filter((r) => r.cardId !== id);
  wishes = wishes.filter((w) => w.cardId !== id);
  return cards.length < before;
}

export function removeReaction(cardId: string, memberId: string): boolean {
  const before = reactions.length;
  reactions = reactions.filter((r) => !(r.cardId === cardId && r.memberId === memberId));
  return reactions.length < before;
}

export function deleteRelationship(id: string): boolean {
  const before = relationships.length;
  relationships = relationships.filter((r) => r.id !== id);
  return relationships.length < before;
}
