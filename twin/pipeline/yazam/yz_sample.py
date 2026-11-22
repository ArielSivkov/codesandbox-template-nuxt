"""Adapter: read the CURRENT single-file map (yazam/map/index.html, window.YZ_DATA) as a pipeline
input. Used to test the pipeline offline on real Ashdod OSM footprints + the real SRTM grid.

The current file has NO georeference (no origin / CRS stored). For testing we place its local
(0,0) at an ASSUMED ITM origin. Production runs must use real OSM/Overture data instead, and the
new manifest stores CRS + absolute ITM coordinates so this can never happen again.
"""
from __future__ import annotations

import base64
import json

import numpy as np
from shapely.geometry import Polygon, LineString

ASSUMED_ORIGIN_ITM = (167824.6, 635153.6)   # corrected 23.11.2026 from 3 georeferenced Ashdod landmarks (twin/groundtruth); was (166300, 634400) – off by ~1.7 km


def load(html_path):
    s = open(html_path, encoding="utf-8").read()
    i = s.index("window.YZ_DATA=") + len("window.YZ_DATA=")
    D, _ = json.JSONDecoder().raw_decode(s[i:])
    return D


def to_inputs(D, origin=ASSUMED_ORIGIN_ITM):
    ox, oy = origin
    M = D["meta"]
    GX, GY, STEP, X0, Y1 = M["GX"], M["GY"], M["step"], M["X0"], M["Y1"]
    raw = np.frombuffer(base64.b64decode(D["terrain"]), dtype="<i2").reshape(GY, GX)
    sea = raw == -32768
    dsm = np.where(sea, np.nan, raw / 10.0).astype(np.float32)

    def dem_fn(x, y):
        c = (np.asarray(x) - ox - X0) / STEP
        r = (Y1 - (np.asarray(y) - oy)) / STEP
        c0 = np.clip(np.floor(c).astype(int), 0, GX - 2); r0 = np.clip(np.floor(r).astype(int), 0, GY - 2)
        fc, fr = np.clip(c - c0, 0, 1), np.clip(r - r0, 0, 1)
        d = dsm
        v = (d[r0, c0] * (1 - fc) * (1 - fr) + d[r0, c0 + 1] * fc * (1 - fr)
             + d[r0 + 1, c0] * (1 - fc) * fr + d[r0 + 1, c0 + 1] * fc * fr)
        out = (c < 0) | (r < 0) | (c > GX - 1) | (r > GY - 1)
        return np.where(out, np.nan, v)

    blds = []
    for b in D["b"]:
        rings = []
        for f in b["r"]:
            x = y = 0; pts = []
            for i in range(0, len(f), 2):
                x += f[i]; y += f[i + 1]
                pts.append((ox + x / 10, oy + y / 10))
            rings.append(pts)
        try:
            g = Polygon(rings[0], rings[1:])
            if not g.is_valid:
                g = g.buffer(0)
        except Exception:
            continue
        blds.append({"id": "w" + b["i"], "geom": g,
                     "tags": {"building": b["t"] or "yes", **({"name": b["n"]} if b["n"] else {})}})
    roads = []
    for r in D["rd"]:
        f = r["r"]; x = y = 0; pts = []
        for i in range(0, len(f), 2):
            x += f[i]; y += f[i + 1]; pts.append((ox + x / 10, oy + y / 10))
        if len(pts) >= 2:
            roads.append({"geom": LineString(pts), "cls": r["c"],
                          "name": D["names"][r["n"]] if r["n"] >= 0 else ""})
    grid = {"sea": sea, "X0": ox + X0, "Y1": oy + Y1, "step": STEP, "GX": GX, "GY": GY}
    return blds, roads, dem_fn, grid


def synthetic_coastline(clean_sea, grid):
    """Coastline polyline from a cleaned sea raster, oriented north->south so that land (east)
    is on the LEFT – i.e. the OSM natural=coastline convention. TEST INPUT ONLY."""
    pts = []
    for r in range(grid["GY"]):
        cols = np.where(clean_sea[r])[0]
        if len(cols) == 0:
            continue
        c = cols.max() + 0.5
        pts.append((grid["X0"] + c * grid["step"], grid["Y1"] - r * grid["step"]))
    # extend the last point straight south / west so the line crosses the frame
    if pts:
        pts.append((pts[-1][0] - 3 * grid["step"], pts[-1][1] - 3 * grid["step"]))
        pts.insert(0, (pts[0][0], pts[0][1] + 3 * grid["step"]))
    return LineString(pts).simplify(10)
