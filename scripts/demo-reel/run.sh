#!/usr/bin/env bash
# npm run demo:reel: build the mock app, serve it on a frozen clock, record the shots, assemble the video.
#
#   DEMO_SKIP_BUILD=1   reuse an existing mock build in .next (MOCK=true NEXT_PUBLIC_MOCK=true next build)
#   DEMO_PORT=4700      port of the throwaway mock server (must be free; this script never kills other servers)
#   DEMO_ONLY=3,4       re-record only those shots (keeps the other raw clips), then assemble
#
# Outputs (gitignored): out/nearer-demo.mp4, out/nearer-demo-captions.srt, out/nearer-demo-voiceover.txt, out/contact.png
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${DEMO_PORT:-4700}"
BASE="http://localhost:${PORT}"
NOW="2026-11-02T14:30:00Z" # 8 PM at the parents' city (evening sky there), afternoon in London
SECRET="demo-reel-secret-0123456789-abcdefghijklmnop"

if curl -s -o /dev/null "$BASE/"; then
  echo "port ${PORT} is already serving something; set DEMO_PORT to a free port (a fresh server is needed: the demo keeps state in memory)" >&2
  exit 1
fi

if [ "${DEMO_SKIP_BUILD:-}" != "1" ]; then
  MOCK=true NEXT_PUBLIC_MOCK=true npx next build
fi

MOCK=true SESSION_SECRET="$SECRET" AANGAN_FIXED_NOW="$NOW" setsid npx next start -p "$PORT" >/tmp/demo-reel-server.log 2>&1 &
SERVER=$!
cleanup() { kill -- "-$SERVER" 2>/dev/null || kill "$SERVER" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "$BASE/home" && break
  sleep 1
done
curl -s -o /dev/null "$BASE/home" || { echo "mock server did not start; see /tmp/demo-reel-server.log" >&2; exit 1; }

ARGS=(--base "$BASE" --out out/demo-reel)
[ -n "${DEMO_ONLY:-}" ] && ARGS+=(--only "$DEMO_ONLY")
python3 scripts/demo-reel/record.py "${ARGS[@]}"
cleanup
bash scripts/demo-reel/assemble.sh
