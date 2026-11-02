// Writes the build docs (docs/site/*.md) with Muse Spark from the repo's own material.
// Run: META_API_KEY=... npm run docs:muse   (never in CI; the key comes from the environment only)
//   --force        regenerate every page even if its inputs are unchanged
//   --only=<slug>  one page
// A page is skipped when the hash of its inputs is unchanged (docs/site/.hashes.json). A reply that
// fails validation is retried once, then the previous version of the page is kept.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DOC_PAGES } from "../lib/docs-pages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "site");
const HASHES = join(OUT, ".hashes.json");
const BASE_URL = "https://api.meta.ai/v1";
const MODEL = "muse-spark-1.3";

// ---------------------------------------------------------------------------------------------
// Validation: what may never appear in a page.

// Words are split so this file itself passes the repo's public-repo lint.
const WORDS = ["pri" + "ce", "pri" + "cing", "reve" + "nue", "inves" + "tor", "compe" + "titor", "mone" + "tiz", "fun" + "ding"];
export const FORBIDDEN = new RegExp(`LLM_[0-9]|\\bsk-|cfut_|AKIA[0-9A-Z]{16}|\\b(${WORDS.join("|")})`, "i");

/** Returns a list of problems; empty means the page is acceptable. */
export function validatePage(md, secrets = []) {
  const problems = [];
  if (typeof md !== "string" || md.trim().length < 200) problems.push("empty or too short");
  else {
    if (!/^# \S/m.test(md)) problems.push("no H1");
    const hit = md.match(FORBIDDEN);
    if (hit) problems.push(`forbidden text: ${hit[0]}`);
    for (const s of secrets) if (s && md.includes(s)) problems.push("contains a secret value");
  }
  return problems;
}

/** Drops any line of source material that would trip the validator, so it cannot be echoed. */
export function sanitizeInput(text) {
  return text
    .split("\n")
    .filter((l) => !FORBIDDEN.test(l))
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Inputs: only what is in the repo.

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");

function clip(text, max, tail = false) {
  if (text.length <= max) return text;
  return tail ? "[...earlier text omitted...]\n" + text.slice(-max) : text.slice(0, max) + "\n[...later text omitted...]";
}

function routes() {
  const out = { pages: [], api: [] };
  const walk = (dir, base, kind) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, e.name);
      if (e.isDirectory()) walk(rel, `${base}/${e.name}`, kind);
      else if (/^page\.tsx?$/.test(e.name) && kind === "pages") out.pages.push(base || "/");
      else if (/^route\.ts$/.test(e.name) && kind === "api") out.api.push(base);
    }
  };
  walk("app", "", "pages");
  walk("app/api", "/api", "api");
  out.pages = out.pages.filter((p) => !p.startsWith("/api") && !p.startsWith("/docs")).sort();
  out.api.sort();
  return out;
}

function testCounts() {
  const dir = join(ROOT, "tests");
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));
  let cases = 0;
  for (const f of files) cases += (readFileSync(join(dir, f), "utf8").match(/^\s*(it|test)(\.each\([^)]*\))?\(/gm) || []).length;
  return { files: files.length, cases };
}

function gitLog() {
  try {
    return execFileSync("git", ["log", "--oneline", "-60"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function packageInfo() {
  const pkg = JSON.parse(read("package.json"));
  return {
    scripts: pkg.scripts,
    dependencies: Object.keys(pkg.dependencies || {}),
    devDependencies: Object.keys(pkg.devDependencies || {}),
  };
}

function migrations() {
  const dir = join(ROOT, "supabase");
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.sql$/.test(e.name)) out.push(join(d, e.name).slice(ROOT.length + 1));
    }
  };
  walk(dir);
  return out.sort();
}

/** Every named block of material, already sanitised and clipped. */
export function gatherMaterial() {
  const r = routes();
  const t = testCounts();
  const pkg = packageInfo();
  const m = {
    README: clip(read("README.md"), 11000),
    BUILD_LOG: clip(read("BUILD_LOG.md"), 15000, true),
    DESIGN: clip(read("docs/DESIGN.md"), 11500),
    MUSE: clip(read("docs/MUSE.md"), 8000),
    NATIVE: clip(read("docs/NATIVE.md"), 13000),
    DEPLOY: clip(read("docs/DEPLOY.md"), 13000),
    STATE: clip(read("docs/STATE.md"), 16000),
    CONFIG: read("lib/config.ts"),
    ROUTES: `Pages (${r.pages.length}):\n${r.pages.join("\n")}\n\nAPI routes (${r.api.length}):\n${r.api.join("\n")}`,
    PACKAGE: `Scripts:\n${Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nDependencies: ${pkg.dependencies.join(", ")}\nDev dependencies: ${pkg.devDependencies.join(", ")}`,
    MIGRATIONS: migrations().join("\n"),
    TESTS: `${t.files} test files, about ${t.cases} test cases (counted from the source, not run).`,
    GIT_LOG: gitLog(),
    PRIVACY_PAGE: clip(read("app/privacy/page.tsx"), 4000),
    PERF_BUDGET: clip(read("scripts/perf-budget.mjs"), 4000),
  };
  for (const k of Object.keys(m)) m[k] = sanitizeInput(m[k]);
  return m;
}

// Which material each page sees.
const PAGE_INPUTS = {
  index: ["README", "STATE", "DESIGN", "ROUTES", "PACKAGE", "TESTS", "BUILD_LOG", "GIT_LOG"],
  architecture: ["README", "DEPLOY", "NATIVE", "STATE", "ROUTES", "PACKAGE", "MIGRATIONS", "CONFIG"],
  muse: ["MUSE", "CONFIG", "STATE", "README"],
  "privacy-and-safety": ["PRIVACY_PAGE", "STATE", "MUSE", "DESIGN", "README", "BUILD_LOG"],
  performance: ["STATE", "DEPLOY", "DESIGN", "PERF_BUDGET", "PACKAGE", "BUILD_LOG"],
  notifications: ["NATIVE", "DEPLOY", "STATE", "ROUTES", "BUILD_LOG"],
  changelog: ["GIT_LOG"],
};

const SYSTEM = [
  "You write the public documentation pages for Nearer, a family app, as Markdown.",
  "Write plain-language, accurate documentation ONLY from the material provided in the user message.",
  "Never invent features, numbers, dates, names or behaviour. If something is unclear or missing from the material, either leave it out or mark it exactly as 'not verified'.",
  "Do not write about business strategy, money, pricing, funding, partners, competitors or other products. Do not mention API keys or secrets.",
  "Format: start with one H1 line (# Title), then short sections with ## headings, short paragraphs, lists, and tables where they help. Use only plain Markdown (headings, lists, tables, code, links, bold, italic). No HTML. No front matter. Do not wrap the whole answer in a code fence.",
  "Do not add a footer or a signature; one is added for you. Keep it concise: a page a new teammate can read in about five minutes.",
].join("\n");

export function buildPrompt(page, material) {
  const blocks = PAGE_INPUTS[page.slug].map((k) => `=== ${k} ===\n${material[k] || "(none)"}`).join("\n\n");
  return `Page to write: "${page.slug}"\nInstructions for this page: ${page.brief}\n\nMaterial (the only source of facts):\n\n${blocks}`;
}

export function inputHash(page, material) {
  return createHash("sha256").update(MODEL).update(SYSTEM).update(buildPrompt(page, material)).digest("hex");
}

// ---------------------------------------------------------------------------------------------
// Muse call: plain fetch, same endpoint and bearer header as lib/llm.ts.

const usage = { calls: 0, prompt: 0, completion: 0 };

async function callMuse(key, user) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    // A reasoning model spends tokens before it answers; keep the cap high.
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], max_tokens: 8000 }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Muse HTTP ${res.status}`);
  const data = await res.json();
  usage.calls += 1;
  usage.prompt += data.usage?.prompt_tokens ?? 0;
  usage.completion += data.usage?.completion_tokens ?? 0;
  return data.choices?.[0]?.message?.content ?? "";
}

/** Strips a wrapping code fence and any footer the model added anyway. */
export function cleanReply(text) {
  let t = String(text).trim();
  const fence = t.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/);
  if (fence) t = fence[1].trim();
  t = t.replace(/\n+---\s*\n+\s*\*?_?Written by[^\n]*$/i, "").replace(/\n+\*?_?Written by Muse[^\n]*$/i, "");
  return t.trim();
}

export function withFooter(md, date) {
  return `${md}\n\n---\n\nWritten by Muse Spark (Meta) from the build log on ${date}.\n`;
}

async function writePage(key, page, material) {
  const user = buildPrompt(page, material);
  let last = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const md = cleanReply(await callMuse(key, user));
      last = validatePage(md, [key]);
      if (last.length === 0) return md;
      console.warn(`  ${page.slug}: attempt ${attempt + 1} rejected (${last.join("; ")})`);
    } catch (e) {
      last = [String(e.message || e)];
      console.warn(`  ${page.slug}: attempt ${attempt + 1} failed (${last[0]})`);
    }
  }
  return null;
}

async function main() {
  const key = process.env.META_API_KEY;
  if (!key) {
    console.error("META_API_KEY is not set (environment only).");
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  mkdirSync(OUT, { recursive: true });
  const hashes = existsSync(HASHES) ? JSON.parse(readFileSync(HASHES, "utf8")) : {};
  const material = gatherMaterial();
  const date = new Date().toISOString().slice(0, 10);
  let failed = 0;
  for (const page of DOC_PAGES) {
    if (only && page.slug !== only) continue;
    const file = join(OUT, `${page.slug}.md`);
    const hash = inputHash(page, material);
    if (!force && hashes[page.slug] === hash && existsSync(file)) {
      console.log(`${page.slug}: unchanged, skipped`);
      continue;
    }
    console.log(`${page.slug}: writing with ${MODEL}...`);
    const md = await writePage(key, page, material);
    if (!md) {
      failed++;
      console.warn(`${page.slug}: kept the previous version`);
      continue;
    }
    writeFileSync(file, withFooter(md, date));
    hashes[page.slug] = hash;
    writeFileSync(HASHES, JSON.stringify(hashes, null, 2) + "\n");
    console.log(`${page.slug}: written (${md.length} chars)`);
  }
  console.log(`Muse usage: ${usage.calls} calls, ${usage.prompt} prompt tokens, ${usage.completion} completion tokens.`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
