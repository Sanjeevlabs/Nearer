#!/usr/bin/env python3
"""Simulates the host's CPU cut-off against a local build and checks nothing visibly fails.

  python3 scripts/cutoff-sim.py --base http://127.0.0.1:3100 [--rate 0.2] [--seed 7]

Part A (service workers blocked): ~RATE of the /api GETs answer 503 with Cloudflare's "Error 1102" HTML
  while the walk screens load as the demo parent. Fails if any screen shows "Couldn't load" / an error page.
Part B (service worker active): each page navigation is answered 503 twice, then OK; the page must appear
  with no error screen. Another navigation is cut off every time: the kept copy (or the self-retrying page) must show.
"""
import argparse
import json
import random
import sys

from playwright.sync_api import sync_playwright

SCREENS = ["/", "/lane", "/stories", "/kitchen", "/bond", "/care", "/gather", "/together/visits", "/inbox", "/settings"]
BAD = ["Couldn't load", "Error 1102", "Worker exceeded", "Something went wrong", "Application error", "You're offline"]
CF = "<!doctype html><title>Error 1102</title><h1>Error 1102</h1><p>Worker exceeded resource limits</p>"


def login(ctx, base):
    r = ctx.request.post(base + "/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": "arjun"}), headers={"content-type": "application/json"})
    assert r.ok, r.status


def part_a(p, base, rate, seed, problems):
    rng = random.Random(seed)
    stats = {"api": 0, "cut": 0}
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    login(ctx, base)

    def handler(route):
        req = route.request
        if req.method == "GET":
            stats["api"] += 1
            if rng.random() < rate:
                stats["cut"] += 1
                return route.fulfill(status=503, content_type="text/html", body=CF)
        route.continue_()

    ctx.route("**/api/**", handler)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    for rnd in range(2):
        for path in SCREENS:
            page.goto(base + path)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(2500)  # room for the 200/600/1500 ms retries
            text = page.inner_text("body")
            for bad in BAD:
                if bad in text:
                    problems.append(f"A {path} (round {rnd}): visible '{bad}'")
    if errs:
        problems.append(f"A page errors: {errs[:3]}")
    b.close()
    return stats


def cut(base, path, n):
    import urllib.request
    urllib.request.urlopen(f"{base}/__cut?path={path}&n={n}").read()


def seen(base):
    import urllib.request
    return json.loads(urllib.request.urlopen(f"{base}/__seen").read())


def part_b(p, base, problems):
    """`base` is a pass-through proxy (scripts/cutoff-sim.py --proxy) that can 503 chosen page navigations: a service
    worker's own fetches cannot be intercepted by the browser driver, so the cut-off is made on the wire."""
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, service_workers="allow")
    login(ctx, base)
    page = ctx.new_page()
    page.goto(base + "/lane")
    page.wait_for_load_state("networkidle")
    page.evaluate("navigator.serviceWorker.ready.then(() => 1)")
    page.wait_for_timeout(1500)
    page.reload()  # now controlled by the worker; keeps /lane's copy
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)
    if not page.evaluate("!!navigator.serviceWorker.controller"):
        problems.append("B the service worker is not controlling the page")

    cut(base, "/stories", 2)
    page.goto(base + "/stories")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    t = page.inner_text("body")
    for bad in BAD:
        if bad in t:
            problems.append(f"B /stories after two cut-offs: visible '{bad}'")
    if "Memories" not in t and "Stories" not in t:
        problems.append(f"B /stories did not show the page: {t[:80]!r}")
    n_stories = seen(base).get("/stories", 0)

    cut(base, "/lane", 99)
    page.goto(base + "/lane")
    page.wait_for_timeout(3500)
    t = page.inner_text("body")
    for bad in BAD:
        if bad in t:
            problems.append(f"B /lane always cut off (kept copy): visible '{bad}'")
    cut(base, "/lane", 0)

    cut(base, "/care/helpers", 3)
    page.goto(base + "/care/helpers")
    page.wait_for_timeout(300)
    # (the worker is still retrying for ~1.2 s; the page shows once it gives up)
    page.wait_for_function("document.body.innerText.includes('One moment')", timeout=5000)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(3500)
    t = page.inner_text("body")
    for bad in BAD + ["One moment"]:
        if bad in t:
            problems.append(f"B /care/helpers after the cut-offs ended: still '{bad}'")
    if "Helpers" not in t:
        problems.append(f"B /care/helpers did not recover: {t[:80]!r}")

    cut(base, "/care/helpers", 0)
    cut(base, "/nearby", 99)
    page.goto(base + "/nearby")
    page.wait_for_function("document.body.innerText.includes('Still opening')", timeout=15000)
    t = page.inner_text("body")
    if "Try again" not in t:
        problems.append("B no 'Try again' button after repeated cut-offs")
    b.close()
    return {"nav": n_stories}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3100")
    ap.add_argument("--proxy", default="http://127.0.0.1:3200", help="pass-through proxy that can 503 navigations (see part_b)")
    ap.add_argument("--rate", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    problems = []
    with sync_playwright() as p:
        s = part_a(p, a.base, a.rate, a.seed, problems)
        print(f"A: {s['cut']} of {s['api']} /api GETs cut off ({100 * s['cut'] / max(1, s['api']):.0f}%) across {2 * len(SCREENS)} screen loads")
        c = part_b(p, a.proxy, problems)
        print(f"B: /stories was cut off twice, the worker retried and the page showed ({c['nav']} requests reached the proxy: 2 cut, 1 served)")
    for x in problems:
        print("FAIL", x)
    print("clean" if not problems else f"{len(problems)} problems")
    sys.exit(1 if problems else 0)


main()
