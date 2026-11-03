import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENTER_MS, HOUSE_KEY, entryMotion, houseValue, isInside, screenAfterUnlock, unlockBeat } from "@/lib/house-entry";
import { KEY_TICKS, keyClickMs, shouldPlayKey } from "@/lib/key-sound";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("key slid -> family page", () => {
  it("goes straight to the family page and remembers it for the session", () => {
    expect(screenAfterUnlock(false)).toBe("window");
    expect(screenAfterUnlock(true)).toBe("family");
    expect(houseValue(true)).toBe("open");
    expect(isInside(houseValue(true))).toBe(true);
    expect(isInside(houseValue(false))).toBe(false);
    expect(isInside(null)).toBe(false);
    expect(isInside("anything else")).toBe(false);
    expect(HOUSE_KEY).toBe("aangan:door");
  });

  it("the transition is a calm fade of at most 250 ms, and instant under reduced motion", () => {
    expect(ENTER_MS).toBeLessThanOrEqual(250);
    expect(entryMotion(false).ms).toBe(ENTER_MS);
    expect(entryMotion(false).ms).toBeGreaterThan(0);
    expect(entryMotion(true)).toEqual({ ms: 0, rise: 0 });
    expect(unlockBeat(true)).toBe(0);
    expect(unlockBeat(false)).toBeGreaterThan(0);
    expect(unlockBeat(false)).toBeLessThan(250);
  });

  it("the first screen no longer has a door: no door scene, photo, creak or recording", () => {
    const page = read("app/page.tsx");
    expect(page).not.toMatch(/DoorTransition|components\/door|moving|doorUsed/);
    expect(page).toContain("go(true)");
    for (const gone of ["components/door.tsx", "lib/door-sound.ts", "lib/door-synth.ts", "public/sound/door-unlock.mp3", "public/demo/door-closed.jpg", "public/demo/door-open.jpg"]) {
      expect(() => readFileSync(join(__dirname, "..", gone))).toThrow();
    }
  });

  it("the window's key plays the soft click, then calls onUnlock", () => {
    const w = read("components/window.tsx");
    expect(w).toContain("playKeyClick()");
    expect(w).toContain("onUnlock");
    expect(w).not.toMatch(/onOpenDoor|DoorTransition/);
    expect(read("components/courtyard.tsx")).toContain("Back to the window");
  });
});

describe("the key click", () => {
  it("is short (under 300 ms), two soft ticks", () => {
    expect(KEY_TICKS).toHaveLength(2);
    expect(keyClickMs()).toBeLessThanOrEqual(300);
    expect(Math.max(...KEY_TICKS.map((t) => t.gain))).toBeLessThanOrEqual(0.6);
  });

  it("is silent under reduced motion or when sound is off", () => {
    expect(shouldPlayKey({ reducedMotion: false, muted: false })).toBe(true);
    expect(shouldPlayKey({ reducedMotion: true, muted: false })).toBe(false);
    expect(shouldPlayKey({ reducedMotion: false, muted: true })).toBe(false);
  });

  it("uses no recording or model, and buzzes once", () => {
    const src = read("lib/key-sound.ts");
    expect(src).not.toMatch(/new Audio|\.mp3|\.ogg|fetch\(/);
    expect(src).toContain("navigator.vibrate?.(12)");
    // The app already taps natively (haptic()), so the browser buzz is for browsers only.
    expect(src).toContain("!isNative()");
  });

  it("the Sounds switch in Settings (You) writes the key the click reads", () => {
    expect(read("lib/key-sound.ts")).toContain("soundOn()");
    expect(read("components/settings/sound-section.tsx")).toContain("setSoundOn");
    expect(read("app/settings/page.tsx")).toContain("<SoundSection />");
  });
});
