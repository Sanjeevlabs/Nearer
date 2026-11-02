import { describe, expect, it } from "vitest";
import { sinceLabel, sinceLines } from "@/lib/since";
import { sinceSentence } from "@/lib/window-server";
import type { museJson } from "@/lib/muse";

const now = new Date("2026-10-31T12:00:00.000Z");
const at = "2026-10-30T10:00:00.000Z";
const base = {
  viewerId: "arjun",
  at,
  now,
  names: { arjun: "Arjun", dadi: "Maa", dada: "Papa" },
  farIds: ["dadi", "dada"],
  cards: [
    { id: "c-mine", type: "audio" as const, authorId: "arjun", takenAt: "2026-10-29T00:00:00.000Z" },
    { id: "p-mine", type: "photo" as const, authorId: "arjun", takenAt: "2026-10-29T00:00:00.000Z" },
    { id: "c-maa", type: "audio" as const, authorId: "dadi", takenAt: "2026-10-31T08:00:00.000Z" },
    { id: "c-old", type: "photo" as const, authorId: "dadi", takenAt: "2026-10-29T08:00:00.000Z" },
  ],
  plays: [{ cardId: "c-mine", memberId: "dadi", playedAt: "2026-10-30T20:00:00.000Z" }],
  reactions: [{ cardId: "p-mine", memberId: "dada", kind: "bless" as const, createdAt: "2026-10-31T06:00:00.000Z" }],
  checkins: [{ memberId: "dada", kind: "home-safe", at: "2026-10-31T10:00:00.000Z", closedAt: "2026-10-31T10:00:00.000Z" }],
};

describe("sinceLines", () => {
  it("writes plain sentences, newest first, at most three", () => {
    expect(sinceLines(base)).toEqual(["Papa checked in: home safe", "Maa sent a voice memory", "Papa blessed your photo"]);
    expect(sinceLines({ ...base, limit: 4 })).toHaveLength(4);
  });
  it("ignores what happened before the last visit, your own actions and strangers", () => {
    const out = sinceLines({ ...base, at: "2026-10-31T11:00:00.000Z" });
    expect(out).toEqual([]);
    const own = sinceLines({ ...base, plays: [{ cardId: "c-mine", memberId: "arjun", playedAt: "2026-10-31T01:00:00.000Z" }], reactions: [], checkins: [], cards: base.cards.filter((c) => c.id !== "c-maa") });
    expect(own).toEqual([]);
  });
  it("labels the gap in words", () => {
    expect(sinceLabel("2026-10-31T03:00:00.000Z", now, "UTC")).toBe("Since this morning");
    expect(sinceLabel("2026-10-31T09:00:00.000Z", now, "UTC")).toBe("Since this morning");
    expect(sinceLabel("2026-10-30T10:00:00.000Z", now, "UTC")).toBe("Since yesterday");
    expect(sinceLabel("2026-10-27T10:00:00.000Z", now, "UTC")).toBe("Since Tuesday");
    expect(sinceLabel("2026-10-10T10:00:00.000Z", now, "UTC")).toBe("Since last week");
  });
});

describe("sinceSentence", () => {
  const lines = ["Papa checked in: home safe", "Maa sent a voice memory"];
  const fake = (json: unknown) =>
    (async (o: { schema: { safeParse: (x: unknown) => { success: boolean; data?: unknown } }; accept?: (d: never) => boolean; fallback: unknown }) => {
      const p = o.schema.safeParse(json);
      const ok = p.success && (!o.accept || o.accept(p.data as never));
      return { data: ok ? p.data : o.fallback, source: ok ? "muse" : "fallback", cached: false, cost: 0, model: "x" };
    }) as unknown as typeof museJson;
  it("uses the plain lines in mock mode or with fewer than two", async () => {
    expect(await sinceSentence("f", "arjun", "en", lines, fake({ line: "Hello there" }), true)).toBeNull();
    expect(await sinceSentence("f", "arjun", "en", lines.slice(0, 1), fake({ line: "Hello there" }), false)).toBeNull();
  });
  it("returns a valid grounded line and rejects a bad one", async () => {
    expect(await sinceSentence("f", "arjun", "en", lines, fake({ line: "Since yesterday, Maa sent a voice memory and Papa got home safe." }), false)).toMatch(/Maa/);
    expect(await sinceSentence("f", "arjun", "en", lines, fake({ line: "Maa sent 3 voice memories" }), false)).toBeNull();
    expect(await sinceSentence("f", "arjun", "en", lines, fake({ line: "x".repeat(200) }), false)).toBeNull();
  });
});
