#!/usr/bin/env bash
# photomatch – הצנרת המלאה מקומית: כיול → משימות → רינדור → השוואה → frustum → תיקונים → זוגות למודל ראייה.
# שימוש: bash twin/integration/tools/photomatch/run_all.sh [OUT] [SIZES]
# דורש שרת: (cd twin && python3 -m http.server 8944 --bind 127.0.0.1)   · Playwright: /tmp/pw/node_modules/playwright או npm  · כרום: /usr/bin/google-chrome
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-/home/claude/swarm/photomatch-out}"; SIZES="${2:-360x800,1080x1920}"; FIRST="${SIZES%%,*}"
curl -sf -o /dev/null "${PM_BASE:-http://127.0.0.1:8944/integration/world/index.html}" || { echo "השרת לא עונה על 8944 – להפעיל: (cd twin && python3 -m http.server 8944 --bind 127.0.0.1)"; exit 2; }
python3 -I "$HERE/calib.py" --out "$OUT"
python3 -I "$HERE/poses.py" --out "$OUT"
node "$HERE/render.js" --jobs "$OUT/jobs.json" --out "$OUT" --sizes "$SIZES"
python3 -I "$HERE/compare.py" --out "$OUT" --sizes "$SIZES"
node "$HERE/frustum_jobs.mjs" --out "$OUT" --size "$FIRST"
python3 -I "$HERE/fixes.py" --out "$OUT" --size "$FIRST"
python3 -I "$HERE/vlm/hook.py" --out "$OUT" --size "$FIRST"
echo "→ $OUT/fixes.json"
