// Server side of the window (the first screen): who's on the other side, their
// real place and sky, and what they shared today. Server only.
import { can } from "./permissions";
import { DEFAULT_IMAGE } from "./hero";
import { z } from "zod";
import { dbListCards, dbListMembers, dbListPlays, dbListReactions, dbListRelationships } from "./db";
import { getDoc, listDocs } from "./family-docs";
import type { Presence, WindowView } from "./kinds";
import { museJson } from "./muse";
import { MOMENT_LABEL, todayFor } from "./presence";
import type { Member } from "./schemas";
import { fetchWeather, geocode, mockPlace, mockWeather, phaseFor, type DayPhase, type PlaceHint, type Weather } from "./weather";
import { countryOfMember } from "./place";
import { checkinEvents, composedLine, type DayMoment } from "./window-words";
import { cityOf, farHomeFor } from "./window";
import { hourIn } from "./zones";
import { aliveState, type Alive } from "./status";
import { dayRhythm, rhythmLine, type DayRhythm } from "./rhythm";
import { isNightAt, moonPhase, skyGlyph } from "./sky";
import type { Wall } from "./kinds";
import { withDemoShelf } from "./demo";
import { isDemoFamily } from "./auth";
import { createDownloadUrl } from "./storage";
import { sinceLines } from "./since";
import { describeLang } from "./languages";
import { isMockMode } from "./config";
import { awakeNow, callTile, nextUp, waitingForYou, type Glance } from "./glance";
import { listEvents } from "./gather-store";
import { familyHolidays } from "./occasions-server";
import { occasionsInRange, addDays } from "./occasion-calendar";
import { dateIn } from "./today";

export interface WindowPerson {
  id: string;
  lastActive: string | null;
  state: Alive;
  line: string;
  rhythm: DayRhythm;
  /** What they shared today (their local day), oldest first: chai, a walk, the temple. */
  moments: DayMoment[];
  /** Today's safety check-ins, oldest first. */
  checkins: { at: string; label: string }[];
}

export interface WindowState {
  view: WindowView | null;
  /** The viewer's chosen family photo, else DEFAULT_IMAGE. A home photo (below) wins over both. */
  imageRef: string;
  far: { ids: string[]; names: string; city: string; tz: string } | null;
  /** Only when the weather fetch succeeded. Otherwise null, and nothing about the weather is said anywhere. */
  weather: Weather | null;
  phase: DayPhase;
  /** One factual line under the photo (empty when there is nothing true to say). */
  line: string;
  /** What they shared today, newest first, in words ("is having chai"). */
  moments: { memberId: string; label: string; at: string }[];
  /** Safe & sound at a glance, per person at the window (at most two). */
  people: WindowPerson[];
  /** This viewer's amber threshold, in hours. */
  quietAfterHours: number;
  /** The viewer's previous visit and what happened after it, in plain words (newest first, at most three). */
  since: { at: string | null; lines: string[]; line?: string };
  /** A family photo was chosen for this window. */
  chosen: boolean;
  /** Someone on the other side has signed in (has an account). Emails never leave the server. */
  joined: boolean;
  /** How far apart the two homes are, in km (city to city), only when both places are known. */
  km: number | null;
  /** The wall setting (tolerated, unused on the first screen). */
  wall: Wall;
  /**
   * The sky badge: the sun between their sunrise and sunset, the moon only at
   * night, nothing at twilight or when we don't know where they are.
   * `bothNight`: it is night at both homes, the only time "the same moon" is true.
   */
  sky: { glyph: "sun" | "moon" | null; moon: { illumination: number; waxing: boolean; name: string }; bothNight: boolean };
  /** Is now a good time to call, in their day and yours. */
  call: { good: boolean; text: string };
  /** Four 3-second answers about the whole family (under Safe & sound). */
  glance: Glance;
  /** A photo of their actual home as the view (a media ref), else null: the default photo. */
  homePhoto: string | null;
}

/**
 * A viewer's window before they've changed anything. The first screen is one
 * still photograph (the default photo until they set their own). The old
 * slideshow, scene and pots fields stay in the document and are tolerated.
 */
export function defaultView(familyId: string, memberId: string): WindowView {
  return {
    id: memberId,
    memberId,
    cardId: null,
    imageRef: null,
    style: "still",
    layers: [],
    line: "",
    madeBy: "family",
    quietAfterHours: 4,
    people: [],
    wall: "jodhpur",
    scene: "window",
    pots: isDemoFamily(familyId) ? ["marigold", "jasmine"] : [],
    homePhoto: null,
    mixAlbum: true,
    updatedAt: new Date(0).toISOString(),
  };
}

const STORAGE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;

/**
 * Is this media ref the family's own photo? Either a file this family
 * uploaded to its private storage (and that exists), or the photo of one of
 * its own photo cards. Never another family's path, never another host.
 */
export async function homePhotoOk(familyId: string, ref: string): Promise<boolean> {
  if (ref.startsWith("storage:")) {
    const path = ref.slice("storage:".length);
    if (!path.startsWith(`${familyId}/`) || path.includes("..") || !STORAGE_PATH.test(path)) return false;
    return (await createDownloadUrl(path)) !== null;
  }
  const cards = withDemoShelf(await dbListCards(familyId), familyId);
  return cards.some((c) => c.type === "photo" && c.mediaRef === ref);
}

/** The photo when a family has set none. Defined in lib/hero.ts (switch it there). */
export { DEFAULT_IMAGE };

const mock = () => process.env.MOCK === "true";

/** Weather only when the Open-Meteo fetch succeeded (mock mode: the deterministic stand-in). Otherwise null: nothing is guessed. */
async function weatherFor(city: string, hint: PlaceHint): Promise<Weather | null> {
  if (!city) return null;
  return mock() ? mockWeather(city) : await fetchWeather(city, hint);
}

/** Where a city is (the right city in the right country), or null. */
async function placeFor(city: string, hint: PlaceHint): Promise<{ lat: number; lon: number } | null> {
  if (!city) return null;
  return mock() ? mockPlace(city) : await geocode(city, hint);
}

function names(ms: Member[]): string {
  const call = (m: Member) => m.displayName || m.firstName;
  const list = ms.filter((m) => m.role !== "child").map(call);
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`;
}

function localDay(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export async function windowState(familyId: string, viewerId: string, now = new Date()): Promise<WindowState> {
  const [members, relationships, view] = await Promise.all([dbListMembers(familyId), dbListRelationships(familyId), getDoc(familyId, "window_view", viewerId)]);
  const viewer = members.find((m) => m.id === viewerId);
  const farHome = viewer ? farHomeFor(viewer, members, relationships) : undefined;
  // Who's at your window: your choice (at most two), else the grown-ups on the other side.
  // Teens are never at a window, even if picked before they became one.
  const chosen = (view?.people ?? []).map((id) => members.find((m) => m.id === id && m.id !== viewerId)).filter((m): m is Member => Boolean(m) && can(m, "window.at")).slice(0, 2);
  const home = chosen.length ? { id: `chosen-${chosen.map((m) => m.id).join("-")}`, members: chosen, tz: chosen[0].tz, elders: chosen.some((m) => m.role === "elder") } : farHome;
  const city = cityOf(home);
  const tz = home?.tz ?? viewer?.tz ?? "UTC";
  const phase = phaseFor(hourIn(tz, now));
  // Which city: the one in the member's own country (their time zone's), never just the first match.
  const cityMember = home?.members.find((m) => m.city);
  const farHint: PlaceHint = { country: countryOfMember(cityMember), tz: cityMember?.tz ?? tz };
  const hereHint: PlaceHint = { country: countryOfMember(viewer), tz: viewer?.tz };
  const [weather, farPlace, herePlace] = await Promise.all([weatherFor(city, farHint), placeFor(city, farHint), placeFor(viewer?.city ?? "", hereHint)]);
  const presence = await listDocs(familyId, "presence");
  const ids = home?.members.map((m) => m.id) ?? [];
  const today: Presence[] = ids.flatMap((id) => todayFor(id, presence, tz, now)).filter((p) => p.moment !== "here");
  today.sort((a, b) => b.at.localeCompare(a.at));
  const who = names(home?.members ?? []);
  const nameOfId = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m?.displayName || m?.firstName || "";
  };
  const line = composedLine({ who: today[0] ? nameOfId(today[0].memberId) : who, moment: today[0] ? { label: MOMENT_LABEL[today[0].moment].label, at: today[0].at } : null, weather, city, tz });
  // Last sign of life in Aangan: any moment (opening the app included), a
  // voice or photo they sent, a safety check-in. Only what they already share.
  const [cards, checkins, settings] = await Promise.all([dbListCards(familyId), listDocs(familyId, "safety_checkin"), listDocs(familyId, "care_settings")]);
  const signs = (id: string): string[] =>
    [
      ...presence.filter((p) => p.memberId === id).map((p) => p.at),
      ...withDemoShelf(cards, familyId).filter((c) => c.authorId === id && Date.parse(c.takenAt) <= now.getTime()).map((c) => c.takenAt),
      ...checkins.filter((c) => c.memberId === id).map((c) => c.closedAt ?? c.at),
    ].filter((t) => Date.parse(t) <= now.getTime());
  const lastSeen = (id: string): string | null => signs(id).sort().pop() ?? null;
  const people: WindowPerson[] = (home?.members ?? [])
    .filter((m) => m.role !== "child")
    .map((m) => {
      const shares = settings.find((s) => s.memberId === m.id)?.shareVisits ?? true;
      const lastActive = shares ? lastSeen(m.id) : null;
      const state = aliveState(lastActive, m.tz, { shares, now, quietAfter: view?.quietAfterHours });
      const rhythm = dayRhythm(shares ? signs(m.id) : [], m.tz, now);
      // The only sign being the app heartbeat (just opening Aangan) is not "active" for long.
      const latestShared = presence.find((p) => p.memberId === m.id && p.at === lastActive);
      const heartbeatOnly = Boolean(lastActive) && latestShared?.moment === "here";
      const shared = dayOf(m.id, m.tz);
      return {
        id: m.id,
        lastActive,
        state,
        rhythm,
        line: rhythmLine(state, lastActive, rhythm, m.tz, (iso) => agoWords(iso, now), { heartbeatOnly, now }),
        moments: shares ? shared.moments : [],
        checkins: shared.checkins,
      };
    })
    .slice(0, 2);
  function dayOf(id: string, mtz: string): { moments: DayMoment[]; checkins: { at: string; label: string }[] } {
    const day = localDay(now.toISOString(), mtz);
    const moments = todayFor(id, presence, mtz, now)
      .filter((p) => p.moment !== "here" && Date.parse(p.at) <= now.getTime())
      .map((p) => ({ label: MOMENT_LABEL[p.moment].label, note: p.note ?? "", at: p.at }));
    const mine = checkins
      .filter((c) => c.memberId === id)
      .flatMap((c) => checkinEvents(c))
      .filter((e) => localDay(e.at, mtz) === day && Date.parse(e.at) <= now.getTime())
      .sort((a, b) => a.at.localeCompare(b.at));
    return { moments, checkins: mine };
  }
  // Since you were here: the visit before this one (the latest "here" is this visit).
  const visits = presence
    .filter((p) => p.memberId === viewerId && p.moment === "here" && Date.parse(p.at) <= now.getTime())
    .map((p) => p.at)
    .sort();
  const previous = visits.length >= 2 ? visits[visits.length - 2] : null;
  let sinceWords: string[] = [];
  if (previous) {
    const [plays, reactions] = await Promise.all([dbListPlays(undefined, familyId), dbListReactions(undefined, familyId)]);
    const sharing = new Set((home?.members ?? []).filter((m) => settings.find((s) => s.memberId === m.id)?.shareVisits ?? true).map((m) => m.id));
    sinceWords = sinceLines({
      viewerId,
      at: previous,
      now,
      names: Object.fromEntries(members.map((m) => [m.id, m.displayName || m.firstName])),
      farIds: ids,
      cards: withDemoShelf(cards, familyId),
      plays,
      reactions,
      checkins: checkins.filter((c) => sharing.has(c.memberId)),
    });
  }
  const sinceLine = await sinceSentence(familyId, viewerId, viewer?.displayLang ?? "en", sinceWords);
  const own = view ?? defaultView(familyId, viewerId);
  const imageRef = view?.imageRef ?? DEFAULT_IMAGE;
  return {
    view: view ? { ...view, style: "still" } : null,
    imageRef,
    far: home ? { ids, names: who, city, tz } : null,
    weather,
    phase,
    line,
    moments: today.slice(0, 4).map((p) => ({ memberId: p.memberId, label: MOMENT_LABEL[p.moment].line, at: p.at })),
    people,
    since: { at: previous, lines: sinceWords, ...(sinceLine ? { line: sinceLine } : {}) },
    quietAfterHours: view?.quietAfterHours ?? 4,
    chosen: Boolean(view?.cardId && view.imageRef),
    km: distanceKm(farPlace, herePlace),
    wall: view?.wall ?? "jodhpur",
    sky: skyOver(farPlace, herePlace, now),
    call: callHint(tz, viewer?.tz ?? tz, home?.members.filter((m) => m.role !== "child").map((m) => m.displayName || m.firstName) ?? [], now),
    // Signed in, or has done anything in Aangan (the demo family has no emails).
    joined: (home?.members ?? []).some((m) => m.role !== "child" && (Boolean(m.email) || lastSeen(m.id) !== null)),
    glance: await glanceFor(familyId, viewerId, members, home?.tz ?? null, cards, now, lastSeen),
    homePhoto: own.homePhoto,
  };
}

/**
 * The glance strip: who is awake, what waits for the viewer, what is next, and
 * the weekly call in both zones. Never throws: a failed source just empties its tile.
 */
async function glanceFor(familyId: string, viewerId: string, members: Member[], theirTz: string | null, cards: Awaited<ReturnType<typeof dbListCards>>, now: Date, lastSeen: (id: string) => string | null): Promise<Glance> {
  const viewer = members.find((m) => m.id === viewerId);
  const myTz = viewer?.tz ?? "UTC";
  const names = Object.fromEntries(members.map((m) => [m.id, m.displayName || m.firstName]));
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  const today = dateIn(myTz, now);
  const [plays, questions, tasks, needs, events, call, hol] = await Promise.all([
    safe(dbListPlays(undefined, familyId), []),
    safe(listDocs(familyId, "question"), []),
    safe(listDocs(familyId, "today_task"), []),
    safe(listDocs(familyId, "need"), []),
    safe(listEvents(familyId), []),
    safe(getDoc(familyId, "weekly_call", "weekly-call"), undefined),
    safe(familyHolidays(familyId, members).then((h) => h.visible), []),
  ]);
  return {
    awake: awakeNow(members, viewerId, now, lastSeen),
    waiting: waitingForYou({ viewerId, now, names, cards: withDemoShelf(cards, familyId), plays, questions, today: tasks.slice(0, 4), needs }),
    next: nextUp({
      today,
      now,
      tz: myTz,
      viewerId,
      names,
      events: events.map((e) => ({ id: e.id, title: e.title, date: e.date, status: e.status, occasionKey: e.occasionKey, forMemberId: e.forMemberId, startsAt: e.status === "locked" ? (e.slots.find((sl) => sl.id === e.lockedSlotId)?.startsAt ?? null) : null })),
      occasions: occasionsInRange(members, hol, today, addDays(today, 120)),
    }),
    call: callTile(call, myTz, theirTz, now),
  };
}

/** City to city, to the nearest 10 km, only when both places are known and really apart. */
export function distanceKm(a: { lat: number; lon: number } | null, b: { lat: number; lon: number } | null): number | null {
  if (!a || !b) return null;
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(x));
  return km < 15 ? null : Math.round(km / 10) * 10;
}

function agoWords(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** The sky over their home from real coordinates; without them, no glyph (never a guess). */
export function skyOver(far: { lat: number; lon: number } | null, here: { lat: number; lon: number } | null, now: Date): WindowState["sky"] {
  const m = moonPhase(now);
  return {
    glyph: skyGlyph(far?.lat, far?.lon, now),
    moon: { illumination: Math.round(m.illumination * 100) / 100, waxing: m.waxing, name: m.name },
    bothNight: isNightAt(far?.lat, far?.lon, now) === true && isNightAt(here?.lat, here?.lon, now) === true,
  };
}

function clockIn(tz: string, d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  } catch {
    return "";
  }
}

/** Both awake and not in the dead of night on either side: say so. Otherwise, when. */
export function callHint(theirTz: string, myTz: string, names: string[], now = new Date()): { good: boolean; text: string } {
  const them = hourIn(theirTz, now);
  const me = hourIn(myTz, now);
  const who = names.length <= 1 ? (names[0] ?? "them") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  if (them >= 8 && them < 21.5 && me >= 7 && me < 23) return { good: true, text: `Good time to call ${who}` };
  if (them < 8 || them >= 21.5) {
    // Next 8 AM there, in your time.
    const wait = ((8 - them + 24) % 24) * 3_600_000;
    return { good: false, text: `They're asleep · best from 8 AM their time (${clockIn(myTz, new Date(now.getTime() + wait))} yours)` };
  }
  return { good: false, text: `It's late for you · ${clockIn(theirTz, now)} there` };
}

/** A photo card from this family, as the window's image. */
export async function photoRefFor(familyId: string, cardId: string): Promise<string | null> {
  const card = withDemoShelf(await dbListCards(familyId), familyId).find((c) => c.id === cardId);
  if (!card || card.type !== "photo") return null;
  return card.mediaRef;
}

const SinceSchema = z.object({ line: z.string().min(3).max(140) });

/**
 * One warm sentence from the plain "since you were here" lines, in the
 * viewer's language. Grounded (no digits, nothing but the given facts), cached
 * and ledgered by museJson; null means "show the plain lines".
 */
export async function sinceSentence(
  familyId: string,
  viewerId: string,
  lang: string,
  lines: string[],
  ask: typeof museJson = museJson,
  mock: boolean = isMockMode(),
): Promise<string | null> {
  if (mock || lines.length < 2) return null;
  const plain = lines.join(". ");
  const out = await ask({
    familyId,
    purpose: "Wrote the catch-up line for the window",
    system:
      "Turn these facts into ONE warm sentence for the person who has been away, in the language named. " +
      "Use ONLY the names and facts given. Never invent events, feelings or details, and never use numbers or counts. " +
      "Keep names as written. Max 140 characters. Reply JSON only: {\"line\": str}.",
    user: `Viewer: ${viewerId}\nLanguage: ${describeLang(lang)}\nFacts:\n${lines.map((l) => `- ${l}`).join("\n")}`,
    schema: SinceSchema,
    mock: () => ({ line: plain.slice(0, 140) }),
    fallback: { line: plain.slice(0, 140) },
    maxTokens: 200,
    accept: (d) => !/\d/.test(d.line),
  });
  return out.source === "muse" ? out.data.line : null;
}
