import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { familyHomePhoto } from "@/lib/family";

// The courtyard header always shows a home photo: yours if you set one, else
// a Muse-made home that differs per side, with its responsive WebP widths.
describe("courtyard header home photo", () => {
  it("uses the viewer's own home photo first", () => {
    expect(familyHomePhoto("demo-family", "/api/media/f/home.jpg")).toBe("/api/media/f/home.jpg");
  });

  it("falls back to each side's own Muse-made home", () => {
    const sharma = familyHomePhoto("demo-family", null);
    const iyer = familyHomePhoto("demo-iyer", null);
    expect(sharma).toBe("/demo/home-courtyard.jpg");
    expect(iyer).toBe("/demo/home-balcony.jpg");
    expect(iyer).not.toBe(sharma);
  });

  it("a visitor's sandbox copy keeps its seed's home", () => {
    expect(familyHomePhoto("demo-v-0123456789ab", null)).toBe("/demo/home-courtyard.jpg");
    expect(familyHomePhoto("demo-v-0123456789ab-iyer", null)).toBe("/demo/home-balcony.jpg");
  });

  it("a real family with no photo still gets a home, never blank", () => {
    expect(familyHomePhoto("fam-abc", null)).toBe("/demo/home-courtyard.jpg");
    expect(familyHomePhoto(null, undefined)).toBe("/demo/home-courtyard.jpg");
  });

  it("every default ships its 390 and 780 WebP widths", () => {
    for (const f of ["home-courtyard", "home-balcony"]) {
      for (const w of [390, 780]) expect(existsSync(join(process.cwd(), "public", "demo", `${f}-${w}.webp`))).toBe(true);
    }
  });

  it("the courtyard header renders the photo with priority over the drawn band", () => {
    const src = readFileSync(join(process.cwd(), "components", "courtyard.tsx"), "utf8");
    expect(src).toMatch(/familyHomePhoto\(viewer\.familyId/);
    expect(src).toMatch(/<Photo src=\{homePhoto\}[^>]*priority/);
  });
});
