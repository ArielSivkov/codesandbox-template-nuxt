#!/usr/bin/env python3
"""תצוגת מדינה/עיר (LOD רחוק) מתוך האריחים שכבר נכתבו – בלי לגעת ב-staging.

פלט (data/nat/):
  overview.png   RGBA, תא 100 מ', שורה 0 = צפון, ITM אמיתי:
                   R = sqrt(שבר שטח בנוי)·255   G = גובה ממוצע משוקלל שטח (מ', עד 255)
                   B = יבשה 255 / ים 0 (קו חוף OSM 2017)   A = 255 בתוך העיגול, 0 מחוצה לו
  overview.json  מטא: origin_itm (פינה צפון-מערבית), cell_m, size, radius_km
  blocks.bin     תאי "גושי עיר" (LOD ביניים): Int16 x,y (בתאים) + Uint8 h, Uint8 frac – רק תאים עם >4% בנוי
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import struct
import sys

import numpy as np
import shapely
from shapely.geometry import shape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from yazam.geo import _tf  # noqa: E402
from yazam.landmask import rasterize  # noqa: E402


def dec_ring(r):
    a = np.cumsum(np.asarray(r, np.float64).reshape(-1, 2), axis=0) / 10.0
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(HERE, "..", "data"))
    ap.add_argument("--land", default=os.path.join(HERE, "..", "_dl/land_il.geojson"))
    ap.add_argument("--cell", type=int, default=100)
    a = ap.parse_args()
    d = os.path.abspath(a.data)
    prog = json.load(open(os.path.join(d, "progress.json")))
    st = prog["stages"][-1] if prog["stages"] else {"radius_km": 100}
    R = st["radius_km"] * 1000
    from build_national import Circle
    circ = Circle(st["radius_km"])
    cell = a.cell
    x0 = math.floor((circ.cx - R) / 1000) * 1000; y1 = math.ceil((circ.cy + R) / 1000) * 1000
    n = int(math.ceil((math.ceil((circ.cx + R) / 1000) * 1000 - x0) / cell))
    area = np.zeros((n, n), np.float64); hsum = np.zeros((n, n), np.float64)
    vdir = os.path.join(d, "tiles/v")
    nb = 0
    for f in os.listdir(vdir):
        if not f.endswith(".json.gz"):
            continue
        v = json.load(gzip.open(os.path.join(vdir, f)))
        ox, oy = v["o"]
        for b in v["b"]:
            r = dec_ring(b["r"][0]); cx = ox + r[:, 0].mean(); cy = oy + r[:, 1].mean()
            i = int((y1 - cy) // cell); j = int((cx - x0) // cell)
            if 0 <= i < n and 0 <= j < n:
                area[i, j] += b["a"]; hsum[i, j] += b["a"] * b["h"] / 10.0
            nb += 1
    frac = np.clip(area / (cell * cell), 0, 1)
    hm = np.where(area > 0, hsum / np.maximum(area, 1e-9), 0)
    land = shape(json.load(open(a.land))["geometry"])
    fwd = _tf()[0]
    land = shapely.transform(land, lambda xy: np.column_stack(fwd.transform(xy[:, 0], xy[:, 1]))).buffer(0)
    lm = rasterize(land, x0, y1 - n * cell, cell, n, n)
    lm = np.asarray(lm, bool)                                 # rasterize: row 0 = north
    X = x0 + (np.arange(n) + 0.5) * cell; Y = y1 - (np.arange(n) + 0.5) * cell
    XX, YY = np.meshgrid(X, Y)
    inside = (XX - circ.cx) ** 2 + (YY - circ.cy) ** 2 <= R * R
    rgba = np.zeros((n, n, 4), np.uint8)
    rgba[..., 0] = (np.sqrt(frac) * 255).astype(np.uint8)
    rgba[..., 1] = np.clip(hm, 0, 255).astype(np.uint8)
    rgba[..., 2] = np.where(lm, 255, 0)
    rgba[..., 3] = np.where(inside, 255, 0)
    from PIL import Image
    os.makedirs(os.path.join(d, "nat"), exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(os.path.join(d, "nat/overview.png"), optimize=True)
    ii, jj = np.nonzero(frac > 0.04)
    buf = bytearray()
    for i, j in zip(ii, jj):
        buf += struct.pack("<hhBB", int(j), int(i), int(min(255, round(hm[i, j]))), int(round(frac[i, j] * 255)))
    open(os.path.join(d, "nat/blocks.bin"), "wb").write(gzip.compress(bytes(buf), 9, mtime=0))
    meta = {"origin_itm_nw": [x0, y1], "cell_m": cell, "size": n, "radius_km": st["radius_km"],
            "center_itm": [round(circ.cx, 1), round(circ.cy, 1)], "buildings_counted": nb, "blocks": int(len(ii)),
            "encoding": "R=sqrt(built fraction)*255, G=area-weighted mean height m, B=land(OSM coast 2017), A=inside circle; row0=north",
            "blocks_bin": "gzip; records <int16 col, int16 row, uint8 h_m, uint8 frac*255> from origin_itm_nw"}
    meta["roads"] = build_roads(d)
    json.dump(meta, open(os.path.join(d, "nat/overview.json"), "w"), ensure_ascii=False, indent=1)
    meta["coast"] = build_coast(d, a.land)
    json.dump(meta, open(os.path.join(d, "nat/overview.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False))


# ------------------------------------------------------------------ כבישים לתצוגה רחוקה (LOD עיר/מדינה)
def _fnv(s):          # == palette.js hashString (FNV-1a על יחידות UTF-16)
    h = 2166136261
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8); h = (h * 16777619) & 0xFFFFFFFF
    return h


def _imul(a, b):
    return (a * b) & 0xFFFFFFFF


def _hash01(n):       # == palette.js hash01
    x = (n & 0xFFFFFFFF) ^ 0x9e3779b9
    x = _imul(x ^ (x >> 16), 0x85ebca6b); x = _imul(x ^ (x >> 13), 0xc2b2ae35); x ^= x >> 16
    return (x & 0xFFFFFFFF) / 4294967296


def lamp_is_led(name, led_share=0.55):   # == palette.js lampTypeForStreet
    return _hash01(_fnv(str(name) or "unnamed")) < led_share


def build_roads(d, min_cls=1, tol=2.5):
    """roads.bin (gzip): רשומות <uint8 flags, uint16 n, int32 x0, int32 y0, (n-1)×(int16 dx, int16 dy)> במטרים ITM.
    flags: bits0-1 = מחלקה, bit2 = פנס לד (אחרת נתרן), לפי אותו גיבוב שם רחוב של מחלקת האטמוספרה."""
    import sqlite3
    from shapely.geometry import LineString
    db = sqlite3.connect(os.path.join(d, "staging.sqlite"))
    buf = bytearray(); n_lines = n_pts = 0
    for tile, rec in db.execute("select tile, rec from r"):
        r = json.loads(rec)
        if r["c"] < min_cls:
            continue
        tx, ty = map(int, tile.split("_"))
        a = dec_ring(r["r"]) + np.array([tx * 1000, ty * 1000])
        if len(a) < 2:
            continue
        ls = LineString(a).simplify(tol)
        c = np.round(np.asarray(ls.coords)).astype(np.int64)
        if len(c) < 2:
            continue
        dd = np.diff(c, axis=0)
        if np.abs(dd).max() > 32767:
            continue
        flags = (r["c"] & 3) | (4 if lamp_is_led(r.get("n", "")) else 0)
        buf += struct.pack("<BHii", flags, len(c), int(c[0, 0]), int(c[0, 1])) + dd.astype("<i2").tobytes()
        n_lines += 1; n_pts += len(c)
    open(os.path.join(d, "nat/roads.bin"), "wb").write(gzip.compress(bytes(buf), 9, mtime=0))
    return {"lines": n_lines, "points": n_pts, "bytes_gz": os.path.getsize(os.path.join(d, "nat/roads.bin")), "min_cls": min_cls, "simplify_m": tol}




def build_coast(d, land_path, tol=3.0):
    """land.json / sea.json: מצולעי יבשה וים בתוך ריבוע הסקירה, ITM במטרים (שלמים) יחסית לפינה הצפון-מערבית.
    קו חוף וקטורי חד (OSM 2017) במקום מדרגות של רסטר 100 מ'."""
    from shapely.geometry import box as _box
    meta = json.load(open(os.path.join(d, "nat/overview.json")))
    x0, y1 = meta["origin_itm_nw"]; W = meta["size"] * meta["cell_m"]
    land = shape(json.load(open(land_path))["geometry"])
    fwd = _tf()[0]
    land = shapely.transform(land, lambda xy: np.column_stack(fwd.transform(xy[:, 0], xy[:, 1]))).buffer(0)
    sq = _box(x0, y1 - W, x0 + W, y1)
    out = {}
    for name, g in (("land", land.intersection(sq)), ("sea", sq.difference(land))):
        polys = [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and p.area > 2000]
        enc = []
        for p in polys:
            p = p.simplify(tol)
            if p.is_empty or p.geom_type != "Polygon":
                continue
            enc.append([[[int(round(x - x0)), int(round(y1 - y))] for x, y in r.coords[:-1]] for r in [p.exterior, *p.interiors]])
        json.dump({"origin_itm_nw": [x0, y1], "frame": "x = E − x0, y = y1 − N (מטרים)", "polys": enc}, open(os.path.join(d, f"nat/{name}.json"), "w"), separators=(",", ":"))
        out[name] = {"polys": len(enc), "vertices": sum(len(r) for p in enc for r in p), "bytes": os.path.getsize(os.path.join(d, f"nat/{name}.json"))}
    return out


if __name__ == "__main__":
    main()
