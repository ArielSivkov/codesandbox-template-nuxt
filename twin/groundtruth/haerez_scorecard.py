"""כרטיס ציון לשכונת הניסוי (שלב 1, מסמך האסטרטגיה): רחוב הארז, אשדוד.

מודד את מצב הנתונים *כפי שהעולם טוען אותם* (twin/integration/world/data – מקור האמת) מול הגדרת "מדויק"
של שלב 1: מיקום ±2 מ', קומות ±1, קרקע ±2 מ', ולכל מספר מקור ו-σ.

שום מספר כאן לא מומצא: כל ערך נקרא מהאריחים, מהמניפסט או מקובץ שמצוטט בשורה שלו.
מה שלא ניתן למדוד מכאן – מסומן "לא נמדד" (ולא "עובר").

הרצה:  python3 twin/groundtruth/haerez_scorecard.py            → מדפיס ומעדכן haerez_scorecard.json
        python3 twin/groundtruth/haerez_scorecard.py --check    → נכשל אם התוצאה שונה מהקובץ השמור
"""
from __future__ import annotations

import gzip
import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TWIN = os.path.dirname(HERE)
DATA = os.path.join(TWIN, "integration", "world", "data")
OUT = os.path.join(HERE, "haerez_scorecard.json")

# ---------------------------------------------------------------- הגדרות (כל אחת עם מקור)
# גבול השכונה = "השכונה שלי" בעולם עצמו: HOME = {E:164751, N:634164, r:500} (מסגרת האריחים),
# twin/integration/world/host/host.js – אמצע מקטע הארז (164765.1,634196.2)→(164737.0,634132.0).
HOST_JS = os.path.join(TWIN, "integration", "world", "host", "host.js")
# יעדי שלב 1 – מסמך האסטרטגיה (24.11.2026): מיקום ±2 מ', קומות ±1, קרקע ±2 מ'.
TARGET = {"position_m": 2.0, "floors": 1.0, "terrain_m": 2.0}
# דיוק אנכי מתועד של מקור הקרקע. המניפסט אומר "SRTM grid ... (DSM, 2000)".
# Rodriguez, Morris & Belz (2006), "A global assessment of the SRTM performance", PE&RS 72(3):249-260,
# טבלה 2: שגיאת גובה מוחלטת 90% באירואסיה 6.2 מ' (LE90). σ ≈ LE90/1.645 (התפלגות נורמלית).
SRTM_LE90_EURASIA_M = 6.2
SEA, OUTSIDE = -32768, -32767          # pipeline/yazam/tiles.py
TERRAIN_STEP = 25                      # pipeline/yazam/geo.py


def read_home():
    src = open(HOST_JS, encoding="utf-8").read()
    m = re.search(r"const HOME = \{ E: ([\d.]+), N: ([\d.]+),.*?r: ([\d.]+)", src)
    if not m:
        raise RuntimeError("HOME לא נמצא ב-host.js – הגבול השתנה, צריך לעדכן את כרטיס הציון")
    return float(m.group(1)), float(m.group(2)), float(m.group(3))


def decode_ring(r, ox, oy):
    """אותו קידוד כמו pipeline/yazam/tiles.py:_enc_ring – זוג ראשון מראשית האריח, השאר הפרשים, דצימטרים."""
    pts, x, y = [], float(ox), float(oy)
    for i in range(0, len(r) - 1, 2):
        x += r[i] / 10.0; y += r[i + 1] / 10.0
        pts.append((x, y))
    return pts


def ring_area_centroid(pts):
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    a *= 0.5
    if abs(a) < 1e-9:
        return 0.0, sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    return abs(a), cx / (6 * a), cy / (6 * a)


def read_terrain(key):
    p = os.path.join(DATA, "tiles", "t", key + ".bin.gz")
    if not os.path.exists(p):
        return None
    b = gzip.open(p).read()
    magic, ver, tx, ty, nt, nm, step = struct.unpack("<4sHiiHHH", b[:20])
    z = struct.unpack("<%dh" % (nt * nt), b[20:20 + nt * nt * 2])
    return {"tx": tx, "ty": ty, "nt": nt, "step": step, "z": z}


def terrain_at(t, E, N):
    """בילינארי על הרשת (שורה 0 = צפון). None על ים/מחוץ לאזור."""
    x0, y1 = t["tx"] * 1000, t["ty"] * 1000 + 1000
    fx, fy = (E - x0) / t["step"], (y1 - N) / t["step"]
    i, j = min(int(fx), t["nt"] - 2), min(int(fy), t["nt"] - 2)
    u, v = fx - i, fy - j
    q = [t["z"][(j + dj) * t["nt"] + i + di] for dj in (0, 1) for di in (0, 1)]
    if any(x in (SEA, OUTSIDE) for x in q):
        return None
    return ((1 - u) * (1 - v) * q[0] + u * (1 - v) * q[1] + (1 - u) * v * q[2] + u * v * q[3]) / 10.0


def pct(n, d):
    return round(100.0 * n / d, 1) if d else None


def median(xs):
    xs = sorted(xs); n = len(xs)
    if not n: return None
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


def score():
    E0, N0, R = read_home()
    man = json.load(open(os.path.join(DATA, "cities", "ashdod", "manifest.json"), encoding="utf-8"))
    keys = [k for k in man["tiles"]
            if (int(k.split("_")[0]) * 1000 <= E0 + R and int(k.split("_")[0]) * 1000 + 1000 >= E0 - R
                and int(k.split("_")[1]) * 1000 <= N0 + R and int(k.split("_")[1]) * 1000 + 1000 >= N0 - R)]
    blds, area_err = [], []
    for k in keys:
        v = json.load(gzip.open(os.path.join(DATA, "tiles", "v", k + ".json.gz")))
        t = read_terrain(k)
        ox, oy = v["o"]
        for b in v["b"]:
            a, cx, cy = ring_area_centroid(decode_ring(b["r"][0], ox, oy))
            a -= sum(ring_area_centroid(decode_ring(h, ox, oy))[0] for h in b["r"][1:])   # חורים (חצרות פנימיות)
            area_err.append(abs(a - b["a"]) / max(b["a"], 1.0))
            if math.hypot(cx - E0, cy - N0) > R:
                continue
            g = terrain_at(t, cx, cy) if t else None
            blds.append({"i": b["i"], "x": cx, "y": cy, "a": b["a"], "h": b["h"] / 10, "s": b["s"] / 10,
                         "f": b["f"], "fl": b["fl"], "fh": b["fh"], "src": b["src"], "c": b["c"],
                         "z": b["z"] / 10, "g": g})
    n = len(blds)
    # קומות: [fl, fh] = הקומות של h−σ ו-h+σ (pipeline/yazam/heights.py:297-298). עובר אם חצי הרוחב ≤ 1 קומה.
    half = [(b["fh"] - b["fl"]) / 2 for b in blds]
    floors_ok = sum(1 for x in half if x <= TARGET["floors"])
    src = {}
    for b in blds: src[b["src"]] = src.get(b["src"], 0) + 1
    # מיקום: הרכיב היחיד שנמדד הוא היסט המסגרת (σ לכל ציר, twin/data/nat-sample ו-il/nat.json: 0.56/0.58 מ').
    off_sig = (0.56, 0.58)
    off_radial = round(math.hypot(*off_sig), 2)
    # קרקע: σ מתועד של המקור + עקביות פנימית (גובה בסיס הבניין z מול רשת הקרקע באותה נקודה).
    srtm_sigma = round(SRTM_LE90_EURASIA_M / 1.645, 2)
    dz = [b["z"] - b["g"] for b in blds if b["g"] is not None]
    zs = [b["g"] for b in blds if b["g"] is not None]
    # אי-התאמות ידועות בגבול (תצפיות שטח של אריאל, procgen/data/discrepancies.json)
    disc = json.load(open(os.path.join(TWIN, "procgen", "data", "discrepancies.json"), encoding="utf-8"))["items"]
    disc_in = [{"id": d["id"], "severity": d["severity"], "building": d.get("building")}
               for d in disc if d.get("x") is not None and math.hypot(d["x"] - E0, d["y"] - N0) <= R]
    # אמת שטח מתועדת (groundtruth/ashdod_reference.csv) שנופלת בגבול – לפי מזהה OSM
    import csv
    rows = [l for l in open(os.path.join(HERE, "ashdod_reference.csv"), encoding="utf-8") if not l.startswith("#")]
    ref = {r["osm_way_id"]: r for r in csv.DictReader(rows) if r["osm_way_id"]}
    ref_in = []
    for b in blds:
        r = ref.get(b["i"])
        if not r: continue
        rf = int(r["floors"]) if r["floors"] else None
        ref_in.append({"ref_id": r["ref_id"], "osm": b["i"], "ref_floors": rf, "reliability": r["reliability"],
                       "use_in_eval": r["use_in_eval"] == "1", "model_floors": b["f"], "model_floors_range": [b["fl"], b["fh"]],
                       "floor_err": (b["f"] - rf) if rf is not None else None})
    res = {
        "v": 1,
        "boundary": {"kind": "circle", "frame": "מסגרת האריחים (ITM אמיתי = מסגרת + 1507.82/757.76)",
                     "E": E0, "N": N0, "r_m": R, "src": "twin/integration/world/host/host.js HOME"},
        "targets": TARGET,
        "tiles": sorted(keys),
        "buildings": n,
        "decoder_check": {"max_rel_area_err": round(max(area_err), 4),
                          "note": "שטח מהטבעת המפוענחת מול השדה a באריח – מוכיח שהפענוח נכון"},
        "height_sources": dict(sorted(src.items())),
        "height_sigma_m_median": median([b["s"] for b in blds]),
        "floors": {"pass": floors_ok, "pass_pct": pct(floors_ok, n),
                   "half_width_median": median(half),
                   "rule": "חצי רוחב [fl,fh] ≤ 1 קומה; fl/fh = קומות של h∓σ (heights.py)",
                   "note": "'עובר' כאן = σ שהמודל מצהיר עליו, לא אימות מול אמת שטח"},
        "position": {"status": "לא נמדד",
                     "frame_offset_sigma_m": list(off_sig), "frame_offset_radial_sigma_m": off_radial,
                     "note": "רק היסט המסגרת נמדד (7,386 בניינים). דיוק טביעות OSM עצמן מול מדידה (מפ\"י/אורתופוטו) – "
                             "לא נמדד; משימה 4 בתור. לכן אף בניין לא מסומן 'עובר' במיקום."},
        "terrain": {"source": man["sources"]["dem"], "kind": "DSM (כולל בניינים/צמחייה – לא קרקע חשופה)",
                    "sigma_m_documented": srtm_sigma,
                    "sigma_src": "Rodriguez et al. 2006, PE&RS 72(3) טבלה 2: LE90 אירואסיה 6.2 מ' → σ≈LE90/1.645",
                    "pass": srtm_sigma <= TARGET["terrain_m"],
                    "ground_m_range": [round(min(zs), 1), round(max(zs), 1)] if zs else None,
                    "base_vs_grid_m": {"n": len(dz), "median": round(median(dz), 2) if dz else None,
                                       "max_abs": round(max(abs(x) for x in dz), 2) if dz else None,
                                       "note": "z של הבניין מול רשת הקרקע 25 מ' במרכז הבניין (עקביות פנימית, לא דיוק)"}},
        "known_discrepancies_in_boundary": disc_in,
        "groundtruth_buildings_in_boundary": ref_in,
    }
    res["phase1_met"] = {"position": False, "floors": floors_ok == n and n > 0, "terrain": res["terrain"]["pass"]}
    return res


def he_summary(r):
    f, t, p = r["floors"], r["terrain"], r["position"]
    return "\n".join([
        f"שכונת הניסוי – רחוב הארז (רדיוס {r['boundary']['r_m']:.0f} מ' סביב {r['boundary']['E']:.0f},{r['boundary']['N']:.0f}, אריחים {', '.join(r['tiles'])})",
        f"בניינים: {r['buildings']} · מקורות גובה: {r['height_sources']} · σ גובה חציוני {r['height_sigma_m_median']} מ'",
        f"קומות ±1: {f['pass']}/{r['buildings']} ({f['pass_pct']}%) · חצי רוחב חציוני {f['half_width_median']} קומות",
        f"קרקע ±2 מ': {'עובר' if t['pass'] else 'לא עובר'} – {t['kind']}, σ מתועד {t['sigma_m_documented']} מ' · בסיס בניין מול רשת: חציון {t['base_vs_grid_m']['median']} מ', מקס' {t['base_vs_grid_m']['max_abs']} מ'",
        f"מיקום ±2 מ': {p['status']} (היסט מסגרת σ {p['frame_offset_radial_sigma_m']} מ'; טביעות OSM לא נמדדו)",
        f"תצפיות שטח בגבול: {len(r['known_discrepancies_in_boundary'])} · בנייני אמת שטח בגבול: "
        + (", ".join(f"{g['ref_id']} {g['ref_floors']} קומות מול מודל {g['model_floors']} ({g['reliability']})" for g in r['groundtruth_buildings_in_boundary']) or "0"),
        f"בדיקת פענוח: סטיית שטח מרבית {r['decoder_check']['max_rel_area_err']}",
    ])


if __name__ == "__main__":
    r = score()
    print(he_summary(r))
    if "--check" in sys.argv:
        old = json.load(open(OUT, encoding="utf-8"))
        if old != json.loads(json.dumps(r, ensure_ascii=False)):
            print("‼ כרטיס הציון השתנה מול haerez_scorecard.json – להריץ בלי --check ולתעד ב-LOG.md"); sys.exit(1)
        print("✓ זהה לקובץ השמור")
    else:
        json.dump(r, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
