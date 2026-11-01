#!/usr/bin/env python3
"""UI inventory: every item visible on every screen, as three demo people (+ signed out).

Generated, not hand-kept. Signs in to the demo (NEARER-DEMO) as arjun (adult),
dadi (parent/elder) and aria (child), visits every route and state (all room
tabs from lib/menu.ts, the window with the door closed, the courtyard with it
open, the laptop home page at 1280px, each settings tab, the house sheet and the
add sheet, the public pages), and records each visible element by its role and
accessible name: headings, links, buttons, toggles, tabs, inputs, selects,
labelled sections, images with alt, labelled badges/dots, status text.

Writes:
  docs/ui-inventory.csv   committed; sorted and stable so diffs read; CI regenerates it and fails on a diff
  docs/ui-inventory.xlsx  one sheet per screen group, All (filters), Summary (counts, a11y list)

`verdict` and `notes` come from docs/ui-inventory.verdicts.json ({label: {verdict, note}}),
which humans edit; regeneration never writes to it (use --seed-verdicts once to add
"review" entries for flagged labels that have none yet).

Times, dates, counts, degrees and "N min ago" are stripped to placeholders so two runs
on the same build give the same bytes.

    npm run ui:inventory                                      # fresh server of the mock build on :4600, CSV + XLSX
    python3 scripts/ui-inventory.py --serve 3200 --no-xlsx    # CSV only (CI)
    python3 scripts/ui-inventory.py --base URL --csv /tmp/x.csv --no-xlsx   # a server that is already up

Needs a mock build first: MOCK=true NEXT_PUBLIC_MOCK=true npx next build (add --webpack if turbopack is unavailable).
Use --serve rather than --base for anything you commit: the demo keeps in-memory state (who was seen when,
caches), so a server that has been browsed already shows slightly different screens.
"""
import argparse
import csv
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
PEOPLE = [("arjun", "adult"), ("dadi", "parent"), ("aria", "child")]
PHONE = {"width": 390, "height": 844}
LAPTOP = {"width": 1280, "height": 800}
# Shell chrome that is on purpose on many screens: not counted as "duplication".
CHROME = {"dock", "room-tabs", "room-header"}


# ---------------------------------------------------------------- screens
# who: "app" = the three people; "all" = the three + signed out; "anon" = signed out only; "arjun" = just arjun.
def screens() -> list[dict]:
    menu = (ROOT / "lib" / "menu.ts").read_text()
    tabs = re.findall(r'href:\s*"(/[^"]*)"', menu)  # every room tab, in order
    out: list[dict] = []

    def add(group, screen, path, who="app", vp=PHONE, door="open", action=None, skip_kind=None, entered=True):
        out.append(dict(group=group, screen=screen, path=path, who=who, vp=vp, door=door, action=action, skip_kind=skip_kind, entered=entered))

    add("Entry", "courtyard", "/", door="open")
    add("Entry", "window", "/", door="closed")
    # The home page comes first, on a phone and a laptop, until "Open Nearer" (sessionStorage aangan:entered).
    add("Entry", "home-laptop", "/", who="arjun", vp=LAPTOP, door="closed", entered=False)
    add("Entry", "home-phone", "/", who="arjun", door="closed", entered=False)
    add("Entry", "landing", "/", who="anon", door="closed", entered=False)
    add("Entry", "landing-laptop", "/", who="anon", vp=LAPTOP, door="closed", entered=False)
    for t in tabs:
        add("Rooms", t, t, skip_kind="child" if t == "/portrait" else None)
    for tid in ("you", "window", "family", "privacy"):
        add("Settings", f"/settings#{tid}", "/settings", action=f"settings:{tid}")
    add("Sheets", "sheet:house", "/", action="house")
    add("Sheets", "sheet:add", "/", action="add")
    for p in ("/send", "/safe", "/trace"):
        add("Other", p, p)
    add("Other", "/people/<id>", "/people/@other")
    for p in ("/privacy", "/home"):
        add("Public", p, p, who="all", door="closed")
    for p in ("/signin", "/create", "/join"):
        add("Public", p, p, who="anon", door="closed")
    return out


# ------------------------------------------------------------- extraction
# In-page walk over the semantic elements, with the accessible name computed the
# way the accessibility tree does (aria-labelledby > aria-label > alt/label/
# placeholder > content > title). `rootSel` limits it to an open dialog.
EXTRACT = r"""(rootSel) => {
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return null;
  const vis = (el) => {
    if (!el.checkVisibility({ checkVisibilityCSS: true, opacityProperty: true })) return false;
    for (let n = el; n && n !== document.body; n = n.parentElement) if (n.getAttribute('aria-hidden') === 'true') return false;
    return true;
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const content = (el) => {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.textContent + ' ';
      else if (n.nodeType === 1) {
        if (n.getAttribute('aria-hidden') === 'true' || n.hidden) continue;
        if (n.matches('script,style,svg:not([aria-label])')) continue;
        const l = n.getAttribute('aria-label');
        if (l) out += l + ' ';
        else if (n.tagName === 'IMG') out += (n.getAttribute('alt') || '') + ' ';
        else out += content(n) + ' ';
      }
    }
    return clean(out);
  };
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = clean(by.split(/\s+/).map((i) => { const e = document.getElementById(i); return e ? content(e) : ''; }).join(' ')); if (t) return t; }
    const al = clean(el.getAttribute('aria-label')); if (al) return al;
    const tag = el.tagName;
    if (tag === 'IMG') return clean(el.getAttribute('alt'));
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      const lab = el.labels && el.labels[0] ? content(el.labels[0]) : ''; if (lab) return lab;
      const ph = clean(el.getAttribute('placeholder')); if (ph) return ph;
      if (tag === 'INPUT' && ['submit', 'button'].includes(el.type)) return clean(el.value);
      return clean(el.getAttribute('title'));
    }
    return content(el) || clean(el.getAttribute('title'));
  };
  const ui = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const d = n.getAttribute && n.getAttribute('data-ui'); if (d) return d; }
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.matches && n.matches('section[aria-label],nav[aria-label],[role=region][aria-label],[role=dialog][aria-label],form[aria-label]')) return '~' + clean(n.getAttribute('aria-label'));
    }
    return '';
  };
  const SEL = 'h1,h2,h3,h4,h5,h6,a[href],button,[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=link],input:not([type=hidden]),select,textarea,img,[role=img][aria-label],section[aria-label],nav[aria-label],[role=region][aria-label],[role=dialog][aria-label],[role=status],[role=alert],form[aria-label]';
  const rows = [];
  for (const el of root.querySelectorAll(SEL)) {
    if ((!rootSel && el.closest('[role=dialog]')) || el.closest('nextjs-portal,next-route-announcer,#__next-build-watcher') || !vis(el)) continue;
    const tag = el.tagName, role = el.getAttribute('role');
    const name = nameOf(el);
    let type;
    if (/^H[1-6]$/.test(tag)) type = tag === 'H1' ? 'h1' : 'heading';
    else if (tag === 'IMG') { if (el.getAttribute('alt') === '') continue; type = 'image'; }
    else if (role === 'img') type = 'badge';
    else if (role === 'status' || role === 'alert') { if (!name) continue; type = 'status'; }
    else if (tag === 'NAV') type = 'nav';
    else if (tag === 'SECTION' || role === 'region' || role === 'dialog') type = 'section';
    else if (tag === 'FORM') type = 'form';
    else if (tag === 'SELECT') type = 'select';
    else if (tag === 'TEXTAREA') type = 'input';
    else if (tag === 'INPUT') type = ['checkbox', 'radio'].includes(el.type) ? 'toggle' : (['submit', 'button'].includes(el.type) ? 'button' : 'input:' + el.type);
    else if (role === 'switch' || role === 'checkbox' || role === 'radio' || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-checked')) type = 'toggle';
    else if (role === 'tab') type = 'tab';
    else if (tag === 'A' || role === 'link') type = 'link';
    else type = 'button';
    const component = ui(el);
    if ((type === 'link' || type === 'button' || type === 'toggle') && /(^|-)tabs$/.test(component)) type = 'tab';
    let href = '';
    if (tag === 'A') href = el.getAttribute('href') || '';
    else if (tag === 'FORM') href = el.getAttribute('action') || '';
    else if (el.type === 'submit' && el.form) href = el.form.getAttribute('action') || '';
    const text = tag === 'IMG' ? '' : content(el);
    rows.push({ type, label: name, href, component, iconOnly: (type === 'button' || type === 'link' || type === 'toggle') && !text });
  }
  return rows;
}"""

TIME = re.compile(r"\b\d{1,2}(?::\d{2}(?::\d{2})?\s?(?:[AaPp]\.?[Mm]\.?)?|\s?[AaPp]\.?[Mm]\.?\b)")
AGO = re.compile(r"\b\d+\s*(?:s|sec|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?|mo|months?|y|yrs?|years?)\s+ago\b|\b(?:just now|an? (?:minute|hour|day|week|month|year) ago)\b", re.I)
MONTHS = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE = re.compile(
    rf"\b\d{{4}}-\d{{2}}-\d{{2}}\b|\b\d{{1,2}}[/.]\d{{1,2}}[/.]\d{{2,4}}\b|\b{MONTHS}\.? \d{{1,2}}(?:st|nd|rd|th)?(?:,? \d{{4}})?\b|\b\d{{1,2}}(?:st|nd|rd|th)? {MONTHS}\b(?:,? \d{{4}})?|\b{MONTHS} \d{{4}}\b",
    re.I,
)
WEEKDAY = re.compile(r"\b(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)(?:day)?s?\b")
DEG = re.compile(r"\d+\s*(?:°\s*[CF]?|degrees(?: celsius)?)", re.I)
NUM = re.compile(r"\d+")
# Who has opened the app so far this run changes these; they are not the interface.
PRESENCE = re.compile(r",? lamp lit today", re.I)
# The demo's "door is open" note is picked by the hour of day (lib/demo-rooms.ts); keep the control, drop the note.
KNOCK = re.compile(r"(door is open)\b.*$", re.I)
ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{12,}")


def norm(s: str, limit: int = 80) -> str:
    """Drop everything that changes with the clock or the demo data's counts."""
    s = TIME.sub("<time>", s)
    s = AGO.sub("<ago>", s)
    s = DATE.sub("<date>", s)
    s = DEG.sub("<temp>", s)
    s = WEEKDAY.sub("<day>", s)
    s = ID.sub("<id>", s)
    s = PRESENCE.sub("", s)
    s = KNOCK.sub(r"\1", s)
    s = NUM.sub("N", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def norm_href(h: str) -> str:
    return norm(h, 120).replace(" ", "") if h else ""


# ------------------------------------------------------------------ walk
def settle(page) -> None:
    try:
        page.locator("h1").first.wait_for(timeout=6_000)
    except Exception:
        pass
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass
    page.wait_for_timeout(500)


def capture(page, scr: dict, persona: str, other: str, log: list[str]):
    path = scr["path"].replace("@other", other)
    # API calls in flight (translations of family words arrive late and swap the text).
    pending = {"n": 0, "failed": 0, "last": time.monotonic()}
    page.on("request", lambda r: "/api/" in r.url and pending.update(n=pending["n"] + 1, last=time.monotonic()))
    page.on("requestfinished", lambda r: "/api/" in r.url and pending.update(n=pending["n"] - 1, last=time.monotonic()))
    page.on("requestfailed", lambda r: "/api/" in r.url and pending.update(n=pending["n"] - 1, failed=pending["failed"] + 1, last=time.monotonic()))
    # Twice: the first visit warms the server's caches (translations, festival week), the second is read.
    page.goto(path, wait_until="load")
    settle(page)
    # A screen is read only from a visit where every API call answered: a dropped request
    # would hide a whole section and look like a UI change. Up to three clean visits.
    for _ in range(3):
        pending["failed"] = 0
        page.goto(path, wait_until="load")
        settle(page)
        if pending["failed"] == 0:
            break
        log.append(f"{persona} {scr['screen']}: an API request failed, visiting again")
    if path != "/" and persona != "anon" and urlparse(page.url).path.rstrip("/") != path.rstrip("/"):
        log.append(f"{persona} {scr['screen']}: redirected to {urlparse(page.url).path}, skipped")
        return None
    root = None
    a = scr["action"]
    if a and a.startswith("settings:"):
        label = {"you": "You", "window": "Window", "family": "People", "privacy": "Privacy"}[a.split(":")[1]]
        page.get_by_role("button", name=label, exact=True).click(timeout=8_000)
        page.wait_for_timeout(500)
    elif a in ("house", "add"):
        name = "Open the house" if a == "house" else "Share a photo or video"
        # A click before hydration does nothing: click again until the sheet is there.
        for attempt in range(4):
            page.get_by_role("button", name=name).first.click(timeout=10_000)
            try:
                page.locator("[role=dialog]").first.wait_for(timeout=3_000)
                break
            except Exception:
                if attempt == 3:
                    raise
        page.wait_for_timeout(600)
        root = "[role=dialog]"
    # The shell hides its dock a beat after the window and landing mount.
    if scr["door"] == "closed":
        try:
            page.locator("[data-ui=dock]").first.wait_for(state="hidden", timeout=4_000)
        except Exception:
            pass
    # Wait for the screen to stop changing (enter/exit animations, late data): four equal reads in a row,
    # with no API call in flight and none started or finished in the last 1.5 s (a slow runner mounts
    # a section's fetch late; reading before it starts would drop the whole section).
    prev, same = None, 0
    for _ in range(30):
        rows = page.evaluate(EXTRACT, root)
        quiet = pending["n"] <= 0 and time.monotonic() - pending["last"] > 1.5
        same = same + 1 if rows == prev and quiet else 0
        if same >= 3:
            return rows
        prev = rows
        page.wait_for_timeout(600)
    log.append(f"{persona} {scr['screen']}: never settled")
    return prev


def walk_persona(base: str, persona: str, kind: str, state: dict | None) -> tuple[list[tuple], list[str]]:
    """Every screen for one person, in their own browser. Returns [(group, screen, door, rows)], log."""
    log: list[str] = []
    seen: list[tuple] = []
    other = "arjun" if persona == "dadi" else "dadi"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for scr in screens():
            who = scr["who"]
            if (who == "app" and persona == "anon") or (who == "anon" and persona != "anon") or (who == "arjun" and persona != "arjun") or scr["skip_kind"] == kind:
                continue
            ctx = browser.new_context(viewport=scr["vp"], base_url=base, storage_state=state)
            ctx.add_init_script(f"try {{ sessionStorage.setItem('aangan:door', '{scr['door']}') }} catch (e) {{}}")
            if scr["entered"]:
                ctx.add_init_script("try { sessionStorage.setItem('aangan:entered', '1') } catch (e) {}")
            page = ctx.new_page()
            try:
                rows = capture(page, scr, persona, other, log)
            except Exception as e:  # keep going; the log says what is missing
                log.append(f"{persona} {scr['screen']}: {type(e).__name__}: {str(e).splitlines()[0][:120]}")
                rows = None
            ctx.close()
            seen.append((scr["group"], scr["screen"], scr["door"], rows or []))
        browser.close()
    return seen, log


def run(base: str) -> tuple[list[dict], list[str]]:
    # One sign-in per person (the endpoint allows 20 per 10 minutes per address).
    states: dict[str, dict] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for who, _ in PEOPLE:
            ctx = browser.new_context(base_url=base)
            res = ctx.request.post("/api/session", data=json.dumps({"inviteCode": "NEARER-DEMO", "memberId": who}), headers={"content-type": "application/json"})
            if not res.ok:
                raise SystemExit(f"ui-inventory: demo sign-in as {who} failed {res.status} {res.text()[:200]}")
            states[who] = ctx.storage_state()
            ctx.close()
        browser.close()
    people = PEOPLE + [("anon", "anon")]
    # Four people, four browsers at once; merged below in a fixed order so the result never depends on who finished first.
    with ProcessPoolExecutor(max_workers=len(people)) as pool:
        futs = [pool.submit(walk_persona, base, persona, kind, states.get(persona)) for persona, kind in people]
        results = [f.result() for f in futs]
    log: list[str] = []
    cells: dict[tuple, dict] = {}
    for (persona, _), (seen, plog) in zip(people, results):
        log += plog
        for group, screen, door, rows in seen:
            for order, r in enumerate(rows):
                # The dock is hidden on the window and the landing (on "/" it shows only for the courtyard and kid-home: app/page.tsx setDockOn); a
                # frame of it mid-transition is not part of the screen.
                if door == "closed" and group == "Entry" and r["component"] == "dock":
                    continue
                label = norm(r["label"])
                key = (screen, r["type"], label, norm_href(r["href"]), r["component"])
                c = cells.get(key)
                if c is None:
                    c = cells[key] = dict(group=group, screen=screen, type=r["type"], label=label, href=norm_href(r["href"]), component=r["component"], order=order, personas=set(), icon_only=False)
                c["personas"].add(persona)
                c["icon_only"] = c["icon_only"] or bool(r["iconOnly"])
    return list(cells.values()), sorted(log)


# ----------------------------------------------------------------- output
COLS = ["group", "screen", "order", "type", "label", "href", "component", "personas", "flags", "verdict", "notes"]
PERSONA_ORDER = ["arjun", "dadi", "aria", "anon"]
NONAME = "(no accessible name)"
NEEDS_NAME = {"button", "link", "tab", "toggle", "select", "image", "badge", "h1", "heading"}
NOT_A_LABEL = ("section", "nav", "form")
INTERACTIVE = {"button", "link", "tab", "toggle", "select"}


def finish(rows: list[dict], verdicts: dict) -> list[dict]:
    screens_of: dict[str, set] = defaultdict(set)
    for r in rows:
        if r["label"] and r["type"] not in NOT_A_LABEL:
            screens_of[r["label"]].add(r["screen"].split("#")[0])  # a screen's tabs are one screen
    out = []
    for r in rows:
        flags = []
        if not r["label"] and (r["type"] in NEEDS_NAME or r["type"].startswith("input")):
            flags.append("no-name")
        if r["icon_only"] and r["label"]:
            flags.append("icon-only")
        comp = r["component"].lstrip("~")
        if r["label"] and len(screens_of[r["label"]]) > 2 and r["type"] in INTERACTIVE and comp not in CHROME:
            flags.append("dup")
        label = r["label"] or NONAME
        v = verdicts.get(label) or {}
        out.append(dict(r, label=label, personas=" ".join(sorted(r["personas"], key=PERSONA_ORDER.index)), flags=" ".join(flags), verdict=v.get("verdict") or ("review" if flags else "keep"), notes=v.get("note", "")))
    out.sort(key=lambda r: (r["group"], r["screen"], r["order"], r["type"], r["label"], r["href"]))
    return out


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(COLS)
        for r in rows:
            w.writerow([r[c] for c in COLS])


def write_xlsx(rows: list[dict], path: Path) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_fill = PatternFill("solid", fgColor="2A211B")
    flag_fill = PatternFill("solid", fgColor="FFF2CC")
    widths = {"group": 12, "screen": 24, "order": 7, "type": 11, "label": 52, "href": 30, "component": 26, "personas": 18, "flags": 18, "verdict": 10, "notes": 40}

    def sheet(ws, data):
        ws.append(COLS)
        for r in data:
            ws.append([r[c] for c in COLS])
        for i, c in enumerate(COLS, 1):
            cell = ws.cell(1, i)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = head_fill
            ws.column_dimensions[get_column_letter(i)].width = widths[c]
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=cell.column in (5, 11))
            if row[8].value or row[9].value == "review":
                for cell in row:
                    cell.fill = flag_fill
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}{max(ws.max_row, 2)}"

    s = wb.active
    s.title = "Summary"
    sheet(wb.create_sheet("All"), rows)
    for g in sorted({r["group"] for r in rows}):
        sheet(wb.create_sheet(g), [r for r in rows if r["group"] == g])

    def block(title, header, lines):
        s.append([title])
        s.cell(s.max_row, 1).font = Font(bold=True, size=13)
        s.append(header)
        for c in range(1, len(header) + 1):
            s.cell(s.max_row, c).font = Font(bold=True)
        for ln in lines:
            s.append(ln)
        s.append([])

    per_screen: dict = defaultdict(int)
    per_persona: dict = defaultdict(int)
    for r in rows:
        per_screen[(r["group"], r["screen"])] += 1
        for p in r["personas"].split():
            per_persona[p] += 1
    dup: dict = defaultdict(set)
    for r in rows:
        if "dup" in r["flags"]:
            dup[r["label"]].add(r["screen"].split("#")[0])
    verdicts: dict = defaultdict(int)
    for r in rows:
        verdicts[r["verdict"]] += 1
    block("Elements per screen (distinct rows)", ["group", "screen", "elements"], [[g, sc, n] for (g, sc), n in sorted(per_screen.items())] + [["", "TOTAL", len(rows)]])
    block("Elements per persona (a row shared by people counts for each)", ["persona", "elements"], [[p, per_persona[p]] for p in PERSONA_ORDER if p in per_persona])
    block("Accessibility: no accessible name", ["screen", "type", "component", "href", "personas"], [[r["screen"], r["type"], r["component"], r["href"], r["personas"]] for r in rows if "no-name" in r["flags"]] or [["none"]])
    block("Labels on more than 2 screens (outside shell chrome)", ["label", "screens", "list"], [[k, len(v), ", ".join(sorted(v))] for k, v in sorted(dup.items())] or [["none"]])
    block("Verdicts", ["verdict", "rows"], [[k, n] for k, n in sorted(verdicts.items())])
    s.column_dimensions["A"].width = 44
    for col, w in zip("BCDE", (30, 26, 30, 18)):
        s.column_dimensions[col].width = w
    wb.save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:4600", help="a running mock build (its state, e.g. who was seen when, shapes the screens: prefer --serve)")
    ap.add_argument("--serve", type=int, metavar="PORT", help="start a fresh `next start` of the existing mock build on PORT for the run, then stop it (the reproducible way)")
    ap.add_argument("--csv", default=str(DOCS / "ui-inventory.csv"))
    ap.add_argument("--xlsx", default=str(DOCS / "ui-inventory.xlsx"))
    ap.add_argument("--verdicts", default=str(DOCS / "ui-inventory.verdicts.json"))
    ap.add_argument("--no-xlsx", action="store_true")
    ap.add_argument("--seed-verdicts", action="store_true", help="add a 'review' entry to the verdicts file for each flagged label that has none")
    args = ap.parse_args()

    vpath = Path(args.verdicts)
    verdicts = json.loads(vpath.read_text()) if vpath.exists() else {}
    server = None
    base = args.base
    if args.serve:
        # A fresh server per run: the demo's in-memory state (presence, last seen, caches) starts the same every time.
        env = dict(os.environ, MOCK="true", SESSION_SECRET=os.environ.get("SESSION_SECRET", "ui-inventory-secret-not-a-real-secret-0000"))
        server = subprocess.Popen(["npx", "next", "start", "-p", str(args.serve)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        base = f"http://127.0.0.1:{args.serve}"
        for _ in range(90):
            try:
                urllib.request.urlopen(base + "/", timeout=2).read(1)
                break
            except Exception:
                time.sleep(1)
        else:
            os.killpg(server.pid, signal.SIGTERM)
            raise SystemExit("ui-inventory: the server did not start (run `npx next build` with MOCK=true NEXT_PUBLIC_MOCK=true first)")
    try:
        raw, log = run(base)
    finally:
        if server:
            # npx forks next-server: stop the whole group, or the port stays taken and the next run reads a stale server.
            try:
                os.killpg(server.pid, signal.SIGTERM)
                server.wait(10)
            except Exception:
                server.kill()
    rows = finish(raw, verdicts)

    if args.seed_verdicts:
        notes = {"dup": "on more than 2 screens: one path per job?", "icon-only": "icon-only control: its name is only an aria-label", "no-name": "no accessible name: a11y bug"}
        for r in rows:
            if r["flags"] and r["label"] not in verdicts:
                verdicts[r["label"]] = {"verdict": "review", "note": notes[r["flags"].split()[0]]}
        vpath.write_text(json.dumps(dict(sorted(verdicts.items())), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        rows = finish(raw, verdicts)

    write_csv(rows, Path(args.csv))
    if not args.no_xlsx:
        write_xlsx(rows, Path(args.xlsx))
    print(f"ui-inventory: {len(rows)} rows, {len({r['screen'] for r in rows})} screens -> {args.csv}")
    for line in log:
        print("  note: " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
