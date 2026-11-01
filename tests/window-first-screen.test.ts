import { beforeEach, describe, expect, it } from "vitest";
import { seedDemoRooms } from "@/lib/demo-rooms";
import { listDocs, resetDocs } from "@/lib/family-docs";
import { DEFAULT_IMAGE } from "@/lib/hero";
import { countryOfTz } from "@/lib/place";
import { dayRhythm, rhythmLine } from "@/lib/rhythm";
import { isNightAt, skyGlyph, solarPhase, sunPosition } from "@/lib/sky";
import { fetchWeather, pickPlace, type Weather } from "@/lib/weather";
import { DEFAULT_IMAGE as SERVER_DEFAULT, distanceKm, skyOver } from "@/lib/window-server";
import { badgeParts, checkinEvents, composedLine, dayWord, lampLine, lampToday } from "@/lib/window-words";
import { hourIn } from "@/lib/zones";

const AMRITSAR = { lat: 31.63, lon: 74.87 };
const BENGALURU = { lat: 12.97, lon: 77.59 };
const NYC = { lat: 40.71, lon: -74.01 };
const wx = (over: Partial<Weather> = {}): Weather => ({ city: "Amritsar", tempC: 24, kind: "clear", label: "Clear", source: "open-meteo", at: "", ...over });

describe("the sky badge follows the real sun", () => {
  it("sun between sunrise and sunset, moon at night, nothing at twilight", () => {
    // 2026-10-31 in Amritsar (IST = UTC+5:30): sunrise ~06:35, sunset ~17:40.
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 31, h, m) - 5.5 * 3_600_000);
    expect(skyGlyph(AMRITSAR.lat, AMRITSAR.lon, at(12))).toBe("sun");
    expect(skyGlyph(AMRITSAR.lat, AMRITSAR.lon, at(3))).toBe("moon");
    expect(skyGlyph(AMRITSAR.lat, AMRITSAR.lon, at(22))).toBe("moon");
    // Just after sunset the sun is below the horizon but it is not night yet.
    expect(skyGlyph(AMRITSAR.lat, AMRITSAR.lon, at(17, 55))).toBeNull();
    // Just before sunrise likewise.
    expect(skyGlyph(AMRITSAR.lat, AMRITSAR.lon, at(6, 25))).toBeNull();
  });

  it("solar phases by altitude, and no glyph without coordinates", () => {
    expect(solarPhase(30)).toBe("day");
    expect(solarPhase(-0.5)).toBe("day");
    expect(solarPhase(-3)).toBe("twilight");
    expect(solarPhase(-10)).toBe("night");
    expect(skyGlyph(undefined, undefined, new Date())).toBeNull();
    expect(isNightAt(undefined, 10)).toBeNull();
  });

  it("the sun is up in the sky it says it is: noon in Amritsar is high, midnight is low", () => {
    expect(sunPosition(AMRITSAR.lat, AMRITSAR.lon, new Date("2026-10-31T06:30:00Z")).altitude).toBeGreaterThan(35);
    expect(sunPosition(AMRITSAR.lat, AMRITSAR.lon, new Date("2026-10-30T20:30:00Z")).altitude).toBeLessThan(-20);
  });

  it('"the same moon" only when it is night at both homes', () => {
    const night = new Date("2026-10-31T22:00:00Z"); // 3:30 AM Amritsar, 6 PM New York (still day)
    expect(skyOver(AMRITSAR, NYC, night).bothNight).toBe(false);
    const both = new Date("2026-10-31T20:30:00Z"); // 2 AM Amritsar, 4:30 PM New York: day there
    expect(skyOver(AMRITSAR, NYC, both).bothNight).toBe(false);
    expect(skyOver(AMRITSAR, BENGALURU, night).bothNight).toBe(true);
    expect(skyOver(AMRITSAR, BENGALURU, new Date("2026-10-31T06:30:00Z")).bothNight).toBe(false);
    // Unknown place: never claimed.
    expect(skyOver(AMRITSAR, null, night).bothNight).toBe(false);
    expect(skyOver(null, null, night).glyph).toBeNull();
  });
});

describe("the weather badge", () => {
  it("is hidden entirely when there is no weather, the time stays", () => {
    expect(badgeParts({ time: "11:25 AM", weather: null, glyph: "sun" })).toEqual({ time: "11:25 AM", weather: null, glyph: "sun" });
    expect(badgeParts({ time: "11:25 AM", weather: wx(), glyph: null }).weather).toMatchObject({ tempC: 24, kind: "clear" });
  });

  it("the line under the photo says nothing about the sky when the weather is null", () => {
    const line = composedLine({ who: "Maa", moment: { label: "Chai", at: "2026-10-31T01:10:00Z" }, weather: null, city: "Amritsar", tz: "Asia/Kolkata" });
    expect(line).toBe("Latest from Maa: chai, 6:40 AM.");
    expect(line).not.toMatch(/°|clear|cloud|rain|fog|snow|storm/i);
    expect(composedLine({ who: "Maa", moment: null, weather: null, city: "Amritsar", tz: "Asia/Kolkata" })).toBe("");
    expect(composedLine({ who: "Maa", moment: null, weather: wx(), city: "Amritsar", tz: "Asia/Kolkata" })).toBe("Clear, 24°C in Amritsar.");
  });
});

describe("the right city", () => {
  const results = [
    { latitude: 1, longitude: 1, country_code: "US", timezone: "America/Chicago" },
    { latitude: 31.63, longitude: 74.87, country_code: "IN", timezone: "Asia/Kolkata" },
    { latitude: 2, longitude: 2, country_code: "IN", timezone: "Asia/Kolkata" },
  ];
  it("takes the first match in the member's country, never just the first match", () => {
    expect(pickPlace(results, { country: "IN" })).toMatchObject({ latitude: 31.63 });
    expect(pickPlace(results, { country: "GB" })).toBeNull();
  });
  it("without a country falls back to the member's time zone, and otherwise guesses nothing", () => {
    expect(pickPlace(results, { tz: "Asia/Calcutta" })).toMatchObject({ latitude: 31.63 });
    expect(pickPlace(results, {})).toBeNull();
    expect(pickPlace(results, { tz: "UTC" })).toBeNull();
  });
  it("derives the country from the time zone through data/traditions.json", () => {
    expect(countryOfTz("Asia/Kolkata")).toBe("IN");
    expect(countryOfTz("Europe/London")).toBe("GB");
    expect(countryOfTz("Antarctica/Troll")).toBeNull();
    expect(countryOfTz("UTC")).toBeNull();
  });
  it("asks the geocoder for the city and picks by country; a failed fetch is null", async () => {
    let asked = "";
    const fake = (async (url: string) => {
      asked += `${url}\n`;
      if (url.includes("geocoding")) return new Response(JSON.stringify({ results: results }), { status: 200 });
      return new Response(JSON.stringify({ current: { temperature_2m: 23.6, weather_code: 0 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const w = await fetchWeather("Amritsar, Punjab", { country: "IN", tz: "Asia/Kolkata" }, fake);
    expect(w).toMatchObject({ tempC: 24, lat: 31.63, lon: 74.87, kind: "clear" });
    expect(asked).toContain("name=Amritsar\n");
    expect(asked).toContain("latitude=31.63");
    expect(await fetchWeather("Springfield", { country: "GB" }, fake)).toBeNull();
    const down = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchWeather("Nowhere", { country: "IN" }, down)).toBeNull();
  });
  it("distance only when both places are known", () => {
    expect(distanceKm(AMRITSAR, BENGALURU)).toBeGreaterThan(2000);
    expect(distanceKm(AMRITSAR, null)).toBeNull();
    expect(distanceKm(null, AMRITSAR)).toBeNull();
  });
});

describe("the lamp row (photo + line)", () => {
  const now = new Date("2026-10-31T06:30:00Z");
  it("lit within a day: who and how long ago; else not lit yet today", () => {
    expect(lampToday({ litAt: "2026-10-31T04:10:00Z" }, "Maa", now)).toEqual({ lit: true, line: "Lit by Maa · 2 h ago" });
    expect(lampToday({ litAt: "2026-10-31T06:10:00Z" }, "Maa", now)).toEqual({ lit: true, line: "Lit by Maa · just now" });
    expect(lampToday({ litAt: "2026-10-30T04:10:00Z" }, "Maa", now)).toEqual({ lit: false, line: "Not lit yet today" });
    expect(lampToday(undefined, "Maa", now).lit).toBe(false);
  });
});

describe("the lamp row words", () => {
  const now = new Date("2026-10-31T06:30:00Z"); // Saturday noon in Kolkata
  const tz = "Asia/Kolkata";
  it("says who lit it and the real day, never an N-days-ago clock", () => {
    expect(lampLine({ litAt: "2026-10-30T06:00:00Z", litBy: "dadi" }, "Maa", now, tz)).toBe("Lit by Maa, yesterday");
    expect(lampLine({ litAt: "2026-10-29T06:00:00Z", litBy: "dadi" }, "Maa", now, tz)).toBe("Lit by Maa, Thursday");
    expect(lampLine({ litAt: "2026-10-31T01:00:00Z", litBy: "dadi" }, "Maa", now, tz)).toBe("Lit by Maa, today");
    for (const at of ["2026-10-29T06:00:00Z", "2026-10-30T06:00:00Z"]) expect(lampLine({ litAt: at, litBy: "x" }, "Maa", now, tz)).not.toMatch(/ago/);
  });
  it("only when truly lit: nothing when never lit or faded out", () => {
    expect(lampLine(undefined, "Maa", now, tz)).toBeNull();
    expect(lampLine({ litAt: null, litBy: null }, "Maa", now, tz)).toBeNull();
    expect(lampLine({ litAt: "2026-10-20T06:00:00Z", litBy: "dadi" }, "Maa", now, tz)).toBeNull();
  });
  it("names the day in the viewer's zone", () => {
    expect(dayWord("2026-10-30T20:00:00Z", now, "Asia/Kolkata")).toBe("today"); // 1:30 AM Saturday there
    expect(dayWord("2026-10-30T20:00:00Z", now, "America/New_York")).toBe("yesterday");
  });
});

describe("Safe & sound words", () => {
  const tz = "Asia/Kolkata";
  const now = new Date("2026-10-31T09:00:00Z"); // 2:30 PM
  const dr = dayRhythm(["2026-10-31T00:40:00Z"], tz, now);
  it("drops 'active N h ago' when the only sign is an old app heartbeat", () => {
    const ago = () => "7 h ago";
    const last = "2026-10-31T02:00:00Z"; // 7:30 AM, 7 h before
    expect(rhythmLine("active", last, dr, tz, ago, { heartbeatOnly: true, now })).toBe("Up since 6:10 AM · quiet since 7:30 AM");
    expect(rhythmLine("active", last, dr, tz, ago, { heartbeatOnly: false, now })).toBe("Up since 6:10 AM · active 7 h ago");
    // A fresh heartbeat is still active.
    expect(rhythmLine("active", "2026-10-31T08:00:00Z", dr, tz, () => "1 h ago", { heartbeatOnly: true, now })).toContain("active 1 h ago");
  });
  it("a check-in is a timed event, and a closed one adds its close", () => {
    expect(checkinEvents({ kind: "heading", at: "2026-10-31T05:00:00Z", closedAt: "2026-10-31T05:30:00Z" })).toEqual([
      { at: "2026-10-31T05:00:00Z", label: "Heading home" },
      { at: "2026-10-31T05:30:00Z", label: "Home safe" },
    ]);
    expect(checkinEvents({ kind: "home-safe", at: "2026-10-31T05:30:00Z", closedAt: "2026-10-31T05:30:00Z" })).toHaveLength(1);
  });
});

describe("the demo is seeded against the member's local morning", () => {
  beforeEach(() => resetDocs());
  const IST = "Asia/Kolkata";
  const istHour = (iso: string) => hourIn(IST, new Date(iso));
  const istDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(iso));

  for (const [label, utc] of [["early morning", "2026-10-31T01:00:00Z"], ["noon", "2026-10-31T06:30:00Z"], ["evening", "2026-10-31T13:30:00Z"], ["night", "2026-10-31T19:00:00Z"]] as const) {
    it(`reads right when the server starts at IST ${label}`, async () => {
      const now = Date.parse(utc);
      seedDemoRooms(now);
      const presence = await listDocs("demo-family", "presence");
      const today = istDay(utc);
      const dadi = presence.filter((p) => p.memberId === "dadi" && p.moment !== "here" && Date.parse(p.at) <= now).sort((a, b) => a.at.localeCompare(b.at));
      // Never in the future, and no "visit" lands in today's small hours.
      expect(presence.filter((p) => p.moment === "here").every((p) => istDay(p.at) !== today)).toBe(true);
      const todays = dadi.filter((p) => istDay(p.at) === today);
      if (istHour(utc) >= 6) {
        expect(todays.length).toBeGreaterThan(0);
        // The first moment of the day is between 6:00 and 7:30 her time.
        expect(istHour(todays[0].at)).toBeGreaterThanOrEqual(6);
        expect(istHour(todays[0].at)).toBeLessThanOrEqual(7.5);
        // And the rhythm reads "up since" from it.
        const r = dayRhythm(presence.filter((p) => p.memberId === "dadi").map((p) => p.at), IST, new Date(now));
        expect(r.firstToday).toBe(todays[0].at);
        expect(r.usual).not.toBeNull();
      } else {
        expect(todays).toHaveLength(0); // before dawn there: the day that just ended is shown
      }
    });
  }
});

describe("the default photo", () => {
  it("is one constant, shared by the server and the phone", () => {
    expect(SERVER_DEFAULT).toBe(DEFAULT_IMAGE);
    expect(DEFAULT_IMAGE).toBe("/demo/home-courtyard.jpg");
  });
});
