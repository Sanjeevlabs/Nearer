#!/usr/bin/env python3
"""The home page's five phone screenshots, from the real app.

Starts a mock build (MOCK=true) with the server clock frozen at --now
(AANGAN_FIXED_NOW, lib/fixed-clock.ts; the browser gets the same instant, as
scripts/ui-inventory.py does), signs in to the demo (NEARER-DEMO) the way
scripts/walk.py does, and captures 390x844 at DPR 2:

  public/home/window.webp    the first screen: their sky, the lamp, what they shared,
                             and Maa's door open for chai (she opens it first)
  public/home/voice.webp     the voice sheet after a short recording: who it is for, the player, and the
                             words Nearer wrote down (a fake microphone; the mock transcript)
  public/home/together.webp  Living Room: Time together
  public/home/chorus.webp    Living Room: Occasions and the chorus
  public/home/memories.webp  Memories: Memory Lane

Each WebP is kept at or under 120 KB (780 wide when it fits, else 390). Needs a mock
build first:
    MOCK=true NEXT_PUBLIC_MOCK=true npx next build
    python3 scripts/home-shots.py
"""
import argparse
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

from PIL import Image
from playwright.sync_api import sync_playwright

TZ = "Asia/Kolkata"
MAX_BYTES = 120 * 1024
# (file, path, door open?, a selector that says the screen is ready)
SHOTS = [
    ("window", "/", False, "[data-ui=together]"),
    ("voice", "/", False, "[data-ui=together]"),
    ("together", "/gather/play", True, "main"),
    ("chorus", "/rituals", True, "main"),
    ("memories", "/lane", True, "main"),
]

# Date shifted so a page starts at NOW and then ticks (the same shim as scripts/ui-inventory.py).
CLOCK_JS = """(() => {
  const R = Date, off = %d - R.now();
  const S = new Proxy(R, {
    construct(t, a, nt) { return Reflect.construct(t, a.length ? a : [R.now() + off], nt === S ? t : nt); },
    apply() { return new R(R.now() + off).toString(); },
    get(t, p, r) { return p === "now" ? () => R.now() + off : Reflect.get(t, p, r === S ? t : r); },
  });
  globalThis.Date = S;
})();"""


def wait_up(base: str, seconds: int = 60) -> None:
    for _ in range(seconds * 2):
        try:
            urllib.request.urlopen(base + "/", timeout=2)
            return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"home-shots: no server at {base}")


def save_webp(png: bytes, out: str) -> int:
    """Full DPR 2 (780 wide) when it fits the budget; else lower quality, then 390 wide."""
    full = Image.open(io.BytesIO(png)).convert("RGB")
    small = full.resize((390, round(full.height * 390 / full.width)), Image.LANCZOS)
    for img in (full, small):
        for q in (80, 72, 64, 56):
            buf = io.BytesIO()
            img.save(buf, "WEBP", quality=q, method=6)
            if buf.tell() <= MAX_BYTES:
                break
        if buf.tell() <= MAX_BYTES:
            break
    with open(out, "wb") as f:
        f.write(buf.getvalue())
    return buf.tell()


def voice_sheet(page) -> None:
    """Open Voice, choose Maa, record four seconds, stop: the sheet shows the words written down."""
    for attempt in range(4):  # a click before hydration does nothing
        page.get_by_role("button", name="Voice memory").first.click(timeout=10_000)
        try:
            page.locator("[role=dialog]").first.wait_for(timeout=3_000)
            break
        except Exception:
            if attempt == 3:
                raise
    page.locator("[data-ui=people-picker]").get_by_text("Maa", exact=True).first.click()
    page.get_by_role("button", name="Start recording").click(timeout=10_000)
    page.wait_for_timeout(4500)
    page.get_by_role("button", name="Stop recording").click()
    page.get_by_role("button", name="Record again").wait_for(timeout=20_000)
    page.wait_for_timeout(800)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4610)
    ap.add_argument("--now", default="2026-11-02T13:45:00Z", help="the frozen instant (7:15 PM at the far home: the lamp and the moon)")
    ap.add_argument("--base", default=None, help="use a server already running (it must have AANGAN_FIXED_NOW set)")
    ap.add_argument("--out", default="public/home")
    args = ap.parse_args()

    srv = None
    base = args.base or f"http://127.0.0.1:{args.port}"
    if not args.base:
        env = dict(os.environ, MOCK="true", AANGAN_FIXED_NOW=args.now, SESSION_SECRET=os.environ.get("SESSION_SECRET", "home-shots-secret-not-a-real-secret-000000"))
        srv = subprocess.Popen(["npx", "next", "start", "-p", str(args.port)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_up(base)
        ms = int(datetime.fromisoformat(args.now.replace("Z", "+00:00")).timestamp() * 1000)
        os.makedirs(args.out, exist_ok=True)
        with sync_playwright() as p:
            # A fake microphone (a steady tone) for the voice sheet; no real audio or person is recorded.
            browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
            # Maa opens her door for Arjun (chai, an hour), so the window shows a real invitation.
            maa = browser.new_context(base_url=base)
            res = maa.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": "dadi"}), headers={"content-type": "application/json"})
            if not res.ok:
                raise SystemExit(f"home-shots: demo sign-in (dadi) failed {res.status}")
            page = maa.new_page()
            page.goto("/gather/play", wait_until="load")
            opened = page.evaluate("async () => (await fetch('/api/sit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'knock', activity: 'chai', invites: ['arjun'], minutes: 60 }) })).status")
            if opened >= 400:
                raise SystemExit(f"home-shots: opening Maa's door failed {opened}")
            maa.close()
            for name, path, door_open, ready in SHOTS:
                ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, base_url=base, timezone_id=TZ, locale="en-US", color_scheme="light", reduced_motion="reduce", permissions=["microphone"])
                ctx.add_init_script(CLOCK_JS % ms)
                ctx.add_init_script("try { localStorage.setItem('aangan:voice-consent', '1') } catch (e) {}")
                door = "open" if door_open else "closed"
                ctx.add_init_script(f"try {{ sessionStorage.setItem('aangan:door', '{door}'); sessionStorage.setItem('aangan:entered', '1') }} catch (e) {{}}")
                res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": "arjun"}), headers={"content-type": "application/json"})
                if not res.ok:
                    raise SystemExit(f"home-shots: demo sign-in failed {res.status}")
                page = ctx.new_page()
                page.goto(path, wait_until="load")
                page.locator(ready).first.wait_for(timeout=20_000)
                page.wait_for_timeout(2500)  # late content and fonts
                if name == "voice":
                    voice_sheet(page)
                size = save_webp(page.screenshot(), os.path.join(args.out, f"{name}.webp"))
                print(f"{name:7} {path:10} {size // 1024} KB")
                ctx.close()
            browser.close()
    finally:
        if srv:
            srv.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
