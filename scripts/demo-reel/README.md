# Scripted product demo

A silent, captioned, 90-second portrait recording of the real application, using only the synthetic demo family. No product components are changed by the recorder. The final three seconds are a branded end card.

## Run

Requires Node/npm, Python 3.10+, ffmpeg with libass and libx264, DejaVu Sans, and Chromium:

```sh
npm ci
python3 -m pip install -r scripts/demo-reel/requirements.txt
python3 -m playwright install chromium ffmpeg
npm run demo:reel
```

The runner builds in mock mode, starts a loopback-only server on port 4700 with an ephemeral session secret, freezes the server and browser wall clocks to 2 November 2026 at 20:00 IST, records all shots, assembles the edit, validates its media properties, and stops the server even on failure. `--skip-build` reuses a matching mock build. `--only N` records one shot for debugging; for the complete story rerun all shots on a fresh server.

`DEMO_BROWSER_PATH` optionally selects an already-installed Chromium binary in restricted recording environments. The default uses Playwright's bundled browser.

Outputs (all ignored by Git):

- `out/nearer-demo.mp4`: 1080×1920, H.264, 30fps, exactly 90 seconds, under 20MB. Captions are burned in; no audio track.
- `out/nearer-demo-captions.srt`: matching caption track.
- `out/nearer-demo-voiceover.txt`: timed narration for recording separately.
- `out/contact.png`: five frames extracted from the finished video.
- `out/verification.json`: technical checks and source revision.
- `out/shot-*.webm`, PNGs and logs: intermediate captures.

## Story and honesty

Meet the family → their sky and time → shared activity and check-ins → light the lamp → see the other home → voice and words → open the house → a recipe passed on and cooked → inbox voice reply → sample gift preview → a London window → end card.

The distance shown is the application's city-to-city distance. Safe & sound is activity inside Nearer and voluntary check-ins, never phone-wide tracking or a guarantee of safety. Captions do not imply continuous location monitoring. Voice playback and model processing are mock fixtures in this recording, rather than a live model performance demonstration. The script uses the app's own player without substituting audio or UI.

Sample product labels remain visible. The narration explicitly identifies samples. The recorder blocks all external browser requests, never opens checkout, and never sends or purchases a gift. The international shot chooses Rohan and Sneha through the existing window-settings endpoint in the local mock family; it does not imply Maa lives in London. The recording-only synthetic shelf (`NEXT_PUBLIC_MOCK=true` and `NEXT_PUBLIC_DEMO_REEL=true`) includes an explicitly addressed note so the real inbox can demonstrate Reply by voice. Ordinary demo visitors and the UI inventory keep the original data.

Every required selector and key state fails closed. The London and night-sky shots assert their actual content. Page exceptions fail the recording; no placeholder product screens or unfinished shots are rendered into the final video.

## Narrated motion film

After the real-app capture exists, `npm run demo:film` builds a separate widescreen film. It synthesizes stock narration with the public Edge TTS client, composes an original piano bed and transition sounds, animates camera moves across the synthetic demo imagery, and puts the actual recordings into moving phone frames. Captioned output: `out/film/nearer-film.mp4`. The separate audio mix, subtitles, script and timeline are in the same folder. No product UI is changed, and no paid account or API key is used. The voice service requires network access; an unavailable service fails the build rather than producing another silent export. Existing narration takes are reused.

The people in the illustrative photos remain still. Camera moves, moving typography, device frames and the recorded app supply the motion; this workflow does not synthesize actor performances. The stock narrator is not a family member's cloned voice. Music and effects are generated locally from original notes and noise.
