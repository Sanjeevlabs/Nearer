import { describe, expect, it } from "vitest";
import { dbAddCard, dbListCards } from "@/lib/db";

const FAM = "fam-bound0000001";
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12)).toISOString();

describe("dbListCards options", () => {
  it("returns everything without options, bounded by since and limit with them, newest first", async () => {
    for (const n of [1, 5, 10, 15, 20]) await dbAddCard({ familyId: FAM, type: "photo", caption: `Card ${n}`, lang: "en", takenAt: day(n), source: "upload" });
    expect((await dbListCards(FAM)).length).toBe(5);
    expect((await dbListCards(FAM, { since: day(10) })).map((c) => c.takenAt).sort()).toEqual([day(10), day(15), day(20)]);
    expect((await dbListCards(FAM, { limit: 2 })).map((c) => c.takenAt)).toEqual([day(20), day(15)]);
    expect((await dbListCards(FAM, { since: day(5), limit: 2 })).map((c) => c.takenAt)).toEqual([day(20), day(15)]);
    expect(await dbListCards("fam-other0000001", { limit: 2 })).toEqual([]);
  });
});
