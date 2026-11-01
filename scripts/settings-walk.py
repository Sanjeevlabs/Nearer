#!/usr/bin/env python3
"""Settings never auto-save: choose things, watch the network, then Save.

Signs in to the demo as a person, opens /settings at 390px and, tab by tab,
changes one control per section. Fails if any write (POST/PUT/PATCH/DELETE to
/api/) happens before Save, or if Save does not send the section's request.
Takes a screenshot of each tab with one dirty section (--shots DIR).

    python3 scripts/settings-walk.py --base http://127.0.0.1:4400 --shots /tmp/shots
"""
import argparse
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

WRITES = ("POST", "PUT", "PATCH", "DELETE")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:4400")
    ap.add_argument("--person", default="dadi")
    ap.add_argument("--shots", default="")
    a = ap.parse_args()
    problems: list[str] = []
    if a.shots:
        os.makedirs(a.shots, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, base_url=a.base)
        ctx.add_init_script("try { sessionStorage.setItem('aangan:door', 'open'); sessionStorage.setItem('aangan:entered', '1') } catch (e) {}")
        page = ctx.new_page()
        writes: list[str] = []
        # The app's own visit heartbeat (POST /api/presence) is not a setting.
        page.on("request", lambda r: "/api/" in r.url and r.method in WRITES and not (r.method == "POST" and r.url.endswith("/api/presence")) and writes.append(f"{r.method} {r.url.split('/api/')[1].split('?')[0]}"))
        page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
        res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "AANGAN-DEMO", "memberId": a.person}), headers={"content-type": "application/json"})
        if not res.ok:
            print("sign-in failed", res.status)
            return 1
        page.goto("/settings", wait_until="load")
        page.locator("h1").first.wait_for(timeout=15_000)

        def tab(name: str):
            page.get_by_role("button", name=name, exact=True).first.click()
            page.wait_for_timeout(250)

        def expect_no_writes(what: str):
            page.wait_for_timeout(400)
            if writes:
                problems.append(f"{what}: wrote before Save: {writes}")
                writes.clear()

        def save_button(section: str):
            return page.get_by_role("button", name=f"Save {section}", exact=True)

        def shot(name: str):
            if a.shots:
                page.screenshot(path=os.path.join(a.shots, f"{a.person}-{name}.png"), full_page=True)

        # ---- You
        page.get_by_role("group", name="Nudges").locator("button[aria-pressed=false]").first.click()
        expect_no_writes("nudges choice")
        sb = save_button("Mail and nudges")
        if sb.is_disabled():
            problems.append("nudges: Save should be enabled after a change")
        page.get_by_role("textbox", name="Your first name").fill("Dadima")
        expect_no_writes("name edit")
        # Language: choosing previews nothing (the headings stay in the old language) and writes nothing.
        heads = page.locator("h2").all_inner_texts()
        page.locator('section[id="language"] button[aria-expanded]').click()
        page.locator('section[id="language"] [role=radio]', has_text="Tamil").first.click()
        expect_no_writes("language choice")
        if page.locator("h2").all_inner_texts() != heads:
            problems.append("language: the UI changed before Save")
        page.get_by_role("checkbox", name=re.compile("Larger text")).click()
        expect_no_writes("larger text")
        shot("1-you")
        sb.click()
        page.wait_for_function("() => document.body.innerText.includes('Saved')", timeout=8000)
        if not any(w == "PUT nudges/settings" for w in writes):
            problems.append(f"nudges Save did not PUT /api/nudges/settings: {writes}")
        writes.clear()
        page.get_by_role("button", name="Discard changes to Your profile").click()
        page.get_by_role("button", name="Discard changes to Reading").click()
        page.locator('section[id="language"]').get_by_role("button", name=re.compile("^Discard")).click()

        # ---- Window
        tab("Window")
        page.get_by_role("radiogroup", name="Amber after").get_by_role("radio", name="8 h").click()
        expect_no_writes("amber choice")
        shot("2-window")
        # ---- Privacy (the window edit stays; a banner reminds)
        tab("Privacy")
        page.get_by_role("checkbox", name=re.compile("Show my lamp")).click()
        expect_no_writes("lamp toggle")
        if page.get_by_text("Unsaved changes in Your first screen").count() == 0:
            problems.append("banner: no 'Unsaved changes in Your first screen' on the Privacy tab")
        shot("4-privacy")
        # ---- People
        tab("People")
        chip = page.get_by_role("radio", name="Teen")
        if chip.count():
            chip.first.click()
            expect_no_writes("role chip")
            shot("3-people")
        else:
            shot("3-people")
        # Save from the banner (window) and check the request.
        page.get_by_text("Unsaved changes in Your first screen").locator("xpath=..").get_by_role("button", name="Save", exact=True).click()
        page.wait_for_timeout(1500)
        if not any(w == "POST window" for w in writes):
            problems.append(f"banner Save did not POST /api/window: {writes}")
        browser.close()

    for pr in problems:
        print("FAIL", pr)
    print("settings walk:", "ok" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
