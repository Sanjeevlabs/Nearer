#!/usr/bin/env python3
"""Records the product demo, shot by shot, from the real app in mock mode (nothing is faked).

    python3 scripts/demo-reel/record.py --base http://localhost:4700 --out out/demo-reel

One browser context (a fresh phone) per shot, at 390x844, with Playwright's video recording. The server
runs with MOCK=true and AANGAN_FIXED_NOW=2026-11-02T14:30:00Z; the browser gets the same instant through the
UI inventory's Date shim (scripts/ui-inventory.py CLOCK_JS), so both agree: 8 PM in the parents' city
(evening sky, moon), afternoon in London. Writes <out>/raw/shot-NN.webm and <out>/manifest.json
(per clip: file, start offset, duration, notes) for assemble.sh.

Human pacing: the pointer glides, taps wait 400-700 ms, every step waits on a data-ui / role selector.
A tap ripple and a pointer dot are injected for the video only (an init script, not app code).
Exits non-zero if a shot's selector is missing. Never opens a checkout: shot 10 stops at the preview.

Needs a running mock server (scripts/demo-reel/run.sh starts one on :4700 with a fresh in-memory state;
the lamp, plays and so on are in memory, so re-record against a fresh server).
"""
import argparse
import importlib.util
import json
import os
import pathlib
import sys
import time
from datetime import datetime

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shots import SHOTS  # noqa: E402

NOW = "2026-11-02T14:30:00Z"
VIEW = {"width": 390, "height": 844}
VIDEO = dict(VIEW)  # Chromium's screencast captures CSS pixels (390x844); assemble.sh upscales it into 1080x1920
SELECTOR_TIMEOUT = 20_000
TRACE = bool(os.environ.get("DEMO_TRACE"))

# The UI inventory's browser clock (reused, so the browser and the frozen server agree).
_spec = importlib.util.spec_from_file_location("ui_inventory", HERE.parent / "ui-inventory.py")
_inv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_inv)
CLOCK_JS = _inv.CLOCK_JS
NOW_MS = int(datetime.fromisoformat(NOW.replace("Z", "+00:00")).timestamp() * 1000)

# Demo-only overlay: a soft pointer dot and a ripple where a tap lands. Lives in the recorder, not the app.
RIPPLE_JS = """(() => {
  const css = `
  #__demo_dot{position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;
    background:rgba(28,27,26,.16);border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.25);
    pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .2s, transform .12s}
  #__demo_dot.on{opacity:1}
  #__demo_dot.down{transform:scale(.78)}
  .__demo_ripple{position:fixed;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;pointer-events:none;
    z-index:2147483646;background:rgba(232,115,90,.35);border:2px solid rgba(232,115,90,.8);animation:__demo_rip .62s ease-out forwards}
  @keyframes __demo_rip{from{transform:scale(.4);opacity:1}to{transform:scale(3.4);opacity:0}}`;
  const boot = () => {
    if (document.getElementById('__demo_dot')) return;
    const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st);
    const dot = document.createElement('div'); dot.id = '__demo_dot'; document.documentElement.appendChild(dot);
    addEventListener('pointermove', e => { dot.classList.add('on'); dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    addEventListener('pointerdown', e => {
      dot.classList.add('down');
      const r = document.createElement('div'); r.className = '__demo_ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
    addEventListener('pointerup', () => dot.classList.remove('down'), true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();"""


class Missing(Exception):
    """A shot's selector is not there: the app changed under the script."""


class Clip:
    """One shot: a fresh phone (browser context) with video, and the clock of the clip."""

    def __init__(self, browser, base: str, spec: dict, out: pathlib.Path, who: str | None, entered: bool, door_open: bool):
        self.spec, self.base, self.out = spec, base, out
        self.notes: list[str] = []
        self.ctx = browser.new_context(
            viewport=VIEW,
            device_scale_factor=1,
            base_url=base,
            timezone_id="UTC",
            locale="en-US",
            record_video_dir=str(out / "raw-tmp"),
            record_video_size=VIDEO,
        )
        self.foreign: list[str] = []
        self.ctx.route("**/*", self._guard)  # mock mode only: nothing leaves localhost
        self.ctx.add_init_script(CLOCK_JS % NOW_MS)
        self.ctx.add_init_script(RIPPLE_JS)
        flags = []
        if entered:
            flags.append("sessionStorage.setItem('aangan:entered','1')")
        if door_open:
            flags.append("sessionStorage.setItem('aangan:door','open')")
        if flags:
            self.ctx.add_init_script("try { " + "; ".join(flags) + " } catch (e) {}")
        if who:
            res = self.ctx.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": who}), headers={"content-type": "application/json"})
            if not res.ok:
                raise Missing(f"shot {spec['id']}: sign-in as {who} failed ({res.status})")
        self.page = self.ctx.new_page()
        self.t_page = time.monotonic()  # the video starts here
        self.t0: float | None = None
        self.x, self.y = 330.0, 470.0

    def _guard(self, route):
        url = route.request.url
        if url.startswith(self.base) or url.startswith(("data:", "blob:")):
            return route.continue_()
        self.foreign.append(url)
        return route.abort()

    # --- time -----------------------------------------------------------------
    def ready(self) -> None:
        """The first frame worth keeping: the clip is trimmed to start here."""
        self.t0 = time.monotonic() - self.t_page

    def elapsed(self) -> float:
        return time.monotonic() - self.t_page - (self.t0 or 0)

    def hold_until(self, sec: float) -> None:
        left = sec - self.elapsed()
        if left < 0:
            self.notes.append(f"over by {-left:.1f}s at the {sec:g}s mark")
            print(f"  ! shot {self.spec['id']}: {-left:.1f}s late for the {sec:g}s mark", flush=True)
            return
        self.page.wait_for_timeout(int(left * 1000))

    def pause(self, ms: int) -> None:
        self.page.wait_for_timeout(ms)

    # --- selectors ------------------------------------------------------------
    def need(self, target, label: str | None = None):
        loc = self.page.locator(target) if isinstance(target, str) else target
        try:
            loc.first.wait_for(state="visible", timeout=SELECTOR_TIMEOUT)
        except PWTimeout:
            raise Missing(f"shot {self.spec['id']} ({self.spec['key']}): missing {label or target}") from None
        return loc.first

    def has(self, target) -> bool:
        loc = self.page.locator(target) if isinstance(target, str) else target
        return loc.count() > 0

    # --- the hand -------------------------------------------------------------
    def glide(self, x: float, y: float, ms: int = 480) -> None:
        """Move the pointer to (x, y) over ms of real time (positions follow the clock, so a slow machine drops frames, not seconds)."""
        x0, y0 = self.x, self.y
        t_start = time.monotonic()
        while True:
            t = min(1.0, (time.monotonic() - t_start) * 1000 / ms)
            e = t * t * (3 - 2 * t)  # smoothstep
            self.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
            if t >= 1.0:
                break
        self.x, self.y = x, y

    def mark(self, what: str) -> None:
        if TRACE:
            print(f"    {self.elapsed():5.1f}s  {what}", flush=True)

    def tap(self, target, label: str | None = None, before: int = 280, after: int = 560, at: tuple[float, float] | None = None) -> None:
        self.mark(f"tap {label or target}")
        loc = self.need(target, label)
        loc.scroll_into_view_if_needed()
        box = loc.bounding_box()
        if not box:
            raise Missing(f"shot {self.spec['id']}: {label or target} has no box")
        x = box["x"] + box["width"] * (at[0] if at else 0.5)
        y = box["y"] + box["height"] * (at[1] if at else 0.5)
        self.glide(x, y)
        self.page.wait_for_timeout(before)
        self.page.mouse.down()
        self.page.wait_for_timeout(80)
        self.page.mouse.up()
        self.page.wait_for_timeout(after)

    def tap_xy(self, x: float, y: float, after: int = 560) -> None:
        self.glide(x, y)
        self.page.wait_for_timeout(260)
        self.page.mouse.down()
        self.page.wait_for_timeout(80)
        self.page.mouse.up()
        self.page.wait_for_timeout(after)

    def scroll(self, dy: float, ms: int = 900, at: tuple[float, float] = (195, 560)) -> None:
        """A flick of the thumb: wheel deltas over ms of real time on the page (or sheet) under the pointer."""
        self.mark(f"scroll {dy:g}")
        self.glide(*at, ms=260)
        sent, t_start = 0.0, time.monotonic()
        while sent < abs(dy) - 0.5:
            t = min(1.0, (time.monotonic() - t_start) * 1000 / ms)
            e = t * t * (3 - 2 * t)
            want = abs(dy) * e
            if want - sent >= 1:
                self.page.mouse.wheel(0, (want - sent) * (1 if dy > 0 else -1))
                sent = want
            elif t >= 1.0:
                break
            else:
                self.page.wait_for_timeout(8)

    def scroll_to(self, target, top: float = 190, ms: int = 900) -> None:
        loc = self.need(target)
        box = loc.bounding_box()
        if box and abs(box["y"] - top) > 12:
            self.scroll(box["y"] - top, ms)
        self.pause(300)

    def close_sheet(self) -> None:
        """Tap the dimmed area above a bottom sheet (its Close backdrop)."""
        self.tap_xy(195, 34, after=600)

    # --- finish ---------------------------------------------------------------
    def finish(self, raw: pathlib.Path) -> dict:
        path = pathlib.Path(self.page.video.path())
        self.ctx.close()  # flushes the video
        dest = raw / f"shot-{self.spec['id']:02d}.webm"
        path.replace(dest)
        if self.foreign:
            self.notes.append(f"blocked {len(self.foreign)} request(s) outside the mock server")
        return {"id": self.spec["id"], "key": self.spec["key"], "file": dest.name, "start": round(self.t0 or 0, 2), "dur": self.spec["dur"], "notes": self.notes}


# --- the shots ------------------------------------------------------------------------------------
def window_ready(c: Clip) -> None:
    """The window with its data in: the sky, the header line, the lamp line (no skeleton)."""
    c.need("[data-ui=window-scene]")
    c.need("[data-ui=window-lamp]")
    c.need("[data-ui=window-safe] button")
    c.pause(900)  # the sky and the lamp settle
    c.ready()


def shot1(c: Clip) -> None:
    c.page.goto("/home")
    c.need("text=Try the demo family")
    c.pause(500)
    c.ready()
    c.pause(1300)
    c.tap(c.page.get_by_text("Try the demo family").first, "the 'Try the demo family' button", after=700)
    c.tap(c.page.get_by_role("button", name="Open Nearer").first, "the 'Open Nearer' button", after=900)
    c.need("[data-ui=window-scene]")
    c.need("[data-ui=window-lamp]")
    c.hold_until(c.spec["dur"])


def shot2(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.glide(300, 300, ms=700)
    c.pause(2600)
    c.scroll(110, ms=1300, at=(300, 560))  # the line under the name: city, their clock, the distance
    c.hold_until(c.spec["dur"])


def shot3(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.scroll_to("[data-ui=window-safe]", top=300, ms=900)
    c.pause(200)
    c.tap(c.page.locator("[data-ui=window-safe] button").first, "Maa's row in Safe & sound", before=200, after=800)
    c.need("[role=dialog] [data-ui=window-their-day]", "Maa's day sheet")
    c.pause(1900)
    c.scroll(150, ms=800, at=(195, 520))
    c.pause(1000)
    c.close_sheet()
    c.hold_until(c.spec["dur"])


def shot4(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.pause(1200)
    c.tap("[data-ui=window-lamp-button]", "the lamp in the scene", before=450, after=900)
    c.page.wait_for_function("() => /glowing for/i.test(document.querySelector('[data-ui=window-lamp]')?.textContent || '')", timeout=SELECTOR_TIMEOUT)
    c.hold_until(c.spec["dur"])


def shot5(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.page.wait_for_function("() => /lit it for you/i.test(document.querySelector('[data-ui=window-lamp]')?.textContent || '')", timeout=SELECTOR_TIMEOUT)
    c.glide(260, 180, ms=800)
    c.hold_until(c.spec["dur"])


def shot6(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.scroll_to("[data-ui=window-voice]", top=420, ms=1100)
    c.tap("[data-ui=window-voice] button", "Maa's latest voice note play button", after=1400)
    c.need("[role=dialog][aria-label^='Voice note from']", "the full player with the words")
    c.hold_until(c.spec["dur"])


def shot7(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.pause(500)
    knob = c.need("[data-ui=window-key] button", "the key").bounding_box()
    track = c.need("[data-ui=window-key]").bounding_box()
    c.glide(knob["x"] + knob["width"] / 2, knob["y"] + knob["height"] / 2, ms=600)
    c.pause(300)
    c.page.mouse.down()
    c.glide(track["x"] + track["width"] - 30, c.y, ms=800)
    c.pause(150)
    c.page.mouse.up()
    c.need("[data-ui=dock]", "the courtyard dock behind the door")
    c.pause(500)
    c.scroll(480, ms=1300, at=(195, 500))
    c.hold_until(c.spec["dur"])


def shot8(c: Clip) -> None:
    c.page.goto("/")
    c.need("[data-ui=dock]", "the courtyard dock")
    c.need("text=Everyone", "the courtyard content")
    c.pause(900)
    c.ready()
    c.tap(c.page.get_by_role("button", name="Open the house"), "the house button on the dock", after=700)
    c.tap("[data-ui=house-sheet] [data-room=kitchen]", "the Kitchen room", after=500)
    c.need("a[href='/kitchen/recipe-dadi-dal']", "Maa's Dal tadka recipe")
    c.pause(700)
    c.tap("a[href='/kitchen/recipe-dadi-dal']", "Dal tadka", after=500)
    c.need("[aria-label='Taught by']", "'Hear Maa teach it'")
    c.pause(700)
    c.scroll_to("[aria-label='Cooked by the family']", top=150, ms=1800)
    c.hold_until(c.spec["dur"])


def shot9(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.pause(600)
    c.tap("[data-ui=window-bell]", "the bell (For you)", after=800)
    c.need("li[data-inbox]", "For you items")
    c.pause(1500)
    reply = c.page.locator("button[aria-label^='Reply by voice']")
    if reply.count():
        c.tap(reply.first, "Reply by voice", after=1100)
        c.need("[role=dialog]", "the voice sheet")
        c.pause(1500)
        c.close_sheet() if c.page.locator("[role=dialog] button[aria-label=Close]").count() else c.page.keyboard.press("Escape")
    else:
        c.notes.append("TODO: no 'Reply by voice' item in Arjun's inbox on this build (needs a seeded voice note addressed to him); reply sheet not shown")
        print("  TODO: no 'Reply by voice' in Arjun's inbox; recording the inbox only", flush=True)
    c.hold_until(c.spec["dur"])


def shot10(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.scroll_to("[data-ui=window-actions]", top=420, ms=800)
    c.tap(c.page.get_by_role("button", name="Send something"), "Send something", before=200, after=300)
    ideas = c.need("section[aria-label=\"Muse's ideas for Maa\"] button", "Muse's ideas from the stores")
    c.pause(300)
    c.scroll_to("section[aria-label=\"Muse's ideas for Maa\"]", top=250, ms=900)
    c.tap(ideas, "the first idea", before=200, after=700)
    c.need("section[aria-label=\"Muse's ideas for Maa\"] >> text=You’ll add", "the order preview")
    # Stop at the preview: never press 'Continue at <store>'.
    c.hold_until(c.spec["dur"])


def shot11(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.glide(300, 420, ms=900)
    c.hold_until(c.spec["dur"])


PLAN = {
    1: dict(who=None, entered=False, door_open=False, fn=shot1),
    2: dict(who="arjun", entered=True, door_open=False, fn=shot2),
    3: dict(who="arjun", entered=True, door_open=False, fn=shot3),
    4: dict(who="arjun", entered=True, door_open=False, fn=shot4),
    5: dict(who="dadi", entered=True, door_open=False, fn=shot5),
    6: dict(who="arjun", entered=True, door_open=False, fn=shot6),
    7: dict(who="arjun", entered=True, door_open=False, fn=shot7),
    8: dict(who="arjun", entered=True, door_open=True, fn=shot8),
    9: dict(who="arjun", entered=True, door_open=False, fn=shot9),
    10: dict(who="arjun", entered=True, door_open=False, fn=shot10),
    11: dict(who="rohan", entered=True, door_open=False, fn=shot11),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:4700")
    ap.add_argument("--out", default="out/demo-reel")
    ap.add_argument("--only", default="", help="comma list of shot ids (default: all)")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    (out / "raw-tmp").mkdir(parents=True, exist_ok=True)
    want = {int(x) for x in a.only.split(",") if x} or {s["id"] for s in SHOTS}
    manifest_path = out / "manifest.json"
    manifest = {m["id"]: m for m in json.loads(manifest_path.read_text())} if (a.only and manifest_path.exists()) else {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for spec in SHOTS:
                if spec["id"] not in want:
                    continue
                plan = PLAN[spec["id"]]
                print(f"shot {spec['id']:>2} {spec['key']}", flush=True)
                clip = Clip(browser, a.base, spec, out, plan["who"], plan["entered"], plan["door_open"])
                try:
                    plan["fn"](clip)
                except Missing as e:
                    print(f"FAIL {e}", file=sys.stderr)
                    return 1
                except PWTimeout as e:
                    print(f"FAIL shot {spec['id']} ({spec['key']}): timed out: {str(e).splitlines()[0]}", file=sys.stderr)
                    return 1
                manifest[spec["id"]] = clip.finish(raw)
        finally:
            browser.close()
    manifest_path.write_text(json.dumps([manifest[k] for k in sorted(manifest)], indent=2))
    print(f"recorded {len(manifest)} clips -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
