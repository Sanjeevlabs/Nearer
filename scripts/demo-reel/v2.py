#!/usr/bin/env python3
"""Product demo v2: the recorded clips in a phone frame, slow push-ins, an animated open and end card,
a synthesized voice-over and captions timed to it. Reuses out/demo-reel/raw (run `npm run demo:reel` first).

    python3 scripts/demo-reel/v2.py                 # 1080x1920 + 1920x1080
    python3 scripts/demo-reel/v2.py --only vertical

Voice: Meta MMS-TTS (facebook/mms-tts-eng), run locally with transformers (VitsModel) + scipy + torch
(pip install transformers torch scipy). The model is fetched from the Hugging Face hub on first use. No account,
no other vendor's model. Licence CC-BY-NC 4.0 (non-commercial: fine for the hackathon demo). Loudness -16 LUFS, AAC 48 kHz. No music.
Writes out/nearer-demo-v2.mp4, out/nearer-demo-v2-16x9.mp4, out/nearer-demo-v2-captions.srt, out/contact-v2.png.
ffmpeg only for video; Pillow for the still layers (background, phone, captions, cards).
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import wave

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import shots  # noqa: E402

OUT = ROOT / "out"
RAW = OUT / "demo-reel" / "raw"
WORK = OUT / "v2"
PAPER = (246, 243, 238)
PETALS = [(232, 115, 90), (95, 170, 163), (91, 127, 204), (138, 79, 117), (222, 159, 62)]
XF = shots.XFADE
FRESH = False
INTRO, END = 2.5, 4.5
VOICE = "facebook/mms-tts-eng"  # Meta MMS-TTS, English
SPEAKING_RATE = 1.15  # MMS speaks slowly with long pauses; 1.15 keeps every line inside its shot
VO_LEAD = 0.5  # the voice starts this long after its shot starts
FONTS = ["/usr/share/fonts/opentype/inter/Inter-Medium.otf", "/usr/share/fonts/opentype/inter/Inter-Regular.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]

# per shot: zoom (fraction at the end of the clip), focus point (fraction of the screen)
KB = {1: (.04, .5, .5), 2: (.04, .5, .3), 3: (.04, .5, .55), 4: (.07, .5, .12), 5: (.06, .5, .12), 6: (.04, .5, .45),
      7: (.07, .5, .5), 8: (.04, .5, .45), 9: (.04, .5, .3), 10: (.04, .5, .5), 11: (.04, .5, .3)}

LAYOUTS = {
    "vertical": dict(name="nearer-demo-v2.mp4", W=1080, H=1920, aw=720, ah=1558, ax=180, ay=44, bezel=14, rbody=74, cap_size=44, cap_w=860, cap_bottom=1880, k=1.0),
    "16x9": dict(name="nearer-demo-v2-16x9.mp4", W=1920, H=1080, aw=416, ah=900, ax=752, ay=34, bezel=10, rbody=52, cap_size=46, cap_w=1500, cap_bottom=1056, k=0.62),
}


def run(cmd: list, quiet=True) -> None:
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"command failed: {' '.join(str(c) for c in cmd[:6])} ...\n{r.stderr[-1500:]}")


def font(size: int) -> ImageFont.FreeTypeFont:
    for f in FONTS:
        if pathlib.Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


# ---------------------------------------------------------------- still layers
def background(W: int, H: int, path: pathlib.Path) -> Image.Image:
    img = Image.new("RGB", (W, H), PAPER)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r = int(min(W, H) * 0.42)
    spots = [(0.08, 0.1), (0.95, 0.22), (0.9, 0.9), (0.12, 0.8), (0.5, 0.5)]
    for (fx, fy), col in zip(spots, PETALS):
        d.ellipse([W * fx - r, H * fy - r, W * fx + r, H * fy + r], fill=col + (46,))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.55))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    img.save(path)
    return img


def phone(L: dict, bg: Image.Image, path: pathlib.Path, mask_path: pathlib.Path) -> None:
    W, H, b = L["W"], L["H"], L["bezel"]
    x0, y0 = L["ax"] - b, L["ay"] - b
    x1, y1 = L["ax"] + L["aw"] + b, L["ay"] + L["ah"] + b
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + 22 * L["k"], x1, y1 + 22 * L["k"]], radius=L["rbody"], fill=(30, 22, 18, 96))
    sh = sh.filter(ImageFilter.GaussianBlur(34 * L["k"]))
    img = Image.alpha_composite(bg.convert("RGBA"), sh)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0, x1, y1], radius=L["rbody"], fill=(24, 23, 25), outline=(66, 63, 68), width=max(2, int(3 * L["k"])))
    img.convert("RGB").save(path)
    m = Image.new("L", (L["aw"], L["ah"]), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, L["aw"] - 1, L["ah"] - 1], radius=L["rbody"] - b, fill=255)
    m.save(mask_path)


def wrap(d, text, f, max_w):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    if len(lines) == 2 and len(lines[1].split()) == 1 and len(lines[0].split()) > 2:
        w = lines[0].split()
        lines = [" ".join(w[:-1]), w[-1] + " " + lines[1]]
    return lines


def caption(L: dict, text: str, path: pathlib.Path) -> tuple[int, int]:
    """A tight PNG of the pill; returns where to overlay it (x, y)."""
    f = font(L["cap_size"])
    tmp = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    lines = wrap(tmp, text, f, L["cap_w"])
    lh = int(L["cap_size"] * 1.3)
    tw = max(tmp.textlength(l, font=f) for l in lines)
    pw, ph = int(tw + 80), int(lh * len(lines) + 44)
    img = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, pw - 1, ph - 1], radius=min(40, ph // 2), fill=(22, 20, 18, 204))
    for i, l in enumerate(lines):
        d.text((pw / 2, 22 + lh * i + lh / 2), l, font=f, fill=(255, 255, 255, 255), anchor="mm")
    img.save(path)
    return (L["W"] - pw) // 2, L["cap_bottom"] - ph


def svg_png(svg: pathlib.Path, out: pathlib.Path, width: int, color=None) -> None:
    data = svg.read_text()
    if color:
        data = data.replace("currentColor", color)
    tmp = out.with_suffix(".svg")
    tmp.write_text(data)
    if shutil.which("rsvg-convert"):
        run(["rsvg-convert", "-w", width, "-o", out, tmp])
    else:
        run(["inkscape", tmp, "--export-width", width, "--export-filename", out])
    tmp.unlink()


def text_png(text: str, size: int, color, path: pathlib.Path) -> None:
    f = font(size)
    d = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    w = int(d.textlength(text, font=f)) + 8
    img = Image.new("RGBA", (w, int(size * 1.5)), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((w / 2, size * 0.75), text, font=f, fill=color, anchor="mm")
    img.save(path)


# ---------------------------------------------------------------- video pieces
def shot_clip(L: dict, tag: str, m: dict, bgphone: pathlib.Path, mask: pathlib.Path) -> pathlib.Path:
    sid, D = m["id"], m["dur"]
    Z, fx, fy = KB[sid]
    aw, ah = L["aw"], L["ah"]
    w2, h2 = aw * 2, ah * 2
    zf = f"(1+{Z}*min(t/{D},1))"
    out = WORK / tag / f"clip-{sid:02d}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and not FRESH:
        return out  # kept from the last run (--fresh re-renders)
    if m["key"] == "notification":
        # The real-world insert stays outside the app's phone frame.
        run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", RAW / m["file"],
             "-vf", f"fps=30,scale={L['W']}:{L['H']}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={L['W']}:{L['H']}:(ow-iw)/2:(oh-ih)/2:color=0x1c1b1a,setsar=1,format=yuv420p",
             "-t", D, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", 16, out])
        return out
    fg = (
        f"[0:v]fps=30,tpad=stop_mode=clone:stop_duration=3,trim=duration={D},setpts=PTS-STARTPTS,"
        f"scale={w2}:{h2}:flags=lanczos,unsharp=5:5:0.8:5:5:0.0,format=yuv420p[a];"
        f"[a]scale=w='trunc({w2}*{zf}/2)*2':h='trunc({h2}*{zf}/2)*2':eval=frame:flags=bicubic[z];"
        f"color=c=black:s={w2}x{h2}:r=30:d={D}[b];"
        f"[b][z]overlay=x='-(overlay_w-main_w)*{fx}':y='-(overlay_h-main_h)*{fy}':eval=frame:shortest=1,"
        f"scale={aw}:{ah}:flags=area,format=yuv420p[app];"
        f"[2:v]format=gray[m];[app][m]alphamerge[am];"
        f"[1:v][am]overlay={L['ax']}:{L['ay']}:format=auto:shortest=1,format=yuv420p[v]"
    )
    script = out.with_suffix(".txt")
    script.write_text(fg)
    run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", m["start"], "-i", RAW / m["file"],
         "-loop", "1", "-framerate", 30, "-i", bgphone, "-loop", "1", "-framerate", 30, "-i", mask,
         "-filter_complex_script", script, "-map", "[v]", "-t", D, "-r", 30, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", 14, out])
    return out


def card_clip(L: dict, tag: str, kind: str, bgplain: pathlib.Path) -> pathlib.Path:
    """The animated open and end card: mark scales and fades in, text lines rise in one after another."""
    W, H, k = L["W"], L["H"], L["k"]
    d = WORK / tag
    d.mkdir(parents=True, exist_ok=True)
    mark = d / "mark.png"
    svg_png(ROOT / "public/brand/mark.svg", mark, int(300 * k))
    word = d / "word.png"
    svg_png(ROOT / "public/brand/wordmark.svg", word, int(470 * k), "#1c1b1a")
    ink, soft = (28, 27, 26, 255), (110, 105, 98, 255)
    if kind == "intro":
        D = INTRO
        text_png("The window between two homes.", int(50 * k), ink, d / "l1.png")
        layers = [(mark, 0.37, 0.0, True), (word, 0.52, 0.55, False), (d / "l1.png", 0.60, 1.0, False)]
    else:
        D = END
        text_png("Far from home, never far from them.", int(46 * k), ink, d / "l1.png")
        text_png("nearer.site", int(52 * k), ink, d / "l2.png")
        text_png("Built with Meta Muse models", int(34 * k), soft, d / "l3.png")
        layers = [(mark, 0.30, 0.0, True), (word, 0.45, 0.5, False), (d / "l1.png", 0.54, 1.0, False), (d / "l2.png", 0.62, 1.8, False), (d / "l3.png", 0.68, 2.4, False)]
    inputs = ["-loop", "1", "-framerate", 30, "-t", D, "-i", bgplain]
    fg, prev = [], "[0:v]"
    for i, (png, cy, t0, grow) in enumerate(layers, 1):
        inputs += ["-loop", "1", "-framerate", 30, "-t", D, "-i", png]
        src = f"[{i}:v]format=rgba"
        if grow:
            src += f",scale=w='trunc(iw*(0.8+0.2*min(t/0.9,1))/2)*2':h=-2:eval=frame"
        src += f",fade=t=in:st={t0}:d=0.7:alpha=1[l{i}]"
        fg.append(src)
        rise = f"+{int(34 * k)}*(1-min(max(t-{t0},0)/0.8,1))" if not grow else ""
        fg.append(f"{prev}[l{i}]overlay=x='(main_w-overlay_w)/2':y='{int(cy * H)}-overlay_h/2{rise}':eval=frame:format=auto[o{i}]")
        prev = f"[o{i}]"
    fg.append(f"{prev}format=yuv420p[v]")
    out = d / f"{kind}.mp4"
    script = d / f"{kind}.txt"
    script.write_text(";\n".join(fg))
    run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *inputs, "-filter_complex_script", script, "-map", "[v]", "-t", D, "-r", 30, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", 14, out])
    return out


# ---------------------------------------------------------------- voice
def voice_files() -> dict:
    try:
        import numpy as np
        import torch
        from scipy.io import wavfile
        from transformers import AutoTokenizer, VitsModel
    except ImportError as e:
        sys.exit(f"Meta MMS-TTS needs: pip install transformers torch scipy ({e})")
    tok = AutoTokenizer.from_pretrained(VOICE)
    model = VitsModel.from_pretrained(VOICE)
    model.speaking_rate = SPEAKING_RATE
    model.eval()
    vo = WORK / "vo"
    vo.mkdir(parents=True, exist_ok=True)
    lines = {}
    for s in shots.ALL:
        wav = vo / f"{s['id']:02d}.wav"
        torch.manual_seed(0)  # the VITS sampler is stochastic: same line, same take
        with torch.no_grad():
            audio = model(**tok(s["vo"], return_tensors="pt")).waveform[0].numpy()
        wavfile.write(str(wav), model.config.sampling_rate, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
        w = wave.open(str(wav))
        lines[s["id"]] = (wav, w.getnframes() / w.getframerate())
    return lines


def timeline() -> list[dict]:
    """Every piece of the final cut: intro, the shots, the end card, with start times on the final timeline."""
    pieces = [dict(id=0, key="intro", dur=INTRO)] + [dict(id=s["id"], key=s["key"], dur=s["dur"]) for s in shots.SHOTS] + [dict(id=12, key="end", dur=END)]
    t = 0.0
    for p in pieces:
        p["start"] = round(t, 3)
        t += p["dur"] - XF
    return pieces


def check_vo() -> None:
    """Synthesize each voice-over line only (no video) and check it fits its piece of the cut, with the margin."""
    lines = voice_files()
    bad = 0
    for p in timeline():
        if p["id"] not in lines:
            continue
        lead = 0.9 if p["id"] == 12 else VO_LEAD
        dur = lines[p["id"]][1]
        margin = p["dur"] - 0.1 - (lead + dur)
        print(f"line {p['id']:2d}: {dur:4.1f}s of {p['dur']}s, margin {margin:+.1f}s {'ok' if margin >= 0 else 'DOES NOT FIT'}")
        bad += margin < 0
    sys.exit(1 if bad else 0)


def build_audio(tl: list[dict], lines: dict, total: float) -> pathlib.Path:
    ins, fg, mix = [], [], []
    n = 0
    for p in tl:
        if p["id"] not in lines:
            continue
        wav, dur = lines[p["id"]]
        lead = 0.9 if p["id"] == 12 else VO_LEAD
        p["vo_in"], p["vo_out"] = round(p["start"] + lead, 3), round(p["start"] + lead + dur, 3)
        if p["vo_out"] > p["start"] + p["dur"] - 0.1:
            sys.exit(f"voice-over line {p['id']} ({dur:.1f}s) does not fit its shot")
        ins += ["-i", wav]
        fg.append(f"[{n}:a]aresample=48000,adelay={int(p['vo_in'] * 1000)}:all=1[a{n}]")
        mix.append(f"[a{n}]")
        n += 1
    fg.append("".join(mix) + f"amix=inputs={n}:normalize=0:duration=longest,apad=whole_dur={total},atrim=0:{total},"
              "loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,aformat=channel_layouts=stereo[a]")
    script = WORK / "audio.txt"
    script.write_text(";\n".join(fg))
    out = WORK / "voice.m4a"
    run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *ins, "-filter_complex_script", script, "-map", "[a]", "-ar", 48000, "-c:a", "aac", "-b:a", "160k", out])
    return out


def stamp(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def cap_windows(tl: list[dict]) -> None:
    for p in tl:
        if p["id"] in (0, 12):
            continue
        end = p["start"] + p["dur"] - 0.3
        p["cap_in"] = round(p["vo_in"] - 0.15, 3)
        p["cap_out"] = round(min(max(p["vo_out"] + 0.8, p["cap_in"] + 3.2), end), 3)


def final(L: dict, tag: str, tl: list[dict], clips: list[pathlib.Path], audio: pathlib.Path, total: float) -> pathlib.Path:
    d = WORK / tag
    inputs, fg = [], []
    for c in clips:
        inputs += ["-i", c]
    n = len(clips)
    prev = "[0:v]"
    for k in range(1, n):
        cur = f"[x{k}]"
        fg.append(f"{prev}[{k}:v]xfade=transition=fade:duration={XF}:offset={tl[k]['start']}{cur}")
        prev = cur
    idx = n
    for p in tl:
        if "cap_in" not in p:
            continue
        png = d / f"cap-{p['id']:02d}.png"
        x, y = caption(L, next(s["caption"] for s in shots.SHOTS if s["id"] == p["id"]), png)
        span = p["cap_out"] - p["cap_in"]
        inputs += ["-loop", "1", "-framerate", 30, "-t", round(span + 0.1, 3), "-i", png]
        fg.append(f"[{idx}:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st={round(span - 0.35, 3)}:d=0.35:alpha=1,setpts=PTS+{p['cap_in']}/TB[c{idx}]")
        fg.append(f"{prev}[c{idx}]overlay={x}:{y}:eof_action=pass:format=auto[o{idx}]")
        prev = f"[o{idx}]"
        idx += 1
    fg.append(f"{prev}format=yuv420p[v]")
    inputs += ["-i", audio]
    script = d / "final.txt"
    script.write_text(";\n".join(fg))
    out = OUT / L["name"]
    for crf, rate in ((22, "3200k"), (27, "2000k")):
        run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *inputs, "-filter_complex_script", script, "-map", "[v]", "-map", f"{idx}:a",
             "-t", total, "-r", 30, "-c:v", "libx264", "-preset", "medium", "-crf", crf, "-maxrate", rate, "-bufsize", rate, "-pix_fmt", "yuv420p",
             "-c:a", "copy", "-movflags", "+faststart", out])
        if out.stat().st_size < 24_000_000:
            break
    if out.stat().st_size > 25_000_000:
        sys.exit(f"{out.name} exceeds the 25 MB cap")
    return out


def contact(video: pathlib.Path, tl: list[dict]) -> None:
    frames = []
    for p in (part for part in tl if part["id"] in (1, 3, 5, 7, 9, 12)):
        t = p["start"] + 3.5 if p["id"] == 12 else (p["cap_in"] + p["cap_out"]) / 2 + (1.2 if p["id"] in (7, 8) else 0)
        f = WORK / f"f{p['id']:02d}.png"
        run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", round(t, 2), "-i", video, "-frames:v", 1, "-vf", "scale=360:640", f])
        frames.append(Image.open(f))
    cols = 3
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 360, rows * 640), (255, 255, 255))
    for i, im in enumerate(frames):
        sheet.paste(im, ((i % cols) * 360, (i // cols) * 640))
    sheet.save(OUT / "contact-v2.png")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["vertical", "16x9"])
    ap.add_argument("--fresh", action="store_true", help="re-render every clip (default reuses clips already in out/v2)")
    ap.add_argument("--check-vo", action="store_true", help="synthesize the voice-over lines only and check each fits its shot (no video, no recorded clips needed)")
    a = ap.parse_args()
    if a.check_vo:
        WORK.mkdir(parents=True, exist_ok=True)
        check_vo()
    global FRESH
    FRESH = a.fresh
    if not (OUT / "demo-reel" / "manifest.json").exists():
        sys.exit("no recorded clips: run `npm run demo:reel` first")
    WORK.mkdir(parents=True, exist_ok=True)
    manifest = {m["id"]: m for m in json.loads((OUT / "demo-reel" / "manifest.json").read_text())}
    tl = timeline()
    total = round(tl[-1]["start"] + tl[-1]["dur"], 3)
    lines = voice_files()
    audio = build_audio(tl, lines, total)
    cap_windows(tl)
    srt = []
    for p in tl:
        if "cap_in" in p:
            srt.append(f"{len(srt) + 1}\n{stamp(p['cap_in'])} --> {stamp(p['cap_out'])}\n{next(s['caption'] for s in shots.SHOTS if s['id'] == p['id'])}\n")
    (OUT / "nearer-demo-v2-captions.srt").write_text("\n".join(srt))
    vo = ["Nearer product demo v2: voice-over (Meta MMS-TTS, facebook/mms-tts-eng; times on the final cut)", ""]
    for p in tl:
        if "vo_in" in p:
            s = next(s for s in shots.ALL if s["id"] == p["id"])
            vo.append(f"{int(p['vo_in'] // 60)}:{p['vo_in'] % 60:04.1f}  {s['vo']}")
    (OUT / "nearer-demo-v2-voiceover.txt").write_text("\n".join(vo) + "\n")
    for tag, L in LAYOUTS.items():
        if a.only and tag != a.only:
            continue
        d = WORK / tag
        d.mkdir(parents=True, exist_ok=True)
        bg = background(L["W"], L["H"], d / "bg.png")
        phone(L, bg, d / "bgphone.png", d / "mask.png")
        clips = [card_clip(L, tag, "intro", d / "bg.png")] + [shot_clip(L, tag, manifest[s["id"]], d / "bgphone.png", d / "mask.png") for s in shots.SHOTS] + [card_clip(L, tag, "end", d / "bg.png")]
        out = final(L, tag, tl, clips, audio, total)
        print(f"{out.name}: {total:.1f}s, {out.stat().st_size // 1024} KB", flush=True)
        if tag == "vertical":
            contact(out, tl)
    return 0


if __name__ == "__main__":
    sys.exit(main())
