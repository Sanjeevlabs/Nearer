import { beforeEach, describe, expect, it } from "vitest";
import { memDocsOf } from "@/lib/family-docs";
import { listCards, resetDemo } from "@/lib/store";
import { DEMO_IYER_MEMBERS } from "@/lib/family";

// The Iyer side (Priya's family) is as lived-in as the Sharma side, with its
// own people only, and claims nobody is available: no presence, no open doors.
const IYER = "demo-iyer";

describe("the Iyer side of the demo", () => {
  beforeEach(() => resetDemo());

  it("has photos, voices, a story, recipes, Diwali in earlier years and today's answer", () => {
    const cards = listCards().filter((c) => c.familyId === IYER);
    expect(cards.filter((c) => c.type === "photo").length).toBeGreaterThanOrEqual(4);
    expect(cards.filter((c) => c.type === "audio").length).toBeGreaterThanOrEqual(6);
    expect(cards.filter((c) => c.ritualSlug).length).toBeGreaterThanOrEqual(2);
    const docs = memDocsOf(IYER);
    const kinds = (k: string) => docs.filter((d) => d.kind === k);
    expect(kinds("story").length).toBeGreaterThanOrEqual(1);
    expect(kinds("recipe").length).toBeGreaterThanOrEqual(2);
    expect(kinds("today_task").some((t) => (t.data.answers as unknown[]).length > 0)).toBe(true);
    expect(kinds("question").length).toBeGreaterThanOrEqual(2);
  });

  it("only ever names the Iyer side's own people", () => {
    const ids = new Set(DEMO_IYER_MEMBERS.map((m) => m.id));
    for (const c of listCards().filter((x) => x.familyId === IYER)) {
      if (c.authorId) expect(ids.has(c.authorId)).toBe(true);
      if (c.addressedTo) expect(ids.has(c.addressedTo)).toBe(true);
    }
    for (const d of memDocsOf(IYER)) {
      for (const f of ["cookId", "tellerId", "toMemberId", "askedBy", "memberId", "hostId"]) {
        const v = d.data[f];
        if (typeof v === "string") expect(ids.has(v)).toBe(true);
      }
    }
  });

  it("seeds no presence, no knock and no sitting: nobody is shown as free", () => {
    const kinds = new Set(memDocsOf(IYER).map((d) => d.kind));
    for (const k of ["presence", "knock", "sitting", "lamp"]) expect(kinds.has(k as never)).toBe(false);
  });
});
