#!/usr/bin/env bash
# Assembles out/nearer-demo.mp4 from the recorder's raw clips (out/demo-reel/raw + manifest.json):
# trim each clip to its shot length, fit the 780x1688 recording (390x844 CSS px, upscaled to 780x1688) into 1080x1920 on the app's paper colour,
# cross-fade clips (0.3 s), burn the captions (PNG pills from captions.py), add the end card.
# Also writes out/nearer-demo-captions.srt, out/nearer-demo-voiceover.txt and out/contact.png.
# Needs ffmpeg (libx264), python3 with Pillow, and rsvg-convert for the end card's mark (falls back to a PNG).
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v ffmpeg >/dev/null || { echo "ffmpeg is required (apt-get install ffmpeg / brew install ffmpeg)" >&2; exit 1; }
OUT=out
DIR=$OUT/demo-reel
CLIPS=$DIR/clips
PAPER=0xf7f5f1 # --paper in app/tokens.css
mkdir -p "$CLIPS"
rm -f "$CLIPS"/*.mp4

python3 scripts/demo-reel/captions.py "$DIR"

# 1. each clip: trimmed to its length, 30 fps, fitted (app 780x1688 centred near the top, captions go below it)
python3 - "$DIR" <<'PY' > "$DIR/clips.tsv"
import json, sys
d = sys.argv[1]
for m in json.load(open(f"{d}/manifest.json")):
    print(m["id"], m["file"], m["start"], m["dur"], sep="\t")
PY
while IFS=$'\t' read -r id file start dur; do
  n=$(printf '%02d' "$id")
  ffmpeg -nostdin -loglevel error -y -ss "$start" -i "$DIR/raw/$file" -t "$dur" \
    -vf "fps=30,scale=780:1688:flags=lanczos,unsharp=5:5:0.6,tpad=stop_mode=clone:stop_duration=3,trim=duration=$dur,setpts=PTS-STARTPTS,pad=1080:1920:150:20:color=$PAPER,setsar=1,format=yuv420p" \
    -an -c:v libx264 -preset veryfast -crf 14 "$CLIPS/clip-$n.mp4"
done < "$DIR/clips.tsv"
ffmpeg -nostdin -loglevel error -y -loop 1 -framerate 30 -t 3 -i "$DIR/assets/endcard.png" \
  -vf "format=yuv420p,setsar=1" -an -c:v libx264 -preset veryfast -crf 14 "$CLIPS/clip-12.mp4"

# 2. cross-fades + burned-in captions, one pass
python3 - "$DIR" <<'PY'
import json, sys
d = sys.argv[1]
tl = json.load(open(f"{d}/assets/timeline.json"))
x, clips = tl["xfade"], tl["clips"]
n = len(clips)
inputs = []
for c in clips:
    inputs += ["-i", f"{d}/clips/clip-{c['id']:02d}.mp4"]
for c in clips:
    inputs += ["-loop", "1", "-framerate", "30", "-t", str(tl["total"] + 1), "-i", f"{d}/assets/cap-{c['id']:02d}.png"]
f, prev = [], "[0:v]"
for k in range(1, n):
    cur = f"[x{k}]"
    f.append(f"{prev}[{k}:v]xfade=transition=fade:duration={x}:offset={clips[k]['start']}{cur}")
    prev = cur
for k, c in enumerate(clips):
    cur = f"[o{k}]"
    f.append(f"{prev}[{n + k}:v]overlay=0:1520:enable='between(t,{c['cap_in']},{c['cap_out']})':format=auto{cur}")
    prev = cur
f.append(f"{prev}format=yuv420p[v]")
open(f"{d}/filter.txt", "w").write(";\n".join(f))
open(f"{d}/inputs.txt", "w").write("\n".join(inputs))
PY
TOTAL=$(python3 -c "import json;print(json.load(open('$DIR/assets/timeline.json'))['total'])")
mapfile -t INPUTS < "$DIR/inputs.txt"
encode() { # $1 = crf, $2 = maxrate
  ffmpeg -nostdin -loglevel error -y "${INPUTS[@]}" -filter_complex_script "$DIR/filter.txt" -map "[v]" \
    -t "$TOTAL" -r 30 -an -c:v libx264 -preset medium -crf "$1" -maxrate "$2" -bufsize "$2" -pix_fmt yuv420p -movflags +faststart "$OUT/nearer-demo.mp4"
}
encode 23 2400k
SIZE=$(stat -c %s "$OUT/nearer-demo.mp4" 2>/dev/null || stat -f %z "$OUT/nearer-demo.mp4")
if [ "$SIZE" -gt 20000000 ]; then
  echo "over 20 MB ($SIZE bytes): re-encoding smaller" >&2
  encode 28 1500k
fi

# 3. contact sheet: five frames from the middle of shots 2, 4, 6, 8, 10
python3 - "$DIR" <<'PY' > "$DIR/contact.tsv"
import json, sys
tl = json.load(open(f"{sys.argv[1]}/assets/timeline.json"))["clips"]
for c in tl:
    if c["id"] in (2, 4, 6, 8, 10):
        print(c["id"], round(c["start"] + c["dur"] * (0.88 if c["id"] in (8, 10) else 0.55), 2), sep="\t")
PY
FR=()
while IFS=$'\t' read -r id t; do
  ffmpeg -nostdin -loglevel error -y -ss "$t" -i "$OUT/nearer-demo.mp4" -frames:v 1 -vf scale=432:768 "$DIR/frame-$id.png"
  FR+=(-i "$DIR/frame-$id.png")
done < "$DIR/contact.tsv"
ffmpeg -nostdin -loglevel error -y "${FR[@]}" -filter_complex "hstack=inputs=5" "$OUT/contact.png"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/nearer-demo.mp4")
SIZE=$(stat -c %s "$OUT/nearer-demo.mp4" 2>/dev/null || stat -f %z "$OUT/nearer-demo.mp4")
echo "nearer-demo.mp4: ${DUR}s, $((SIZE / 1024)) KB"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,codec_name -of csv=p=0 "$OUT/nearer-demo.mp4"
