// What one request reads about a family, read once. The courtyard answers ten
// slices from one request and each used to load the same members, cards,
// calendar settings and document lists for itself. These helpers memoise those
// reads on the Request (lib/request-memo.ts), so the first asker pays the round
// trip and the rest share it; preloadFamily starts the shared reads before the
// session check has answered, so they ride the same wave as the auth lookup.
//
// For GET handlers only: a handler that writes and then re-reads must go to the
// database. Server only.
import { dbGetFamilyName, dbListCards, dbListMembers, dbListRelationships } from "./db";
import { listDocs, listDocsMany, listDocsManyWith, type RawDocRows } from "./family-docs";
import { EVENT_DOC_KINDS, eventsFromBatch } from "./gather-store";
import type { DocKind, DocOf } from "./kinds";
import { RITUAL_SETTINGS_KIND, getRitualSettings, ritualSettingsFromBatch } from "./occasion-settings";
import { familyHolidays } from "./occasions-server";
import { has, once, seedMember } from "./request-memo";

/** Everyone in the family, waiting joiners included: one query, which membersFor and the session's own row both come from. */
export const membersAllFor = (req: Request, familyId: string) => once(req, `members-all:${familyId}`, () => dbListMembers(familyId, { includePending: true }));
export const membersFor = (req: Request, familyId: string) => once(req, `members:${familyId}`, async () => (await membersAllFor(req, familyId)).filter((m) => m.status !== "pending"));

/**
 * The signed-in member's row comes out of the family list the route reads anyway, so the
 * session check costs no round trip of its own. Call before requireSession, with the session
 * the signed cookie claims. Someone not in that list (removed, moved) is still looked up by id.
 */
export function preloadSessionMember(req: Request, claimed: { familyId: string; memberId: string }): void {
  seedMember(req, claimed.memberId, async () => (await membersAllFor(req, claimed.familyId)).find((m) => m.id === claimed.memberId) ?? null);
}
export const relationshipsFor = (req: Request, familyId: string) => once(req, `relationships:${familyId}`, () => dbListRelationships(familyId));
/** The whole shelf (the lane's view). The window and the week counts ask dbListCards for a bounded slice instead. */
export const cardsFor = (req: Request, familyId: string) => once(req, `cards:${familyId}`, () => dbListCards(familyId));
export const familyNameFor = (req: Request, familyId: string) => once(req, `name:${familyId}`, () => dbGetFamilyName(familyId));
export const ritualSettingsFor = (req: Request, familyId: string) => once(req, `ritual-settings:${familyId}`, () => getRitualSettings(familyId));

/** The family's calendar: its members' zones pick the country, its settings pick what shows. Callers keep their own catch. */
export const holidaysOf = (req: Request, familyId: string) =>
  once(req, `holidays:${familyId}`, async () => familyHolidays(familyId, await membersFor(req, familyId), {}, { settings: ritualSettingsFor(req, familyId) }));

/** One kind's documents, listed once per request. */
export function docsFor<K extends DocKind>(req: Request, familyId: string, kind: K): Promise<DocOf<K>[]> {
  return once(req, `docs:${familyId}:${kind}`, () => listDocs(familyId, kind));
}

/** Several kinds in one round trip; later docsFor calls for them are free. Kinds already asked for are left alone. */
export function prefetchDocs(req: Request, familyId: string, kinds: readonly DocKind[]): void {
  const fresh = kinds.filter((k, i) => kinds.indexOf(k) === i && !has(req, `docs:${familyId}:${k}`));
  if (fresh.length === 0) return;
  const batch = listDocsMany(familyId, fresh);
  for (const k of fresh) once(req, `docs:${familyId}:${k}`, () => batch.then((all) => all[k] as DocOf<typeof k>[]));
}

/**
 * prefetchDocs plus, in the same query, the family's calendar settings and its
 * events (stores with their own kinds in family_docs): ritualSettingsFor and
 * eventsFor then cost nothing. Call before anything asks for those.
 */
export function prefetchDocsWithStores(req: Request, familyId: string, kinds: readonly DocKind[]): void {
  const fresh = kinds.filter((k, i) => kinds.indexOf(k) === i && !has(req, `docs:${familyId}:${k}`));
  const batch = listDocsManyWith(familyId, fresh, [RITUAL_SETTINGS_KIND, ...EVENT_DOC_KINDS]);
  batch.catch(() => undefined);
  for (const k of fresh) once(req, `docs:${familyId}:${k}`, () => batch.then((all) => all.docs[k] as DocOf<typeof k>[]));
  if (!has(req, `ritual-settings:${familyId}`)) once(req, `ritual-settings:${familyId}`, () => batch.then((b) => ritualSettingsFromBatch(familyId, b.extra?.get(RITUAL_SETTINGS_KIND))));
  once(req, `events-raw:${familyId}`, () => batch.then((b) => b.extra).catch(() => null));
}

/** The family's events and this member's dismissed prompts (from prefetchDocsWithStores' query when it ran). */
export async function eventsFor(req: Request, familyId: string, memberId: string) {
  const raw = has(req, `events-raw:${familyId}`) ? await once(req, `events-raw:${familyId}`, async () => null as RawDocRows | null) : null;
  return eventsFromBatch(familyId, memberId, raw);
}


/** The documents every courtyard slice reads, whoever is looking. */
export const COURTYARD_KINDS = ["safety_settings", "safety_checkin", "presence", "care_settings", "sitting", "knock", "project", "chitthi", "today_task", "habit", "habit_tick", "kid_ask", "bedtime_story"] as const;
/** The extra ones an elder's slices (gifts, keeper, care) and a child's (stories) read. */
export const ELDER_KINDS = ["recipe", "attempt", "story", "question", "need", "helper"] as const;
export const CHILD_KINDS = ["story", "question"] as const;

/** The reads nearly every slice leans on, started now: call it before the session check, with the session the signed cookie claims. */
export function preloadCore(req: Request, claimed: { familyId: string; memberId: string }): void {
  const familyId = claimed.familyId;
  preloadSessionMember(req, claimed);
  void membersFor(req, familyId).catch(() => undefined);
  void ritualSettingsFor(req, familyId).catch(() => undefined);
  void cardsFor(req, familyId).catch(() => undefined);
}

export function preloadCourtyard(req: Request, claimed: { familyId: string; memberId: string }): void {
  const familyId = claimed.familyId;
  // First, so the calendar settings come out of the documents query instead of one of their own.
  prefetchDocsWithStores(req, familyId, COURTYARD_KINDS);
  preloadCore(req, claimed);
  void relationshipsFor(req, familyId).catch(() => undefined);
  void familyNameFor(req, familyId).catch(() => undefined);
}
