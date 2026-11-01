#!/usr/bin/env python3
"""Core Web Vitals on a phone, without Lighthouse.

Signs in to the demo (AANGAN-DEMO), opens the courtyard (sessionStorage
aangan:door=open) in a cold 390px Chromium with a simulated 4G link
(1.5 Mbps down, 100 ms RTT) and a 4x CPU slowdown, and reads LCP and CLS from
the browser's own PerformanceObservers. Fails when:

  courtyard LCP  > --max-lcp ms   (default 2500)
  window LCP     > --max-window-lcp ms (default 2000; the signed-in first screen, door closed)
  window CLS     > --max-window-cls    (default 0.05)
  CLS on any room > --max-cls     (default 0.1)
  API calls on the courtyard > --max-api (default 8; the courtyard makes 6)

LCP is the median of --runs cold loads, CLS the worst. Rooms other than the
courtyard are checked for CLS only.

    python3 scripts/perf-vitals.py --base http://127.0.0.1:3100

CI runs it after the walk against the same mock build (.github/workflows/ci.yml).
"""
import argparse
import json
import statistics
import sys

from playwright.sync_api import sync_playwright

# (label, path, door open?) The window is the signed-in first screen (door closed).
ROOMS = [("/", "/", True), ("window", "/", False), ("/lane", "/lane", True), ("/kitchen", "/kitchen", True), ("/care", "/care", True), ("/bond", "/bond", True)]

READ = """() => new Promise((res) => {
  let lcp = 0, cls = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  setTimeout(() => {
    const api = performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/')).length;
    res({ lcp, cls, api });
  }, 300);
})"""


def sign_in(browser, base: str) -> dict:
    """One demo sign-in (the endpoint allows 20 per 10 minutes per address); returns the cookies to reuse."""
    ctx = browser.new_context(base_url=base)
    res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "AANGAN-DEMO", "memberId": "arjun"}), headers={"content-type": "application/json"})
    if not res.ok:
        status, body = res.status, res.text()[:200]
        ctx.close()
        raise SystemExit(f"perf-vitals: demo sign-in failed {status} {body}")
    state = ctx.storage_state()
    ctx.close()
    return state


def measure(browser, base: str, route: str, state: dict, door_open: bool = True) -> dict:
    """One cold load: a fresh context (empty cache), signed in, door open (or closed: the window)."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, base_url=base, storage_state=state)
    if door_open:
        ctx.add_init_script("try { sessionStorage.setItem('aangan:door', 'open') } catch (e) {}")
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 100, "downloadThroughput": 1.5 * 1024 * 1024 / 8, "uploadThroughput": 750 * 1024 / 8})
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    page.goto(route, wait_until="load")
    page.wait_for_timeout(3500)  # let late content and layout shifts land
    out = page.evaluate(READ)
    ctx.close()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3100")
    ap.add_argument("--max-lcp", type=float, default=2500)
    ap.add_argument("--max-cls", type=float, default=0.1)
    ap.add_argument("--max-api", type=int, default=8)
    ap.add_argument("--max-window-lcp", type=float, default=2000)
    ap.add_argument("--max-window-cls", type=float, default=0.05)
    ap.add_argument("--runs", type=int, default=3)
    args = ap.parse_args()

    problems: list[str] = []
    print(f"{'route':10} {'LCP ms':>7} {'CLS':>6} {'API':>4}")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        state = sign_in(browser, args.base)
        for label, route, door_open in ROOMS:
            is_home, is_window = label == "/", label == "window"
            runs = [measure(browser, args.base, route, state, door_open) for _ in range(args.runs if (is_home or is_window) else 1)]
            lcp = statistics.median(r["lcp"] for r in runs)
            cls = max(r["cls"] for r in runs)
            api = max(r["api"] for r in runs)
            print(f"{label:10} {lcp:7.0f} {cls:6.3f} {api:4}")
            if is_home:
                if lcp > args.max_lcp:
                    problems.append(f"courtyard LCP {lcp:.0f} ms > {args.max_lcp:.0f} ms")
                if api > args.max_api:
                    problems.append(f"courtyard makes {api} API calls on load (> {args.max_api})")
            if is_window:
                if lcp > args.max_window_lcp:
                    problems.append(f"window LCP {lcp:.0f} ms > {args.max_window_lcp:.0f} ms")
                if cls > args.max_window_cls:
                    problems.append(f"window CLS {cls:.3f} > {args.max_window_cls}")
            elif cls > args.max_cls:
                problems.append(f"{label}: CLS {cls:.3f} > {args.max_cls}")
        browser.close()

    if problems:
        print("\n".join(f"perf-vitals: {m}" for m in problems), file=sys.stderr)
        return 1
    print("perf-vitals ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
