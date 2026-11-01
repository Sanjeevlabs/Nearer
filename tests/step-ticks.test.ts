// The festival steps checklist ticks (localStorage) are keyed by family +
// festival + year: not shared with next year, another family, or a demo copy.
import { describe, expect, it } from "vitest";
import { pruneStepTicks, stepTicksKey, STEP_TICKS_PREFIX } from "@/lib/festival-week";

function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    keys: () => Array.from(m.keys()).sort(),
  };
}

describe("stepTicksKey", () => {
  it("differs by family, festival and year", () => {
    const a = stepTicksKey("fam-a", "lakshmi-puja", "2026-11-08");
    expect(a).toBe(`${STEP_TICKS_PREFIX}fam-a:lakshmi-puja:2026`);
    expect(stepTicksKey("fam-b", "lakshmi-puja", "2026-11-08")).not.toBe(a);
    expect(stepTicksKey("fam-a", "holi", "2026-11-08")).not.toBe(a);
    expect(stepTicksKey("fam-a", "lakshmi-puja", "2027-10-29")).not.toBe(a);
    // The same festival on another day of the same year is still this year's list.
    expect(stepTicksKey("fam-a", "lakshmi-puja", "2026-11-09")).toBe(a);
  });
});

describe("pruneStepTicks", () => {
  it("drops last year's ticks and the old un-keyed format; keeps this year's, for any family; leaves other keys alone", () => {
    const s = fakeStorage({
      [stepTicksKey("fam-a", "lakshmi-puja", "2026-11-08")]: "[0,1]",
      [stepTicksKey("fam-b", "lakshmi-puja", "2026-11-08")]: "[2]",
      [stepTicksKey("fam-a", "lakshmi-puja", "2025-10-20")]: "[0]",
      [`${STEP_TICKS_PREFIX}lakshmi-puja:2026-11-08`]: "[0,1,2]",
      "aangan:hero": "/x.jpg",
    });
    expect(pruneStepTicks(s, "2026")).toBe(2);
    expect(s.keys()).toEqual([`${STEP_TICKS_PREFIX}fam-a:lakshmi-puja:2026`, `${STEP_TICKS_PREFIX}fam-b:lakshmi-puja:2026`, "aangan:hero"]);
    expect(pruneStepTicks(s, "2026")).toBe(0);
  });
});
