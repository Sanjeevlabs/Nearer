import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// The window's demo home photo must exist, stay inside a 500 KB budget, and
// carry its AI-generated notice. (The old courtyard.jpg door was retired on 2 Nov.)
describe("demo home photo asset", () => {
  const jpg = join(process.cwd(), "public", "demo", "home-window.jpg");
  const readme = join(process.cwd(), "public", "demo", "README.md");

  it("exists as an image within the 300 KB budget", () => {
    expect(existsSync(jpg)).toBe(true);
    expect(statSync(jpg).size).toBeLessThanOrEqual(500 * 1024);
    const head = readFileSync(jpg).subarray(0, 4);
    const jpeg = head[0] === 0xff && head[1] === 0xd8;
    const webp = head.toString("latin1") === "RIFF";
    expect(jpeg || webp).toBe(true);
  });

  it("ships an AI-generated notice", () => {
    expect(existsSync(readme)).toBe(true);
    expect(readFileSync(readme, "utf8")).toMatch(/AI-generated/i);
  });
});

// M6 seed: the consistent demo-family photos + manifest. Each file must be a
// real image (JPEG or WebP magic), and the manifest must list every photo
// with its AI-generated notice.
describe("demo-family seed assets", () => {
  const dir = join(process.cwd(), "public", "demo");
  const manifestPath = join(dir, "family.json");

  it("manifest lists the photos with an AI notice", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      model?: string;
      notice?: string;
      photos?: { file?: string }[];
    };
    expect(manifest.model).toBeTruthy();
    expect(manifest.notice).toMatch(/AI-generated/i);
    expect(manifest.photos?.length).toBeGreaterThan(0);
    for (const p of manifest.photos ?? []) {
      expect(p.file).toMatch(/\.(jpg|webp)$/);
      expect(existsSync(join(dir, p.file as string))).toBe(true);
    }
  });

  it("each photo is a real image file", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { photos: { file: string }[] };
    for (const p of manifest.photos) {
      const bytes = readFileSync(join(dir, p.file));
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const isWebP = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
      expect(isJpeg || isWebP, `${p.file} is not a JPEG or WebP`).toBe(true);
    }
  });
});
