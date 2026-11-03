#!/usr/bin/env python3
"""Navigation walk: every room tab, as three demo people, in a real browser.

Signs in to the demo (NEARER-DEMO) as a parent, an adult child and two children (the kids' first screen is kid-home),
opens the house from the dock, then visits every tab of every room
(lib/menu.ts). It also opens every reachable sheet at 360x640 and checks how it closes (close button on screen and 44pt, Escape, focus back). At 360x740 and 390x844 it also fails on sideways overflow, display-size text without data-display, and text under 12px. Fails on a page error, an error-level console message, a
4xx/5xx document or a 5xx API call, a missing page title, or a room tile
that doesn't open its first tab.

CI runs it against a mock build (.github/workflows/ci.yml). It also works
against the live site after a deploy:
    python3 scripts/walk.py --base https://nearer.site
(live, each person gets their own demo copy; the daily cron removes them).
"""
import argparse
import json
import re
import sys

from playwright.sync_api import sync_playwright

# Mirrors lib/menu.ts roomsFor(); the walk fails if the house sheet disagrees.
ROOMS = {
    "Living Room": ["/gather/play", "/gather", "/rituals"],
    "Memories": ["/lane", "/stories", "/book", "/advice", "/ask-family"],
    "Kitchen": ["/kitchen"],
    # Kids (/bond/kids) is there because the demo family has children.
    "Our People": ["/bond", "/bond/homes", "/bond/kids", "/together/visits"],
    "Care": ["/care", "/care/helpers", "/nearby"],
}
# Kid mode (lib/menu.ts roomsFor(..., kid)): a child's house has three rooms, and fewer tabs in them.
KID_ROOMS = {
    "Living Room": ["/gather/play", "/gather"],
    "Memories": ["/lane", "/stories"],
    "Our People": ["/bond"],
}
# Pages that are in no room: For you (the bell on the window, and behind your own photo); Portrait (from the Family tree) and
# Holidays (from Visits) left the tabs but still resolve.
EXTRA = ["/inbox", "/portrait", "/together/holidays"]
PEOPLE = [("arjun", "adult"), ("dadi", "parent"), ("leo", "child"), ("aria", "child")]
# Console noise that isn't ours (dev tooling, a blocked third-party font).
IGNORE = re.compile(r"Download the React DevTools|fonts\.g(static|oogleapis)|favicon", re.I)


# Every visible button/link whose box touches the dock's box (the dock's own buttons excepted).
OVERLAP_JS = """() => {
  const dock = document.querySelector('[data-ui=dock]');
  if (!dock) return null;
  const d = dock.getBoundingClientRect();
  if (d.width === 0 || d.height === 0) return null;
  const hit = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button], input, textarea')) {
    if (dock.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (r.left < d.right && r.right > d.left && r.top < d.bottom && r.bottom > d.top) hit.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40));
  }
  return hit;
}"""


# The fit check (mobile first): no horizontal overflow, nothing display-sized but what is marked data-display, nothing under 12px.
FIT_JS = """() => {
  const out = { overflow: document.documentElement.scrollWidth - innerWidth, big: [], small: [] };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('svg, script, style, noscript, .sr-only')) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fs = parseFloat(cs.fontSize);
    const label = (el.tagName.toLowerCase() + ' "' + n.nodeValue.trim().slice(0, 28) + '" ' + fs + 'px');
    if (fs > 34 && !el.closest('[data-display]')) out.big.push(label);
    if (fs < 12) out.small.push(label);
  }
  return out;
}"""
FIT_SIZES = [(360, 740), (390, 844)]


def fit_check(page, where: str, problems: list[str], person: str) -> None:
    page.evaluate("window.scrollTo(0, 0)")
    r = page.evaluate(FIT_JS)
    vw = page.viewport_size["width"]
    if r["overflow"] > 0:
        problems.append(f"{person} {where} @{vw}: sideways overflow by {r['overflow']}px")
    for kind, what in (("big", "text over 34px without data-display"), ("small", "text under 12px")):
        if r[kind]:
            problems.append(f"{person} {where} @{vw}: {what}: {'; '.join(r[kind][:4])}")


def dock_overlaps(page, where: str, problems: list[str], person: str) -> None:
    """No visible button or link may sit under the dock, with the page scrolled to its end (what floats stays put; what scrolls must be able to clear the dock)."""
    page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_timeout(300)
    hit = page.evaluate(OVERLAP_JS)
    if hit:
        problems.append(f"{person} {where}: under the dock: {', '.join(hit)}")


def first_screen(base: str, person: str, browser, problems: list[str], size=(390, 844)) -> None:
    """The first screen at 390pt: the home page first, then exactly one bottom bar on the window, the dock only after the key is slid."""
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, base_url=base)
    res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": person}), headers={"content-type": "application/json"})
    if not res.ok:
        problems.append(f"{person}: first-screen sign-in failed {res.status}")
        ctx.close()
        return
    page = ctx.new_page()
    page.goto("/", wait_until="load")
    try:
        page.get_by_role("button", name="Open Nearer").first.wait_for(timeout=15_000)
    except Exception:
        problems.append(f"{person} /: signed in on a phone, the home page has no 'Open Nearer' button")
        ctx.close()
        return
    fit_check(page, "/ (home)", problems, person)
    if page.locator("[data-ui=dock]").count():
        problems.append(f"{person} /: the dock shows on the home page")
    page.get_by_role("button", name="Open Nearer").first.click()
    page.locator("[data-ui=window-lamp]").wait_for(timeout=15_000)
    page.wait_for_timeout(1200)
    fit_check(page, "/ (window)", problems, person)
    if page.locator("[data-ui=dock]").count():
        problems.append(f"{person} /: the dock shows on the window (key not yet slid)")
    bars = page.evaluate(
        """() => [...document.querySelectorAll('*')].filter((e) => {
          const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
          return (cs.position === 'fixed' || cs.position === 'sticky') && r.width > 100 && r.height > 30 && r.bottom > innerHeight - 140 && r.top > innerHeight / 2 && e.querySelector('button');
        }).length"""
    )
    # One bar: the key slider. (A fixed full-screen container is not a bar: it starts above half the screen.)
    if bars != 1:
        problems.append(f"{person} /: {bars} bottom bars on the window, expected 1")
    dock_overlaps(page, "/ (window)", problems, person)
    # Slide the key (Enter on it): straight to the family page, no door in between.
    page.get_by_role("button", name="Slide or tap to go inside").focus()
    page.keyboard.press("Enter")
    try:
        page.locator("[data-ui=courtyard-header]").wait_for(timeout=5_000)
    except Exception:
        problems.append(f"{person} /: sliding the key did not reach the family page within 5 s")
    if page.locator("[data-door], img[src*='door-']").count():
        problems.append(f"{person} /: a door is still on screen after the key")
    page.reload(wait_until="load")
    try:
        page.locator("[data-ui=dock]").wait_for(timeout=15_000)
        page.wait_for_timeout(800)
        fit_check(page, "/ (courtyard)", problems, person)
        dock_overlaps(page, "/ (courtyard)", problems, person)
        # Voice first: the bottom bar is Voice and House, nothing else.
        names = page.evaluate("[...document.querySelectorAll('[data-ui=dock] a, [data-ui=dock] button')].map((e) => e.getAttribute('aria-label') || e.textContent.trim())")
        if len(names) != 2 or not names[0].startswith(("Record a voice note", "Invite family")) or names[1] != "Open the house":
            problems.append(f"{person} /: the dock should be Voice and House only, found {names}")
    except Exception:
        problems.append(f"{person} /: no dock on the family page")
    ctx.close()


def walk(base: str, person: str, kind: str, browser, size=(390, 844)) -> list[str]:
    problems: list[str] = []
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, base_url=base)
    # Behind the door: open straight into the house (app/page.tsx DOOR_KEY).
    ctx.add_init_script("try { sessionStorage.setItem('aangan:door', 'open'); sessionStorage.setItem('aangan:entered', '1') } catch (e) {}")
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

    res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": person}), headers={"content-type": "application/json"})
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
        fit_check(page, "/ (kid-home)", problems, person)
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

    for room, tabs in [*rooms.items(), ("", EXTRA)]:
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
            page.wait_for_timeout(400)
            # The header: the room's name beside the back chevron (lib/menu.ts, verbatim), the pills in the room's order, <= 104px.
            if room:
                head = page.locator("[data-ui=room-header]")
                if head.count() == 0:
                    problems.append(f"{person} {href}: no room header")
                else:
                    name = page.locator("[data-ui=room-header] h1").first.inner_text().strip()
                    if name != room:
                        problems.append(f"{person} {href}: header says {name!r}, the room is {room!r}")
                    # The tab row fills once the family has loaded (components/ui/kit.tsx RoomHeader).
                    if len(tabs) > 1:
                        try:
                            page.locator("[data-ui=room-tabs] a").first.wait_for(timeout=8_000)
                        except Exception:
                            pass
                    else:
                        page.wait_for_timeout(1_500)
                    pills = page.locator("[data-ui=room-tabs] a").count()
                    if (pills > 0) != (len(tabs) > 1):
                        problems.append(f"{person} {href}: {pills} tab pills for a room with {len(tabs)} pages")
                    h = head.first.bounding_box()
                    if h and h["height"] > 104:
                        problems.append(f"{person} {href}: header is {h['height']:.0f}px, over 104")
            if href == "/lane":
                # Memory Lane: voice memories (never "voice notes"), a Starred filter and a search box.
                # The filters render once the Lane has loaded (live: a few seconds), so wait for them.
                try:
                    page.get_by_role("radio", name=re.compile(r"Starred")).first.wait_for(timeout=10_000)
                except Exception:
                    pass
                if page.get_by_text(re.compile(r"\bvoice notes?\b", re.I)).count():
                    problems.append(f"{person} /lane: still says 'voice note'")
                if page.get_by_role("radio", name=re.compile(r"Starred")).count() == 0:
                    problems.append(f"{person} /lane: no Starred filter")
                if page.get_by_role("searchbox", name="Search photos and voice memories").count() == 0:
                    problems.append(f"{person} /lane: no search box")
            fit_check(page, href, problems, person)
            dock_overlaps(page, href, problems, person)
    ctx.close()
    return problems


# Every popup closes the same easy way (components/ui/bottom-sheet.tsx): at 360x640 the close control is on screen and 44pt,
# Escape closes, the close button closes, and focus goes back to what opened it.
SHEET_SIZE = (360, 640)
CLOSE_RECT_JS = """() => {
  const d = [...document.querySelectorAll('[role=dialog]')].pop();
  if (!d) return null;
  const b = d.querySelector('button[aria-label=Close]');
  if (!b) return { missing: true };
  const r = b.getBoundingClientRect();
  return { missing: false, top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, named: Boolean(d.getAttribute('aria-labelledby') || d.getAttribute('aria-label')) };
}"""


def check_sheet(page, name: str, opener, problems: list[str], person: str) -> bool:
    """Open one sheet from `opener` and check how it closes. False if the opener isn't there (the caller notes it)."""
    if opener.count() == 0:
        return False
    opener.first.scroll_into_view_if_needed()
    opener.first.click()
    try:
        page.locator("[role=dialog]").last.wait_for(timeout=8_000)
    except Exception:
        problems.append(f"{person} sheet '{name}': did not open")
        return True
    page.wait_for_timeout(500)  # the spring settles
    r = page.evaluate(CLOSE_RECT_JS)
    if not r or r.get("missing"):
        problems.append(f"{person} sheet '{name}': no close button (aria-label=Close)")
    else:
        if r["top"] < 0 or r["left"] < 0 or r["right"] > r["vw"] or r["bottom"] > r["vh"]:
            problems.append(f"{person} sheet '{name}': the close button is outside the {r['vw']:.0f}x{r['vh']:.0f} screen")
        if r["w"] < 43.5 or r["h"] < 43.5:
            problems.append(f"{person} sheet '{name}': the close button is {r['w']:.0f}x{r['h']:.0f}, under 44")
        if not r["named"]:
            problems.append(f"{person} sheet '{name}': the dialog has no name")
    if page.evaluate("document.documentElement.scrollWidth - innerWidth") > 0:
        problems.append(f"{person} sheet '{name}': sideways overflow while open")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    if page.locator("[role=dialog]").count():
        problems.append(f"{person} sheet '{name}': Escape did not close it")
        return True
    if not opener.first.evaluate("(el) => el === document.activeElement"):
        problems.append(f"{person} sheet '{name}': focus did not go back to what opened it")
    opener.first.click()
    try:
        page.locator("[role=dialog]").last.wait_for(timeout=8_000)
        page.wait_for_timeout(500)
        page.locator("[role=dialog] button[aria-label=Close]").last.click()
        page.wait_for_timeout(600)
        if page.locator("[role=dialog]").count():
            problems.append(f"{person} sheet '{name}': the close button did not close it")
    except Exception:
        problems.append(f"{person} sheet '{name}': did not reopen")
    return True


def voice_sheet_photo(page, person: str, problems: list[str]) -> None:
    """Photos start from your own picture on the family page: 'Add to your day' offers Photo, Voice note, Status."""
    page.goto("/", wait_until="load")
    page.wait_for_timeout(1200)
    chip = page.locator("[aria-label^='Your day']")
    try:
        chip.first.wait_for(timeout=8_000)
    except Exception:
        return  # the first screen has no family row (a child's home, or nobody to show yet)
    chip.first.click()
    try:
        page.get_by_role("button", name="Photo", exact=True).wait_for(timeout=8_000)
    except Exception:
        problems.append(f"{person} own picture: no 'Photo' in Add to your day")
        return
    for label in ("Voice note", "Status"):
        if page.get_by_role("button", name=label, exact=True).count() == 0:
            problems.append(f"{person} own picture: no '{label}' in Add to your day")
    page.get_by_role("button", name="Photo", exact=True).click()
    try:
        page.get_by_text("Choose photos or a video").wait_for(timeout=8_000)
    except Exception:
        problems.append(f"{person} own picture: 'Photo' did not open the photo composer")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)


def profile_menu(page, person: str, problems: list[str]) -> None:
    """Your own photo opens a small sheet with Sign out first, then For you, Settings."""
    page.goto("/", wait_until="load")
    page.wait_for_timeout(1200)
    btn = page.locator("[data-ui=profile-menu-button]").first
    if btn.count() == 0:
        problems.append(f"{person} /: no profile photo button")
        return
    btn.click()
    try:
        page.locator("[data-ui=profile-menu]").wait_for(timeout=8_000)
    except Exception:
        problems.append(f"{person} profile menu: did not open")
        return
    rows = page.evaluate("[...document.querySelectorAll('[data-ui=profile-menu] [data-profile]')].map((e) => e.getAttribute('data-profile'))")
    want = ["sign-out", "inbox", "settings"]
    if rows[:3] != want:
        problems.append(f"{person} profile menu: expected {want} first, found {rows}")
    small = page.evaluate("[...document.querySelectorAll('[data-ui=profile-menu] [data-profile]')].filter((e) => e.getBoundingClientRect().height < 43.5).length")
    if small:
        problems.append(f"{person} profile menu: {small} row(s) under 44 px")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    if page.locator("[data-ui=profile-menu]").count():
        problems.append(f"{person} profile menu: Escape did not close it")
    elif not btn.evaluate("(el) => el === document.activeElement"):
        problems.append(f"{person} profile menu: focus did not go back to the photo")


def sheets(base: str, person: str, browser, problems: list[str]) -> list[str]:
    """Open every sheet that is reachable without typing, as a grown-up, at 360x640. Returns the sheets whose opener wasn't there."""
    skipped: list[str] = []
    ctx = browser.new_context(viewport={"width": SHEET_SIZE[0], "height": SHEET_SIZE[1]}, base_url=base)
    ctx.add_init_script("try { sessionStorage.setItem('aangan:door', 'open'); sessionStorage.setItem('aangan:entered', '1') } catch (e) {}")
    res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": person}), headers={"content-type": "application/json"})
    if not res.ok:
        problems.append(f"{person}: sheets: sign-in failed {res.status}")
        ctx.close()
        return skipped
    page = ctx.new_page()
    plan = [
        ("/", "the house", lambda: page.get_by_role("button", name="Open the house")),
        ("/", "your photo menu", lambda: page.get_by_role("button", name=re.compile(r"account and settings|profile and settings"))),
        ("/", "who is it for", lambda: page.get_by_role("button", name=re.compile(r"^Record a voice note"))),
        ("/", "invite family", lambda: page.get_by_role("button", name="Invite family")),
        ("/bond", "invite (family page)", lambda: page.get_by_role("button", name=re.compile(r"^Invite$"))),
        ("/bond", "add someone", lambda: page.get_by_role("button", name=re.compile(r"^Add someone"))),
        ("/care", "new task", lambda: page.get_by_role("button", name="New task with details")),
        ("/gather", "plan an event", lambda: page.get_by_role("button", name="Plan an event").first),
        ("/rituals", "our traditions", lambda: page.get_by_role("button", name=re.compile(r"Our traditions"))),
    ]
    here = ""
    for url, name, opener in plan:
        if url != here:
            page.goto(url, wait_until="load")
            page.wait_for_timeout(1200)
            here = url
        if not check_sheet(page, name, opener(), problems, person):
            skipped.append(f"{url} {name}")
    voice_sheet_photo(page, person, problems)
    profile_menu(page, person, problems)
    ctx.close()
    return skipped


# Records every getUserMedia call (and answers it with an empty stream, so no real device is touched).
GUM_SPY = """
window.__gum = [];
try {
  const md = navigator.mediaDevices || {};
  md.getUserMedia = (c) => { window.__gum.push({ audio: Boolean(c && c.audio), video: Boolean(c && c.video) }); return Promise.resolve(new MediaStream()); };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
} catch (e) {}
"""


def doors(base: str, browser, problems: list[str]) -> None:
    """Two (three) sessions: Arjun opens a chai door for Dadi only. Dadi sees it and joins with audio (no media
    before the tap, no camera after it); Leo sees nothing and cannot open it; Arjun closes it and Dadi's room
    says so within one 60 s re-check. The video provider is blocked: nothing leaves the machine."""
    # One demo family for all three: Arjun signs in, then hands Dadi and Leo a demo pass
    # (POST /api/session/pass), as a judge does with a second phone. Live, every demo visitor
    # gets their own family copy with its own ids, so ids are looked up, never assumed.
    ctxs = {}
    for who in ("arjun", "dadi", "leo"):
        ctx = browser.new_context(viewport={"width": 360, "height": 740}, base_url=base)
        ctx.add_init_script("try { sessionStorage.setItem('aangan:door', 'open'); sessionStorage.setItem('aangan:entered', '1') } catch (e) {}")
        ctx.add_init_script(GUM_SPY)
        ctx.route(re.compile(r"https://(meet\.jit\.si|8x8\.vc)/.*"), lambda route: route.abort())
        ctxs[who] = ctx
    a, d, l = ctxs["arjun"], ctxs["dadi"], ctxs["leo"]
    res = a.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": "arjun"}), headers={"content-type": "application/json"})
    if not res.ok:
        problems.append(f"doors: arjun sign-in failed {res.status}")
        return
    family = res.json()["familyId"]
    # Through a page (the browser's own cookie jar and origin), as the app does.
    pa = a.new_page()
    pa.goto("/gather/play", wait_until="load")
    call = "async ([url, body]) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }; }"
    got = pa.evaluate(call, ["/api/members", None])
    people = (got["body"] or {}).get("members", []) if got["ok"] else []
    ids = {}
    for seed in ("dadi", "leo"):
        hit = next((m for m in people if m.get("familyId", family) == family and (m["id"] == seed or m["id"].endswith("-" + seed))), None)
        if not hit:
            problems.append(f"doors: no {seed} in the demo family ({got['status']}, {len(people)} people)")
            return
        ids[seed] = hit["id"]
        made_pass = pa.evaluate(call, ["/api/session/pass", {"memberId": hit["id"]}])
        if not made_pass["ok"]:
            problems.append(f"doors: demo pass for {seed} failed {made_pass['status']}")
            return
        landing = ctxs[seed].new_page()
        landing.goto(made_pass["body"]["path"], wait_until="load")
        landing.close()
    try:
        # Writes go through the page (its own cookies and origin), as the app's own buttons do.
        post = "async (b) => { const r = await fetch('/api/sit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }; }"
        made = pa.evaluate(post, {"action": "knock", "activity": "chai", "invites": [ids["dadi"]]})
        if not made["ok"]:
            problems.append(f"doors: opening the door failed {made['status']}")
            return
        kid = made["body"]["knock"]["id"]
        pa.reload(wait_until="load")
        try:
            pa.locator("[data-ui=together-mine]").wait_for(timeout=15_000)
        except Exception:
            problems.append("doors: Arjun does not see his own open door")
        pl = l.new_page()
        pl.goto("/gather/play", wait_until="load")
        pl.locator("ul[aria-label='Things to do together']").wait_for(timeout=15_000)
        pl.wait_for_timeout(2000)
        if pl.locator("[data-ui=together-door]").count():
            problems.append("doors: Leo (not invited) sees Arjun's door")
        pl.goto(f"/call/{kid}", wait_until="load")
        try:
            pl.get_by_text("This door has closed").wait_for(timeout=15_000)
        except Exception:
            problems.append("doors: Leo can open a door he was not invited to")
        if pl.evaluate("window.__gum.length") or pl.locator("[data-ui=call-room] iframe").count():
            problems.append("doors: media started on Leo's closed door")

        pd = d.new_page()
        pd.goto("/gather/play", wait_until="load")
        try:
            pd.locator("[data-ui=together-door]").wait_for(timeout=15_000)
        except Exception:
            problems.append("doors: Dadi does not see the door Arjun opened for her")
            return
        pd.locator("[data-ui=together-door]").get_by_role("button", name="Join").click()
        pd.locator("[data-ui=call-prejoin]").wait_for(timeout=15_000)
        pd.wait_for_timeout(1500)
        if pd.evaluate("window.__gum.length"):
            problems.append("doors: getUserMedia was called before the consent tap")
        if pd.locator("iframe").count() or pd.evaluate("Boolean(window.JitsiMeetExternalAPI) || [...document.scripts].some((s) => /external_api/.test(s.src))"):
            problems.append("doors: the video room loaded before the consent tap")
        pd.locator("[data-ui=join-audio]").click()
        pd.wait_for_timeout(1500)
        gum = pd.evaluate("window.__gum")
        if not gum or any(g["video"] for g in gum):
            problems.append(f"doors: joining with audio asked for {gum!r} (expected audio only)")
        pa.evaluate(post, {"action": "unknock"})
        try:
            # The call page re-checks the door every 60 s.
            pd.get_by_text(re.compile(r"closed the door|This door has closed")).wait_for(timeout=70_000)
        except Exception:
            problems.append("doors: Dadi's room did not say the door closed within 70 s")
    finally:
        for ctx in ctxs.values():
            ctx.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3100")
    ap.add_argument("--engine", default="chromium", choices=["chromium", "webkit"], help="webkit is Safari's engine (iPhone)")
    args = ap.parse_args()
    problems: list[str] = []
    with sync_playwright() as p:
        browser = getattr(p, args.engine).launch()
        for person, kind in PEOPLE:
            for size in FIT_SIZES:
                found = walk(args.base, person, kind, browser, size)
                if person == "arjun":
                    first_screen(args.base, person, browser, found, size)
                print(f"{person:6} {size[0]}x{size[1]} {'ok' if not found else f'{len(found)} problem(s)'}")
                problems += found
        found: list[str] = []
        skipped = sheets(args.base, "arjun", browser, found)
        print(f"sheets 360x640 {'ok' if not found else f'{len(found)} problem(s)'}" + (f" (no opener for: {', '.join(skipped)})" if skipped else ""))
        problems += found
        found = []
        doors(args.base, browser, found)
        print(f"doors (two sessions) {'ok' if not found else f'{len(found)} problem(s)'}")
        problems += found
        browser.close()
    for line in problems:
        print("  " + line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
