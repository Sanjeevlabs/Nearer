import { describe, expect, it } from "vitest";
import raw from "@/data/send-apps.json";
import { isOccasionAlbum, occasionGroups } from "@/lib/occasion-album";
import type { Album } from "@/lib/kinds";
import { CardSchema, type Card } from "@/lib/schemas";
import { appsFor, countryForTz, SEND_APPS, SendAppsSchema } from "@/lib/send-apps";

describe("send-apps.json", () => {
  it("validates: https only, no tracking parameters, a fallback, known categories", () => {
    expect(SendAppsSchema.safeParse(raw).success).toBe(true);
    const urls = Object.values(SEND_APPS.countries).flatMap((c) => Object.values(c.apps).flat().map((a) => a.url));
    expect(urls.length).toBeGreaterThan(10);
    for (const u of urls) {
      expect(u.startsWith("https://"), u).toBe(true);
      expect(u).not.toMatch(/[?#]|utm_|ref=|affiliate/i);
    }
    const bad = structuredClone(raw) as { countries: Record<string, { apps: Record<string, { url: string }[]> }> };
    bad.countries.IN.apps.groceries[0].url = "http://blinkit.com";
    expect(SendAppsSchema.safeParse(bad).success).toBe(false);
    bad.countries.IN.apps.groceries[0].url = "https://blinkit.com/?ref=aangan";
    expect(SendAppsSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps exactly one app per category per country, and rejects a second", () => {
    for (const [code, c] of Object.entries(SEND_APPS.countries)) for (const [cat, apps] of Object.entries(c.apps)) expect(apps, `${code} ${cat}`).toHaveLength(1);
    const names = Object.values(SEND_APPS.countries).flatMap((c) => Object.values(c.apps).flat().map((a) => a.name));
    for (const gone of ["Swiggy", "Swiggy Instamart", "BigBasket", "Zepto"]) expect(names).not.toContain(gone);
    const two = structuredClone(raw) as { countries: Record<string, { apps: Record<string, { name: string; url: string }[]> }> };
    two.countries.IN.apps.rides.push({ name: "Ola", url: "https://www.olacabs.com" });
    expect(SendAppsSchema.safeParse(two).success).toBe(false);
  });

  it("picks the recipient's country from their time zone, India first, with a fallback", () => {
    expect(countryForTz("Asia/Kolkata")).toBe("IN");
    expect(countryForTz("Europe/London")).toBe("GB");
    expect(countryForTz("America/Chicago")).toBe("US");
    expect(countryForTz("Asia/Tokyo")).toBeNull();
    const india = appsFor("IN");
    expect(india.categories.map((c) => c.label)).toEqual(["Groceries", "Sweets & cakes", "Medicines", "House help", "Flowers & gifts", "Rides"]);
    expect(india.categories.map((c) => c.apps.map((a) => a.name))).toEqual([["Blinkit"], ["Zomato"], ["Tata 1mg"], ["Urban Company"], ["Ferns N Petals"], ["Uber"]]);
    expect(india.categories.find((c) => c.id === "house-help")?.apps[0].url).toBe("https://www.urbancompany.com");
    const elsewhere = appsFor("JP");
    expect(elsewhere.country).toBe("*");
    expect(elsewhere.categories.every((c) => c.apps.length > 0)).toBe(true);
  });
});

const card = (id: string, over: Partial<Card>): Card => CardSchema.parse({ id, familyId: "f", type: "photo", caption: id, lang: "en", takenAt: "2026-10-20T10:00:00.000Z", ...over });
const album = (id: string, event: Album["event"], cardIds: string[], endAt: string): Album => ({ id, title: `Album ${id}`, event, cardIds, startAt: endAt, endAt, coverId: null, madeBy: "muse", fixedBy: null, createdAt: endAt });

describe("the occasions album", () => {
  it("groups wishes, a guide's cards and occasion albums by occasion, newest first; no empty groups; everyday albums stay in the Lane", () => {
    const cards = [
      card("wish-voice", { type: "audio", takenAt: "2026-10-19T09:00:00.000Z" }),
      card("cake", { ritualSlug: "birthday", takenAt: "2026-10-20T18:00:00.000Z" }),
      card("lamps", { ritualSlug: "lights", takenAt: "2026-10-26T18:30:00.000Z" }),
      card("w1", { takenAt: "2025-02-10T10:00:00.000Z" }),
      card("w2", { takenAt: "2025-02-10T11:00:00.000Z" }),
      card("trip1", { takenAt: "2026-05-01T10:00:00.000Z" }),
    ];
    const groups = occasionGroups({
      cards,
      albums: [album("wed", "wedding", ["w1", "w2"], "2025-02-10T12:00:00.000Z"), album("trip", "trip", ["trip1"], "2026-05-01T12:00:00.000Z"), album("gone", "festival", ["missing"], "2026-01-01T00:00:00.000Z")],
      runs: [
        { id: "run-b", familyId: "f", ritualSlug: "birthday", occasionDate: "2026-10-20", status: "open", createdAt: "2026-10-10T00:00:00.000Z" },
        { id: "run-empty", familyId: "f", ritualSlug: "birthday", occasionDate: "2026-09-01", status: "open", createdAt: "2026-08-25T00:00:00.000Z" },
      ],
      wishes: [{ ritualRunId: "run-b", cardId: "wish-voice" }],
      titleFor: (slug, date) => `${slug} ${date}`,
    });
    expect(groups.map((g) => g.title)).toEqual(["lights 2026-10-26", "birthday 2026-10-20", "Album wed"]);
    expect(groups[1].voices.map((c) => c.id)).toEqual(["wish-voice"]);
    expect(groups[1].prints.map((c) => c.id)).toEqual(["cake"]);
    expect(groups[2].prints.map((c) => c.id)).toEqual(["w1", "w2"]);
    expect(isOccasionAlbum({ event: "trip" })).toBe(false);
    expect(isOccasionAlbum({ event: "wedding" })).toBe(true);
  });
});
