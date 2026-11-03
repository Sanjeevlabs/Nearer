#!/usr/bin/env python3
"""Run axe on the main Nearer screens against a mock build."""
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

from walk import PEOPLE

AXE = Path(__file__).resolve().parents[1] / "node_modules/axe-core/axe.min.js"
HOUSE_STATE = """try {
  sessionStorage.setItem('aangan:entered', '1');
  sessionStorage.setItem('aangan:door', 'open');
  localStorage.setItem('aangan:voice-consent', '1');
} catch (e) {}"""


def audit(page, label, problems):
    page.evaluate("document.fonts.ready")
    if not page.evaluate("Boolean(window.axe)"):
        page.add_script_tag(path=str(AXE))
    violations = page.evaluate("async () => (await axe.run()).violations")
    for violation in violations:
        if violation["impact"] in ("serious", "critical"):
            targets = ", ".join(str(node["target"]) for node in violation["nodes"])
            problem = f"{label}: {violation['id']} ({violation['impact']}): {targets}"
            problems.append(problem)
            print(problem)


def visit(page, path, ready):
    page.goto(path, wait_until="load")
    page.locator(ready).first.wait_for(state="visible")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:3100")
    args = parser.parse_args()
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        options = dict(viewport={"width": 390, "height": 844}, base_url=args.base, reduced_motion="reduce")
        with browser.new_context(**options) as ctx:
            page = ctx.new_page()
            visit(page, "/home", "h1")
            audit(page, "Home", problems)
            visit(page, "/signin", "input")
            audit(page, "Sign-in", problems)
        for member, kind in PEOPLE:
            with browser.new_context(**options) as ctx:
                response = ctx.request.post("/api/session", data={"inviteCode": "NEARER-DEMO", "memberId": member})
                if not response.ok:
                    raise RuntimeError(f"{member}: demo sign-in failed with {response.status}")
                page = ctx.new_page()
                if kind != "child":
                    visit(page, "/", "button:has-text('Open Nearer')")  # signed in: the home page first, then the window
                    audit(page, f"{member}: Home (signed in)", problems)
                    page.get_by_role("button", name="Open Nearer").first.click()
                    page.locator("[data-ui=window-lamp]").first.wait_for(state="visible")
                    audit(page, f"{member}: Window", problems)
                ctx.add_init_script(HOUSE_STATE)
                if kind == "child":
                    visit(page, "/?demo=1", "[data-ui=kid-home]")
                    audit(page, f"{member}: Kid home", problems)
                    continue
                visit(page, "/", "[data-ui=dock]")
                audit(page, f"{member}: Family", problems)
                page.locator("[data-ui=profile-menu-button]").first.click()
                page.locator("[data-ui=profile-menu]").wait_for()
                audit(page, f"{member}: Profile menu", problems)
                page.keyboard.press("Escape")
                page.locator("[data-ui=profile-menu]").wait_for(state="hidden")
                page.locator("[data-ui=dock] button[aria-label^='Record a voice note']").first.click()
                page.locator("[role=dialog]").last.wait_for()
                audit(page, f"{member}: Voice sheet", problems)
                for path in ("/lane", "/kitchen", "/kitchen/recipe-dadi-dal", "/stories", "/care", "/inbox", "/settings"):
                    visit(page, path, "h1")
                    audit(page, f"{member}: {path}", problems)
        browser.close()
    print(f"Axe serious or critical violations: {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
