import { describe, expect, it } from "vitest";
import { en } from "@/lib/ui-strings/en";
import { TAP_SLOP, keyOutcome, showWindowIntro, travelSoFar, whoLooksOnto } from "@/lib/window-purpose";

describe("the first-visit card", () => {
  it("waits for the window, shows until dismissed, never again after", () => {
    expect(showWindowIntro(undefined, false)).toBe(false);
    expect(showWindowIntro(null, false)).toBe(false);
    expect(showWindowIntro(null, true)).toBe(true);
    expect(showWindowIntro("1", true)).toBe(false);
  });
});

describe("who the window looks onto", () => {
  it("uses the names from data", () => {
    expect(whoLooksOnto("Maa & Paa", "adult")).toEqual({ who: "Maa & Paa", known: true });
  });
  it("falls back to plain words", () => {
    expect(whoLooksOnto("  ", "adult")).toEqual({ who: "your parents", known: false });
    expect(whoLooksOnto("", "elder")).toEqual({ who: "your family", known: false });
    expect(whoLooksOnto("", undefined).who).toBe("your parents");
  });
});

describe("the key", () => {
  it("opens on a tap, opens past 80%, springs back from a half slide", () => {
    expect(keyOutcome(0, 0)).toBe("open");
    expect(keyOutcome(TAP_SLOP - 1, 0.02)).toBe("open");
    expect(keyOutcome(120, 0.81)).toBe("open");
    expect(keyOutcome(120, 0.5)).toBe("back");
    expect(keyOutcome(TAP_SLOP, 0.1)).toBe("back");
  });
});

describe("a slow half-drag on the key", () => {
  it("springs back: many 1px moves past the tap slop but short of the end do not open it", () => {
    const track = 220;
    let travel = 0;
    const downX = 100;
    let x = downX;
    for (let i = 0; i < 90; i++) {
      x += 1; // each step is far under TAP_SLOP
      travel = travelSoFar(travel, downX, x);
    }
    expect(travel).toBe(90);
    expect(keyOutcome(travel, (x - downX) / track)).toBe("back");
    // A real slide to the end still opens.
    for (let i = 0; i < 100; i++) travel = travelSoFar(travel, downX, (x += 1));
    expect(keyOutcome(travel, (x - downX) / track)).toBe("open");
  });
  it("a tap with a little jitter still opens", () => {
    let travel = 0;
    for (const x of [100, 101, 99, 102, 100]) travel = travelSoFar(travel, 100, x);
    expect(keyOutcome(travel, 0)).toBe("open");
  });
});

describe("the purpose strings", () => {
  it("say the purpose and the why, in short warm words, with no app-internal names", () => {
    const keys = Object.keys(en).filter((k) => /^window\.(purpose|keyWhy|keyLabel|intro|clocksLine|next|waitingCount)/.test(k)) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      expect(en[k]).not.toMatch(/circle|aangan|\bgood time\b|asleep/i);
      expect(en[k].length).toBeLessThan(120);
    }
    expect(en["window.purpose"]).toContain("{who}");
  });
});
