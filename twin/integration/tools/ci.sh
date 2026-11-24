#!/usr/bin/env bash
# בדיקה אוטומטית אחת לעולם התאום (משימה 3 בתור). אותו סקריפט רץ מקומית וב-GitHub Actions.
#   bash twin/integration/tools/ci.sh unit     → בדיקות בלי דפדפן (pytest, test-sim, פיזיקה, ITM, סנכרון עותקים)
#   bash twin/integration/tools/ci.sh browser  → בדיקות עשן ופיזיקה בדפדפן ב-360×800 (game + integration)
#   bash twin/integration/tools/ci.sh canary   → שבירה מכוונת: מוודא שהבדיקות *נכשלות* כשהקוד שבור (יוצא 0 רק אם השער תפס את השבירה)
# קוד יציאה ≠ 0 = נכשל.
set -u
cd "$(dirname "$0")/../.."   # twin/
FAIL=0
run() { local name="$1"; shift; echo "::group::$name"; "$@"; local rc=$?; echo "::endgroup::"; if [ $rc -ne 0 ]; then echo "נכשל: $name (קוד $rc)"; FAIL=1; else echo "עבר: $name"; fi; }

unit() {
  run "pytest צינור + מודיעין" python3 -m pytest pipeline/tests imint -q
  run "סימולציה (שמש מול NREL SPA, רחפן, רוח)" node game/tools/test-sim.js
  run "פיזיקה קנונית (שמש מול SPA)" bash -c 'cd physics && node --test'
  run "רשת ישראל ITM" python3 game/tools/test-itm.py
  run "שמיים: dist עדכני מול src" node sky/tools/build.mjs --check
  run "שמיים (ירח וכוכבי לכת מול Skyfield, זמני היום, לוח עברי, תוסף)" bash -c 'cd sky && node --test test/*.test.mjs'
  run "סנכרון עותקים (0 הבדלים)" node integration/tools/sync-copies.js --check
}

browser() {
  local G=8931 I=8940
  (cd game && python3 -m http.server $G >/dev/null 2>&1 &)
  (cd integration && python3 -m http.server $I >/dev/null 2>&1 &)
  for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:$G/index.html && curl -sf -o /dev/null http://localhost:$I/world/index.html && break; sleep 0.5; done
  # nat=0: בלי אריחי כל הארץ מ-githack – הבדיקה תלויה רק בקבצים שבענף
  run "עשן game" node game/tools/smoke.js "http://localhost:$G/index.html?auto&nat=0"
  run "פיזיקה בדפדפן (הליכה, רכב)" node game/tools/test-phys.js "http://localhost:$G/index.html?auto&nat=0"
  run "יכולות רחוב" node game/tools/test-features.js "http://localhost:$G/index.html?auto&nat=0"
  run "GPS" node game/tools/test-gps.js "http://localhost:$G/index.html?nat=0"
  run "עשן integration (העולם החי)" node integration/tools/smoke.js "http://localhost:$I/world/index.html?auto&nat=0"
}

canary() {
  # עובד על עותק זמני של הקבצים – לא משנה את הענף
  local T; T=$(mktemp -d); cp -r game integration preview physics aviation weather sky "$T"/ 2>/dev/null; cd "$T"
  local caught=0
  # בקרה: בעותק הזמני, לפני השבירה, הכול חייב לעבור (אחרת "נתפס" היה שקר – למשל קובץ חסר)
  if ! node game/tools/test-sim.js >/dev/null 2>&1 || ! node integration/tools/sync-copies.js --check >/dev/null 2>&1 || ! node sky/tools/build.mjs --check >/dev/null 2>&1; then
    echo "‼ בקרה נכשלה: העותק הזמני לא עובר לפני השבירה"; cd - >/dev/null; rm -rf "$T"; FAIL=1; return; fi
  echo "✓ בקרה: לפני השבירה test-sim, sync --check ו-build --check של השמיים עוברים"
  # 1) שבירה פיזיקלית: שבירת אור באופק מוקטנת פי 10, מסונכרנת לכל העותקים → test-sim חייב להיכשל
  sed -i 's#-20.774 / Math.tan#-2.0774 / Math.tan#' integration/world/js/sim.js
  node integration/tools/sync-copies.js >/dev/null
  if node game/tools/test-sim.js >/dev/null 2>&1; then echo "‼ השער לא תפס שבירה פיזיקלית בשמש"; else echo "✓ שבירה פיזיקלית נתפסה (test-sim נכשל כמצופה)"; caught=$((caught+1)); fi
  # 2) סטיית עותק: שינוי ידני בעותק preview בלבד → sync --check חייב להיכשל
  echo "// שבירה מכוונת" >> preview/world/js/itm.js
  if node integration/tools/sync-copies.js --check >/dev/null 2>&1; then echo "‼ השער לא תפס סטיית עותק"; else echo "✓ סטיית עותק נתפסה (sync --check נכשל כמצופה)"; caught=$((caught+1)); fi
  # 3) שמיים: שינוי ב-src בלי לבנות מחדש את dist → build.mjs --check חייב להיכשל
  sed -i 's#export const D2R = Math.PI / 180;#export const D2R = Math.PI / 180.0001;#' sky/src/time.js
  if node sky/tools/build.mjs --check >/dev/null 2>&1; then echo "‼ השער לא תפס dist ישן של השמיים"; else echo "✓ dist ישן של השמיים נתפס (build --check נכשל כמצופה)"; caught=$((caught+1)); fi
  cd - >/dev/null; rm -rf "$T"
  [ $caught -eq 3 ] || FAIL=1
}

case "${1:-unit}" in
  unit) unit ;; browser) browser ;; canary) canary ;;
  all) unit; browser; canary ;;
  *) echo "שימוש: ci.sh unit|browser|canary|all"; exit 2 ;;
esac
[ $FAIL -eq 0 ] && echo "הכול עבר" || echo "יש כישלונות"
exit $FAIL
