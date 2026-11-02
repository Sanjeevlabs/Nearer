import { parseBirthday } from "./birthday";
import type { Member } from "./schemas";

// Demo family (synthetic seed data; the viewer cycles between members).
// Kinship titles here are data (what the family calls each person), not logic —
// the viewer-relative kinship resolver lands in M3.
export interface DemoFamily {
  id: string;
  name: string;
  defaultHomeImageRef: string | null;
}

export const DEMO_FAMILY: DemoFamily = {
  id: "demo-family",
  name: "Sharma",
  // Muse-made (scripts/gen-courtyard.mjs): an old courtyard in morning light, no people.
  defaultHomeImageRef: "/demo/home-courtyard.jpg",
};

type Seed = Omit<Member, "status">;
const active = (rows: Seed[]): Member[] => rows.map((m) => ({ ...m, status: "active" }));

export const DEMO_MEMBERS: Member[] = active([
  {
    id: "dadi",
    access: "member",
    personId: null,
    photoRef: "/demo/portrait-dadi.webp",
    email: null,
    familyId: "demo-family",
    firstName: "Kamla",
    displayName: "Maa",
    role: "elder",
    lang: "hi",
    displayLang: "hi-deva",
    tz: "Asia/Kolkata",
    city: "Amritsar",
    birthday: "1955-01-22",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "dada",
    access: "member",
    personId: null,
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Mohan",
    displayName: "Papa",
    role: "elder",
    lang: "hi",
    displayLang: "hi-deva",
    tz: "Asia/Kolkata",
    city: "Amritsar",
    birthday: "1952-08-15",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "arjun",
    access: "owner",
    personId: "p-arjun",
    photoRef: "/demo/portrait-dad.webp",
    email: null,
    familyId: "demo-family",
    firstName: "Arjun",
    displayName: "Arjun",
    role: "adult",
    lang: "en",
    displayLang: "en",
    tz: "Asia/Kolkata",
    city: "Bengaluru",
    birthday: "1987-07-30",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "leo",
    access: "member",
    personId: "p-leo",
    photoRef: "/demo/portrait-leo.webp",
    email: null,
    familyId: "demo-family",
    firstName: "Vihaan",
    displayName: "Vihaan",
    role: "child",
    lang: "en",
    displayLang: "en",
    tz: "Asia/Kolkata",
    city: "Bengaluru",
    birthday: "2017-11-09",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "aria",
    access: "child",
    personId: "p-aria",
    photoRef: "/demo/portrait-aria.webp",
    email: null,
    familyId: "demo-family",
    firstName: "Anika",
    displayName: "Anika",
    role: "child",
    lang: "en",
    displayLang: "hi-latn",
    tz: "Asia/Kolkata",
    city: "Bengaluru",
    birthday: "2019-03-14",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "priya",
    access: "member",
    personId: "p-priya",
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Priya",
    displayName: "Priya",
    role: "adult",
    lang: "en",
    displayLang: "en",
    tz: "Asia/Kolkata",
    city: "Bengaluru",
    birthday: "1989-05-02",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "kavya",
    access: "member",
    personId: null,
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Kavya",
    displayName: "Kavya",
    role: "adult",
    lang: "hi",
    displayLang: "en",
    tz: "Asia/Kolkata",
    city: "Pune",
    birthday: "1990-09-19",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "rahul",
    access: "member",
    personId: null,
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Rahul",
    displayName: "Rahul",
    role: "adult",
    lang: "en",
    displayLang: "en",
    tz: "Asia/Kolkata",
    city: "Pune",
    birthday: "1985-12-03",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "anaya",
    access: "child",
    personId: null,
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Anaya",
    displayName: "Anaya",
    role: "child",
    lang: "en",
    displayLang: "en",
    tz: "Asia/Kolkata",
    city: "Pune",
    birthday: "2018-06-25",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "rohan",
    access: "member",
    personId: null,
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Rohan",
    displayName: "Rohan",
    role: "adult",
    lang: "en",
    displayLang: "en",
    tz: "Europe/London",
    city: "London",
    birthday: "1987-03-14",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "sneha",
    access: "member",
    personId: null,
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Sneha",
    displayName: "Sneha",
    role: "adult",
    lang: "en",
    displayLang: "en",
    tz: "Europe/London",
    city: "London",
    birthday: "1989-08-30",
    homeImageRef: null,
    homePalette: [],
  },
  {
    id: "kabir",
    access: "child",
    personId: null,
    photoRef: null,
    email: null,
    familyId: "demo-family",
    firstName: "Kabir",
    displayName: "Kabir",
    role: "child",
    lang: "en",
    displayLang: "en",
    tz: "Europe/London",
    city: "London",
    birthday: "2021-11-21",
    homeImageRef: null,
    homePalette: [],
  },
]);

// Muse-made (scripts/gen-courtyard.mjs): a city balcony of plants at sunset, no people.
export const DEMO_IYER: DemoFamily = { id: "demo-iyer", name: "Iyer", defaultHomeImageRef: "/demo/home-balcony.jpg" };

// Priya's side: her parents in Chennai, her brother's family in Pune. Priya,
// Arjun and the children belong here too (same personId as on the Sharma side).
const iyer = (id: string, firstName: string, displayName: string, role: Member["role"], access: Member["access"], tz: string, birthday: string, personId: string | null = null, photoRef: string | null = null, lang = "en", displayLang: Member["displayLang"] = "en", city = "Chennai"): Member => ({
  id,
  access,
  status: "active",
  personId,
  photoRef,
  email: null,
  familyId: "demo-iyer",
  firstName,
  displayName,
  role,
  lang,
  displayLang,
  tz,
  city,
  birthday,
  homeImageRef: null,
  homePalette: [],
});

export const DEMO_IYER_MEMBERS: Member[] = [
  iyer("iyer-priya", "Priya", "Priya", "adult", "owner", "Asia/Kolkata", "1989-05-02", "p-priya", null, "en", "en", "Bengaluru"),
  iyer("iyer-arjun", "Arjun", "Arjun", "adult", "member", "Asia/Kolkata", "1987-07-30", "p-arjun", "/demo/portrait-dad.webp", "en", "en", "Bengaluru"),
  iyer("iyer-leo", "Vihaan", "Vihaan", "child", "child", "Asia/Kolkata", "2017-11-09", "p-leo", "/demo/portrait-leo.webp", "en", "en", "Bengaluru"),
  iyer("iyer-aria", "Anika", "Anika", "child", "child", "Asia/Kolkata", "2019-03-14", "p-aria", "/demo/portrait-aria.webp", "en", "en", "Bengaluru"),
  iyer("iyer-nani", "Lakshmi", "Amma", "elder", "member", "Asia/Kolkata", "1958-02-11", null, null, "ta", "ta"),
  iyer("iyer-nana", "Venkat", "Appa", "elder", "member", "Asia/Kolkata", "1955-09-05", null, null, "ta", "ta"),
  iyer("iyer-karthik", "Karthik", "Karthik", "adult", "member", "Asia/Kolkata", "1986-01-27", null, null, "en", "en", "Pune"),
  iyer("iyer-meera", "Meera", "Meera", "adult", "member", "Asia/Kolkata", "1988-06-08", null, null, "en", "en", "Pune"),
  iyer("iyer-diya", "Diya", "Diya", "child", "child", "Asia/Kolkata", "2016-10-02", null, null, "en", "en", "Pune"),
];

/** Demo homes: the synthetic families the demo invite code opens. */
export const DEMO_FAMILY_IDS = ["demo-family", "demo-iyer"] as const;
/** The seed itself: synthetic, in memory, never written to. */
export const isSeedFamily = (familyId: string): boolean => (DEMO_FAMILY_IDS as readonly string[]).includes(familyId);
/**
 * A demo visitor's own copy of the seed, kept in the database for 48 hours
 * (lib/demo-sandbox.ts): `demo-v-<12 hex>` for the Sharma side,
 * `demo-v-<12 hex>-iyer` for the Iyer side.
 */
export const SANDBOX_PREFIX = "demo-v-";
export const isSandboxFamily = (familyId: string): boolean => /^demo-v-[0-9a-f]{12}(-[a-z]+)?$/.test(familyId);
/** Demo behaviour (persona switch, no public shares, no cron spend): the seed and every visitor copy. */
export const isDemoFamily = (familyId: string): boolean => isSeedFamily(familyId) || isSandboxFamily(familyId);

export const DEFAULT_VIEWER_ID = "arjun";

/**
 * The photo behind a family's courtyard header: the viewer's own home photo
 * when they set one, else a Muse-made home (each demo side has its own; a
 * visitor's sandbox copy keeps its seed's). Always a photo, never blank.
 */
export function familyHomePhoto(familyId: string | null | undefined, own: string | null | undefined): string {
  if (own) return own;
  const id = familyId ?? "";
  const seed = [DEMO_FAMILY, DEMO_IYER].find((f) => f.id === id || (isSandboxFamily(id) && f.id !== DEMO_FAMILY.id && id.endsWith(f.id.replace(/^demo/, ""))));
  return seed?.defaultHomeImageRef ?? DEMO_FAMILY.defaultHomeImageRef ?? "/demo/home-courtyard.jpg";
}

// Signal + role lines per viewer display_lang (data, not logic).
// en, hi-latn (Latin script), hi-deva (Devanagari).
export const MOCK_SIGNAL_LINES: Record<string, string> = {
  dadi: "Arjun sent you a voice note · Priya asked for your dal recipe",
  arjun: "Maa heard your voice note · Papa sent a blessing",
  dada: "Arjun asked for your blessing · Priya sent a photo",
  priya: "Maa heard your voice note · 1 new recipe",
};

export const SIGNAL_LINES_BY_LANG: Record<string, Record<string, string>> = {
  en: {
    dadi: "Arjun sent you a voice note · Priya asked for your dal recipe",
    dada: "Arjun asked for your blessing · Priya sent a photo",
    arjun: "Maa heard your voice note · Papa sent a blessing",
    priya: "Maa heard your voice note · 1 new recipe",
  },
  "hi-latn": {
    dadi: "Arjun ne aapko voice note bheja · Priya ne dal ki recipe maangi",
    dada: "Arjun ne aashirvaad maanga · Priya ne photo bheji",
    arjun: "Maa ne aapka voice note suna · Papa ne aashirvaad bheja",
    priya: "Maa ne aapka voice note suna · 1 nayi recipe",
  },
  "hi-deva": {
    dadi: "अर्जुन ने आपको वॉइस नोट भेजा · प्रिया ने दाल की रेसिपी माँगी",
    dada: "अर्जुन ने आशीर्वाद माँगा · प्रिया ने फ़ोटो भेजी",
    arjun: "माँ ने आपका वॉइस नोट सुना · पापा ने आशीर्वाद भेजा",
    priya: "माँ ने आपका वॉइस नोट सुना · 1 नई रेसिपी",
  },
};

export function signalLineFor(viewerId: string, displayLang: string): string {
  return (
    SIGNAL_LINES_BY_LANG[displayLang]?.[viewerId] ??
    MOCK_SIGNAL_LINES[viewerId] ??
    // Real families get no invented signal; the demo family's lines are seeded.
    ""
  );
}

// Days from `now` until the next MM-DD birthday. Pure and data-driven.
/** Days until the next birthday; Infinity when no birthday has been added. */
export function daysUntilBirthday(birthday: string, now = new Date()): number {
  const p = parseBirthday(birthday);
  if (!p) return Number.POSITIVE_INFINITY;
  const { month: m, day: d } = p;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let next = new Date(Date.UTC(now.getUTCFullYear(), m - 1, d));
  if (next < start) next = new Date(Date.UTC(now.getUTCFullYear() + 1, m - 1, d));
  return Math.round((next.getTime() - start.getTime()) / 86400000);
}
