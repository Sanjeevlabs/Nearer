#!/usr/bin/env python3
"""LCP and CLS per route, second visit, on a throttled phone (390px).

Signs in to the demo, then for each route loads it once to warm the HTTP cache
and loads it again in a new tab (cold session storage, warm HTTP cache),
measuring that second load with CDP throttling: 150 ms latency, 2.4 Mbps down,
4x CPU. A mock build answers /api instantly, which a real database never does,
so --api-delay (default 250 ms) holds each /api response back, all in
parallel, to stand in for the round trip to it. LCP and CLS come from the
browser's own PerformanceObservers; --verbose also names the LCP element and
what moved. LCP is the median of --runs second visits, CLS the worst.

    python3 scripts/route-vitals.py --base http://127.0.0.1:3100
    python3 scripts/route-vitals.py --routes /kitchen,/care --verbose

Budgets (--max-lcp, --max-cls) fail the run only when given; with none it prints a table.
"""
import argparse
import asyncio
import json
import statistics
import sys

from playwright.async_api import async_playwright

ROUTES = ["/", "/inbox", "/lane", "/kitchen", "/care", "/bond", "/gather", "/send", "/settings"]

READ = """() => new Promise((res) => {
  let lcp = 0, lcpEl = '', cls = 0; const shifts = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { lcp = e.startTime; const el = e.element; lcpEl = el ? (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : '') + ' ' + (e.url || '').slice(-40)) : ''; } }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { cls += e.value; shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), n: (e.sources || []).slice(0, 2).map((s) => s.node ? (s.node.nodeName || '').toLowerCase() + (s.node.className && typeof s.node.className === 'string' ? '.' + s.node.className.split(' ').slice(0, 2).join('.') : '') : '?') }); } }).observe({ type: 'layout-shift', buffered: true });
  setTimeout(() => res({ lcp, lcpEl, cls, shifts }), 600);
})"""


async def sign_in(browser, base: str) -> dict:
    ctx = await browser.new_context(base_url=base)
    res = await ctx.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": "arjun"}), headers={"content-type": "application/json"})
    if not res.ok:
        status, body = res.status, (await res.text())[:200]
        await ctx.close()
        raise SystemExit(f"route-vitals: demo sign-in failed {status} {body}")
    state = await ctx.storage_state()
    await ctx.close()
    return state


async def throttle(ctx, page) -> None:
    cdp = await ctx.new_cdp_session(page)
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 2.4 * 1024 * 1024 / 8, "uploadThroughput": 750 * 1024 / 8})
    await cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})


async def second_visit(browser, base: str, route: str, state: dict, api_delay: int) -> dict:
    ctx = await browser.new_context(viewport={"width": 390, "height": 844}, base_url=base, storage_state=state)
    await ctx.add_init_script("try { sessionStorage.setItem('aangan:door', 'open'); sessionStorage.setItem('aangan:entered', '1') } catch (e) {}")
    page = await ctx.new_page()
    await throttle(ctx, page)
    await page.goto(route, wait_until="load")
    await page.wait_for_timeout(2500)  # first visit: warms the HTTP cache
    await page.close()
    page = await ctx.new_page()  # a new tab: session storage is empty again, the HTTP cache is not
    await throttle(ctx, page)
    if api_delay:

        async def slow(r):
            await asyncio.sleep(api_delay / 1000)
            await r.continue_()

        await page.route("**/api/**", slow)
    await page.goto(route, wait_until="load")
    await page.wait_for_timeout(3000)  # let late content and layout shifts land
    out = await page.evaluate(READ)
    await ctx.close()
    return out


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3100")
    ap.add_argument("--routes", default=",".join(ROUTES))
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--api-delay", type=int, default=250, help="ms each /api response is held back (stands in for the database round trip)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--max-lcp", type=float, default=None)
    ap.add_argument("--max-cls", type=float, default=None)
    ap.add_argument("--json", action="store_true", help="also print the table as JSON")
    args = ap.parse_args()

    rows, problems = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        state = await sign_in(browser, args.base)
        for route in [r for r in args.routes.split(",") if r]:
            runs = [await second_visit(browser, args.base, route, state, args.api_delay) for _ in range(args.runs)]
            lcp = statistics.median(r["lcp"] for r in runs)
            cls = max(r["cls"] for r in runs)
            worst = max(runs, key=lambda r: r["cls"])
            rows.append({"route": route, "lcp": round(lcp), "cls": round(cls, 3)})
            print(f"{route:10} LCP {lcp:6.0f} ms   CLS {cls:.3f}")
            if args.verbose:
                print(f"           LCP element: {runs[0]['lcpEl']}")
                for s in worst["shifts"]:
                    print(f"           shift {s['v']} at {s['t']} ms: {', '.join(s['n'])}")
            if args.max_lcp is not None and lcp > args.max_lcp:
                problems.append(f"{route}: LCP {lcp:.0f} ms > {args.max_lcp:.0f} ms")
            if args.max_cls is not None and cls > args.max_cls:
                problems.append(f"{route}: CLS {cls:.3f} > {args.max_cls}")
        await browser.close()
    if args.json:
        print(json.dumps(rows))
    if problems:
        print("\n".join(f"route-vitals: {m}" for m in problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
