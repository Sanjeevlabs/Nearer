// The three honest metrics: pure functions on synthetic days, and the admin-only route.
import { describe, expect, it } from "vitest";
import { GET as metricsGet } from "@/app/api/metrics/route";
import { bidsAnswered, familyMetrics, parentActiveDays, twoWayWeek, type MetricsInput } from "@/lib/metrics";
import { authedGet } from "./auth-helper";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const day = (n: number, hh = "09:00") => new Date(`${new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)}T${hh}:00.000Z`).toISOString();
const members = [
  { id: "maa", role: "elder", status: "active", displayName: "Maa", firstName: "Sunita" },
  { id: "papa", role: "elder", status: "active", displayName: "Papa", firstName: "Ravi" },
  { id: "arjun", role: "adult", status: "active", displayName: "Arjun", firstName: "Arjun" },
  { id: "priya", role: "adult", status: "active", displayName: "Priya", firstName: "Priya" },
] as MetricsInput["members"];
const card = (id: string, authorId: string, addressedTo: string | null, takenAt: string, type: "audio" | "photo" = "audio") => ({ id, authorId, addressedTo, takenAt, type });
const base = (over: Partial<MetricsInput> = {}): MetricsInput => ({ now: NOW, tz: "UTC", members, cards: [], reactions: [], wishes: [], plays: [], presence: [], lights: [], ...over });

describe("Two-way week", () => {
  it("counts a day only when a parent reached a child AND a child reached a parent", () => {
    const cards = [
      card("a", "maa", "arjun", day(0)), // today: parent -> child
      card("b", "arjun", "maa", day(0, "11:00")), // today: child -> parent  => both
      card("c", "maa", "arjun", day(1)), // yesterday: parent only
      card("d", "arjun", "maa", day(2)), // 2 days ago: child only
      card("e", "maa", "arjun", day(3)), // 3 days ago: both, via a reaction
    ];
    const reactions = [{ cardId: "e", memberId: "arjun", createdAt: day(3, "10:00") }];
    expect(twoWayWeek(base({ cards, reactions }))).toEqual({ days: 2, of: 7, share: 0.29 });
  });
  it("a broadcast to everyone, a note to someone your own age, and old days do not count", () => {
    const cards = [card("a", "maa", null, day(0)), card("b", "arjun", "priya", day(0)), card("c", "maa", "arjun", day(9)), card("d", "arjun", "maa", day(9))];
    expect(twoWayWeek(base({ cards })).days).toBe(0);
  });
  it("a lit lamp is reaching toward the other generation", () => {
    const lights = [{ by: "maa", at: day(1) }, { by: "arjun", at: day(1, "13:00") }];
    expect(twoWayWeek(base({ lights })).days).toBe(1);
  });
  it("a family with no parent has no two-way days", () => {
    const kids = members.filter((m) => m.role !== "elder");
    expect(twoWayWeek(base({ members: kids, cards: [card("a", "arjun", "priya", day(0))] })).days).toBe(0);
  });
});

describe("Bids answered in 24 h", () => {
  it("answered by a note back or a reaction inside 24 h; listening alone is not an answer", () => {
    const cards = [
      card("b1", "maa", null, day(5)), // answered by a note back after 3 h
      card("r1", "arjun", "maa", day(5, "12:00")),
      card("b2", "maa", null, day(6)), // answered by a reaction after 5 h
      card("b3", "papa", null, day(7)), // only listened to
      card("b4", "maa", null, day(8)), // answered, but after 30 h
      card("r4", "arjun", "maa", day(7, "15:00")),
    ];
    const reactions = [{ cardId: "b2", memberId: "priya", createdAt: day(6, "14:00") }];
    const out = bidsAnswered(base({ cards, reactions, plays: [{ memberId: "arjun", playedAt: day(7, "10:00") }] }));
    expect(out).toEqual({ answered: 2, total: 4, share: 0.5 });
  });
  it("a note still inside its 24 hours and unanswered counts neither way; none yet is null", () => {
    expect(bidsAnswered(base({ cards: [card("b", "maa", null, new Date(NOW.getTime() - 3_600_000).toISOString())] }))).toEqual({ answered: 0, total: 0, share: null });
  });
  it("only parent voice memories are bids, and only the last 30 days", () => {
    const cards = [card("p", "maa", null, day(3), "photo"), card("k", "arjun", null, day(3)), card("old", "maa", null, day(40))];
    expect(bidsAnswered(base({ cards })).total).toBe(0);
  });
});

describe("Parent active days", () => {
  it("counts the days each parent did anything, and the typical parent", () => {
    const presence = [0, 1, 2, 3].map((n) => ({ memberId: "maa", at: day(n) }));
    const cards = [card("x", "maa", null, day(1, "20:00")), card("y", "maa", null, day(10))]; // day 1 again; day 10 is new
    const out = parentActiveDays(base({ presence, cards, plays: [{ memberId: "papa", playedAt: day(2) }] }));
    expect(out.perParent).toEqual([{ id: "maa", name: "Maa", days: 5 }, { id: "papa", name: "Papa", days: 1 }]);
    expect(out.typical).toBe(3);
    expect(out.of).toBe(30);
  });
  it("ignores other people's activity and anything older than 30 days; no parent means no typical", () => {
    const out = parentActiveDays(base({ presence: [{ memberId: "arjun", at: day(0) }, { memberId: "maa", at: day(45) }] }));
    expect(out.perParent.map((p) => p.days)).toEqual([0, 0]);
    expect(parentActiveDays(base({ members: members.filter((m) => m.role !== "elder") })).typical).toBeNull();
  });
});

describe("/api/metrics", () => {
  it("is for the owner or an admin, and returns all three", async () => {
    expect((await metricsGet(authedGet("http://t/api/metrics", "dadi"))).status).toBe(403);
    const res = await metricsGet(authedGet("http://t/api/metrics", "arjun"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReturnType<typeof familyMetrics>;
    expect(Object.keys(body).sort()).toEqual(["bidsAnswered", "parentActiveDays", "twoWayWeek"]);
    expect(body.twoWayWeek.of).toBe(7);
  });
});
