// Before a live demo: node scripts/warm.mjs [base-url] [rounds]
// Hits the judge-path pages and APIs a few times in parallel so Cloudflare has warm isolates, and prints
// status counts per URL. A 503 here is the host's CPU cut-off (the app retries those); a healthy run is nearly all 200.
const BASE = (process.argv[2] || process.env.BASE || "https://nearer.site").replace(/\/$/, "");
const ROUNDS = Number(process.argv[3] || process.env.ROUNDS || 4);
const PARALLEL = 6;

const pages = ["/", "/home", "/signin", "/offline.html"];
const apis = ["/api/session?family=1", "/api/window", "/api/courtyard", "/api/cards", "/api/waiting", "/api/members", "/api/relationships"];

// Demo sign-in, as the Home page's "Try the demo" does. The cookie then warms the signed-in reads.
async function demoCookie() {
  try {
    const res = await fetch(BASE + "/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteCode: "NEARER-DEMO", memberId: "arjun" }) });
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return { status: res.status, cookie };
  } catch (e) {
    return { status: `error ${e.cause?.code ?? e.message}`, cookie: "" };
  }
}

async function hit(path, cookie) {
  try {
    const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    await res.arrayBuffer();
    return res.status;
  } catch {
    return "network";
  }
}

const signin = await demoCookie();
console.log(`warming ${BASE} (${ROUNDS} rounds x ${PARALLEL} parallel); demo sign-in: ${signin.status}`);
const counts = new Map();
const note = (path, s) => {
  const m = counts.get(path) ?? new Map();
  m.set(s, (m.get(s) ?? 0) + 1);
  counts.set(path, m);
};
for (let r = 0; r < ROUNDS; r++) {
  const jobs = [];
  for (const path of [...pages, ...apis]) for (let i = 0; i < PARALLEL; i++) jobs.push(hit(path, apis.includes(path) ? signin.cookie : "").then((s) => note(path, s)));
  await Promise.all(jobs);
}
let bad = 0;
for (const [path, m] of counts) {
  const row = [...m].map(([s, n]) => `${s} x${n}`).join(", ");
  for (const [s, n] of m) if (s !== 200 && !(typeof s === "number" && s < 400)) bad += n;
  console.log(path.padEnd(26), row);
}
console.log(bad ? `${bad} requests were not OK (cut-offs are retried by the app; warm again if many)` : "all OK");
