#!/usr/bin/env python3
"""גדוד הכיסוי הארצי – בניית אריחים לרדיוס סביב אשדוד, בשלבים (100, 110, 120 ... ק"מ).

    python3 -I build_national.py --radius-km 100 --out ../data            # שלב ראשון
    python3 -I build_national.py --radius-km 110 --out ../data            # מוסיף רק את הטבעת החדשה
    python3 -I build_national.py --radius-km 100 --pbf israel-and-palestine-latest.osm.pbf  # ב-CI (גיאופבריק)

קואורדינטות: ITM אמיתי (EPSG:2039) בכל מקום. אין כאן הזזת "מסגרת הדגימה" של אשדוד הישנה
(sample + (1524.6, 753.6)) – הנתונים החדשים כבר ב-ITM אמיתי.

זרימה (חסומת זיכרון, ניתנת לחידוש):
  1. ingest  – קריאה זורמת של המקור (GPKG בקבוצות של 4,000 / PBF ב-osmium), כל בניין לאריח לפי מרכזו,
               כל כביש נחתך לאריחים. נכתב ל-staging.sqlite (INSERT OR IGNORE → הרצה חוזרת זולה).
               מקור שכבר נקלט לאותו רדיוס מסומן ב-progress.json ולא נקרא שוב.
  2. tiles   – לכל אריח בעיגול שעוד לא נכתב (progress.json): גבהים (heights.py של גדוד 5),
               דריסת גובה ממקור ציבורי, ים מקו החוף, כתיבת v/<k>.json.gz + t/<k>.bin.gz בפורמט גדוד 5.
  3. overview – רסטר 100 מ' של צפיפות בנייה (לתצוגת המדינה ולאורות הלילה) + אינדקס ארצי.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import sqlite3
import struct
import sys
import time

import numpy as np
import shapely
from shapely.geometry import Point, box, shape, LineString, MultiLineString, Polygon, MultiPolygon

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from yazam.geo import TILE_M, TERRAIN_STEP, MASK_STEP, COORD_Q, tile_key, tile_bounds, to_itm  # noqa: E402
from yazam import heights as H  # noqa: E402
from yazam.landmask import rasterize, pack_bits  # noqa: E402
from yazam.tiles import _enc_ring, _enc_poly, _polys, building_record  # noqa: E402
from yazam.sources_osm import ROAD_CLASS  # noqa: E402

CENTER = (31.80, 34.65)                          # אשדוד (lat, lon)
NT = TILE_M // TERRAIN_STEP + 1
NM = TILE_M // MASK_STEP
SEA, OUTSIDE = -32768, -32767
LANDUSE_KEEP = {"park": "park", "grass": "grass", "forest": "forest", "wood": "forest", "recreation_ground": "park",
                "cemetery": "cemetery", "farmland": "farm", "orchard": "farm", "meadow": "grass", "industrial": "industrial",
                "residential": "residential", "commercial": "commercial", "retail": "commercial", "nature_reserve": "park",
                "garden": "park", "pitch": "pitch", "scrub": "scrub", "beach": "beach", "sand": "beach"}


# ------------------------------------------------------------------ GeoPackage (sqlite, בלי GDAL)
def gpkg_wkb(blob):
    """GeoPackage binary header → WKB.  flags bits 1-3 = envelope type."""
    flags = blob[3]
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    return bytes(blob[8 + env:])


def iter_gpkg(path, batch=4000):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    (table,) = con.execute("select table_name from gpkg_contents where data_type='features'").fetchone()
    cols = [r[1] for r in con.execute(f'pragma table_info("{table}")')]
    gcol = con.execute("select column_name from gpkg_geometry_columns where table_name=?", (table,)).fetchone()[0]
    srs = con.execute("select srs_id from gpkg_geometry_columns where table_name=?", (table,)).fetchone()[0]
    if srs != 2039:
        raise SystemExit(f"{path}: SRS {srs} – צפוי 2039 (ITM)")
    cur = con.execute(f'select * from "{table}"')
    gi = cols.index(gcol)
    while True:
        rows = cur.fetchmany(batch)
        if not rows:
            break
        geoms = shapely.from_wkb([gpkg_wkb(r[gi]) for r in rows], on_invalid="ignore")
        for r, g in zip(rows, geoms):
            if g is None or g.is_empty:
                continue
            yield g, dict(zip(cols, r))
    con.close()


# ------------------------------------------------------------------ staging
def open_stage(out):
    os.makedirs(out, exist_ok=True)
    db = sqlite3.connect(os.path.join(out, "staging.sqlite"))
    db.executescript("""
      pragma journal_mode=wal; pragma synchronous=normal;
      create table if not exists b(id text primary key, tile text, rec text);
      create table if not exists r(id text, tile text, rec text, primary key(id, tile));
      create table if not exists lu(id text, tile text, rec text, primary key(id, tile));
      create index if not exists bt on b(tile); create index if not exists rt on r(tile); create index if not exists lt on lu(tile);
    """)
    return db


class Circle:
    def __init__(self, radius_km):
        self.cx, self.cy = to_itm(CENTER[1], CENTER[0])
        self.r = radius_km * 1000.0
        self.geom = Point(self.cx, self.cy).buffer(self.r, 256)

    def tiles(self):
        tx0, tx1 = int((self.cx - self.r) // TILE_M), int((self.cx + self.r) // TILE_M)
        ty0, ty1 = int((self.cy - self.r) // TILE_M), int((self.cy + self.r) // TILE_M)
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                x0, y0, x1, y1 = tile_bounds(tx, ty)
                dx = max(x0 - self.cx, 0, self.cx - x1); dy = max(y0 - self.cy, 0, self.cy - y1)
                if dx * dx + dy * dy <= self.r * self.r:
                    yield tx, ty

    def has_tile(self, tx, ty):
        x0, y0, x1, y1 = tile_bounds(tx, ty)
        dx = max(x0 - self.cx, 0, self.cx - x1); dy = max(y0 - self.cy, 0, self.cy - y1)
        return dx * dx + dy * dy <= self.r * self.r


def _tiles_of_bounds(b):
    for tx in range(int(b[0] // TILE_M), int(b[2] // TILE_M) + 1):
        for ty in range(int(b[1] // TILE_M), int(b[3] // TILE_M) + 1):
            yield tx, ty


def _clip_lines(g, tx, ty):
    x0, y0, x1, y1 = tile_bounds(tx, ty)
    c = g.intersection(box(x0, y0, x1, y1))
    return [ln for ln in getattr(c, "geoms", [c]) if isinstance(ln, LineString) and not ln.is_empty and ln.length > 1]


def put_building(db, circ, bid, g, typ, name, tags):
    if not isinstance(g, (Polygon, MultiPolygon)):
        return 0
    c = g.centroid
    tx, ty = int(c.x // TILE_M), int(c.y // TILE_M)
    if not circ.has_tile(tx, ty):
        return 0
    if isinstance(g, MultiPolygon):
        g = max(g.geoms, key=lambda q: q.area)
    rec = {"w": shapely.to_wkb(g, hex=True), "t": typ or "", "n": name or "", "tg": tags}
    db.execute("insert or ignore into b values(?,?,?)", (bid, tile_key(tx, ty), json.dumps(rec, ensure_ascii=False)))
    return 1


def put_road(db, circ, rid, g, cls, name):
    n = 0
    for tx, ty in _tiles_of_bounds(g.bounds):
        if not circ.has_tile(tx, ty):
            continue
        x0, y0 = tile_bounds(tx, ty)[:2]
        for ln in _clip_lines(g, tx, ty):
            rec = {"c": cls, "n": name or "", "r": _enc_ring(list(ln.coords), x0, y0)}
            db.execute("insert or ignore into r values(?,?,?)", (f"{rid}:{n}", tile_key(tx, ty), json.dumps(rec, ensure_ascii=False)))
            n += 1
    return 1 if n else 0


def put_landuse(db, circ, lid, g, kind):
    n = 0
    for tx, ty in _tiles_of_bounds(g.bounds):
        if not circ.has_tile(tx, ty):
            continue
        x0, y0, x1, y1 = tile_bounds(tx, ty)
        c = g.intersection(box(x0, y0, x1, y1))
        for p in _polys(c):
            if p.area < 50:
                continue
            db.execute("insert or ignore into lu values(?,?,?)",
                       (f"{lid}:{n}", tile_key(tx, ty), json.dumps({"k": kind, "r": _enc_poly(p.simplify(1.0), x0, y0)})))
            n += 1
    return 1 if n else 0


def ingest_gpkg(db, circ, buildings_path, roads_path, log):
    nb = nr = 0
    t0 = time.time()
    for i, (g, row) in enumerate(iter_gpkg(buildings_path)):
        nb += put_building(db, circ, "w" + str(row.get("osm_id")), g, row.get("type") or "", row.get("name") or "", {})
        if i % 20000 == 0:
            db.commit(); log(f"  בניינים: נקראו {i:,}, בעיגול {nb:,} ({time.time() - t0:.0f} ש')")
    db.commit()
    for i, (g, row) in enumerate(iter_gpkg(roads_path)):
        nr += put_road(db, circ, "w" + str(row.get("osm_id")), g, ROAD_CLASS.get(row.get("fclass") or "", 0), row.get("name") or "")
        if i % 20000 == 0:
            db.commit(); log(f"  כבישים: נקראו {i:,}, בעיגול {nr:,} ({time.time() - t0:.0f} ש')")
    db.commit()
    return nb, nr


def ingest_pbf(db, circ, pbf_path, log):
    """Geofabrik PBF (ב-CI). שתי ריצות osmium: (1) ways/areas. זיכרון: מיקומי צמתים ב-flex_mem/sparse."""
    import osmium
    fwd = None
    from yazam.geo import _tf
    fwd = _tf()[0]
    wkb = osmium.geom.WKBFactory()
    cnt = {"b": 0, "r": 0, "lu": 0}
    W, S = (circ.cx - circ.r), (circ.cy - circ.r)

    def itm(g):
        return shapely.transform(g, lambda xy: np.column_stack(fwd.transform(xy[:, 0], xy[:, 1])))

    class Hd(osmium.SimpleHandler):
        def way(self, w):
            t = w.tags
            if "highway" in t and "building" not in t:
                try:
                    g = itm(shapely.from_wkb(wkb.create_linestring(w), ))
                except Exception:
                    return
                name = t.get("name:he") or t.get("name") or ""
                cnt["r"] += put_road(db, circ, "w" + str(w.id), g, ROAD_CLASS.get(t.get("highway"), 0), name)

        def area(self, a):
            t = a.tags
            isb = "building" in t
            kind = None
            if not isb:
                for k in ("leisure", "landuse", "natural"):
                    if t.get(k) in LANDUSE_KEEP:
                        kind = LANDUSE_KEEP[t.get(k)]; break
                if t.get("natural") == "water" or t.get("water") or t.get("landuse") in ("reservoir", "basin"):
                    kind = "water"
            if not (isb or kind):
                return
            try:
                g = itm(shapely.from_wkb(wkb.create_multipolygon(a)))
            except Exception:
                return
            if not g.is_valid:
                g = g.buffer(0)
            oid = ("w" if a.from_way() else "r") + str(a.orig_id())
            if isb:
                tags = {k: t.get(k) for k in ("height", "min_height", "building:levels", "roof:levels", "roof:shape") if t.get(k)}
                cnt["b"] += put_building(db, circ, oid, g, t.get("building") if t.get("building") != "yes" else "",
                                         t.get("name:he") or t.get("name") or "", tags)
            else:
                cnt["lu"] += put_landuse(db, circ, oid, g, kind)
            if (cnt["b"] + cnt["lu"]) % 50000 == 1:
                db.commit(); log(f"  PBF: בניינים {cnt['b']:,} כבישים {cnt['r']:,} שימושי קרקע {cnt['lu']:,}")

    # חיתוך מקדים לתיבת העיגול עם osmium-tool אם קיים (מהיר ובזיכרון נמוך)
    import shutil, subprocess, tempfile
    src = pbf_path
    exe = shutil.which("osmium")
    if exe:
        from yazam.geo import to_wgs
        lo0, la0 = to_wgs(W, S); lo1, la1 = to_wgs(circ.cx + circ.r, circ.cy + circ.r)
        src = tempfile.NamedTemporaryFile(suffix=".osm.pbf", delete=False).name
        subprocess.run([exe, "extract", "-b", f"{lo0},{la0},{lo1},{la1}", "--overwrite", "-o", src, pbf_path], check=True)
    Hd().apply_file(src, locations=True, idx="flex_mem")
    db.commit()
    if src != pbf_path:
        os.unlink(src)
    return cnt["b"], cnt["r"]


# ------------------------------------------------------------------ public height overrides (ממקור ציבורי)
def load_public_overrides(path):
    out = {}
    if not path or not os.path.exists(path):
        return out
    rows = csv.DictReader(l for l in open(path, encoding="utf-8") if not l.startswith("#"))
    for r in rows:
        if r.get("osm_way_id") and r.get("reliability") in ("high", "medium") and (r.get("height_m") or r.get("floors")):
            out[r["osm_way_id"]] = {"h": float(r["height_m"]) if r.get("height_m") else None,
                                    "f": int(float(r["floors"])) if r.get("floors") else None, "ref": r["ref_id"]}
    return out


def load_public_points(path, db):
    """publicdata/ashdod_public_facts.json: רשומות עם נקודת ITM אמיתי (מרכז תכנית/כתובת), קומות או גובה, אמינות high/medium,
    ובניין יחיד (לא קבוצה) → הבניין שמכיל את הנקודה (או הקרוב עד 15 מ'). קבוצות ונקודות בלי בניין – לא משויכות (נרשמות בדוח)."""
    out, log = {}, []
    if not path or not os.path.exists(path):
        return out, log
    recs = json.load(open(path, encoding="utf-8")).get("records", [])
    for r in recs:
        if not (r.get("itm_x") and r.get("itm_y")) or r.get("rel") not in ("high", "medium") or not (r.get("floors") or r.get("height_m")):
            continue
        if r.get("is_group") or (r.get("n_buildings") or 1) > 1:
            log.append([r["ref_id"], "קבוצה – לא משויך"]); continue
        x, y = float(r["itm_x"]), float(r["itm_y"]); pt = Point(x, y)
        k = tile_key(int(x // TILE_M), int(y // TILE_M)); best = None
        for bid, rec in db.execute("select id, rec from b where tile=?", (k,)):
            g = shapely.from_wkb(json.loads(rec)["w"]); d = g.distance(pt)
            if d < 15 and (best is None or d < best[1]):
                best = (bid, d)
        if not best:
            log.append([r["ref_id"], "אין בניין ב-15 מ'"]); continue
        out[best[0]] = {"h": float(r["height_m"]) if r.get("height_m") else None, "f": int(r["floors"]) if r.get("floors") else None, "ref": r["ref_id"]}
        log.append([r["ref_id"], best[0], round(best[1], 1)])
    return out, log


# ------------------------------------------------------------------ tiles
def _write_gz(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(gzip.compress(data, compresslevel=9, mtime=0))
    os.replace(tmp, path)            # אטומי: אריח חצי-כתוב לא קיים אף פעם


def build_tile(db, out, tx, ty, land, land_prep, overrides, stats):
    k = tile_key(tx, ty)
    x0, y0, x1, y1 = tile_bounds(tx, ty)
    fr = box(x0, y0, x1, y1)
    rows = db.execute("select id, rec from b where tile=?", (k,)).fetchall()
    rds = [json.loads(r[0]) for r in db.execute("select rec from r where tile=?", (k,))]
    lus = [json.loads(r[0]) for r in db.execute("select rec from lu where tile=?", (k,))]
    # ים: קו חוף OSM (2017) → יבשה; ים = האריח פחות יבשה
    if shapely.contains(land_prep, fr):
        land_t = fr; sea = []
    elif not shapely.intersects(land_prep, fr):
        land_t = Polygon(); sea = [fr]
    else:
        land_t = land.intersection(fr); sea = _polys(fr.difference(land_t))
    if not rows and not rds and not lus and not sea:
        return None                          # אריח יבשה בלי נתונים – לא נכתב (הלקוח מצייר קרקע כללית)
    if not rows and not rds and not lus and land_t.is_empty:
        return None                          # ים פתוח – לא נכתב
    blds = []
    for bid, rec in rows:
        d = json.loads(rec)
        g = shapely.from_wkb(d["w"])
        blds.append({"id": bid, "geom": g, "type": d["t"], "name": d["n"], "tags": d.get("tg") or {},
                     "area": g.area, "cx": g.centroid.x, "cy": g.centroid.y, "base": 0.0})
    if blds:
        H.attach_heights(blds, self_calibrate=False)
        for b in blds:
            o = overrides.get(b["id"])
            if o:                            # גובה/קומות ממקור ציבורי (groundtruth, אמינות high/medium)
                grp = H.tgroup(b["type"])
                h = o["h"] if o["h"] else H.floors_to_m(o["f"], grp)
                b.update(h=h, sigma=3.0 if o["h"] else 0.15 * (o["f"] or 1) * 3 + 1.0, floors=o["f"] or H.m_to_floors(h, grp),
                         src="U", conf="בינוני", used=["U"], rejected=[])
                b["floors_lo"] = b["floors_hi"] = b["floors"]
                stats["public_override"] += 1
            stats["src_" + b["src"]] += 1
    recs = [building_record(b, x0, y0) for b in blds]
    for r, b in zip(recs, blds):
        r["he"] = "משוער" if b["src"] in ("R", "N") else ("מ-OSM" if b["src"] in ("H", "L") else ("ממקור ציבורי" if b["src"] == "U" else ""))
        rs = (b.get("tags") or {}).get("roof:shape")
        if rs:
            r["rs"] = rs
    sea_enc = [_enc_poly(p.simplify(1.0), x0, y0) for p in sea if p.area > 25]
    v = {"v": 1, "k": k, "o": [x0, y0], "crs": "EPSG:2039", "b": recs, "rd": rds, "sea": sea_enc, "lu": lus}
    _write_gz(os.path.join(out, "tiles/v", k + ".json.gz"), json.dumps(v, ensure_ascii=False, separators=(",", ":")).encode())
    # קרקע: אין DEM נגיש בארגז החול → שטוח (0.3 מ' ביבשה), מסומן במניפסט "dem: none"
    xs = x0 + np.arange(NT) * TERRAIN_STEP
    ys = y1 - np.arange(NT) * TERRAIN_STEP
    X, Y = np.meshgrid(xs, ys)
    lp = shapely.contains_xy(land_t.buffer(1.0), X, Y) if not land_t.is_empty else np.zeros((NT, NT), bool)
    q = np.where(lp, 3, SEA).astype("<i2")
    mask = rasterize(land_t, x0, y0, MASK_STEP, NM, NM) if not land_t.is_empty else np.zeros((NM, NM), bool)
    hdr = struct.pack("<4sHiiHHH", b"YZT1", 1, tx, ty, NT, NM, TERRAIN_STEP)
    _write_gz(os.path.join(out, "tiles/t", k + ".bin.gz"), hdr + q.tobytes() + pack_bits(mask))
    stats["buildings"] += len(recs); stats["roads"] += len(rds); stats["named_roads"] += sum(1 for r in rds if r["n"])
    stats["landuse"] += len(lus)
    stats["built_m2"] += sum(b["area"] for b in blds)
    return {"n": len(recs), "rd": len(rds), "a": round(sum(b["area"] for b in blds)),
            "hm": round(float(np.mean([b["h"] for b in blds])), 1) if blds else 0, "sea": 1 if sea_enc else 0}


# ------------------------------------------------------------------ overview raster (100 m) for country view + night lights
def build_overview(db, out, circ, tiles_meta):
    """רסטר 100 מ' של שטח בנוי × גובה (uint8) לכל העיגול → PNG אפור. משמש לתצוגת המדינה ולאורות הלילה."""
    from PIL import Image
    cell = 100
    x0 = math.floor((circ.cx - circ.r) / 1000) * 1000; y1 = math.ceil((circ.cy + circ.r) / 1000) * 1000
    n = int(math.ceil(2 * circ.r / cell)) + 20
    dens = np.zeros((n, n), np.float32); hgt = np.zeros((n, n), np.float32)
    for k in tiles_meta:
        for (rec,) in db.execute("select rec from b where tile=?", (k,)):
            d = json.loads(rec)
            g = shapely.from_wkb(d["w"])
            c = g.centroid
            i = int((y1 - c.y) // cell); j = int((c.x - x0) // cell)
            if 0 <= i < n and 0 <= j < n:
                dens[i, j] += g.area
    frac = np.clip(dens / (cell * cell), 0, 1)
    img = (np.sqrt(frac) * 255).astype(np.uint8)
    os.makedirs(os.path.join(out, "nat"), exist_ok=True)
    Image.fromarray(img, "L").save(os.path.join(out, "nat/built100.png"), optimize=True)
    return {"origin_itm": [x0, y1], "cell_m": cell, "size": n, "encoding": "sqrt(built_area_fraction)*255, row 0 = north"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--radius-km", type=float, default=100)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "data"))
    ap.add_argument("--gpkg-buildings", default=os.path.join(HERE, "..", "_dl/TAMA_QGIS_Project/TAMA_buildings.gpkg"))
    ap.add_argument("--gpkg-roads", default=os.path.join(HERE, "..", "_dl/TAMA_QGIS_Project/TAMA_roads.gpkg"))
    ap.add_argument("--pbf", default=None, help="Geofabrik israel-and-palestine-latest.osm.pbf (CI)")
    ap.add_argument("--land", default=os.path.join(HERE, "..", "_dl/land_il.geojson"))
    ap.add_argument("--public", default="/home/claude/swarm/groundtruth/ashdod_reference.csv")
    ap.add_argument("--public-points", default="/home/claude/swarm/publicdata/ashdod_public_facts.json")
    ap.add_argument("--max-tiles", type=int, default=0, help="עצירה אחרי N אריחים (בדיקת חידוש)")
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    logf = open(os.path.join(out, "build.log"), "a", encoding="utf-8")

    def log(s):
        line = time.strftime("%H:%M:%S ") + s
        print(line, flush=True); logf.write(line + "\n"); logf.flush()

    t0 = time.time()
    pp = os.path.join(out, "progress.json")
    prog = json.load(open(pp)) if os.path.exists(pp) else {"ingested": {}, "done": {}, "stages": []}
    circ = Circle(a.radius_km)
    db = open_stage(out)
    src_key = ("pbf:" + os.path.basename(a.pbf)) if a.pbf else "gpkg:TAMA"
    if prog["ingested"].get(src_key, 0) < a.radius_km:
        log(f"קליטה {src_key} לרדיוס {a.radius_km} ק\"מ")
        if a.pbf:
            nb, nr = ingest_pbf(db, circ, a.pbf, log)
        else:
            nb, nr = ingest_gpkg(db, circ, a.gpkg_buildings, a.gpkg_roads, log)
        prog["ingested"][src_key] = a.radius_km
        json.dump(prog, open(pp, "w"), ensure_ascii=False)
        log(f"קליטה הסתיימה: {nb:,} בניינים, {nr:,} כבישים בעיגול ({time.time() - t0:.0f} ש')")
    t_ing = time.time() - t0
    land = shape(json.load(open(a.land))["geometry"])
    land = shapely.transform(land, lambda xy: np.column_stack(__import__("yazam.geo", fromlist=["_tf"])._tf()[0].transform(xy[:, 0], xy[:, 1])))
    land = land.buffer(0)
    land_prep = land
    shapely.prepare(land_prep)
    overrides = load_public_overrides(a.public)
    pts, pts_log = load_public_points(a.public_points, db)
    overrides.update({k: v for k, v in pts.items() if k not in overrides})
    log(f"דריסות גובה ממקור ציבורי: {len(overrides)} (groundtruth + נקודות publicdata: {pts_log})")
    # אריח שמכיל בניין עם דריסה חדשה – נבנה מחדש (גם אם כבר "done")
    prev = prog.get("override_ids", [])
    ids = sorted(set(overrides) | set(prev))
    ov_tiles = {r[0] for r in db.execute(f"select tile from b where id in ({','.join('?' * len(ids))})", ids)} if ids else set()
    if sorted(overrides) != sorted(prev):
        for k in ov_tiles:
            prog["done"].pop(k, None)
        prog["override_ids"] = sorted(overrides)
    from collections import Counter
    stats = Counter()
    all_tiles = list(circ.tiles())
    todo = [t for t in all_tiles if tile_key(*t) not in prog["done"]]
    log(f"אריחים בעיגול: {len(all_tiles):,}; לבנייה: {len(todo):,}")
    t1 = time.time(); written = 0
    for i, (tx, ty) in enumerate(todo):
        m = build_tile(db, out, tx, ty, land, land_prep, overrides, stats)
        prog["done"][tile_key(tx, ty)] = m          # None = אין מה לכתוב (ים פתוח / יבשה בלי נתונים)
        written += 1 if m else 0
        if i % 500 == 0 or i == len(todo) - 1:
            json.dump(prog, open(pp, "w"), ensure_ascii=False)
            log(f"  אריחים {i + 1:,}/{len(todo):,}, נכתבו {written:,} ({time.time() - t1:.0f} ש')")
        if a.max_tiles and i + 1 >= a.max_tiles:
            json.dump(prog, open(pp, "w"), ensure_ascii=False)
            log("עצירה מכוונת (--max-tiles)"); return
    t_tiles = time.time() - t1
    tiles_meta = {k: m for k, m in prog["done"].items() if m}
    in_circle = {tile_key(*t) for t in all_tiles}
    ov = build_overview(db, out, circ, [k for k in tiles_meta if k in in_circle])
    # סיכום מלא מהאריחים (לא רק מהריצה הזאת – כך שהחידוש מדווח נכון)
    tot = {"buildings": 0, "roads_segments": 0, "tiles_written": 0, "built_m2": 0}
    for k, m in tiles_meta.items():
        if k in in_circle:
            tot["buildings"] += m["n"]; tot["roads_segments"] += m["rd"]; tot["tiles_written"] += 1; tot["built_m2"] += m["a"]
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(os.path.join(out, "tiles")) for f in fs)
    circle_km2 = circ.geom.area / 1e6
    land_km2 = land.intersection(circ.geom).area / 1e6
    idx = {"v": 1, "crs": "EPSG:2039", "center_wgs": CENTER, "center_itm": [round(circ.cx, 1), round(circ.cy, 1)],
           "radius_km": a.radius_km, "tile_m": TILE_M,
           "tiles": {k: [m["n"], m["hm"], m["sea"]] for k, m in sorted(tiles_meta.items()) if k in in_circle},
           "overview": dict(ov, png="nat/built100.png"),
           "sources": {"buildings_roads": src_key + (" (Geofabrik free shapefile via github.com/ishusterman/TAMA_QGIS_Project, commit 96800c1, 2026-08-16; covers Tel Aviv metro ring incl. Ashdod only)" if not a.pbf else ""),
                       "coast": "OSM land polygons via npm @geo-maps/earth-lands-1m 0.6.0 (2017-12)",
                       "dem": "none – flat 0.3 m on land (לא ידוע)", "heights": "rule of thumb (משוער) unless OSM height/levels (מ-OSM) or groundtruth public source (ממקור ציבורי)"},
           "attribution": "© OpenStreetMap contributors, ODbL",
           "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    json.dump(idx, open(os.path.join(out, "nat/index.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    st = {"radius_km": a.radius_km, "circle_km2": round(circle_km2), "land_km2_in_circle": round(land_km2),
          "tiles_in_circle": len(all_tiles), **tot, "built_km2": round(tot["built_m2"] / 1e6, 2),
          "tiles_bytes": size, "seconds_ingest": round(t_ing, 1), "seconds_tiles": round(t_tiles, 1),
          "this_run": dict(stats)}
    prog["stages"].append(st)
    json.dump(prog, open(pp, "w"), ensure_ascii=False)
    json.dump(st, open(os.path.join(out, f"nat/stage_{int(a.radius_km)}.json"), "w"), ensure_ascii=False, indent=1)
    log("סיום: " + json.dumps(st, ensure_ascii=False))


if __name__ == "__main__":
    main()
