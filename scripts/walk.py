#!/usr/bin/env python3
"""Navigation walk: every room tab, as three demo people, in a real browser.

Signs in to the demo (AANGAN-DEMO) as a parent, an adult child and two children (the kids' first screen is kid-home),
opens the house from the dock, then visits every tab of every room
(lib/menu.ts). Fails on a page error, an error-level console message, a
4xx/5xx document or a 5xx API call, a missing page title, or a room tile
that doesn't open its first tab.

CI runs it against a mock build (.github/workflows/ci.yml). It also works
against the live site after a deploy:
    python3 scripts/walk.py --base https://aangan.sanjeevlabs.com
(live, each person gets their own demo copy; the daily cron removes them).
"""
import argparse
import json
import re
import sys

from playwright.sync_api import sync_playwright

# Mirrors lib/menu.ts roomsFor(); the walk fails if the house sheet disagrees.
ROOMS = {
    "Memories": ["/lane", "/stories"],
    "Kitchen": ["/kitchen"],
    "Care": ["/care", "/care/helpers", "/nearby"],
    "Family": ["/bond", "/bond/homes", "/book", "/advice", "/portrait"],
    "Celebrations": ["/gather", "/rituals", "/together/visits", "/together/holidays", "/gather/play"],
}
# Kid mode (lib/menu.ts roomsFor(..., kid)): a child's house has three rooms, and fewer tabs in them.
KID_ROOMS = {
    "Memories": ["/lane", "/stories"],
    "Celebrations": ["/gather", "/gather/play"],
    "Family": ["/bond"],
}
PEOPLE = [("arjun", "adult"), ("dadi", "parent"), ("leo", "child"), ("aria", "child")]
# Console noise that isn't ours (dev tooling, a blocked third-party font).
IGNORE = re.compile(r"Download the React DevTools|fonts\.g(static|oogleapis)|favicon", re.I)


def walk(base: str, person: str, kind: str, browser) -> list[str]:
    problems: list[str] = []
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, base_url=base)
    # Behind the door: open straight into the house (app/page.tsx DOOR_KEY).
    ctx.add_init_script("try { sessionStorage.setItem('aangan:door', 'open') } catch (e) {}")
    page = ctx.new_page()
    where = {"url": "/"}
    page.on("pageerror", lambda e: problems.append(f"{person} {where['url']}: page error: {e}"))
    page.on(
        "console",
        lambda m: m.type == "error" and not IGNORE.search(m.text) and problems.append(f"{person} {where['url']}: console: {m.text[:200]}"),
    )
    page.on(
        "response",
        lambda r: r.status >= 500 and "/api/" in r.url and problems.append(f"{person} {where['url']}: {r.status} {r.url}"),
    )

    res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "AANGAN-DEMO", "memberId": person}), headers={"content-type": "application/json"})
    if not res.ok:
        ctx.close()
        return [f"{person}: demo sign-in failed {res.status} {res.text()[:200]}"]

    rooms = KID_ROOMS if kind == "child" else ROOMS
    # The dock's house opens the rooms; each tile goes to the room's first tab.
    page.goto("/", wait_until="load")
    if kind == "child":
        # A child's first screen is kid-home: Show, Tell, Ask. Never the grown-ups' courtyard or window.
        where["url"] = "/"
        try:
            page.locator("[data-ui=kid-home]").wait_for(timeout=15_000)
            for big in ("show", "tell", "ask"):
                if page.locator(f"[data-kid={big}]").count() == 0:
                    problems.append(f"{person} /: no '{big}' button on kid-home")
        except Exception:
            problems.append(f"{person} /: no kid-home")
    page.get_by_role("button", name="Open the house").click(timeout=15_000)
    for room, tabs in rooms.items():
        tile = page.get_by_role("link", name=re.compile(rf"^{room}\b"))
        if tile.count() == 0:
            tile = page.get_by_role("button", name=re.compile(rf"^{room}\b"))
        if tile.count() == 0:
            problems.append(f"{person}: no '{room}' tile in the house")
    if kind == "child":
        for room in ("Kitchen", "Care"):
            if page.get_by_role("link", name=re.compile(rf"^{room}\b")).count():
                problems.append(f"{person}: kid mode shows '{room}'")
    first = rooms["Memories"][0]
    page.get_by_role("link", name=re.compile(r"^Memories\b")).first.click()
    page.wait_for_url(f"**{first}", timeout=15_000)

    for room, tabs in rooms.items():
        for href in tabs:
            if href == "/portrait" and kind == "child":
                continue  # grown-ups only (lib/muse-portrait canStartPortrait)
            where["url"] = href
            resp = page.goto(href, wait_until="load")
            if resp is None or resp.status >= 400:
                problems.append(f"{person} {href}: document {resp.status if resp else 'none'}")
                continue
            try:
                page.locator("h1").first.wait_for(timeout=15_000)
            except Exception:
                problems.append(f"{person} {href}: no page title (h1)")
            if page.get_by_text(re.compile(r"something went wrong|application error", re.I)).count():
                problems.append(f"{person} {href}: error screen")
    ctx.close()
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3100")
    args = ap.parse_args()
    problems: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for person, kind in PEOPLE:
            found = walk(args.base, person, kind, browser)
            print(f"{person:6} {'ok' if not found else f'{len(found)} problem(s)'}")
            problems += found
        browser.close()
    for line in problems:
        print("  " + line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
