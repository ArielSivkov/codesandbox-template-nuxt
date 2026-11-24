#!/usr/bin/env bash
# בדיקה אוטומטית אחת לעולם התאום (משימה 3 בתור). אותו סקריפט רץ מקומית וב-GitHub Actions.
#   bash twin/integration/tools/ci.sh unit     → בדיקות בלי דפדפן (pytest, test-sim, פיזיקה, ITM, סנכרון עותקים)
#   bash twin/integration/tools/ci.sh browser  → בדיקות עשן ופיזיקה בדפדפן ב-360×800 (game + integration)
#   bash twin/integration/tools/ci.sh canary   → שבירה מכוונת: מוודא שהבדיקות *נכשלות* כשהקוד שבור (יוצא 0 רק אם השער תפס את השבירה)
# קוד יציאה ≠ 0 = נכשל.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
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
  run "שרתי בדיקת הדפדפן נסגרים (בלי תקיעה בצינור)" servers_selftest
}

start_servers() {
  # שרתים ישירות ברקע (בלי "(cd X && ... &)": שם תת-מעטפת יתומה מחזיקה את stdout/stderr של הסקריפט,
  # וכל "ci.sh browser | tail" נתקע לנצח אחרי שהבדיקות כבר עברו). נסגרים ביציאה מהסקריפט.
  if curl -sf -o /dev/null "http://localhost:$G/" || curl -sf -o /dev/null "http://localhost:$I/"; then
    echo "‼ הפורט $G או $I כבר תפוס – שרת ישן היה מגיש תיקייה אחרת"; return 1; fi
  python3 -m http.server $G --directory game </dev/null >/dev/null 2>&1 & SRV_PIDS="$!"
  python3 -m http.server $I --directory integration </dev/null >/dev/null 2>&1 & SRV_PIDS="$SRV_PIDS $!"
  trap 'kill $SRV_PIDS 2>/dev/null' EXIT
  for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:$G/index.html && curl -sf -o /dev/null http://localhost:$I/world/index.html && return 0; sleep 0.5; done
  echo "‼ השרתים לא עלו"; return 1
}

servers_selftest() {
  # בדיקה בלי דפדפן: הסקריפט חייב להסתיים גם כשהפלט שלו בצינור, ולא להשאיר שרתים
  local G=8951 I=8952 t0=$SECONDS
  # הצינור חייב להיסגר תוך 10 ש' מסוף הסקריפט; אחרת תהליך יתום מחזיק אותו (כמו התקיעה מ-24.11)
  timeout 30 bash "$SELF" _servers_only "$G" "$I" | timeout 40 cat >/dev/null; local rc=${PIPESTATUS[0]} rcp=${PIPESTATUS[1]}
  if [ "$rcp" -eq 124 ]; then echo "‼ הצינור לא נסגר – תהליך יתום מחזיק את הפלט"; pkill -f "http.server $G" 2>/dev/null; pkill -f "http.server $I" 2>/dev/null; return 1; fi
  if [ "$rc" -ne 0 ]; then echo "‼ הפעלת השרתים נכשלה (קוד $rc)"; return 1; fi
  sleep 0.3
  if curl -sf -o /dev/null "http://localhost:$G/" || curl -sf -o /dev/null "http://localhost:$I/"; then echo "‼ נשאר שרת יתום אחרי היציאה"; return 1; fi
  echo "שרתי הבדיקה: עלו, נסגרו ביציאה, הצינור נסגר ($((SECONDS-t0)) ש')"
}

browser() {
  local G=8931 I=8940
  start_servers || { FAIL=1; return; }
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
  # 4) שרתים יתומים: החזרת הדפוס הישן "(cd X && python3 -m http.server &)" → בדיקת השרתים חייבת להיכשל (תקיעה בצינור)
  sed -i 's#^  python3 -m http.server $G --directory game </dev/null >/dev/null 2>&1 & SRV_PIDS="$!"#  (cd game \&\& python3 -m http.server $G >/dev/null 2>\&1 \&); SRV_PIDS=""#' integration/tools/ci.sh
  if bash integration/tools/ci.sh _selftest >/dev/null 2>&1; then echo "‼ השער לא תפס שרת יתום שתוקע את הצינור"; else echo "✓ שרת יתום נתפס (בדיקת השרתים נכשלה כמצופה)"; caught=$((caught+1)); fi
  pkill -f "http.server 8951" 2>/dev/null
  cd - >/dev/null; rm -rf "$T"
  [ $caught -eq 4 ] || FAIL=1
}

case "${1:-unit}" in
  _servers_only) G=$2; I=$3; start_servers; exit $? ;;
  _selftest) servers_selftest; exit $? ;;
  unit) unit ;; browser) browser ;; canary) canary ;;
  all) unit; browser; canary ;;
  *) echo "שימוש: ci.sh unit|browser|canary|all"; exit 2 ;;
esac
[ $FAIL -eq 0 ] && echo "הכול עבר" || echo "יש כישלונות"
exit $FAIL
