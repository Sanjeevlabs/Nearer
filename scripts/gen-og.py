#!/usr/bin/env python3
"""Render the static link-preview image (1200x630) to app/opengraph-image.png and
app/r/[token]/opengraph-image.png. Static on purpose: next/og adds ~0.6 MiB to the Worker.

    python3 scripts/gen-og.py

Needs playwright + chromium (the same as scripts/ui-inventory.py). Edit the words here, rerun, commit the PNGs.
"""
import base64
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MARK = "data:image/png;base64," + base64.b64encode((ROOT / "public/icons/icon-1024.png").read_bytes()).decode()
NAME = "Nearer"
TAGLINE = "The window between two homes."
SUB = "Their time, weather and sky. Safe &amp; sound. A lamp that says I&rsquo;m thinking of you."

HTML = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px}}
body{{display:flex;align-items:center;padding:0 96px;box-sizing:border-box;position:relative;overflow:hidden;
 font-family:Inter,'Inter Display',system-ui,sans-serif;background:linear-gradient(135deg,#1c1712 0%,#2f2418 55%,#2f5684 140%)}}
.glow{{position:absolute;left:120px;top:120px;width:380px;height:380px;border-radius:50%;background:rgba(255,190,96,.22)}}
img{{position:relative;width:260px;height:260px;border-radius:60px;box-shadow:0 30px 60px rgba(0,0,0,.45)}}
.t{{position:relative;margin-left:72px;display:flex;flex-direction:column}}
.n{{font-size:104px;font-weight:700;color:#fff6e6;line-height:1}}
.g{{font-size:40px;color:rgba(255,246,230,.92);margin-top:22px;max-width:720px;line-height:1.2}}
.s{{font-size:26px;color:rgba(255,214,144,.92);margin-top:28px;max-width:660px;line-height:1.3}}
</style><div class="glow"></div><img src="{MARK}" alt=""><div class="t"><div class="n">{NAME}</div><div class="g">{TAGLINE}</div><div class="s">{SUB}</div></div>"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.set_content(HTML)
    pg.wait_for_timeout(300)
    for out in ("app/opengraph-image.png", "app/r/[token]/opengraph-image.png"):
        pg.screenshot(path=str(ROOT / out))
        print("wrote", out)
    b.close()
