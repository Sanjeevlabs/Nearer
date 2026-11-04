#!/usr/bin/env python3
"""Compare two local mock builds and check the window's reserved footer."""
import argparse
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    routes = ["/", "/lane", "/kitchen", "/settings"]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        device = dict(p.devices["iPhone 14"])
        device.pop("default_browser_type", None)
        width, height = (device["viewport"][axis] for axis in ("width", "height"))
        board = Image.new("RGB", (width * len(routes), (height + 26) * 2), "white")
        draw = ImageDraw.Draw(board)
        for row, base in enumerate((args.before, args.after)):
            ctx = browser.new_context(base_url=base, **device)
            assert ctx.request.post("/api/session", data={"inviteCode": "NEARER-DEMO", "memberId": "arjun"}).ok
            for col, route in enumerate(routes):
                page = ctx.new_page()
                page.goto(route)
                # The device preset provides viewport and UA, but its desktop
                # browser has no OS chrome. Test the inset separately below.
                if route == "/":
                    page.locator("[data-ui=window-lamp]").wait_for()
                    page.locator("[data-ui=window-intro]").wait_for()
                else:
                    page.get_by_role("heading", level=1).first.wait_for()
                page.evaluate("document.fonts.ready")
                page.wait_for_timeout(700)
                img = Image.open(BytesIO(page.screenshot(scale="css", animations="disabled")))
                x, y = col * width, row * (height + 26)
                draw.text((x + 10, y + 6), f"{'Before' if row == 0 else 'After'}  {route}", fill="black")
                board.paste(img, (x, y + 26))
                page.close()
            if row == 1:
                for w, h in ((390, 844), (360, 740)):
                    page = ctx.new_page()
                    page.set_viewport_size({"width": w, "height": h})
                    page.goto("/")
                    page.add_style_tag(content=":root { --status-bar-inset: 47px; }")
                    footnote = page.locator("[data-ui=window-intro] > p").last
                    footnote.scroll_into_view_if_needed()
                    hint = page.locator("[data-ui=window-key-why]")
                    box = footnote.bounding_box()
                    assert box["y"] + box["height"] < hint.bounding_box()["y"], (w, h)
                    page.close()
            ctx.close()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        board.save(args.output)


if __name__ == "__main__":
    main()
