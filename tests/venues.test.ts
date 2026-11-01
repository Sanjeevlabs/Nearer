import { existsSync } from "fs";
import { describe, expect, it } from "vitest";
import { KnockSchema, SittingSchema } from "@/lib/kinds";
import { VENUES, VENUE_IDS, assignSeats, venueOf } from "@/lib/venues";

describe("venues", () => {
  it("has the six places, each with a photo and up to eight seats inside the screen", () => {
    expect(VENUES.map((v) => v.id).sort()).toEqual(["courtyard", "deck", "lounge", "patio", "pergola", "terrace"]);
    expect([...VENUE_IDS].sort()).toEqual(VENUES.map((v) => v.id).sort());
    for (const v of VENUES) {
      expect(v.image).toBe(`/demo/venues/${v.id}.jpg`);
      expect(existsSync(`public${v.image}`)).toBe(true);
      expect(v.seats.length).toBeGreaterThan(0);
      expect(v.seats.length).toBeLessThanOrEqual(8);
      for (const s of v.seats) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(100);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(100);
      }
      expect(v.seats.filter((s) => s.kind === "cushion").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("seats children on cushions and everyone else on real seats, in arrival order", () => {
    for (const v of VENUES) {
      const seats = assignSeats(v, [
        { id: "you", child: false },
        { id: "kid", child: true },
        { id: "dadi", child: false },
        { id: "kid2", child: true },
      ]);
      expect(seats.get("kid")!.kind).toBe("cushion");
      expect(seats.get("kid2")!.kind).toBe("cushion");
      expect(seats.get("you")!.kind).not.toBe("cushion");
      expect(seats.get("dadi")!.kind).not.toBe("cushion");
      expect(new Set(seats.values()).size).toBe(4);
    }
  });

  it("never seats more people than there are seats", () => {
    const crowd = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, child: i % 3 === 0 }));
    expect(assignSeats(VENUES[0], crowd).size).toBe(VENUES[0].seats.length);
  });

  it("falls back to the courtyard for an unknown id", () => {
    expect(venueOf("moon").id).toBe("courtyard");
    expect(venueOf(undefined).id).toBe("courtyard");
  });
});

describe("venue on sittings and knocks", () => {
  const base = { id: "s1", reason: "chai", title: "Chai", hostId: "arjun", startsAt: "2026-11-02T10:00:00.000Z", createdAt: "2026-11-01T10:00:00.000Z" };
  it("defaults a sitting to the courtyard and keeps a chosen venue", () => {
    expect(SittingSchema.parse(base).venue).toBe("courtyard");
    expect(SittingSchema.parse({ ...base, venue: "terrace" }).venue).toBe("terrace");
    expect(SittingSchema.safeParse({ ...base, venue: "moon" }).success).toBe(false);
  });
  it("defaults a knock to the courtyard", () => {
    const k = { id: "k1", memberId: "dadi", at: "2026-11-01T10:00:00.000Z", until: "2026-11-01T11:00:00.000Z" };
    expect(KnockSchema.parse(k).venue).toBe("courtyard");
    expect(KnockSchema.parse({ ...k, venue: "deck" }).venue).toBe("deck");
  });
});
