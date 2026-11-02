// The live window (PR window-live): the lamp means an explicit tap, the sky is
// real, the renderer is one constant, and /api/window is bounded and never
// waits on the holiday feed.
import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as lampGET, POST as lampPOST } from "@/app/api/lamp/route";
import { GET as windowGET } from "@/app/api/window/route";
import { addCard } from "@/lib/store";
import { RENDERER_COMPONENT, SCENE_RENDERER, isRetiredHero, photoSceneCandidates } from "@/lib/hero";
import { glowFrom, lampView } from "@/lib/lamp";
import { moonPhase, sunPosition } from "@/lib/sky";
import { phaseFromSun, skyState, weatherLayer } from "@/lib/sky-state";
import { arrivedLine, firstNameOf, lampState, moonLine, statusLine } from "@/lib/window-words";
import { resetDemo } from "@/lib/store";
import { authedGet, authedJson } from "./auth-helper";

const AMRITSAR = { lat: 31.63, lon: 74.87, tz: "Asia/Kolkata" };
const H = 3_600_000;

describe("the lamp is lit only by an explicit tap", () => {
  beforeEach(() => resetDemo());

  it("a voice note from their home does not light it; a tap does", async () => {
    const read = async (as: string) => ((await (await lampGET(authedGet("http://t/api/lamp", as))).json()) as { lamps: { memberIds: string[]; litAt: string | null; litBy: string | null }[] }).lamps;
    const dadiHome = (ls: Awaited<ReturnType<typeof read>>) => ls.find((l) => l.memberIds.includes("dadi"));
    const before = dadiHome(await read("arjun"));
    // A fresh voice note from Maa: in the old rules this counted as lighting her lamp.
    addCard({ id: "t-voice-now", familyId: "demo-family", type: "audio", caption: "Hello", lang: "en", takenAt: new Date().toISOString(), authorId: "dadi", source: "upload" });
    const after = dadiHome(await read("arjun"));
    expect(after?.litAt).toBe(before?.litAt ?? null);
    expect((await lampPOST(authedJson("http://t/api/lamp", { action: "light" }, "dadi"))).status).toBe(200);
    const lit = dadiHome(await read("arjun"));
    expect(lit?.litBy).toBe("dadi");
    expect(lit?.litAt).not.toBeNull();
  });

  it("lampView reads nothing but lamp documents, and hides someone who keeps visits private", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    const homes = [
      { id: "h1", members: [{ id: "a" }], tz: "UTC", elders: false },
      { id: "h2", members: [{ id: "b" }], tz: "UTC", elders: true },
    ] as unknown as Parameters<typeof lampView>[0];
    const lamps = [{ id: "h2", litAt: new Date(now - H / 2).toISOString(), litBy: "b", beats: [], felt: { b: new Date(now - H).toISOString() }, lit: {}, pushed: {}, updatedAt: "" }] as Parameters<typeof lampView>[1];
    const v = lampView(homes, lamps, "a", new Set(), now);
    expect(v.lamps.find((l) => l.homeKey === "h2")).toMatchObject({ litBy: "b", glow: 0.75 });
    expect(v.arrived).toMatchObject({ from: "b" });
    expect(lampView(homes, lamps, "a", new Set(["b"]), now).lamps.find((l) => l.homeKey === "h2")?.litAt).toBeNull();
  });

  it("glow is full when lit and fades straight to nothing at 2 h", () => {
    const lit = "2026-11-01T00:00:00Z";
    const t = Date.parse(lit);
    expect(glowFrom(lit, t)).toBe(1);
    expect(glowFrom(lit, t + H / 2)).toBe(0.75);
    expect(glowFrom(lit, t + 2 * H)).toBe(0);
    expect(skyState({ ...AMRITSAR, now: new Date(t + H / 2), lampLitAt: lit }).lampGlow).toBeCloseTo(0.75, 2);
  });

  it("the state lines say who lit it, when, and that it was felt", () => {
    const now = new Date("2026-11-02T04:00:00Z");
    const nameOf = (id: string) => ({ dadi: "Maa", arjun: "Arjun" })[id] ?? "";
    const base = { viewerId: "arjun", nameOf, city: "Amritsar", now, tz: "Asia/Kolkata" };
    expect(lampState({ ...base, theirs: { litAt: "2026-11-02T02:40:00Z", litBy: "dadi" }, mine: undefined, felt: null }).line).toBe("Maa lit it for you · 8:10 AM");
    const mine = lampState({ ...base, theirs: undefined, mine: { litAt: "2026-11-02T02:40:00Z", litBy: "arjun" }, felt: { by: "dadi", at: "2026-11-02T03:12:00Z" }, forName: "Maa" });
    expect(mine.line).toBe("Glowing for Maa · 40 m");
    expect(mine.felt).toBe("Maa saw it · 8:42 AM");
    // The glow lasts 2 hours: after that the lamp asks again.
    const gone = lampState({ ...base, theirs: { litAt: "2026-11-02T01:00:00Z", litBy: "dadi" }, mine: undefined, felt: null });
    expect(gone).toEqual({ lit: false, line: "Light the lamp \u2014 they\u2019ll know you\u2019re thinking of them", felt: null });
    expect(lampState({ ...base, theirs: undefined, mine: { litAt: "2026-11-02T04:00:00Z", litBy: "arjun" }, felt: null, forName: "Maa" }).line).toBe("Glowing for Maa · 2 h");
  });
});

describe("a light that arrived", () => {
  it("says who is thinking of you for 24 h, then nothing", () => {
    const nameOf = (id: string) => (id === "dadi" ? "Maa" : "");
    const now = new Date("2026-11-02T12:00:00Z");
    expect(arrivedLine({ from: "dadi", at: "2026-11-02T06:00:00Z" }, nameOf, now)).toBe("Maa is thinking of you");
    expect(arrivedLine({ from: "dadi", at: "2026-11-01T06:00:00Z" }, nameOf, now)).toBeNull();
    expect(arrivedLine(null, nameOf, now)).toBeNull();
  });
});

describe("the one status line", () => {
  const P = (name: string, state: "active" | "quiet" | "asleep" | "unknown" | "private", lastActive: string | null = null, alarm: string | null = null) => ({ name, state, lastActive, tz: "Asia/Kolkata", alarm });
  it("says all is well, or names the one person", () => {
    expect(statusLine([P("Maa", "active"), P("Papa", "active")])?.text).toBe("Both active in Nearer today \u00b7 all good");
    expect(statusLine([P("Maa", "active"), P("Papa", "quiet", "2026-11-02T04:30:00Z")])).toMatchObject({ text: "Papa quiet since 10 AM", tone: "quiet", subject: 1 });
    expect(statusLine([P("Maa", "active")])?.text).toBe("Maa active in Nearer today \u00b7 all good");
    expect(statusLine([P("Maa", "asleep"), P("Papa", "asleep")])?.text).toBe("Night-time there \u00b7 all good");
    expect(statusLine([P("Maa", "active"), P("Papa", "active", null, "Home late")])).toMatchObject({ text: "Papa \u00b7 Home late", tone: "alarm", subject: 1 });
  });
  it("says nothing for nobody or for people who keep their activity private", () => {
    expect(statusLine([])).toBeNull();
    expect(statusLine([P("Maa", "private")])).toBeNull();
  });
});

describe("the real sky", () => {
  it("moon illumination: full on 26 Oct 2026, new on 9 Nov 2026 (±1 day)", () => {
    for (const d of ["2026-10-25", "2026-10-26", "2026-10-27"]) expect(moonPhase(new Date(`${d}T12:00:00Z`)).illumination).toBeGreaterThan(0.97);
    for (const d of ["2026-11-08", "2026-11-09", "2026-11-10"]) expect(moonPhase(new Date(`${d}T12:00:00Z`)).illumination).toBeLessThan(0.03);
    // The phase angle runs 0 (new) .. 180 (full) .. 360.
    expect(skyState({ ...AMRITSAR, now: new Date("2026-10-26T12:00:00Z") }).moon.phaseAngle).toBeGreaterThan(170);
    expect(skyState({ ...AMRITSAR, now: new Date("2026-10-26T12:00:00Z") }).moon.phaseAngle).toBeLessThan(195);
  });

  it("day phase comes from the sun's altitude at their city", () => {
    expect(phaseFromSun(30, 180)).toBe("day");
    expect(phaseFromSun(-20, 0)).toBe("night");
    expect(phaseFromSun(2, 100)).toBe("dawn");
    expect(phaseFromSun(2, 250)).toBe("dusk");
    // Amritsar: noon IST is day, 11 PM IST is night, regardless of the viewer's own clock.
    expect(skyState({ ...AMRITSAR, now: new Date("2026-11-02T06:30:00Z") }).phase).toBe("day");
    expect(skyState({ ...AMRITSAR, now: new Date("2026-11-02T17:30:00Z") }).phase).toBe("night");
    const alt = sunPosition(AMRITSAR.lat, AMRITSAR.lon, new Date("2026-11-02T06:30:00Z")).altitude;
    expect(alt).toBeGreaterThan(30);
  });

  it("moonVisible only when it is night at THEIR end", () => {
    // 11 PM in Amritsar (5:30 PM UTC) is noon in New York: the viewer's own sky does not matter.
    const night = skyState({ ...AMRITSAR, now: new Date("2026-11-02T17:30:00Z") });
    const day = skyState({ ...AMRITSAR, now: new Date("2026-11-02T06:30:00Z") });
    expect(night.moonVisible).toBe(true);
    expect(day.moonVisible).toBe(false);
    expect(moonLine(day.moonVisible, "Amritsar", day.moon.illumination)).toBeNull();
    expect(moonLine(night.moonVisible, "Amritsar", 0.62)).toBe("Same moon tonight · 62%");
  });

  it("weather is drawn only from a fetched code, and rain hides the stars", () => {
    expect(weatherLayer(null)).toBeNull();
    expect(weatherLayer(0)).toBe("clear");
    expect(weatherLayer(3)).toBe("cloud");
    expect(weatherLayer(53)).toBe("drizzle");
    expect(weatherLayer(63)).toBe("rain");
    expect(weatherLayer(45)).toBe("fog");
    expect(weatherLayer(73)).toBe("snow");
    expect(weatherLayer(95)).toBe("thunder");
    const now = new Date("2026-11-02T17:30:00Z");
    expect(skyState({ ...AMRITSAR, now }).weather).toBeNull();
    expect(skyState({ ...AMRITSAR, now }).stars).toBe(true);
    expect(skyState({ ...AMRITSAR, now, weatherCode: 63 }).stars).toBe(false);
  });

  it("names one person, never the joined list", () => {
    expect(firstNameOf(["Maa, Papa & Dada"])).toBe("Maa");
    expect(firstNameOf(["Sunita Sharma"])).toBe("Sunita");
  });
});

describe("the renderer", () => {
  it("one constant selects DrawnScene by default", () => {
    expect(SCENE_RENDERER).toBe("drawn");
    expect(RENDERER_COMPONENT[SCENE_RENDERER]).toBe("DrawnScene");
    expect(RENDERER_COMPONENT.photo).toBe("PhotoScene");
  });
  it("PhotoScene falls back exact -> same phase clear -> day clear -> own photo", () => {
    expect(photoSceneCandidates("balcony", "night", "rain", "/me.jpg")).toEqual(["/window/balcony-night-rain.webp", "/window/balcony-night-clear.webp", "/window/balcony-day-clear.webp", "/me.jpg"]);
  });
  it("stale remembered demo photos are never painted early", () => {
    expect(isRetiredHero("/demo/home-courtyard.jpg")).toBe(true);
    expect(isRetiredHero("/demo/courtyard-390.webp")).toBe(true);
    expect(isRetiredHero("storage:fam/x.jpg")).toBe(false);
  });
});

describe("/api/window is bounded and does not wait on the holiday feed", () => {
  beforeEach(() => resetDemo());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads cards with a since + limit bound, never the whole lane", () => {
    const src = readFileSync("lib/window-server.ts", "utf8");
    const calls = src.match(/dbListCards\([^)]*\)/g) ?? [];
    const inRead = src.slice(src.indexOf("export function readWindow"), src.indexOf("export async function windowState"));
    expect(inRead).toMatch(/dbListCards\(familyId, \{ since, limit: CARD_WINDOW_LIMIT \}\)/);
    // The only unbounded reads are the settings actions (homePhotoOk, photoRefFor), not GET.
    expect(calls.filter((c) => c === "dbListCards(familyId)").length).toBeLessThanOrEqual(2);
    expect(inRead).not.toMatch(/familyHolidays\(/);
    expect(src).not.toMatch(/sinceSentence\(familyId/);
  });

  it("answers fast while the holiday feed and weather hang, with lamp and voice included", async () => {
    vi.stubEnv("MOCK", "false");
    vi.stubEnv("META_API_KEY", "");
    vi.stubGlobal("fetch", () => new Promise(() => undefined));
    const t0 = Date.now();
    const res = await windowGET(authedGet("http://t/api/window", "arjun"));
    const ms = Date.now() - t0;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lamp: { lamps: unknown[] }; voice: unknown; weather: unknown; doors: unknown[]; myDoor: unknown };
    expect(ms).toBeLessThan(1400);
    expect(body.weather).toBeNull();
    expect(Array.isArray(body.lamp.lamps)).toBe(true);
    expect(body).toHaveProperty("voice");
    expect(Array.isArray(body.doors)).toBe(true);
    expect(body).not.toHaveProperty("glance");
  });
});
