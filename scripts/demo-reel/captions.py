#!/usr/bin/env python3
"""Captions, voice-over and end card for the product demo (called by assemble.sh).

    python3 scripts/demo-reel/captions.py out/demo-reel

Writes, from scripts/demo-reel/shots.py and the recorder's manifest.json:
  out/nearer-demo-captions.srt      cues on the final timeline (a [TODO] cue for any shot that recorded less than planned)
  out/nearer-demo-voiceover.txt     timestamped voice-over lines
  out/demo-reel/assets/cap-NN.png   the burned-in caption (white system sans on a dark translucent pill, bottom safe area)
  out/demo-reel/assets/endcard.png  the end card (brand mark, wordmark, nearer.site)
  out/demo-reel/assets/timeline.json
"""
import json
import pathlib
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import shots  # noqa: E402

W, H = 1080, 1920
PAPER = (247, 245, 241)  # --paper in app/tokens.css
INK = (28, 27, 26)
FONTS = [
    "/usr/share/fonts/opentype/inter/Inter-Medium.otf",
    "/usr/share/fonts/truetype/inter/Inter-Medium.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]
CAP_SIZE = 44
CAP_BOTTOM = 1880  # bottom of the pill, px from the top: clear of the app (ends 1708) and the platform UI strip


def font(size: int) -> ImageFont.FreeTypeFont:
    for f in FONTS:
        if pathlib.Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def stamp(t: float, comma: bool = True) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{',' if comma else '.'}{ms:03d}"


def wrap(draw, text: str, f, max_w: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=f) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    # balance two lines: avoid a one-word second line
    if len(lines) == 2 and len(lines[1].split()) == 1 and len(lines[0].split()) > 2:
        w = lines[0].split()
        lines = [" ".join(w[:-1]), w[-1] + " " + lines[1]]
    return lines


def caption_png(text: str, path: pathlib.Path) -> None:
    f = font(CAP_SIZE)
    img = Image.new("RGBA", (W, 400), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lines = wrap(d, text, f, 860)
    lh = int(CAP_SIZE * 1.3)
    tw = max(d.textlength(l, font=f) for l in lines)
    pw, ph = int(tw + 2 * 40), int(lh * len(lines) + 2 * 22)
    x0, y1 = (W - pw) // 2, 400 - (H - CAP_BOTTOM)
    y0 = y1 - ph
    pill = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle([x0, y0, x0 + pw, y1], radius=min(40, ph // 2), fill=(22, 20, 18, 196))
    img = Image.alpha_composite(img, pill)
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        d.text((W / 2, y0 + 22 + lh * i + lh / 2), l, font=f, fill=(255, 255, 255, 255), anchor="mm")
    img.save(path)


def svg_png(svg: pathlib.Path, out: pathlib.Path, width: int, color: str | None = None) -> bool:
    data = svg.read_text()
    if color:
        data = data.replace("currentColor", color)
    tmp = out.with_suffix(".svg")
    tmp.write_text(data)
    try:
        subprocess.run(["rsvg-convert", "-w", str(width), "-o", str(out), str(tmp)], check=True, capture_output=True)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False
    finally:
        tmp.unlink(missing_ok=True)


def endcard(assets: pathlib.Path) -> None:
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    mark = assets / "mark.png"
    if svg_png(ROOT / "public/brand/mark.svg", mark, 360):
        m = Image.open(mark).convert("RGBA")
    else:  # no rsvg-convert: the 96px PNG of the same mark
        m = Image.open(ROOT / "public/brand/mark-96.png").convert("RGBA").resize((360, 360), Image.LANCZOS)
    img.paste(m, ((W - m.width) // 2, 640), m)
    word = assets / "wordmark.png"
    if svg_png(ROOT / "public/brand/wordmark.svg", word, 520, "#1c1b1a"):
        w = Image.open(word).convert("RGBA")
        img.paste(w, ((W - w.width) // 2, 640 + m.height + 70), w)
    else:
        d.text((W / 2, 640 + m.height + 120), "Nearer", font=font(120), fill=INK, anchor="mm")
    d.text((W / 2, 1290), "nearer.site", font=font(48), fill=(110, 105, 98), anchor="mm")
    img.save(assets / "endcard.png")


def main() -> int:
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out/demo-reel")
    assets = out / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    manifest = {m["id"]: m for m in json.loads((out / "manifest.json").read_text())} if (out / "manifest.json").exists() else {}
    starts = shots.starts()
    srt, vo, timeline, n = [], [], [], 0
    for s, t0 in zip(shots.ALL, starts):
        a, b = t0 + shots.CAPTION_IN, t0 + s["dur"] - shots.CAPTION_OUT
        if s["id"] == 12:
            a = t0 + 0.6
        caption_png(s["caption"], assets / f"cap-{s['id']:02d}.png")
        n += 1
        srt.append(f"{n}\n{stamp(a)} --> {stamp(b)}\n{s['caption']}\n")
        for note in manifest.get(s["id"], {}).get("notes", []):
            if note.startswith("TODO"):
                n += 1
                srt.append(f"{n}\n{stamp(a)} --> {stamp(b)}\n[{note}]\n")
        v = t0 + 0.4
        vo.append(f"{int(v // 60)}:{int(v % 60):02d}  {s['vo']}")
        timeline.append({"id": s["id"], "start": round(t0, 3), "dur": s["dur"], "cap_in": round(a, 3), "cap_out": round(b, 3)})
    todo = [f"shot {i}: {note}" for i, m in sorted(manifest.items()) for note in m.get("notes", []) if note.startswith("TODO")]
    (out.parent / "nearer-demo-captions.srt").write_text("\n".join(srt))
    (out.parent / "nearer-demo-voiceover.txt").write_text(
        "Nearer product demo: voice-over (about 2.6 words a second; times are on the final cut)\n\n" + "\n".join(vo) + "\n" + ("\nTODO (recorded less than planned):\n" + "\n".join(todo) + "\n" if todo else "")
    )
    endcard(assets)
    (assets / "timeline.json").write_text(json.dumps({"total": round(shots.total(), 3), "xfade": shots.XFADE, "clips": timeline}, indent=2))
    print(f"captions: {len(timeline)} cues, final cut {shots.total():.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
