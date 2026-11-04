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
Exits non-zero if a required shot is missing. No commerce routes are recorded.

Needs a running mock server (scripts/demo-reel/run.sh starts one on :4700 with a fresh in-memory state;
the lamp, plays and so on are in memory, so re-record against a fresh server).
"""
import argparse
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import time
from datetime import datetime

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

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
        if who:
            flags.append("localStorage.setItem('nearer:window-intro-v1','1')")
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
        if url == self.base or url.startswith((self.base + "/", "data:", "blob:")):
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
    c.need("[data-ui=window-scene]")
    c.need("[data-ui=window-lamp]")
    c.need("[data-ui=window-purpose]")
    c.pause(350)


def mock_member(ctx, who: str) -> dict:
    signed = ctx.request.post("/api/session", data={"inviteCode": "NEARER-DEMO", "memberId": who})
    if not signed.ok or "set-cookie" not in signed.headers:
        raise Missing(f"mock sign-in as {who} failed ({signed.status})")
    return {"cookie": signed.headers["set-cookie"].split(";", 1)[0]}


def landing(c: Clip) -> None:
    c.page.goto("/home")
    entry = c.page.get_by_role("button", name="Try the demo family")
    c.need(entry)
    c.ready()
    c.pause(850)
    c.tap(entry)
    window_ready(c)
    c.need("[data-ui=window-intro]")
    c.tap("[data-ui=window-intro] button")
    c.hold_until(c.spec["dur"])


def lamp(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.ready()
    c.tap("[data-ui=window-lamp-button]")
    c.page.wait_for_function("() => /glowing for/i.test(document.querySelector('[data-ui=window-lamp]')?.textContent || '')", timeout=SELECTOR_TIMEOUT)
    c.hold_until(c.spec["dur"])


def voice(c: Clip) -> None:
    # Use a known synthetic Hindi fixture so the mock translation has a real
    # source line to display alongside the English words.
    maa = c.ctx.browser.new_context(base_url=c.base)
    try:
        headers = mock_member(maa, "dadi")
        words = "पार्क में धूप थी। तुम कब आ रहे हो?"
        note = maa.request.post("/api/cards", data={"type": "audio", "caption": words, "transcript": words, "transcriptLang": "hi", "lang": "hi", "takenAt": NOW, "addressedTo": "arjun"}, headers=headers)
        if not note.ok:
            raise Missing(f"mock Hindi note failed ({note.status})")
    finally:
        maa.close()
    c.page.goto("/")
    window_ready(c)
    target = c.need("[data-ui=window-voice] button[aria-label^='Play']")
    target.scroll_into_view_if_needed()
    c.pause(400)
    c.ready()
    c.tap(target)
    c.need("[role=dialog][aria-label^='Voice memory from']")
    c.tap("[role=dialog] [data-ui=voice-words]")
    c.need("#player-words")
    c.need("#player-words >> text=Said:")
    c.hold_until(c.spec["dur"])


def photo(c: Clip) -> None:
    c.page.goto("/")
    window_ready(c)
    c.ready()
    c.tap("[data-ui=window-key] button", "the key")
    c.tap("[data-ui=my-day]", "Arjun’s picture", before=100, after=350)
    c.tap(c.page.get_by_role("button", name="Photo", exact=True), before=100, after=350)
    c.page.locator("input[type=file]").last.set_input_files(str(HERE.parent.parent / "public/demo/venues/courtyard.jpg"))
    c.page.wait_for_function("() => Boolean(document.querySelector('input[placeholder^=Caption]')?.value)", timeout=SELECTOR_TIMEOUT)
    c.pause(1200)
    c.tap(c.page.get_by_role("button", name="Share with the family", exact=True), before=100)
    c.page.get_by_role("dialog").wait_for(state="hidden", timeout=SELECTOR_TIMEOUT)
    c.need("[data-ui=dock]")
    c.hold_until(c.spec["dur"])


def recipe(c: Clip) -> None:
    maa = c.ctx.browser.new_context(base_url=c.base)
    try:
        headers = mock_member(maa, "dadi")
        saved = maa.request.get("/api/kitchen", headers=headers)
        if not saved.ok:
            raise Missing(f"mock Kitchen lookup failed ({saved.status})")
        dal = next(r for r in saved.json()["recipes"] if r["id"] == "recipe-dadi-dal")
        result = maa.request.post("/api/kitchen", headers=headers, data={**dal, "action": "edit", "recipeId": dal["id"], "caloriesPerServing": 240})
        if not result.ok:
            raise Missing(f"mock recipe estimate failed ({result.status})")
    finally:
        maa.close()
    c.page.goto("/kitchen/recipe-dadi-dal")
    c.need("[aria-label='Taught by']")
    c.need(c.page.get_by_text("about 240 kcal", exact=True))
    c.ready()
    c.pause(1000)
    c.scroll_to("[aria-label=Ingredients]", top=235)
    c.hold_until(c.spec["dur"])


def chef(c: Clip) -> None:
    c.page.goto("/kitchen")
    surprise = c.page.get_by_role("button", name="Surprise me", exact=True)
    c.need(surprise)
    c.ready()
    c.tap(surprise)
    c.page.get_by_role("textbox", name="What’s in your fridge?").fill("rice, lemon and red lentils")
    c.tap(c.page.get_by_role("button", name="Find a recipe", exact=True))
    c.need(c.page.get_by_text("kcal per serving", exact=False))
    c.hold_until(c.spec["dur"])


def call(c: Clip) -> None:
    # The prerecorded banner is the outbound push; the real app opens its destination.
    maa = c.ctx.browser.new_context(base_url=c.base)
    try:
        headers = mock_member(maa, "dadi")
        res = maa.request.post("/api/sit", data={"action": "knock", "activity": "chai", "invites": ["arjun"]}, headers=headers)
        if not res.ok:
            raise Missing(f"mock tea invite failed ({res.status})")
        knock = res.json()["knock"]
    finally:
        maa.close()
    # Mock the external media transport, not the app's consent, token or joined
    # requests. No camera, microphone, real call or third-party iframe is opened.
    c.ctx.add_init_script("""(() => {
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => new MediaStream();
      window.JitsiMeetExternalAPI = class {
        constructor(_domain, {parentNode}) {
          this.status = document.createElement('p');
          Object.assign(this.status.style, {height:'100%', margin:'0', display:'grid', placeItems:'center', color:'white', background:'#242221'});
          this.status.textContent = 'Audio call';
          parentNode.append(this.status);
        }
        dispose() {}
        addListener(event, cb) {
          if (event === 'videoConferenceJoined') setTimeout(cb, 150);
          if (event === 'participantJoined' && location.search.includes('demoMaa=1')) {
            setTimeout(() => {
              cb({id:'demo-arjun', displayName:'Arjun'});
              this.status.textContent = 'Arjun joined';
            }, 400);
          }
        }
      };
    })();""")
    c.page.goto(f"/call/{knock['id']}")
    c.need("[data-ui=call-prejoin]")
    c.ready()
    with c.page.expect_response(lambda r: r.url.endswith("/api/sit") and r.request.method == "POST") as arjun_joined:
        c.tap("[data-ui=join-audio]", before=100, after=300)
    if not arjun_joined.value.ok:
        raise Missing("Arjun’s local call-join acknowledgement failed")
    mock_member(c.ctx, "dadi")
    c.page.goto(f"/call/{knock['id']}?demoMaa=1")
    c.tap("[data-ui=join-audio]", before=100, after=250)
    c.need(c.page.get_by_role("list", name="Seats in the", exact=False).get_by_text("Arjun", exact=True))
    c.hold_until(c.spec["dur"])


def habit(c: Clip) -> None:
    c.page.goto("/")
    walk = c.page.get_by_role("button", name="Morning walk", exact=False)
    c.need(walk).scroll_into_view_if_needed()
    c.ready()
    c.tap(walk)
    c.need(c.page.get_by_role("list", name="last seven weeks", exact=False))
    c.hold_until(c.spec["dur"])


def story(c: Clip) -> None:
    c.page.goto("/stories")
    play = c.page.locator('[data-card="demo-story-elephant"] button[aria-label^="Play"]')
    c.need(play).scroll_into_view_if_needed()
    c.ready()
    c.tap(play)
    c.hold_until(c.spec["dur"])


def private_note(c: Clip) -> None:
    # A synthetic private voice-card fixture, never a real recording.
    headers = mock_member(c.ctx, "arjun")
    words = "Maa, I got home safely. I’ll call you after dinner."
    note = c.ctx.request.post("/api/cards", data={"type": "audio", "caption": words, "transcript": words, "takenAt": NOW, "addressedTo": "dadi"}, headers=headers)
    if not note.ok:
        raise Missing(f"mock private note failed ({note.status})")
    c.page.goto(f"/lane?card={note.json()['card']['id']}")
    c.need(c.page.get_by_text("Just for Maa", exact=False))
    c.ready()
    c.hold_until(c.spec["dur"])


PLAN = {
    1: dict(who=None, entered=False, door_open=False, fn=landing),
    2: dict(who="arjun", entered=True, door_open=False, fn=lamp),
    3: dict(who="arjun", entered=True, door_open=False, fn=voice),
    4: dict(who="arjun", entered=True, door_open=False, fn=photo),
    5: dict(who="arjun", entered=True, door_open=True, fn=recipe),
    6: dict(who="arjun", entered=True, door_open=True, fn=chef),
    8: dict(who="arjun", entered=True, door_open=False, fn=call),
    9: dict(who="arjun", entered=True, door_open=True, fn=habit),
    10: dict(who="arjun", entered=True, door_open=True, fn=story),
    11: dict(who="arjun", entered=True, door_open=True, fn=private_note),
}


def notification(spec: dict, out: pathlib.Path, raw: pathlib.Path) -> dict:
    still, copy = out / "notification-source.jpg", out / "notification-copy.txt"
    if not still.is_file() or not copy.is_file():
        raise Missing("notification still missing; run the Muse Image step in run.sh with META_API_KEY in the environment")
    overlay = out / "notification-banner.png"
    canvas = Image.new("RGBA", (390, 844))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((21, 385, 369, 471), radius=17, fill=(251, 250, 248, 246))
    font = ImageFont.truetype("DejaVuSans.ttf", 19)
    draw.text((39, 400), "Nearer", font=font, fill="#151515")
    draw.text((39, 431), copy.read_text().strip(), font=font, fill="#151515")
    canvas.save(overlay)
    dest = raw / "shot-07.webm"
    subprocess.run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-filter_complex_threads", "1", "-loop", "1", "-i", str(still), "-i", str(overlay),
        "-filter_complex", "[0:v]scale=390:844:force_original_aspect_ratio=increase,crop=390:844[still];[still][1:v]overlay=format=auto,format=yuv420p",
        "-t", str(spec["dur"]), "-r", "30", "-an", "-c:v", "libvpx-vp9", str(dest),
    ], check=True)
    return {"id": spec["id"], "key": spec["key"], "file": dest.name, "start": 0, "dur": spec["dur"], "notes": ["Synthesized adult and composited notification."]}


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
                print(f"shot {spec['id']:>2} {spec['key']}", flush=True)
                if spec["key"] == "notification":
                    try:
                        manifest[spec["id"]] = notification(spec, out, raw)
                    except Missing as e:
                        print(f"FAIL {e}", file=sys.stderr)
                        return 1
                    continue
                plan = PLAN[spec["id"]]
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
                manifest_path.write_text(json.dumps([manifest[k] for k in sorted(manifest)], indent=2))
        finally:
            browser.close()
    manifest_path.write_text(json.dumps([manifest[k] for k in sorted(manifest)], indent=2))
    print(f"recorded {len(manifest)} clips -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
