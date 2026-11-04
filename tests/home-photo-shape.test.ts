import { describe, expect, it } from "vitest";
import { HOME_PHOTO_RULE, homePhotoWarning } from "@/lib/home-photo-shape";

describe("home photo shape", () => {
  it("states the rule plainly", () => {
    expect(HOME_PHOTO_RULE).toBe("Use a wide (landscape) photo, at least 1600 × 900. The middle is what shows.");
  });
  it("accepts a wide, large photo", () => {
    expect(homePhotoWarning(1920, 1080)).toBeNull();
    expect(homePhotoWarning(1600, 900)).toBeNull();
  });
  it("warns, gently, about a portrait or a small photo", () => {
    expect(homePhotoWarning(900, 1600)).toMatch(/tall/);
    expect(homePhotoWarning(1200, 800)).toMatch(/smaller than 1600/);
  });
  it("says nothing when the size is unknown", () => {
    expect(homePhotoWarning(0, 0)).toBeNull();
  });
});
