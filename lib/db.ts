import { parseBirthday } from "./birthday";
import { revokeMembers } from "./sessions";
import { ritualRunId } from "./rituals";
// Data-access seam: mock memory store vs Supabase.
// Every route handler goes through these async functions; the shapes match
// lib/store.ts (plus the M3–M5 entities below). Tests import lib/store.ts
// directly and stay mock-only — this module is never exercised by vitest
// with MOCK=true.
//
// Demo families (DEMO_FAMILY_IDS) never touch the database: dbFor(familyId)
// returns null for them, so they always read the in-memory seed and write to
// memory. Functions keyed by a member id decide by that member's family when
// the id is in memory (the demo seed, or anything added in the demo).
import {
  getMovableCache as memGetMovable,
  setMovableCache as memSetMovable,
  addAgentRun as memAddAgentRun,
  addCard as memAddCard,
  addGatherSession as memAddGather,
  addPlay as memAddPlay,
  addRelationship as memAddRelationship,
  addRitualRun as memAddRitualRun,
  addSuggestion as memAddSuggestion,
  addWish as memAddWish,
  assignDailyRole as memAssignRole,
  createInvite as memCreateInvite,
  deleteMemberTraces as memDeleteTraces,
  getKinshipTerms as memGetKinship,
  getMember as memGetMember,
  listAgentRuns as memListAgentRuns,
  listCards as memListCards,
  listDailyRoles as memListRoles,
  listGatherSessions as memListGather,
  listInvites as memListInvites,
  listMembers as memListMembers,
  listPlays as memListPlays,
  listReactions as memListReactions,
  listRelationships as memListRelationships,
  listRitualRuns as memListRitualRuns,
  listSuggestions as memListSuggestions,
  listWishes as memListWishes,
  removeMemberCompletely as memRemoveMember,
  setKinshipTerms as memSetKinship,
  setMemberDisplayLang as memSetDisplayLang,
  updateMemberProfile as memUpdateProfile,
  createFamily as memCreateFamily,
  familyName as memFamilyName,
  findMemberByEmail as memFindByEmail,
  findMembersByPerson as memFindByPerson,
  setMemberHome as memSetHome,
  setReaction as memSetReaction,
  setRitualRunStatus as memSetRunStatus,
  setSuggestionStatus as memSetSuggestionStatus,
  mockAddMember as memAddMember,
  revokeInvite as memRevokeInvite,
  updateCard as memUpdateCard,
  deleteCard as memDeleteCard,
  removeReaction as memRemoveReaction,
  deleteRelationship as memDeleteRelationship,
  addConsent as memAddConsent,
  listConsents as memListConsents,
  type Invite as MemInvite,
} from "./store";
import { DbWriteError, dbFor } from "./family-db";
import { removeAllForMember } from "./push/store";
import { DEMO_FAMILY_IDS, isDemoFamily, isSeedFamily } from "./family";
import { baseLang } from "./languages";
import type { MemberPatch } from "./store";
import { ConsentSchema, type Consent } from "./schemas";
import { AgentRunSchema, CardSchema, DailyRoleSchema, GatherSessionSchema, MemberSchema, PlaySchema, ReactionSchema, RelationshipSchema, RitualRunSchema, SuggestionSchema, WishSchema, type AgentRun, type Card, type DailyRole, type GatherSession, type Member, type Play, type Reaction, type Relationship, type RitualRun, type Suggestion, type Wish } from "./schemas";

// Postgres returns "2026-10-27 08:10:00+00" / "...+00:00"; the schemas (and
// string sorting across the app) expect canonical UTC "...Z". Normalise here.
export function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v ?? ""));
  return Number.isNaN(d.getTime()) ? String(v ?? "") : d.toISOString();
}


/** Never let a member-id write reach the demo rows schema.sql seeds. */
const DEMO_IN = `(${DEMO_FAMILY_IDS.join(",")})`;

/** The family a member id belongs to, when memory knows it (the demo seed and demo additions). */
function memberFamily(memberId: string): string | undefined {
  return memGetMember(memberId)?.familyId;
}

export function cardFromRow(r: Record<string, unknown>): Card {
  return CardSchema.parse({
    id: r.id,
    familyId: r.family_id,
    type: r.type,
    caption: r.caption ?? "",
    summary: r.summary ?? "",
    lang: r.lang ?? "en",
    takenAt: iso(r.taken_at),
    ritualSlug: (r.ritual_slug as string | null) ?? null,
    source: (r.source as string) ?? "upload",
    mediaRef: (r.media_ref as string | null) ?? null,
    peaks: Array.isArray(r.peaks) ? (r.peaks as number[]) : [],
    palette: Array.isArray(r.palette) ? (r.palette as string[]) : [],
    transcript: (r.transcript as string) ?? "",
    transcriptLang: (r.transcript_lang as string) ?? "en",
    segments: Array.isArray(r.segments) ? r.segments : [],
    authorId: (r.author_id as string | null) ?? null,
    coverRef: (r.cover_ref as string | null) ?? null,
    addressedTo: (r.addressed_to as string | null) ?? null,
    place: typeof r.place === "string" ? r.place.slice(0, 60) : "",
    note: typeof r.note === "string" ? r.note.slice(0, 140) : "",
    forMemberId: (r.for_member_id as string | null) ?? null,
  });
}

function memberFromRow(r: Record<string, unknown>): Member {
  return MemberSchema.parse({
    id: r.id,
    familyId: r.family_id,
    firstName: r.first_name ?? r.display_name ?? "",
    displayName: r.display_name ?? "",
    role: r.role ?? "adult",
    lang: r.lang ?? "en",
    displayLang: r.display_lang ?? "en",
    tz: r.tz ?? "UTC",
    city: typeof r.city === "string" ? r.city : "",
    birthday: typeof r.birthday === "string" && parseBirthday(r.birthday) ? r.birthday : "",
    homeImageRef: (r.home_image_ref as string | null) ?? null,
    homePalette: Array.isArray(r.home_palette) ? (r.home_palette as string[]) : [],
    photoRef: (r.photo_ref as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    access: r.access === "owner" || r.access === "admin" || r.access === "teen" || r.access === "child" ? r.access : "member",
    status: r.status === "pending" ? "pending" : "active",
    personId: (r.person_id as string | null) ?? null,
  });
}


/** Every family id, for jobs that run across families (the daily ritual scan). */
export async function dbListFamilyIds(): Promise<string[]> {
  const fromMem = Array.from(new Set(memListMembers().map((m) => m.familyId)));
  const sb = dbFor(null);
  if (!sb) return fromMem;
  // Live: real families only. The demo lives in each instance's memory, so a
  // cron pass over it would do nothing anyone sees (and spend on Muse calls).
  const realMem = fromMem.filter((id) => !isDemoFamily(id));
  const { data, error } = await sb.from("families").select("id");
  if (error || !data) return realMem;
  return data.map((r) => String(r.id)).filter((id) => !isDemoFamily(id));
}

// Tenancy: every list is scoped to one family. In-memory results (mock mode or
// a live error) are filtered the same way, so a new family never sees another
// family's rows.
const DEMO_FAMILY = "demo-family";
function scoped<T extends { familyId?: string | null }>(rows: T[], familyId: string | undefined): T[] {
  return familyId ? rows.filter((r) => (r.familyId ?? DEMO_FAMILY) === familyId) : rows;
}

/** Bounds for a screen that only needs the recent shelf (the window): cards taken at/after `since`, newest first, at most `limit`. */
export interface ListCardsOptions {
  limit?: number;
  since?: string;
}

export async function dbListCards(familyId: string, opts: ListCardsOptions = {}): Promise<Card[]> {
  const bound = (rows: Card[]): Card[] => {
    const kept = opts.since ? rows.filter((c) => c.takenAt >= (opts.since as string)) : rows;
    return opts.limit !== undefined ? [...kept].sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, opts.limit) : kept;
  };
  const sb = dbFor(familyId);
  if (!sb) return bound(scoped(memListCards(), familyId));
  let q = sb.from("cards").select("*").eq("family_id", familyId);
  if (opts.since) q = q.gte("taken_at", opts.since);
  q = q.order("taken_at", { ascending: false });
  if (opts.limit !== undefined) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error || !data) return bound(scoped(memListCards(), familyId));
  // One malformed row must never blank the whole feed: skip it and log the id.
  const cards: Card[] = [];
  for (const row of data) {
    try {
      cards.push(cardFromRow(row));
    } catch (e) {
      console.error("[db] skipped malformed card", (row as { id?: unknown }).id, (e as Error).message);
    }
  }
  return cards;
}

/** The cards row for a card (dbAddCard and the demo copy write the same columns). */
export function cardRow(card: Card): Record<string, unknown> {
  return {
    id: card.id,
    family_id: card.familyId,
    type: card.type,
    caption: card.caption,
    summary: card.summary,
    lang: card.lang,
    taken_at: card.takenAt,
    ritual_slug: card.ritualSlug,
    source: card.source,
    media_ref: card.mediaRef,
    peaks: card.peaks,
    palette: card.palette,
    transcript: card.transcript,
    transcript_lang: card.transcriptLang,
    segments: card.segments,
    author_id: card.authorId,
    cover_ref: card.coverRef,
    addressed_to: card.addressedTo,
    // Only sent when set, so a database that hasn't added the columns yet keeps working.
    ...(card.place ? { place: card.place } : {}),
    ...(card.note ? { note: card.note } : {}),
    ...(card.forMemberId ? { for_member_id: card.forMemberId } : {}),
  };
}

export async function dbAddCard(input: Omit<import("zod").input<typeof CardSchema>, "id"> & { id?: string }): Promise<Card> {
  const card = CardSchema.parse({ id: input.id ?? crypto.randomUUID(), ...input });
  const sb = dbFor(card.familyId);
  if (!sb) return memAddCard(card);
  const { error } = await sb.from("cards").upsert(cardRow(card));
  if (error) throw new DbWriteError("cards", error.message);
  return card;
}

/**
 * The family's people. Joiners still waiting for an admin ("pending") are left
 * out unless asked for: they aren't in the family yet, so no screen, window,
 * tree or count sees them. Admin screens and the caps pass includePending.
 */
export async function dbListMembers(familyId: string, opts: { includePending?: boolean } = {}): Promise<Member[]> {
  const all = await listMembersAll(familyId);
  return opts.includePending ? all : all.filter((m) => m.status !== "pending");
}

async function listMembersAll(familyId: string): Promise<Member[]> {
  const sb = dbFor(familyId);
  if (!sb) return scoped(memListMembers(), familyId);
  const { data, error } = await sb.from("members").select("*").eq("family_id", familyId);
  if (error || !data) return scoped(memListMembers(), familyId);
  return data.map(memberFromRow);
}

export async function dbGetMember(id: string): Promise<Member | undefined> {
  const sb = dbFor(memberFamily(id));
  if (!sb) return memGetMember(id);
  const { data, error } = await sb.from("members").select("*").eq("id", id).maybeSingle();
  if (error || !data) return memGetMember(id);
  const m = memberFromRow(data as Record<string, unknown>);
  // The demo rows schema.sql seeds are never served: the demo lives in memory.
  return isSeedFamily(m.familyId) ? memGetMember(id) : m;
}

export async function dbSetMemberHome(memberId: string, homeImageRef: string, homePalette: string[]): Promise<Member | undefined> {
  const sb = dbFor(memberFamily(memberId));
  if (!sb) return memSetHome(memberId, homeImageRef, homePalette);
  const { error } = await sb.from("members").update({ home_image_ref: homeImageRef, home_palette: homePalette }).eq("id", memberId).not("family_id", "in", DEMO_IN);
  if (error) return undefined;
  return dbGetMember(memberId);
}

/** The family's display name ("Sharma"), for headers and the poster. */
export async function dbGetFamilyName(familyId: string): Promise<string> {
  const local = memFamilyName(familyId) ?? "";
  const sb = dbFor(familyId);
  if (!sb) return local;
  const { data } = await sb.from("families").select("name").eq("id", familyId).maybeSingle();
  return String((data as { name?: unknown } | null)?.name ?? local);
}

export async function dbCreateFamily(name: string): Promise<string> {
  const id = `fam-${crypto.randomUUID().slice(0, 12)}`;
  memCreateFamily(id, name);
  const sb = dbFor(id);
  if (!sb) return id;
  const { error } = await sb.from("families").insert({ id, name });
  if (error) throw new Error("family-create-failed");
  return id;
}

/** The members row for a member (dbAddMember and the demo copy write the same columns). */
export function memberRow(member: Member): Record<string, unknown> {
  return {
    id: member.id,
    family_id: member.familyId,
    first_name: member.firstName,
    display_name: member.displayName,
    role: member.role,
    access: member.access,
    status: member.status,
    lang: member.lang,
    display_lang: member.displayLang,
    tz: member.tz,
    city: member.city,
    birthday: member.birthday,
    email: member.email ? member.email.toLowerCase() : null,
    photo_ref: member.photoRef,
    person_id: member.personId,
    ...(member.homeImageRef ? { home_image_ref: member.homeImageRef, home_palette: member.homePalette } : {}),
  };
}

export async function dbAddMember(input: Omit<import("zod").input<typeof MemberSchema>, "id">): Promise<Member> {
  const member = MemberSchema.parse({ id: `m-${crypto.randomUUID().slice(0, 12)}`, ...input });
  const sb = dbFor(member.familyId);
  if (!sb) return memAddMember(member);
  const { error } = await sb.from("members").insert(memberRow(member));
  if (error) throw new Error("member-create-failed");
  return member;
}

export async function dbFindMemberByEmail(email: string): Promise<Member | undefined> {
  const e = email.trim().toLowerCase();
  const sb = dbFor(null);
  if (!sb) return memFindByEmail(e);
  // The demo's people live in memory (and carry no email); the demo rows in
  // schema.sql are never a sign-in.
  const { data, error } = await sb.from("members").select("*").eq("email", e).limit(8); // exact: ilike would treat "_" and "%" as wildcards
  if (error || !data) return undefined;
  const row = data.find((r) => !isDemoFamily(String((r as { family_id?: unknown }).family_id ?? "")));
  return row ? memberFromRow(row as Record<string, unknown>) : undefined;
}

/**
 * Every family space this member's person belongs to: one row per family, the same
 * human. A member without a personId belongs to one family space only.
 */
export async function dbListSides(member: Member): Promise<Member[]> {
  return (await dbListSidesNamed(member)).map((s) => s.member);
}

export interface NamedSide {
  member: Member;
  /** null when it wasn't read with the sides: ask dbGetFamilyName. */
  familyName: string | null;
  /** With `since`: everyone in that family (waiting joiners too), or null when not read. */
  people: Member[] | null;
  /** With `since`: who shared what in that family since then, or null when not read. */
  recent: { authorId: string | null; takenAt: string }[] | null;
}

/**
 * dbListSides, with each family's name (and, given `since`, its people and its
 * recent cards' authors and dates) read in the SAME query through the family
 * foreign keys. Anything the database couldn't embed comes back null and the
 * caller reads it as before.
 */
export async function dbListSidesNamed(member: Member, opts: { since?: string } = {}): Promise<NamedSide[]> {
  const bare = (list: Member[]): NamedSide[] => list.map((m) => ({ member: m, familyName: null, people: null, recent: null }));
  if (!member.personId) return bare([member]);
  const local = memFindByPerson(member.personId);
  // A demo person's sides are the demo homes, in memory.
  const sb = dbFor(member.familyId);
  if (!sb) return bare(local);
  type Row = Record<string, unknown> & { families?: { name?: unknown; members?: unknown; cards?: unknown } | null };
  let rows: Row[] | null = null;
  if (opts.since) {
    const { data, error } = await sb.from("members").select("*, families(name, members(*), cards(author_id, taken_at))").eq("person_id", member.personId).gte("families.cards.taken_at", opts.since).limit(8);
    if (!error && data) rows = data as Row[];
  }
  if (!rows) {
    const { data, error } = await sb.from("members").select("*, families(name)").eq("person_id", member.personId).limit(8);
    if (error || !data) return bare(local);
    rows = data as Row[];
  }
  const out: NamedSide[] = [];
  for (const r of rows) {
    const m = memberFromRow(r);
    if (isSeedFamily(m.familyId)) continue;
    const fam = r.families;
    let people: Member[] | null = null;
    let recent: NamedSide["recent"] = null;
    if (opts.since && fam && Array.isArray(fam.members) && Array.isArray(fam.cards)) {
      try {
        people = (fam.members as Record<string, unknown>[]).map(memberFromRow);
        recent = (fam.cards as { author_id?: unknown; taken_at?: unknown }[]).map((c) => ({ authorId: typeof c.author_id === "string" ? c.author_id : null, takenAt: String(c.taken_at ?? "") }));
      } catch {
        people = null;
        recent = null;
      }
    }
    out.push({ member: m, familyName: typeof fam?.name === "string" ? fam.name : null, people, recent });
  }
  return out;
}

export async function dbUpdateMemberProfile(memberId: string, patch: MemberPatch): Promise<Member | undefined> {
  const sb = dbFor(memberFamily(memberId));
  if (!sb) return memUpdateProfile(memberId, patch);
  const row: Record<string, unknown> = {};
  if (patch.firstName !== undefined) row.first_name = patch.firstName;
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.access !== undefined) row.access = patch.access;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.birthday !== undefined) row.birthday = patch.birthday;
  if (patch.tz !== undefined) row.tz = patch.tz;
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.photoRef !== undefined) row.photo_ref = patch.photoRef;
  if (patch.email !== undefined) row.email = patch.email ? patch.email.toLowerCase() : null;
  if (patch.personId !== undefined) row.person_id = patch.personId;
  const { error } = await sb.from("members").update(row).eq("id", memberId).not("family_id", "in", DEMO_IN);
  if (error) return undefined;
  return dbGetMember(memberId);
}

export async function dbSetMemberDisplayLang(memberId: string, displayLang: Member["displayLang"]): Promise<Member | undefined> {
  const sb = dbFor(memberFamily(memberId));
  if (!sb) return memSetDisplayLang(memberId, displayLang);
  const lang = baseLang(displayLang);
  const { error } = await sb.from("members").update({ display_lang: displayLang, lang }).eq("id", memberId).not("family_id", "in", DEMO_IN);
  if (error) return undefined;
  return dbGetMember(memberId);
}

export async function dbListPlays(cardId: string | undefined, familyId: string, since?: string): Promise<Play[]> {
  const sb = dbFor(familyId);
  const mem = () => scoped(memListPlays(cardId), familyId).filter((p) => !since || p.playedAt >= since);
  if (!sb) return mem();
  let q = sb.from("plays").select("*").eq("family_id", familyId).order("played_at", { ascending: false });
  if (cardId) q = q.eq("card_id", cardId);
  if (since) q = q.gte("played_at", since);
  const { data, error } = await q;
  if (error || !data) return mem();
  return data.map((r) =>
    PlaySchema.parse({
      id: r.id,
      familyId: r.family_id,
      cardId: r.card_id,
      memberId: r.member_id,
      playedAt: iso(r.played_at),
    }),
  );
}

export async function dbAddPlay(input: { cardId: string; memberId: string; familyId: string }): Promise<Play> {
  const play = PlaySchema.parse({
    id: crypto.randomUUID(),
    playedAt: new Date().toISOString(),
    ...input,
  });
  const sb = dbFor(play.familyId);
  if (!sb) return memAddPlay(play);
  const { error } = await sb.from("plays").insert({
    id: play.id,
    family_id: play.familyId,
    card_id: play.cardId,
    member_id: play.memberId,
    played_at: play.playedAt,
  });
  if (error) throw new DbWriteError("plays", error.message);
  return play;
}

export async function dbListReactions(cardId: string | undefined, familyId: string, since?: string): Promise<Reaction[]> {
  const sb = dbFor(familyId);
  const mem = () => scoped(memListReactions(cardId), familyId).filter((r) => !since || r.createdAt >= since);
  if (!sb) return mem();
  let q = sb.from("reactions").select("*").eq("family_id", familyId).order("created_at", { ascending: true });
  if (cardId) q = q.eq("card_id", cardId);
  if (since) q = q.gte("created_at", since);
  const { data, error } = await q;
  if (error || !data) return mem();
  return data.map((r) =>
    ReactionSchema.parse({
      id: r.id,
      familyId: r.family_id,
      cardId: r.card_id,
      memberId: r.member_id,
      kind: r.kind,
      createdAt: iso(r.created_at),
    }),
  );
}

export async function dbListRelationships(familyId: string): Promise<Relationship[]> {
  const sb = dbFor(familyId);
  if (!sb) return scoped(memListRelationships(), familyId);
  const { data, error } = await sb.from("relationships").select("*").eq("family_id", familyId);
  if (error || !data) return scoped(memListRelationships(), familyId);
  const rows = data.map((r) =>
    RelationshipSchema.parse({
      id: r.id,
      familyId: r.family_id,
      memberId: r.member_id,
      relationMemberId: r.relation_member_id,
      relation: r.relation,
      canonicalKind: canonicalKindFor(r.relation),
    }),
  );
  return rows;
}

// Canonical edge kind from the family's own word. Data in, data out.
export function canonicalKindFor(relation: string): Relationship["canonicalKind"] {
  const w = relation.toLowerCase().trim();
  if (["mother", "father", "mom", "dad", "maa", "pita", "parent", "saas", "sasur"].includes(w)) return "parent";
  if (["daughter", "son", "child", "beti", "beta", "bahu", "damad"].includes(w)) return "child";
  if (["wife", "husband", "spouse", "partner", "patni", "pati"].includes(w)) return "spouse";
  return "sibling";
}

/** A sensible default generation for someone added by relation; editable afterwards. */
export function inferRole(relation: string, anchorRole: Member["role"] = "adult"): Member["role"] {
  const kind = canonicalKindFor(relation);
  if (kind === "parent") return anchorRole === "child" ? "adult" : "elder";
  if (kind === "child") return anchorRole === "elder" ? "adult" : "child";
  return anchorRole;
}

export async function dbAddRelationship(input: {
  memberId: string;
  newMemberName: string;
  newMemberRole?: Member["role"];
  relation: string;
  familyId: string;
  tz?: string;
  birthday?: string;
  anchorRole?: Member["role"];
}): Promise<{ member: Member; relationship: Relationship }> {
  const familyId = input.familyId;
  const memberId = `member-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const member = MemberSchema.parse({
    id: memberId,
    familyId,
    firstName: input.newMemberName,
    displayName: input.newMemberName,
    role: input.newMemberRole ?? inferRole(input.relation, input.anchorRole),
    access: (input.newMemberRole ?? inferRole(input.relation, input.anchorRole)) === "child" ? "child" : "member",
    lang: "en",
    displayLang: "en",
    tz: input.tz ?? "UTC",
    birthday: input.birthday ?? "",
    homeImageRef: null,
    homePalette: [],
  });
  const relationship = RelationshipSchema.parse({
    id: crypto.randomUUID(),
    familyId,
    memberId: input.memberId,
    relationMemberId: memberId,
    relation: input.relation,
    canonicalKind: canonicalKindFor(input.relation),
  });
  // Mock mode and the demo mutate the in-memory family (tests reset it first).
  const sb = dbFor(familyId);
  if (!sb) {
    memAddRelationship(relationship);
    memAddMember(member);
    return { member, relationship };
  }
  // Member first: relationships.relation_member_id has a foreign key to it,
  // so the two inserts can't run side by side.
  const { error: mErr } = await sb.from("members").insert({
    id: member.id,
    family_id: familyId,
    first_name: member.firstName,
    display_name: member.displayName,
    role: member.role,
    access: member.access,
    lang: member.lang,
    display_lang: member.displayLang,
    tz: member.tz,
    birthday: member.birthday,
  });
  if (mErr) throw new DbWriteError("members", mErr.message);
  const { error: rErr } = await sb.from("relationships").insert({
    id: relationship.id,
    family_id: familyId,
    member_id: input.memberId,
    relation_member_id: memberId,
    relation: input.relation,
  });
  if (rErr) {
    // Don't leave a half-made person with no link behind.
    await sb.from("members").delete().eq("id", member.id).eq("family_id", familyId);
    throw new DbWriteError("relationships", rErr.message);
  }
  return { member, relationship };
}

export async function dbGetKinshipTerms(path: string, displayLang: string): Promise<string | undefined> {
  const sb = dbFor(null);
  if (!sb) return memGetKinship(path, displayLang);
  const { data } = await sb.from("kinship_cache").select("terms").eq("path", path).eq("display_lang", displayLang).maybeSingle();
  const terms = (data as { terms?: unknown } | null)?.terms;
  if (terms && typeof terms === "object" && typeof (terms as { text?: unknown }).text === "string") {
    return (terms as { text: string }).text;
  }
  return memGetKinship(path, displayLang);
}

export async function dbSetKinshipTerms(path: string, displayLang: string, terms: string): Promise<void> {
  memSetKinship(path, displayLang, terms);
  const sb = dbFor(null);
  if (!sb) return;
  await sb.from("kinship_cache").upsert({ path, display_lang: displayLang, terms: { text: terms } });
}

// ---- Agent entities: mock-first, Supabase when live. ----

function suggestionFromRow(r: Record<string, unknown>): Suggestion {
  return SuggestionSchema.parse({
    id: r.id,
    familyId: r.family_id,
    goal: r.goal ?? "",
    payload: (r.payload as Record<string, unknown>) ?? {},
    status: r.status ?? "pending",
    createdAt: iso(r.created_at),
  });
}

export async function dbListSuggestions(status: Suggestion["status"] | undefined, familyId: string): Promise<Suggestion[]> {
  const sb = dbFor(familyId);
  if (!sb) return scoped(memListSuggestions(status), familyId);
  let q = sb.from("suggestions").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  q = q.eq("family_id", familyId);
  const { data, error } = await q;
  if (error || !data) return scoped(memListSuggestions(status), familyId);
  return data.map((r) => suggestionFromRow(r as Record<string, unknown>));
}

export async function dbAddSuggestion(input: { goal: string; payload?: Record<string, unknown>; familyId: string }): Promise<Suggestion> {
  const s = SuggestionSchema.parse({
    id: crypto.randomUUID(),
    familyId: input.familyId,
    goal: input.goal,
    payload: input.payload ?? {},
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  const sb = dbFor(s.familyId);
  if (!sb) return memAddSuggestion(s);
  const { error } = await sb.from("suggestions").insert({
    id: s.id,
    family_id: s.familyId,
    goal: s.goal,
    payload: s.payload,
    status: s.status,
  });
  if (error) throw new DbWriteError("suggestions", error.message);
  return s;
}

export async function dbSetSuggestionStatus(id: string, status: Suggestion["status"], familyId: string): Promise<Suggestion | undefined> {
  // Only the family's own suggestion: an id from another family is unknown here.
  if (!(await dbListSuggestions(undefined, familyId)).some((x) => x.id === id)) return undefined;
  const sb = dbFor(familyId);
  if (!sb) return memSetSuggestionStatus(id, status);
  const { error } = await sb.from("suggestions").update({ status }).eq("id", id).eq("family_id", familyId);
  if (error) return undefined;
  const all = await dbListSuggestions(undefined, familyId);
  return all.find((s) => s.id === id);
}

export async function dbListAgentRuns(familyId: string): Promise<AgentRun[]> {
  const sb = dbFor(familyId);
  if (!sb) return scoped(memListAgentRuns(), familyId);
  let q = sb.from("agent_runs").select("*").order("created_at", { ascending: false }).limit(50);
  if (familyId) q = q.eq("family_id", familyId);
  const { data, error } = await q;
  if (error || !data) return scoped(memListAgentRuns(), familyId);
  return data.map((r) =>
    AgentRunSchema.parse({
      id: r.id,
      familyId: r.family_id,
      goal: r.goal ?? "",
      tools: Array.isArray(r.tools) ? r.tools : [],
      status: r.status ?? "done",
      createdAt: iso(r.created_at),
    }),
  );
}

export async function dbAddAgentRun(input: { goal: string; tools: string[]; status?: string; familyId: string }): Promise<AgentRun> {
  const run = AgentRunSchema.parse({
    id: crypto.randomUUID(),
    familyId: input.familyId,
    goal: input.goal,
    tools: input.tools,
    status: input.status ?? "done",
    createdAt: new Date().toISOString(),
  });
  const sb = dbFor(run.familyId);
  if (!sb) return memAddAgentRun(run);
  const { error } = await sb.from("agent_runs").insert({
    id: run.id,
    family_id: run.familyId,
    goal: run.goal,
    tools: run.tools,
    status: run.status,
  });
  if (error) throw new DbWriteError("agent_runs", error.message);
  return run;
}

export async function dbListWishes(runId: string | undefined, familyId: string, since?: string): Promise<Wish[]> {
  const sb = dbFor(familyId);
  const mem = () => scoped(memListWishes(runId), familyId).filter((w) => !since || w.createdAt >= since);
  if (!sb) return mem();
  let q = sb.from("wishes").select("*").order("created_at", { ascending: true });
  if (runId) q = q.eq("ritual_run_id", runId);
  if (familyId) q = q.eq("family_id", familyId);
  if (since) q = q.gte("created_at", since);
  const { data, error } = await q;
  if (error || !data) return mem();
  return data.map((r) =>
    WishSchema.parse({
      id: r.id,
      familyId: r.family_id,
      ritualRunId: (r.ritual_run_id as string | null) ?? null,
      cardId: (r.card_id as string | null) ?? null,
      memberId: r.member_id,
      kind: r.kind,
      createdAt: iso(r.created_at),
    }),
  );
}

export async function dbAddWish(input: { ritualRunId?: string | null; cardId?: string | null; memberId: string; kind: Wish["kind"]; familyId: string }): Promise<Wish> {
  const w = WishSchema.parse({
    id: crypto.randomUUID(),
    familyId: input.familyId,
    ritualRunId: input.ritualRunId ?? null,
    cardId: input.cardId ?? null,
    memberId: input.memberId,
    kind: input.kind,
    createdAt: new Date().toISOString(),
  });
  const sb = dbFor(w.familyId);
  if (!sb) return memAddWish(w);
  const { error } = await sb.from("wishes").insert({
    id: w.id,
    family_id: w.familyId,
    ritual_run_id: w.ritualRunId,
    card_id: w.cardId,
    member_id: w.memberId,
    kind: w.kind,
  });
  if (error) throw new DbWriteError("wishes", error.message);
  return w;
}

export async function dbListRitualRuns(familyId: string): Promise<RitualRun[]> {
  const sb = dbFor(familyId);
  if (!sb) return scoped(memListRitualRuns(), familyId);
  let q = sb.from("ritual_runs").select("*").order("occasion_date", { ascending: true });
  if (familyId) q = q.eq("family_id", familyId);
  const { data, error } = await q;
  if (error || !data) return scoped(memListRitualRuns(), familyId);
  return data.map((r) =>
    RitualRunSchema.parse({
      id: r.id,
      familyId: r.family_id,
      ritualSlug: r.ritual_slug,
      occasionDate: typeof r.occasion_date === "string" ? r.occasion_date.slice(0, 10) : "",
      status: r.status ?? "open",
      createdAt: iso(r.created_at),
    }),
  );
}

export async function dbEnsureRitualRun(slug: string, occasionDate: string, familyId: string): Promise<RitualRun> {
  const id = ritualRunId(familyId, slug, occasionDate);
  const existing = (await dbListRitualRuns(familyId)).find((r) => r.id === id);
  if (existing) return existing;
  const run = RitualRunSchema.parse({
    id,
    familyId,
    ritualSlug: slug,
    occasionDate,
    status: "collecting",
    createdAt: new Date().toISOString(),
  });
  const sb = dbFor(familyId);
  if (!sb) return memAddRitualRun(run);
  const { error } = await sb.from("ritual_runs").insert({
    id: run.id,
    family_id: familyId,
    ritual_slug: slug,
    occasion_date: occasionDate,
    status: "collecting",
  });
  if (error) throw new DbWriteError("ritual_runs", error.message);
  return run;
}

export async function dbSetRitualRunStatus(id: string, status: RitualRun["status"], familyId: string): Promise<RitualRun | undefined> {
  if (!(await dbListRitualRuns(familyId)).some((r) => r.id === id)) return undefined;
  const sb = dbFor(familyId);
  if (!sb) return memSetRunStatus(id, status);
  const { error } = await sb.from("ritual_runs").update({ status }).eq("id", id).eq("family_id", familyId);
  if (error) return undefined;
  return (await dbListRitualRuns(familyId)).find((r) => r.id === id);
}

export async function dbListDailyRoles(familyId: string): Promise<DailyRole[]> {
  const sb = dbFor(familyId);
  if (!sb) return scoped(memListRoles(), familyId);
  let q = sb.from("daily_roles").select("*");
  if (familyId) q = q.eq("family_id", familyId);
  const { data, error } = await q;
  if (error || !data) return scoped(memListRoles(), familyId);
  return data.map((r) =>
    DailyRoleSchema.parse({
      id: r.id,
      familyId: r.family_id,
      memberId: r.member_id,
      roleDate: typeof r.role_date === "string" ? r.role_date.slice(0, 10) : "",
      prompt: r.prompt ?? "",
    }),
  );
}

export async function dbAssignDailyRole(memberId: string, prompt: string, roleDate: string, familyId: string): Promise<DailyRole> {
  // Idempotent per (member, day): the mock seam enforces uniqueness, and the
  // live table has a matching unique index.
  const role = memAssignRole({ id: crypto.randomUUID(), familyId, memberId, roleDate, prompt });
  const sb = dbFor(familyId);
  if (!sb) return role;
  await sb.from("daily_roles").upsert(
    { id: role.id, family_id: familyId, member_id: memberId, role_date: roleDate, prompt },
    { onConflict: "family_id,member_id,role_date" },
  );
  return role;
}

export async function dbListGatherSessions(familyId: string): Promise<GatherSession[]> {
  const sb = dbFor(familyId);
  if (!sb) return scoped(memListGather(), familyId);
  let q = sb.from("gather_sessions").select("*").order("starts_at", { ascending: false });
  if (familyId) q = q.eq("family_id", familyId);
  const { data, error } = await q;
  if (error || !data) return scoped(memListGather(), familyId);
  return data.map((r) =>
    GatherSessionSchema.parse({
      id: r.id,
      familyId: r.family_id,
      title: r.title ?? "",
      startsAt: iso(r.starts_at),
      invites: Array.isArray(r.invites) ? (r.invites as string[]) : [],
      playlist: Array.isArray(r.playlist) ? (r.playlist as string[]) : [],
      createdAt: iso(r.created_at),
    }),
  );
}

export async function dbAddGatherSession(input: { title: string; startsAt: string; invites?: string[]; playlist?: string[]; familyId: string }): Promise<GatherSession> {
  const g = GatherSessionSchema.parse({
    id: crypto.randomUUID(),
    familyId: input.familyId,
    title: input.title,
    startsAt: input.startsAt,
    invites: input.invites ?? [],
    playlist: input.playlist ?? [],
    createdAt: new Date().toISOString(),
  });
  const sb = dbFor(g.familyId);
  if (!sb) return memAddGather(g);
  const { error } = await sb.from("gather_sessions").insert({
    id: g.id,
    family_id: g.familyId,
    title: g.title,
    starts_at: g.startsAt,
    invites: g.invites,
    playlist: g.playlist,
  });
  if (error) throw new DbWriteError("gather_sessions", error.message);
  return g;
}

// ---- Movable-date persistent cache (ritual_configs.config.movable). ----

export async function dbGetMovableDate(slug: string, year: number): Promise<{ date: string; sources: string[] } | undefined> {
  const sb = dbFor(null);
  if (!sb) return memGetMovable(slug, year);
  const { data } = await sb.from("ritual_configs").select("config").eq("slug", slug).maybeSingle();
  const movable = (data as { config?: { movable?: Record<string, { date: string; sources: string[] }> } } | null)?.config?.movable;
  const entry = movable?.[String(year)];
  if (entry?.date) {
    memSetMovable(slug, year, entry.date, entry.sources ?? []);
    return { date: entry.date, sources: entry.sources ?? [] };
  }
  return memGetMovable(slug, year);
}

export async function dbSetMovableDate(slug: string, year: number, date: string, sources: string[]): Promise<void> {
  memSetMovable(slug, year, date, sources);
  const sb = dbFor(null);
  if (!sb) return;
  const { data } = await sb.from("ritual_configs").select("config").eq("slug", slug).maybeSingle();
  const config = ((data as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
  const movable = { ...((config.movable as Record<string, unknown>) ?? {}), [String(year)]: { date, sources } };
  await sb.from("ritual_configs").upsert({ slug, config: { ...config, movable } });
}

/**
 * Take the one-time right to act on a pending suggestion: flips pending ->
 * approved and says whether THIS call did it. Two taps (or two requests)
 * race here and only one wins, so an approval can't run its action twice.
 */
export async function dbClaimSuggestion(id: string, familyId: string): Promise<boolean> {
  const sb = dbFor(familyId);
  if (!sb) {
    // No await between the check and the flip, so this is atomic in memory.
    const s = memListSuggestions().find((x) => x.id === id && x.familyId === familyId && x.status === "pending");
    if (!s) return false;
    memSetSuggestionStatus(id, "approved");
    return true;
  }
  const { data, error } = await sb.from("suggestions").update({ status: "approved" }).eq("id", id).eq("family_id", familyId).eq("status", "pending").select("id");
  if (error) throw new DbWriteError("suggestions", error.message);
  return (data?.length ?? 0) > 0;
}

/** Give a claim back when the action failed, so the family can try again. */
export async function dbReleaseSuggestion(id: string, familyId: string): Promise<void> {
  const sb = dbFor(familyId);
  if (!sb) {
    memSetSuggestionStatus(id, "pending");
    return;
  }
  await sb.from("suggestions").update({ status: "pending" }).eq("id", id).eq("family_id", familyId);
}

// ---- Privacy set + invites. ----

export type Invite = MemInvite;

export async function dbListInvites(): Promise<Invite[]> {
  const sb = dbFor(null);
  if (!sb) return memListInvites();
  // Invites made inside the demo stay in memory; they redeem alongside the
  // live ones (the NEARER-DEMO code itself needs no invite row).
  const demo = memListInvites().filter((i) => isSeedFamily(i.familyId));
  const { data, error } = await sb.from("invites").select("*").order("created_at", { ascending: false });
  if (error || !data) return memListInvites();
  const rows = data.map((r) => ({
    id: r.id as string,
    code: r.code as string,
    familyId: r.family_id as string,
    expiresAt: iso(r.expires_at),
    createdBy: (r.created_by as string | null) ?? null,
  }));
  return [...rows.filter((i) => !isSeedFamily(i.familyId)), ...demo];
}

/**
 * One unexpired invite by code (any case), without pulling every family's
 * invites. Demo invites live in memory and are checked first, like
 * dbListInvites merges them.
 */
export async function dbFindInvite(code: string): Promise<Invite | undefined> {
  const want = code.trim().toUpperCase();
  if (!want) return undefined;
  const nowMs = Date.now();
  const match = (i: Invite) => i.code.toUpperCase() === want && new Date(i.expiresAt).getTime() > nowMs;
  const sb = dbFor(null);
  if (!sb) return memListInvites().find(match);
  const demo = memListInvites().find((i) => isDemoFamily(i.familyId) && match(i));
  if (demo) return demo;
  const { data, error } = await sb.from("invites").select("*").eq("code", want).gt("expires_at", new Date(nowMs).toISOString()).limit(1);
  if (error || !data) return memListInvites().find(match);
  const r = data[0];
  if (!r || isDemoFamily(r.family_id as string)) return undefined;
  return { id: r.id as string, code: r.code as string, familyId: r.family_id as string, expiresAt: iso(r.expires_at), createdBy: (r.created_by as string | null) ?? null };
}

function inviteCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  // 8 characters from 31 (~8.5e11): typeable by a grandparent, not guessable.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export async function dbCreateInvite(familyId: string, createdBy: string | null = null): Promise<Invite> {
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const sb = dbFor(familyId);
  if (!sb) return memCreateInvite(inviteCode(), expiresAt, familyId, createdBy);
  const invite: Invite = { id: crypto.randomUUID(), code: inviteCode(), familyId, expiresAt, createdBy };
  const { error } = await sb.from("invites").insert({
    id: invite.id,
    family_id: familyId,
    code: invite.code,
    expires_at: expiresAt,
    created_by: createdBy,
  });
  if (error) throw new DbWriteError("invites", error.message);
  return invite;
}

// ---- Consents (supabase/schema.sql `consents`). ----

export async function dbAddConsent(input: Omit<Consent, "id" | "createdAt">): Promise<Consent> {
  const c = ConsentSchema.parse({ id: `consent-${crypto.randomUUID().slice(0, 12)}`, createdAt: new Date().toISOString(), ...input });
  const sb = dbFor(c.familyId);
  if (!sb) return memAddConsent(c);
  const { error } = await sb.from("consents").insert({
    id: c.id,
    family_id: c.familyId,
    member_id: c.memberId,
    parent_member_id: c.parentMemberId,
    kind: c.kind,
    method: c.method,
    created_at: c.createdAt,
  });
  if (error) throw new Error("consent-failed");
  return c;
}

export async function dbListConsents(familyId: string): Promise<Consent[]> {
  const sb = dbFor(familyId);
  if (!sb) return memListConsents(familyId);
  const { data, error } = await sb.from("consents").select("*").eq("family_id", familyId).order("created_at", { ascending: false });
  if (error || !data) return memListConsents(familyId);
  return data.map((r) =>
    ConsentSchema.parse({ id: r.id, familyId: r.family_id, memberId: r.member_id, parentMemberId: r.parent_member_id ?? null, kind: r.kind, method: r.method, createdAt: iso(r.created_at) }),
  );
}

// "Remove my memories": delete the member's attributable traces (cards stay
// in the shared family pool). "Leave family": remove the member completely.
export async function dbDeleteMemberTraces(memberId: string): Promise<Record<string, number>> {
  const sb = dbFor(memberFamily(memberId));
  if (!sb) return memDeleteTraces(memberId);
  const tables = ["wishes", "reactions", "plays", "daily_roles"];
  for (const t of tables) {
    await sb.from(t).delete().eq("member_id", memberId);
  }
  return memDeleteTraces(memberId);
}

export async function dbRemoveMember(memberId: string): Promise<boolean> {
  const fam = memberFamily(memberId);
  // Their sessions end at once, on every device.
  await revokeMembers([memberId]).catch(() => undefined);
  // Their phones stop receiving at once (the database cascades too, memory does not).
  if (fam) await removeAllForMember(fam, memberId).catch(() => undefined);
  const sb = dbFor(fam);
  if (!sb) return memRemoveMember(memberId);
  await sb.from("relationships").delete().or(`member_id.eq.${memberId},relation_member_id.eq.${memberId}`);
  const tables = ["wishes", "reactions", "plays", "daily_roles"];
  for (const t of tables) {
    await sb.from(t).delete().eq("member_id", memberId);
  }
  const { error } = await sb.from("members").delete().eq("id", memberId).not("family_id", "in", DEMO_IN);
  if (error) return false;
  memRemoveMember(memberId);
  return true;
}

export async function dbSetReaction(input: { cardId: string; memberId: string; kind: Reaction["kind"]; familyId: string }): Promise<Reaction> {
  const reaction = ReactionSchema.parse({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  });
  const sb = dbFor(reaction.familyId);
  if (!sb) return memSetReaction(reaction);
  const { error } = await sb.from("reactions").upsert(
    {
      id: reaction.id,
      family_id: reaction.familyId,
      card_id: reaction.cardId,
      member_id: reaction.memberId,
      kind: reaction.kind,
      created_at: reaction.createdAt,
    },
    { onConflict: "card_id,member_id" },
  );
  if (error) throw new DbWriteError("reactions", error.message);
  return reaction;
}

// ---- Edit / delete operations (stage 5 CRUD). Callers check family + permission. ----

export async function dbRevokeInvite(code: string, familyId: string): Promise<boolean> {
  const mem = memRevokeInvite(code, familyId);
  const sb = dbFor(familyId);
  if (!sb) return mem;
  const { error, count } = await sb.from("invites").delete({ count: "exact" }).eq("family_id", familyId).eq("code", code.trim().toUpperCase());
  return !error && ((count ?? 0) > 0 || mem);
}

export async function dbUpdateCard(id: string, familyId: string, patch: { caption?: string; transcript?: string; segments?: Card["segments"] }): Promise<Card | undefined> {
  const sb = dbFor(familyId);
  if (!sb) return memUpdateCard(id, patch);
  const row: Record<string, unknown> = {};
  if (patch.caption !== undefined) row.caption = patch.caption;
  if (patch.transcript !== undefined) row.transcript = patch.transcript;
  if (patch.segments !== undefined) row.segments = patch.segments;
  const { error } = await sb.from("cards").update(row).eq("id", id).eq("family_id", familyId);
  if (error) return undefined;
  return (await dbListCards(familyId)).find((c) => c.id === id);
}

/** Deletes a card and everything attached to it (plays, reactions, wishes). */
export async function dbDeleteCard(id: string, familyId: string): Promise<boolean> {
  const mem = memDeleteCard(id);
  const sb = dbFor(familyId);
  if (!sb) return mem;
  for (const t of ["plays", "reactions", "wishes"]) await sb.from(t).delete().eq("card_id", id);
  const { error } = await sb.from("cards").delete().eq("id", id).eq("family_id", familyId);
  return !error;
}

export async function dbRemoveReaction(cardId: string, memberId: string): Promise<boolean> {
  const mem = memRemoveReaction(cardId, memberId);
  const sb = dbFor(memberFamily(memberId));
  if (!sb) return mem;
  const { error } = await sb.from("reactions").delete().eq("card_id", cardId).eq("member_id", memberId);
  return !error;
}

/** Link two people already in the family ("Maa is Papa's wife"). */
export async function dbLinkMembers(input: { familyId: string; memberId: string; relationMemberId: string; relation: string }): Promise<Relationship> {
  const relationship = RelationshipSchema.parse({ id: crypto.randomUUID(), familyId: input.familyId, memberId: input.memberId, relationMemberId: input.relationMemberId, relation: input.relation, canonicalKind: canonicalKindFor(input.relation) });
  memAddRelationship(relationship);
  const sb = dbFor(input.familyId);
  if (!sb) return relationship;
  await sb.from("relationships").insert({ id: relationship.id, family_id: input.familyId, member_id: input.memberId, relation_member_id: input.relationMemberId, relation: input.relation });
  return relationship;
}

export async function dbDeleteRelationship(id: string, familyId: string): Promise<boolean> {
  const mem = memDeleteRelationship(id);
  const sb = dbFor(familyId);
  if (!sb) return mem;
  const { error } = await sb.from("relationships").delete().eq("id", id).eq("family_id", familyId);
  return !error || mem;
}
