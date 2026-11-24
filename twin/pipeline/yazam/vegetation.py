"""Vegetation layer (מחלקת הצמחייה): land cover + every tree / shrub of a 1 km ITM tile.

Additive to the tile contract – existing tiles are never rewritten. New files:

  tiles/g/<tx>_<ty>.json.gz      green layer of one tile
  cities/<slug>/green.json       per-city summary: counts by source, sources, licences, NDVI status

Green tile JSON:
  {"v":1,"k":"164_634","o":[164000,634000],
   "lc_step":10, "lc":"<base64 of 100x100 uint8, row 0 = NORTH>",   # class | 0x80 when ESTIMATED
   "sp":["WASH","FMIC",...],                                         # species codes used in this tile
   "t":[dx_dm,dy_dm,sp_idx,h_dm,src, ...],                           # flat, 5 ints per plant, dm from tile origin
   "stats":{...}}
  src: 0 OSM natural=tree · 1 OSM tree_row · 2 transport street slot · 3 street slot ESTIMATED from road
       4 procedural by land cover (OSM polygon) · 5 procedural in ESTIMATED land cover · 6 NDVI-driven

Determinism: every procedural plant comes from a GLOBAL jittered grid anchored to absolute ITM metres and
hashed per (grid cell, rule). Same input -> byte-identical tiles; tile borders never seam or double-plant.
Nothing here is presented as measured unless it came from OSM / transport / NDVI – see `src` and the
0x80 'estimated' bit of the land-cover raster.
"""
from __future__ import annotations

import base64
import gzip
import json
import math
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TILE = 1000
STEP = 10                  # land-cover raster (same grid as the land/sea mask)
NM = TILE // STEP
EST = 0x80

LC = {"NONE": 0, "LAWN": 1, "PARK": 2, "WOOD": 3, "SCRUB": 4, "SAND": 5, "BEACH": 6, "DUNE": 7, "FARM": 8,
      "ORCHARD": 9, "CEMETERY": 10, "PITCH": 11, "GARDEN": 12, "MEADOW": 13, "SEA": 14, "MOBILE": 15}
LC_HE = {0: "עירוני/לא ידוע", 1: "מדשאה", 2: "פארק", 3: "חורש/יער", 4: "בתה/שיחים", 5: "חול", 6: "חוף",
         7: "חולית מיוצבת", 8: "שדה", 9: "מטע", 10: "בית עלמין", 11: "מגרש ספורט", 12: "גינה/חצר", 13: "אחו",
         14: "ים", 15: "חולית נודדת"}
# when OSM polygons overlap, the higher number wins (a lawn inside a park stays a lawn, a pitch stays a pitch)
PRIORITY = {LC["FARM"]: 1, LC["MEADOW"]: 2, LC["SAND"]: 2, LC["DUNE"]: 3, LC["MOBILE"]: 3, LC["SCRUB"]: 3,
            LC["WOOD"]: 4, LC["PARK"]: 5, LC["ORCHARD"]: 5, LC["BEACH"]: 6, LC["CEMETERY"]: 6, LC["LAWN"]: 7,
            LC["GARDEN"]: 8, LC["PITCH"]: 9}
SRC = {"osm_tree": 0, "osm_row": 1, "slot": 2, "slot_est": 3, "proc": 4, "proc_est": 5, "ndvi": 6}
ROAD_W = [4.0, 5.0, 7.0, 8.5, 10.0]          # same widths as the game (RW) – c0..c4

# area rules: class -> (grid spacing m, probability, palette, probability when the cell is ESTIMATED)
RULES = {
    LC["PARK"]: (11.0, 0.55, "park", 0.40),
    LC["LAWN"]: (16.0, 0.18, "park", 0.12),
    LC["GARDEN"]: (12.0, 0.33, "garden", 0.22),
    LC["WOOD"]: (6.5, 0.80, "wood", 0.6),
    LC["SCRUB"]: (5.0, 0.45, "scrub", 0.35),
    LC["DUNE"]: (5.0, 0.32, "dune", 0.30),
    LC["MOBILE"]: (6.0, 0.16, "mobile_dune", 0.14),
    LC["SAND"]: (9.0, 0.05, "dune", 0.04),
    LC["CEMETERY"]: (9.0, 0.40, "cemetery", 0.3),
    LC["ORCHARD"]: (6.0, 0.95, "orchard", 0.9),
}
SHRUB_RULES = {LC["PARK"]: (7.0, 0.10, "park_shrub"), LC["GARDEN"]: (6.0, 0.10, "park_shrub")}
# שטח פתוח טבעי שהכלל "פער סגור בעיר = פארק" טועה בו (גדוד "כמו בתמונות", 24.11.2026: 14 צילומים מהפסגה – שיחייה נמוכה,
# עצים בודדים, מבט פתוח לעיר ולנמל). כאן כיסוי *משוער* בלבד (EST) הופך לבתה/שיחים, הצמחים: פלטת natural_open
# (רתם/לענה, זית בודד) — במקום עצי פארק של 9–17 מ'. קואורדינטות במסגרת הדגימה (ITM אמיתי = דגימה + 1507.82/757.76).
NATURAL_OPEN = [
    {"name": "givat-yona-summit", "E": 165103.2, "N": 635061.2, "r": 75.0},   # המגדלור: ITM אמיתי 166611,635819
]
NATURAL_RULE = (5.0, 0.30, "natural_open")


# ---------------------------------------------------------------- species
_SP = None


def species_db():
    global _SP
    if _SP is None:
        p = os.path.join(HERE, "species_veg.json")
        _SP = json.load(open(p, encoding="utf-8"))
        _SP["by_code"] = {s["code"]: s for s in _SP["species"]}
    return _SP


def species_from_tags(tags):
    """OSM tags of a tree -> species code or None. Uses species, genus, taxon, species:he, name, leaf_type."""
    db = species_db()
    for k in ("species", "taxon", "species:en"):
        v = (tags.get(k) or "").strip()
        if v:
            if v in db["osm_species"]:
                return db["osm_species"][v]
            g = v.split()[0].capitalize()
            if g in db["osm_genus"]:
                return db["osm_genus"][g]
    g = (tags.get("genus") or "").strip().capitalize()
    if g in db["osm_genus"]:
        return db["osm_genus"][g]
    for k in ("species:he", "taxon:he", "name:he", "name"):
        v = tags.get(k) or ""
        for he, code in db["osm_he"].items():
            if he in v:
                return code
    lt = tags.get("leaf_type")
    if lt == "needleleaved":
        return "PINU"
    if lt == "palm":
        return "WASH"
    return None


def classify(tags):
    """OSM polygon tags -> land-cover class or None (not vegetation)."""
    n, lu, le = tags.get("natural"), tags.get("landuse"), tags.get("leisure")
    if le in ("pitch", "golf_course", "stadium") or lu == "recreation_ground" and tags.get("sport"):
        return LC["PITCH"]
    if le == "garden":
        return LC["GARDEN"]
    if lu == "grass" or (lu == "village_green"):
        return LC["LAWN"]
    if lu == "cemetery" or tags.get("amenity") == "grave_yard":
        return LC["CEMETERY"]
    if le in ("park", "nature_reserve") and n not in ("sand", "beach") or lu == "recreation_ground":
        return LC["PARK"]
    if lu == "orchard":
        return LC["ORCHARD"]
    if n == "wood" or lu == "forest":
        return LC["WOOD"]
    if n in ("scrub", "heath"):
        return LC["SCRUB"]
    if n == "beach":
        return LC["BEACH"]
    if n == "dune" or (n == "sand" and "dune" in (tags.get("name:en", "") + tags.get("description", "")).lower()):
        return LC["DUNE"]
    if n == "sand":
        return LC["SAND"]
    if lu == "meadow" or n == "grassland":
        return LC["MEADOW"]
    if lu == "farmland":
        return LC["FARM"]
    return None


GREEN_TAGS = ("natural", "landuse", "leisure", "amenity")


def is_green(tags):
    return classify(tags) is not None


# ---------------------------------------------------------------- deterministic hashing (vectorised)
def _mix(a):
    a = a.astype(np.uint64)
    a ^= a >> np.uint64(33); a *= np.uint64(0xff51afd7ed558ccd) & np.uint64(0xFFFFFFFFFFFFFFFF)
    a ^= a >> np.uint64(33); a *= np.uint64(0xc4ceb9fe1a85ec53)
    a ^= a >> np.uint64(33)
    return a


def hash_u(i, j, salt, k):
    """uniform [0,1) per integer grid cell (i,j), rule salt and channel k – independent of tile order."""
    with np.errstate(over="ignore"):
        i = np.asarray(i, dtype=np.int64).astype(np.uint64)
        j = np.asarray(j, dtype=np.int64).astype(np.uint64)
        h = _mix(i * np.uint64(0x9E3779B97F4A7C15) ^ _mix(j + np.uint64(0x632BE59BD9B4E019))
                 ^ np.uint64((salt * 1000003 + k * 7919) & 0xFFFFFFFF))
    return (h >> np.uint64(11)).astype(np.float64) / float(1 << 53)


def fnv(s):
    h = 2166136261
    for ch in s.encode("utf-8"):
        h = ((h ^ ch) * 16777619) & 0xFFFFFFFF
    return h


def pick(palette, u):
    """weighted pick from {code: weight}, u in [0,1) (scalar or array) -> code(s)."""
    items = [(k, v) for k, v in palette.items() if not k.startswith("_")]
    w = np.array([v for _, v in items], float); c = np.cumsum(w) / w.sum()
    idx = np.searchsorted(c, np.asarray(u), side="right")
    idx = np.minimum(idx, len(items) - 1)
    codes = np.array([k for k, _ in items])
    if np.ndim(idx) == 0:
        return str(codes[int(idx)])
    return codes[idx]


def tree_height(code, u):
    s = species_db()["by_code"][code]
    lo, hi = s["h"]
    return lo + (hi - lo) * (0.15 + 0.85 * float(u)) ** 0.9


# ---------------------------------------------------------------- reading the existing tiles
def read_terrain_tile(path):
    b = gzip.open(path).read()
    magic, ver, tx, ty, nt, nm, step = struct.unpack("<4sHiiHHH", b[:20])
    z = np.frombuffer(b[20:20 + nt * nt * 2], "<i2").reshape(nt, nt)
    bits = np.unpackbits(np.frombuffer(b[20 + nt * nt * 2:], np.uint8))[:nm * nm].reshape(nm, nm).astype(bool)
    return {"tx": tx, "ty": ty, "z": z, "land": bits}


def decode_ring(r, ox, oy):
    pts, x, y = [], ox, oy
    for i in range(0, len(r) - 1, 2):
        x += r[i] / 10.0; y += r[i + 1] / 10.0
        pts.append((x, y))
    return pts


# ---------------------------------------------------------------- mosaic (whole city at 10 m)
class Mosaic:
    """All tiles of a city on one 10 m grid so distances (to sea, to buildings) cross tile borders."""

    def __init__(self, keys):
        txy = [tuple(map(int, k.split("_"))) for k in keys]
        self.tx0 = min(t[0] for t in txy); self.ty0 = min(t[1] for t in txy)
        self.tx1 = max(t[0] for t in txy); self.ty1 = max(t[1] for t in txy)
        self.W = (self.tx1 - self.tx0 + 1) * NM; self.H = (self.ty1 - self.ty0 + 1) * NM
        self.x0 = self.tx0 * TILE; self.y1 = (self.ty1 + 1) * TILE      # NW corner
        self.keys = keys

    def slice(self, tx, ty):
        c = (tx - self.tx0) * NM; r = (self.ty1 - ty) * NM
        return slice(r, r + NM), slice(c, c + NM)

    def to_px(self, x, y):
        return (np.asarray(x) - self.x0) / STEP, (self.y1 - np.asarray(y)) / STEP

    def cell(self, x, y):
        c, r = self.to_px(x, y)
        c = np.floor(c).astype(int); r = np.floor(r).astype(int)
        ok = (c >= 0) & (r >= 0) & (c < self.W) & (r < self.H)
        return r, c, ok


def _draw(H, W, polys=(), lines=(), mosaic=None):
    """Rasterise ITM polygons / (line, width) pairs to a bool grid with PIL (cell-centre-ish fill)."""
    from PIL import Image, ImageDraw
    im = Image.new("1", (W, H), 0); d = ImageDraw.Draw(im)
    for ring in polys:
        c, r = mosaic.to_px([p[0] for p in ring], [p[1] for p in ring])
        if len(ring) >= 3:
            d.polygon(list(zip((c - 0.5).tolist(), (r - 0.5).tolist())), fill=1)
    for pts, w in lines:
        c, r = mosaic.to_px([p[0] for p in pts], [p[1] for p in pts])
        d.line(list(zip((c - 0.5).tolist(), (r - 0.5).tolist())), fill=1, width=max(1, int(round(w / STEP))))
    return np.array(im, dtype=bool)


def _rings(geom):
    from shapely.geometry import Polygon, MultiPolygon
    if isinstance(geom, Polygon):
        return [list(geom.exterior.coords)], [list(r.coords) for r in geom.interiors]
    if isinstance(geom, MultiPolygon):
        o, i = [], []
        for g in geom.geoms:
            a, b = _rings(g); o += a; i += b
        return o, i
    return [], []


# ---------------------------------------------------------------- main builder
def build_green(data_dir, keys, green=(), trees=(), rows=(), slots=None, ndvi=None, coast_km=3.0):
    """Returns {key: tile_dict}. green: [{"geom","cls"|None,"tags"}] ITM; trees: [{"x","y","tags"}];
    rows: [{"geom": LineString,"tags"}]; slots: [{"x","y","cls","street"}] from the transport team (ITM) or None;
    ndvi: None or {"x0","y1","step":10,"ndvi": 2-D float array} on the ITM grid (see ndvi_* helpers)."""
    from scipy import ndimage
    db = species_db(); pal = db["palettes"]
    M = Mosaic(keys)
    land = np.zeros((M.H, M.W), bool); have = np.zeros((M.H, M.W), bool)
    blds, res_blds, roads = [], [], []
    for k in keys:
        tx, ty = map(int, k.split("_"))
        t = read_terrain_tile(os.path.join(data_dir, "tiles/t", k + ".bin.gz"))
        rs, cs = M.slice(tx, ty)
        land[rs, cs] = t["land"]; have[rs, cs] = True
        vp = os.path.join(data_dir, "tiles/v", k + ".json.gz")
        if os.path.exists(vp):
            v = json.load(gzip.open(vp))
            ox, oy = v["o"]
            for b in v["b"]:
                ring = decode_ring(b["r"][0], ox, oy)
                blds.append(ring)
                if b.get("a", 0) < 2500 and b.get("t", "") not in ("industrial", "warehouse", "retail", "commercial",
                                                                    "manufacture", "roof", "construction"):
                    res_blds.append(ring)
            for r in v.get("rd", []):
                roads.append({"pts": decode_ring(r["r"], ox, oy), "c": int(r.get("c", 1)), "n": r.get("n", "")})
    land &= have
    bld = _draw(M.H, M.W, polys=blds, mosaic=M)
    res = _draw(M.H, M.W, polys=res_blds, mosaic=M)
    road = _draw(M.H, M.W, lines=[(r["pts"], ROAD_W[min(r["c"], 4)]) for r in roads if r["c"] >= 1], mosaic=M)

    # ---- 1. OSM land cover (priority order)
    lc = np.zeros((M.H, M.W), np.uint8)
    for g in sorted(green, key=lambda g: PRIORITY.get(g.get("cls") if g.get("cls") is not None else classify(g.get("tags", {})), 0)):
        cls = g.get("cls") if g.get("cls") is not None else classify(g.get("tags", {}))
        if cls is None:
            continue
        outer, inner = _rings(g["geom"])
        m = _draw(M.H, M.W, polys=outer, mosaic=M)
        if inner:
            m &= ~_draw(M.H, M.W, polys=inner, mosaic=M)
        lc[m & land] = cls
    lc[~land & have] = LC["SEA"]
    osm_cells = int(((lc != 0) & (lc != LC["SEA"])).sum())

    # ---- 2. ESTIMATED land cover where OSM says nothing (flag 0x80)
    free = land & (lc == 0) & ~bld & ~road
    sea_m = have & ~land
    if sea_m.any():                                                   # inland cities: no beach / dunes
        d_sea = ndimage.distance_transform_edt(~sea_m) * STEP
    else:
        d_sea = np.full(land.shape, 1e9)
    d_sea = np.where(have, d_sea, 1e9)
    d_bld = ndimage.distance_transform_edt(~bld) * STEP
    d_res = ndimage.distance_transform_edt(~res) * STEP
    d_road = ndimage.distance_transform_edt(~road) * STEP
    beach = free & (d_sea <= 60)
    lc[beach] = LC["BEACH"] | EST
    free &= ~beach
    dune_c = free & (d_bld > 100) & (d_road > 25) & (d_sea <= coast_km * 1000)
    lab, n = ndimage.label(dune_c)
    if n:
        area = ndimage.sum(dune_c, lab, index=np.arange(1, n + 1)) * STEP * STEP
        keep = np.zeros(n + 1, bool); keep[1:] = area >= 20000
        dune_c = keep[lab]
    lc[dune_c & (d_sea < 250)] = LC["MOBILE"] | EST
    lc[dune_c & (d_sea >= 250)] = LC["DUNE"] | EST
    free &= ~dune_c
    # an open gap is a (possible) park only when it is ENCLOSED by the city: its connected open area
    # (free cells >= 25 m from buildings, no upper limit) must be small. Open land around isolated
    # buildings belongs to one huge component and is left unknown.
    park_c = free & (d_bld >= 25) & (d_road > 8)
    lab, n = ndimage.label(park_c)
    if n:
        area = ndimage.sum(park_c, lab, index=np.arange(1, n + 1)) * STEP * STEP
        keep = np.zeros(n + 1, bool); keep[1:] = (area >= 2500) & (area <= 100000)
        park_c = keep[lab]
    lc[park_c] = LC["PARK"] | EST
    free &= ~park_c
    yard = free & (d_res <= 20)
    lc[yard] = LC["GARDEN"] | EST
    free &= ~yard
    # open land away from buildings/roads that matched nothing above: annual vegetation (green in
    # winter, straw in summer) – the typical look of unbuilt plots on the coastal plain. ESTIMATED.
    lc[free & (d_bld > 40) & (d_road > 10)] = LC["MEADOW"] | EST
    # שטח פתוח טבעי (NATURAL_OPEN): כיסוי משוער → בתה; OSM אמיתי לא נוגעים
    nat = np.zeros(land.shape, bool)
    if NATURAL_OPEN:
        cy_, cx_ = np.mgrid[0:M.H, 0:M.W]
        CXm = M.x0 + (cx_ + 0.5) * STEP; CYm = M.y1 - (cy_ + 0.5) * STEP
        for z in NATURAL_OPEN:
            nat |= (CXm - z["E"]) ** 2 + (CYm - z["N"]) ** 2 <= z["r"] ** 2
        nat &= land & ~bld & (((lc & EST) > 0) | (lc == 0))
        lc[nat & ~road] = LC["SCRUB"] | EST

    ndvi_m = None
    if ndvi is not None:
        ndvi_m = ndvi_to_mosaic(ndvi, M)
        known = ~np.isnan(ndvi_m)
        est = (lc & EST) > 0; base = lc & 0x7F
        bare = known & est & np.isin(base, [LC["PARK"], LC["GARDEN"], LC["LAWN"]]) & (ndvi_m < 0.18)
        lc[bare] = 0
        grassy = known & land & (lc == 0) & ~bld & ~road & (ndvi_m >= 0.30)
        lc[grassy] = LC["LAWN"] | EST
        lc[known & est & (base == LC["MEADOW"]) & (ndvi_m >= 0.30)] = LC["LAWN"] | EST
        dn = known & np.isin(base, [LC["DUNE"], LC["MOBILE"]]) & est
        lc[dn & (ndvi_m < 0.10)] = LC["MOBILE"] | EST
        lc[dn & (ndvi_m >= 0.20)] = LC["DUNE"] | EST

    # ---- 3. plants
    plants = []          # (x, y, code, h, src)

    def ok_cell(xs, ys, allow_classes=None):
        r, c, ok = M.cell(xs, ys)
        r = np.clip(r, 0, M.H - 1); c = np.clip(c, 0, M.W - 1)
        good = ok & land[r, c] & ~bld[r, c] & ~road[r, c]
        if allow_classes is not None:
            good &= np.isin(lc[r, c] & 0x7F, allow_classes)
        return good

    # 3a OSM single trees
    for t in trees:
        code = species_from_tags(t.get("tags", {})) or pick(pal["street_c1"], hash_u(int(t["x"]), int(t["y"]), 1, 0))
        h = t.get("tags", {}).get("height")
        try:
            h = float(str(h).replace("m", "").strip())
        except Exception:
            h = tree_height(code, hash_u(int(t["x"]), int(t["y"]), 1, 1))
        plants.append((t["x"], t["y"], str(code), h, SRC["osm_tree"]))
    # 3b OSM tree rows: every 8 m
    for rw in rows:
        g = rw["geom"]; L = g.length
        code = species_from_tags(rw.get("tags", {}))
        for s in np.arange(4.0, max(L, 4.01), 8.0):
            p = g.interpolate(float(s))
            c = code or pick(pal["street_c1"], hash_u(int(g.coords[0][0]), int(g.coords[0][1]), 2, 0))
            plants.append((p.x, p.y, str(c), tree_height(c, hash_u(int(p.x), int(p.y), 2, 1)), SRC["osm_row"]))
    # 3c street slots: from transport, or estimated along our own road lines
    if slots:
        for s in slots:
            cls = int(s.get("cls", 1)); key = "street_c%d" % max(1, min(3, cls))
            street = s.get("street", "") or "%d_%d" % (int(s["x"] // 200), int(s["y"] // 200))
            u = (fnv(street + key) % 100000) / 100000.0
            mix = hash_u(int(s["x"] * 10), int(s["y"] * 10), 3, 0)
            code = pick(pal[key], u if mix > 0.15 else hash_u(int(s["x"]), int(s["y"]), 3, 1))
            plants.append((s["x"], s["y"], str(code), tree_height(code, hash_u(int(s["x"]), int(s["y"]), 3, 2)), SRC["slot"]))
    else:
        for r in roads:
            if r["c"] < 1:
                continue
            key = "street_c%d" % min(3, r["c"]); sp = 9.0 if r["c"] >= 3 else 11.0
            off = ROAD_W[min(r["c"], 4)] / 2 + 2.5
            street = r["n"] or "%d_%d" % (int(r["pts"][0][0] // 200), int(r["pts"][0][1] // 200))
            code_street = pick(pal[key], (fnv(street + key) % 100000) / 100000.0)
            pts = np.array(r["pts"]); acc = 0.0
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]; d = b - a; L = float(np.hypot(*d))
                if L < 0.5:
                    continue
                u = d / L; nrm = np.array([-u[1], u[0]])
                ss = np.arange(acc, L, sp)
                acc = (acc - L) % sp
                for side in (-1, 1):
                    P = a + np.outer(ss, u) + side * off * nrm
                    if not len(P):
                        continue
                    qi = np.floor(P[:, 0] / 2).astype(np.int64); qj = np.floor(P[:, 1] / 2).astype(np.int64)
                    occ = hash_u(qi, qj, 4, 0) < 0.62
                    good = ok_cell(P[:, 0], P[:, 1]) & occ
                    r_, c_, _ = M.cell(P[:, 0], P[:, 1])
                    r_ = np.clip(r_, 0, M.H - 1); c_ = np.clip(c_, 0, M.W - 1)
                    good &= ~np.isin(lc[r_, c_] & 0x7F, [LC["BEACH"], LC["SEA"], LC["MOBILE"], LC["DUNE"]])
                    good &= ~nat[r_, c_]                                   # שטח פתוח טבעי: אין עצי רחוב משוערים
                    mix = hash_u(qi, qj, 4, 1)
                    alt = pick(pal[key], hash_u(qi, qj, 4, 2))
                    for k in np.nonzero(good)[0]:
                        code = code_street if mix[k] > 0.15 else str(alt[k])
                        plants.append((float(P[k, 0]), float(P[k, 1]), str(code),
                                       tree_height(code, hash_u(qi[k], qj[k], 4, 3)), SRC["slot_est"]))
    # 3d area rules on a global jittered grid
    def area_rule(cls, spacing, prob, palette, prob_est, salt, mask=None):
        x0, y1 = M.x0, M.y1; x1 = x0 + M.W * STEP; y0 = y1 - M.H * STEP
        I = np.arange(math.floor(x0 / spacing), math.ceil(x1 / spacing))
        J = np.arange(math.floor(y0 / spacing), math.ceil(y1 / spacing))
        II, JJ = np.meshgrid(I, J); II = II.ravel(); JJ = JJ.ravel()
        jit = 0.0 if cls == LC["ORCHARD"] else 0.9
        X = (II + 0.5 + (hash_u(II, JJ, salt, 0) - 0.5) * jit) * spacing
        Y = (JJ + 0.5 + (hash_u(II, JJ, salt, 1) - 0.5) * jit) * spacing
        r, c, ok = M.cell(X, Y)
        r = np.clip(r, 0, M.H - 1); c = np.clip(c, 0, M.W - 1)
        cell = lc[r, c]
        sel = ok & ((cell & 0x7F) == cls) & land[r, c] & ~bld[r, c] & ~road[r, c]
        sel &= nat[r, c] if mask == "nat" else ~nat[r, c]
        est = (cell & EST) > 0
        p = np.where(est, prob_est, prob)
        u = hash_u(II, JJ, salt, 2)
        sel &= u < p
        idx = np.nonzero(sel)[0]
        codes = pick(pal[palette], hash_u(II[idx], JJ[idx], salt, 3))
        hu = hash_u(II[idx], JJ[idx], salt, 4)
        for n_, k in enumerate(idx):
            code = str(codes[n_])
            plants.append((float(X[k]), float(Y[k]), code, tree_height(code, hu[n_]),
                           SRC["proc_est"] if est[k] else SRC["proc"]))

    for cls, (sp_, pr, pa, pe) in RULES.items():
        area_rule(cls, sp_, pr, pa, pe, 10 + cls)
    for cls, (sp_, pr, pa) in SHRUB_RULES.items():
        area_rule(cls, sp_, pr, pa, pr * 0.8, 40 + cls)
    if nat.any():
        area_rule(LC["SCRUB"], NATURAL_RULE[0], NATURAL_RULE[1], NATURAL_RULE[2], NATURAL_RULE[1], 70, mask="nat")

    # 3e NDVI canopy in otherwise unplanted urban cells (tree canopy reads NDVI >= 0.5 at 10 m)
    if ndvi_m is not None:
        r, c = np.nonzero(land & ~bld & ~road & (np.nan_to_num(ndvi_m) >= 0.5) & np.isin(lc & 0x7F, [0, LC["LAWN"], LC["MEADOW"]]))
        X = M.x0 + (c + 0.5) * STEP; Y = M.y1 - (r + 0.5) * STEP
        u = hash_u(c + M.tx0 * NM, r - M.ty1 * NM, 60, 0)
        codes = pick(pal["street_c1"], hash_u(c + M.tx0 * NM, r - M.ty1 * NM, 60, 1))
        for k in np.nonzero(u < 0.6)[0]:
            plants.append((float(X[k]), float(Y[k]), str(codes[k]), tree_height(str(codes[k]), u[k] / 0.6), SRC["ndvi"]))

    # ---- 4. exact clearance from building footprints (the 10 m raster misses small overlaps).
    #      Only generated plants are moved out; mapped OSM trees / transport slots are kept as given.
    P = plants
    if blds and P:
        import shapely
        from shapely.geometry import Polygon as _P
        polys = []
        for ring in blds:
            try:
                g = _P(ring)
                g = g if g.is_valid else g.buffer(0)
                if not g.is_empty:
                    polys.append(g.buffer(1.0, quad_segs=2))
            except Exception:
                pass
        if polys:
            gen = [i for i, p in enumerate(P) if p[4] in (SRC["slot_est"], SRC["proc"], SRC["proc_est"], SRC["ndvi"])]
            pts = shapely.points(np.array([[P[i][0], P[i][1]] for i in gen]))
            hit = shapely.STRtree(polys).query(pts, predicate="within")
            drop = {gen[i] for i in np.unique(hit[0])}
            P = [p for i, p in enumerate(P) if i not in drop]

    # ---- 5. split into tiles
    out = {}
    byt = {}
    for p in P:
        byt.setdefault((int(p[0] // TILE), int(p[1] // TILE)), []).append(p)
    for k in keys:
        tx, ty = map(int, k.split("_"))
        rs, cs = M.slice(tx, ty)
        lct = np.ascontiguousarray(lc[rs, cs])
        pl = sorted(byt.get((tx, ty), []), key=lambda p: (p[4], round(p[1], 1), round(p[0], 1)))
        codes = sorted({p[2] for p in pl}); ci = {c: i for i, c in enumerate(codes)}
        flat = []
        by_src = {}
        for x, y, code, h, src in pl:
            flat += [int(round((x - tx * TILE) * 10)), int(round((y - ty * TILE) * 10)), ci[code], int(round(h * 10)), src]
            by_src[src] = by_src.get(src, 0) + 1
        lt = lct & 0x7F
        landc = max(1, int((lt != LC["SEA"]).sum()))
        stats = {"plants": len(pl), "by_src": {str(k_): v for k_, v in sorted(by_src.items())},
                 "est_cells": int(((lct & EST) > 0).sum()),
                 "osm_cells": int(((lct & EST) == 0).sum() - (lt == 0).sum() - (lt == LC["SEA"]).sum()),
                 "green_frac_est": round(float(np.isin(lt, [1, 2, 3, 4, 9, 10, 11, 12, 13]).sum()) / landc, 3)}
        if ndvi_m is not None:
            nv = ndvi_m[rs, cs]; kn = ~np.isnan(nv)
            stats["ndvi_green_frac"] = round(float((nv[kn] >= 0.3).mean()), 3) if kn.any() else None
        out[k] = {"v": 1, "k": k, "o": [tx * TILE, ty * TILE], "lc_step": STEP,
                  "lc": base64.b64encode(lct.tobytes()).decode(), "sp": codes, "t": flat, "stats": stats}
    out["_summary"] = {"plants": len(P), "osm_cells": osm_cells, "tiles": len(keys),
                       "by_src": {str(s): sum(1 for p in P if p[4] == s) for s in sorted({p[4] for p in P})}}
    return out


# ---------------------------------------------------------------- NDVI (Sentinel-2 L2A, 10 m)
def ndvi_from_l2a(b04_dn, b08_dn, offset=-1000, scale=1e-4):
    """Sentinel-2 L2A digital numbers -> NDVI. Processing baseline >= 04.00 adds BOA_ADD_OFFSET = -1000."""
    r = (np.asarray(b04_dn, float) + offset) * scale
    n = (np.asarray(b08_dn, float) + offset) * scale
    with np.errstate(invalid="ignore", divide="ignore"):
        v = (n - r) / (n + r)
    v[(n + r) <= 0] = np.nan
    return np.clip(v, -1, 1)


def ndvi_to_mosaic(ndvi, M):
    """Resample an ITM-gridded NDVI {"x0","y1","step","ndvi"} onto the mosaic (nearest cell centre)."""
    a = np.asarray(ndvi["ndvi"], float); st = float(ndvi.get("step", 10))
    xs = M.x0 + (np.arange(M.W) + 0.5) * STEP; ys = M.y1 - (np.arange(M.H) + 0.5) * STEP
    ci = np.floor((xs - ndvi["x0"]) / st).astype(int); ri = np.floor((ndvi["y1"] - ys) / st).astype(int)
    R, C = np.meshgrid(ri, ci, indexing="ij")
    ok = (R >= 0) & (C >= 0) & (R < a.shape[0]) & (C < a.shape[1])
    out = np.full((M.H, M.W), np.nan)
    out[ok] = a[R[ok], C[ok]]
    return out


def load_ndvi_npz(path):
    z = np.load(path)
    nd = z["ndvi"].astype(float)
    if nd.dtype.kind in "iu" or nd.max() > 1.5:          # uint8 0..250 = NDVI*125+125 (255 = nodata)
        raw = z["ndvi"]; nd = np.where(raw == 255, np.nan, (raw.astype(float) - 125) / 125.0)
    return {"x0": float(z["x0"]), "y1": float(z["y1"]), "step": float(z["step"]), "ndvi": nd,
            "synthetic": bool(z["synthetic"]) if "synthetic" in z else False,
            "scene": str(z["scene"]) if "scene" in z else ""}


def fetch_sentinel_ndvi(bbox_itm, date_range="2026-06-01/2026-08-31", max_cloud=10):
    """Real path (needs network to earth-search.aws.element84.com + sentinel-cogs.s3): STAC search for
    sentinel-2-l2a, least-cloudy summer scene, read B04/B08 COG windows, reproject to ITM 10 m.
    Raises RuntimeError offline – callers fall back to land-cover rules (all plants then marked estimated)."""
    try:
        import pystac_client  # noqa: F401
        import rasterio  # noqa: F401
    except Exception as ex:   # pragma: no cover - environment dependent
        raise RuntimeError(f"NDVI needs pystac-client + rasterio: {ex}")
    raise RuntimeError("network fetch not implemented in this environment (blocked); see NDVI-DESIGN.txt")


# ---------------------------------------------------------------- writer + CLI
def write_green(out_dir, tiles, slug, sources):
    import time
    keys = [k for k in tiles if not k.startswith("_")]
    for k in keys:
        p = os.path.join(out_dir, "tiles/g", k + ".json.gz")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        data = json.dumps(tiles[k], ensure_ascii=False, separators=(",", ":")).encode()
        with open(p, "wb") as fh:
            fh.write(gzip.compress(data, compresslevel=9, mtime=0))
    summ = dict(tiles.get("_summary", {}))
    summ.update({"v": 1, "layer": "tiles/g", "lc_classes": LC_HE, "src_codes": {
        "0": "OSM natural=tree", "1": "OSM tree_row", "2": "משבצת עץ ממחלקת התחבורה", "3": "משבצת רחוב משוערת מקו הכביש",
        "4": "פרוצדורלי לפי פוליגון OSM", "5": "פרוצדורלי בכיסוי קרקע משוער", "6": "לפי NDVI"},
        "sources": sources, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "licence": "OSM © OpenStreetMap contributors ODbL; Sentinel-2 © Copernicus (if used)"})
    p = os.path.join(out_dir, "cities", slug, "green.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(summ, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return summ


def load_green_geojson(path):
    """FeatureCollection WGS84 (or ITM if crs says 2039): polygons with OSM tags (kind=green), points
    natural=tree (kind=tree), lines natural=tree_row (kind=tree_row). Returns (green, trees, rows)."""
    from shapely.geometry import shape
    from .geo import _tf
    from shapely.ops import transform as shp_transform
    fc = json.load(open(path, encoding="utf-8"))
    itm = "2039" in json.dumps(fc.get("crs", ""))
    fwd = _tf()[0] if not itm else None
    tf = (lambda g: g) if itm else (lambda g: shp_transform(lambda x, y, z=None: fwd.transform(x, y), g))
    green, trees, rows = [], [], []
    for f in fc["features"]:
        p = f.get("properties") or {}
        tags = p.get("tags", p)
        g = tf(shape(f["geometry"]))
        kind = p.get("kind") or ("tree" if tags.get("natural") == "tree" else
                                 "tree_row" if tags.get("natural") == "tree_row" else "green")
        if kind == "tree":
            trees.append({"x": g.x, "y": g.y, "tags": tags})
        elif kind == "tree_row":
            rows.append({"geom": g, "tags": tags})
        elif classify(tags) is not None:
            green.append({"geom": g, "tags": tags, "cls": classify(tags)})
    return green, trees, rows


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description="build tiles/g (vegetation) for an existing city output")
    ap.add_argument("--data", required=True, help="pipeline output dir (has index.json, tiles/, cities/)")
    ap.add_argument("--city", required=True)
    ap.add_argument("--osm-geojson", help="green polygons / trees / tree rows (GeoJSON)")
    ap.add_argument("--slots", help="JSON list of street-tree slots from the transport team [{x,y,cls,street}] ITM")
    ap.add_argument("--ndvi", help=".npz NDVI grid on ITM (see NDVI-DESIGN.txt)")
    ap.add_argument("--out", help="default: --data")
    a = ap.parse_args(argv)
    man = json.load(open(os.path.join(a.data, "cities", a.city, "manifest.json"), encoding="utf-8"))
    green = trees = rows = ()
    sources = {}
    if a.osm_geojson:
        green, trees, rows = load_green_geojson(a.osm_geojson)
        sources["osm_green"] = os.path.basename(a.osm_geojson)
    slots = json.load(open(a.slots, encoding="utf-8")) if a.slots else None
    if slots:
        sources["slots"] = "transport " + os.path.basename(a.slots)
    nd = load_ndvi_npz(a.ndvi) if a.ndvi else None
    if nd:
        sources["ndvi"] = ("SYNTHETIC FIXTURE " if nd["synthetic"] else "Sentinel-2 L2A ") + nd["scene"]
    if not a.osm_geojson:
        sources["land_cover"] = "ESTIMATED from buildings/roads/coast (no OSM green input)"
    tiles = build_green(a.data, man["tiles"], green, trees, rows, slots, nd)
    s = write_green(a.out or a.data, tiles, a.city, sources)
    print(json.dumps({k: v for k, v in s.items() if k != "lc_classes"}, ensure_ascii=False))
    return s


if __name__ == "__main__":
    main()
