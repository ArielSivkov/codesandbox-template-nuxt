#!/usr/bin/env python3
"""בדיקות יחידה לצינור הארצי:  python3 -I tests/test_pipeline.py
1. חידוש: ריצה שנעצרת אחרי 5 אריחים + המשך == ריצה מלאה (קבצים זהים בבתים).
2. שלב הרחבה: רדיוס 3 → 4 ק"מ בונה רק את הטבעת החדשה; אריחי הרדיוס הקודם לא נכתבים מחדש (mtime).
3. גבהים: building:levels=9 → 28.0 מ' "מ-OSM"; height=31.5 → "מ-OSM"; בלי תגית → "משוער".
4. GPKG: פענוח כותרת עם מעטפת 32 בתים.
5. גיבוב סוג פנס (פייתון) == palette.js (node).
6. ITM ב-JS (web/js/geo.js) מול pyproj: עד 0.5 מ'."""
import gzip, hashlib, json, os, shutil, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PIPE = os.path.join(ROOT, "pipeline")
FIX = os.path.join(HERE, "fixtures", "mini.osm")
sys.path.insert(0, PIPE)
ok = fail = 0


def check(name, cond, info=""):
    global ok, fail
    ok += bool(cond); fail += (not cond)
    print(("PASS " if cond else "FAIL ") + name + (" – " + str(info) if info else ""))


def run(out, r, extra=()):
    subprocess.run([sys.executable, "-I", os.path.join(PIPE, "build_national.py"), "--radius-km", str(r), "--pbf", FIX, "--out", out, "--public", "/nonexistent", *extra],
                   check=True, capture_output=True)


def digest(out):
    h = {}
    for dp, _, fs in os.walk(os.path.join(out, "tiles")):
        for f in fs:
            h[f] = hashlib.sha1(open(os.path.join(dp, f), "rb").read()).hexdigest()
    return h


tmp = tempfile.mkdtemp()
a, b = os.path.join(tmp, "a"), os.path.join(tmp, "b")
run(a, 3)
run(b, 3, ["--max-tiles", "5"]); part = len(json.load(open(os.path.join(b, "progress.json")))["done"])
run(b, 3)
check("חידוש אחרי עצירה = ריצה מלאה", digest(a) == digest(b) and len(digest(a)) > 0, f"נעצר אחרי {part} אריחים; {len(digest(a))} קבצים")
mt = {f: os.path.getmtime(os.path.join(dp, f)) for dp, _, fs in os.walk(os.path.join(a, "tiles")) for f in fs}
run(a, 4)
st = json.load(open(os.path.join(a, "nat", "stage_4.json")))
same = all(os.path.getmtime(os.path.join(dp, f)) == mt[f] for dp, _, fs in os.walk(os.path.join(a, "tiles")) for f in fs if f in mt)
check("שלב 4 ק\"מ: רק טבעת חדשה", same and st["tiles_in_circle"] > 41, f"אריחים בעיגול {st['tiles_in_circle']}, ישנים לא נכתבו מחדש: {same}")
v = json.load(gzip.open(os.path.join(a, "tiles/v/166_634.json.gz")))
H = {x["i"]: (x["h"], x["he"], x["src"]) for x in v["b"]}
check("גובה מקומות OSM", H.get("w1001") == (280, "מ-OSM", "L"), H.get("w1001"))
check("גובה מתגית height", H.get("w1002") == (315, "מ-OSM", "H"), H.get("w1002"))
from build_national import gpkg_wkb
import shapely
from shapely.geometry import Point
wkb = shapely.to_wkb(Point(1, 2))
blob = b"GP" + bytes([0, 0b00000010]) + struct.pack("<i", 2039) + struct.pack("<4d", 1, 1, 2, 2) + wkb
check("פענוח GPKG", shapely.from_wkb(gpkg_wkb(blob)).equals(Point(1, 2)))
from build_overview import lamp_is_led
names = ["א", "ב", "הגפן", "התאנה", "רוגוזין", "abc", "x1", "שבזי", "ז'בוטינסקי", "אבן גבירול", "הארז", ""]
py = "".join("l" if lamp_is_led(n) else "s" for n in names)
js = subprocess.run(["node", "-e", f"import('{ROOT}/web/vendor/atmosphere/src/palette.js').then(p=>console.log({json.dumps(names, ensure_ascii=False)}.map(n=>p.lampTypeForStreet(n)[0]).join('')))"],
                    capture_output=True, text=True).stdout.strip()
check("גיבוב סוג פנס פייתון == JS", py == js, f"{py} / {js}")
from pyproj import Transformer
t = Transformer.from_crs(4326, 2039, always_xy=True)
pts = [(31.80, 34.65), (32.08, 34.78), (31.77, 35.21), (31.25, 34.79), (33.0, 35.5), (29.56, 34.95)]
js = json.loads(subprocess.run(["node", "-e", f"import('{ROOT}/web/js/geo.js').then(g=>console.log(JSON.stringify({json.dumps(pts)}.map(([a,b])=>g.toITM(a,b)))))"], capture_output=True, text=True).stdout)
err = max(((x - t.transform(lo, la)[0]) ** 2 + (y - t.transform(lo, la)[1]) ** 2) ** 0.5 for (la, lo), (x, y) in zip(pts, js))
check("ITM ב-JS מול pyproj (כולל אילת וצפון)", err < 1.5, f"סטייה מקסימלית {err:.2f} מ'")
shutil.rmtree(tmp)
print(f"\n{ok} עברו, {fail} נכשלו")
sys.exit(1 if fail else 0)
