// Nearer demo-family seed script (M6). Generates ONCE into public/demo/.
// Usage: node scripts/seed.mjs
// The key comes from META_API_KEY in the environment (or .env.local); it is
// never printed, logged, or written anywhere by this script.
//
// Series consistency (cookbook 05_muse_image/03 intent): every prompt reuses
// the identical CHARACTER block verbatim plus the same STYLE suffix, so the
// same Dadi, Arjun, Leo and Aria appear across all photos. The reference
// cookbook path (D:\refs\meta-model-cookbook) was absent on this machine, so
// this implements the described intent directly from the PRD.
// Synthetic seed assets only: labelled AI-generated in public/demo/README.md
// and the manifest below; they never appear inside real memory cards.
import { mkdirSync, readFileSync, writeFileSync } from "fs";

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local — environment only.
  }
  return env;
}

const env = loadEnv();
const key = env.META_API_KEY;
if (!key) {
  console.error("META_API_KEY is missing. Nothing was called.");
  process.exit(2);
}

const MODEL = "muse-image-1.0"; // mirrors PROVIDERS.meta.imageModel in lib/config.ts

// Identical in every prompt: the consistency anchor.
const CHARACTER =
  "The same Indian family in every photo: " +
  "Dadi, an elderly Indian woman with a silver bun and a maroon shawl; " +
  "Arjun, an Indian man in his 30s with short black hair wearing a simple kurta; " +
  "Leo, an 8-year-old boy with short black hair wearing a yellow kurta; " +
  "Aria, a 6-year-old girl with two braids wearing a red dress.";

const STYLE =
  "Warm photorealistic family photograph, soft morning light, modest Indian family courtyard home, " +
  "no text, no watermarks, no house numbers, no street signs.";

const PHOTOS = [
  {
    file: "family-dadi.jpg",
    who: "dadi",
    scene: "Portrait of Dadi smiling gently, seated on the courtyard steps with potted plants beside her.",
  },
  {
    file: "family-leo.jpg",
    who: "leo",
    scene: "Leo playing with wooden spinning tops on the courtyard floor, laughing.",
  },
  {
    file: "family-aria.jpg",
    who: "aria",
    scene: "Aria holding up a picture she drew, standing in the sunlit courtyard doorway.",
  },
  {
    file: "family-group.jpg",
    who: "dadi,arjun,leo,aria",
    scene: "The whole family together in the courtyard at golden hour, Dadi seated in the middle, everyone close.",
  },
];

const startedAt = new Date().toISOString();
mkdirSync("public/demo", { recursive: true });

const manifest = { generated_at: startedAt, model: MODEL, notice: "AI-generated synthetic seed assets. Not real people, places, or events.", photos: [] };
let totalBytes = 0;

for (const photo of PHOTOS) {
  const prompt = `${CHARACTER} ${photo.scene} ${STYLE}`;
  const res = await fetch("https://api.meta.ai/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, prompt, size: "1024x1024", n: 1 }),
  });
  if (!res.ok) {
    console.error(`image request failed for ${photo.file}: provider-http-${res.status}`);
    process.exit(1);
  }
  const data = await res.json();
  const first = data?.data?.[0];
  let bytes;
  if (typeof first?.b64_json === "string") {
    bytes = Buffer.from(first.b64_json, "base64");
  } else if (typeof first?.url === "string") {
    const dl = await fetch(first.url);
    if (!dl.ok) {
      console.error(`image download failed for ${photo.file}: provider-http-${dl.status}`);
      process.exit(1);
    }
    bytes = Buffer.from(await dl.arrayBuffer());
  } else {
    console.error(`unexpected image payload keys: ${Object.keys(data).join(",")}`);
    process.exit(1);
  }
  // The provider may return JPEG or WebP: name the file by magic bytes.
  const isWebP = bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const file = photo.file.replace(/\.jpg$/, isWebP ? ".webp" : ".jpg");
  writeFileSync(`public/demo/${file}`, bytes);
  totalBytes += bytes.length;
  manifest.photos.push({ file, who: photo.who, bytes: bytes.length });
  console.log(`saved public/demo/${file} (${bytes.length} bytes)`);
}

writeFileSync("public/demo/family.json", JSON.stringify(manifest, null, 2));

// llm_calls record: only metadata + cost/usage as returned by the provider.
console.log(`llm_calls ${JSON.stringify({ at: startedAt, model: MODEL, purpose: "demo-family-seed", images: PHOTOS.length, bytes: totalBytes, cost_usd: null })}`);
