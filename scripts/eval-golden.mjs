// Manual live eval runner. Never run in CI.
// Usage: npm run eval:golden   (requires META_API_KEY in the environment)
// Loads .env.local (CRLF-safe) so the documented command works as-is; the key
// is never printed. Runs under vitest.live.config.ts, which — unlike the
// default config — does not force MOCK=true.
import { spawnSync } from "child_process";
import { readFileSync } from "fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // No .env.local — environment only.
}

if (!process.env.META_API_KEY) {
  console.error("eval:golden needs META_API_KEY in the environment. Nothing was called.");
  process.exit(2);
}
const r = spawnSync("npx", ["vitest", "run", "--config", "vitest.live.config.ts"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    RUN_GOLDEN: "1",
    RUN_LIVE_CACHE: "1",
    MOCK: "",
    TEMP: "D:\\Nearer\\.tmp",
    TMP: "D:\\Nearer\\.tmp",
  },
});
process.exit(r.status ?? 1);
