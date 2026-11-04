// Run with MOCK=true SESSION_SECRET=test-session-secret npx vite-node --config vitest.config.ts scripts/cpu-bench.ts
import { GET as courtyard } from "@/app/api/courtyard/route";
import { GET as window } from "@/app/api/window/route";
import { GET as waiting } from "@/app/api/waiting/route";
import { GET as inbox } from "@/app/api/inbox/route";
import { GET as session } from "@/app/api/session/route";
import { sessionCookie } from "../tests/auth-helper";

if (process.env.MOCK !== "true" || process.env.SESSION_SECRET !== "test-session-secret") {
  throw new Error("Run the CPU benchmark with the mock environment shown above.");
}

const routes = [
  ["/api/courtyard", courtyard],
  ["/api/window", window],
  ["/api/waiting", waiting],
  ["/api/inbox", inbox],
  ["/api/session?family=1", session],
] as const;
const cookie = sessionCookie("arjun");
const samples = 25;
for (const [path, handler] of routes) {
  const times: number[] = [];
  for (let i = -5; i < samples; i++) {
    const req = new Request(`http://localhost${path}`, { headers: { cookie } });
    const start = process.cpuUsage();
    const response = await handler(req);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    await response.arrayBuffer();
    const cpu = process.cpuUsage(start);
    if (i >= 0) times.push((cpu.user + cpu.system) / 1_000);
  }
  times.sort((a, b) => a - b);
  const percentile = (p: number) => times[Math.ceil(samples * p) - 1].toFixed(2);
  console.log(`${path.padEnd(23)} median ${percentile(0.5)} ms · p90 ${percentile(0.9)} ms`);
}
