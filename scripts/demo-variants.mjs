// Writes the small WebP widths of the bundled demo photos (public/demo/*-<w>.webp)
// that components/ui/kit.tsx <Photo> picks from with srcset. The full-size files
// stay as they are (share cards, the print frame and the model use them).
//
//   node scripts/demo-variants.mjs
//
// Needs `sharp`, which Next installs for its own use; it is not a dependency of
// this repo, so this is a run-once helper, not part of the build.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error("sharp is not installed; skipping (the full-size demo photos still work).");
  process.exit(0);
}

const dir = join(process.cwd(), "public", "demo");
// file -> widths. Keep in step with DEMO_WIDTHS in components/ui/kit.tsx.
const plan = {};
// The first screen's home photos (scripts/gen-courtyard.mjs), once they exist.
for (const n of ["home-courtyard", "home-balcony", "home-window"]) if (existsSync(join(dir, `${n}.jpg`))) plan[`${n}.jpg`] = [390, 780];
for (const n of ["lamp-unlit", "lamp-lit"]) if (existsSync(join(dir, `${n}.jpg`))) plan[`${n}.jpg`] = [160, 390];
// The sitting venues (scripts/gen-courtyard.mjs venue-*): full-bleed on the call page.
for (const n of ["courtyard", "terrace", "pergola", "deck", "lounge", "patio"]) if (existsSync(join(dir, "venues", `${n}.jpg`))) plan[`venues/${n}.jpg`] = [390, 780, 1600];
for (const f of readdirSync(dir)) {
  if (/^family-[a-z]+\.webp$/.test(f)) plan[f] = [440, 880];
  if (/^portrait-[a-z]+\.webp$/.test(f)) plan[f] = [160, 400];
}

for (const [file, widths] of Object.entries(plan)) {
  for (const w of widths) {
    const out = join(dir, file.replace(/\.(jpg|webp)$/, `-${w}.webp`));
    const info = await sharp(join(dir, file)).resize({ width: w }).webp({ quality: 74, effort: 6 }).toFile(out);
    console.log(`${file} -> ${out.split("/").pop()} ${(info.size / 1024).toFixed(1)} KB`);
  }
}
