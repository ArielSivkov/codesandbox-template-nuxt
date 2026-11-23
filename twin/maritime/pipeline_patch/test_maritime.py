"""Maritime patch tests (המחלקה הימית) – run: python -m pytest -q tests/test_maritime.py"""
import gzip
import json
import os
import struct
import sys
import tempfile

import numpy as np
from shapely.geometry import box

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from yazam import sources_osm, tiles, bathy  # noqa: E402

G = lambda *pts: [{"lat": la, "lon": lo} for la, lo in pts]

OVERPASS = {"elements": [
    {"type": "way", "id": 11, "tags": {"man_made": "breakwater", "name": "שובר גלים"}, "geometry": G((31.820, 34.630), (31.830, 34.628), (31.836, 34.633))},
    {"type": "way", "id": 12, "tags": {"man_made": "pier", "floating": "yes", "width": "2.5"}, "geometry": G((31.790, 34.628), (31.790, 34.630))},
    {"type": "way", "id": 13, "tags": {"landuse": "port", "name": "נמל"}, "geometry": G((31.81, 34.64), (31.81, 34.65), (31.82, 34.65), (31.82, 34.64), (31.81, 34.64))},
    {"type": "way", "id": 14, "tags": {"leisure": "marina"}, "geometry": G((31.788, 34.626), (31.788, 34.632), (31.792, 34.632), (31.792, 34.626), (31.788, 34.626))},
    {"type": "way", "id": 15, "tags": {"waterway": "river", "name": "נחל לכיש"}, "geometry": G((31.80, 34.64), (31.805, 34.66))},
    {"type": "node", "id": 16, "lat": 31.825, "lon": 34.645, "tags": {"man_made": "crane", "operator": "x"}},
    {"type": "node", "id": 17, "lat": 31.838, "lon": 34.632, "tags": {"seamark:type": "buoy_lateral", "seamark:buoy_lateral:colour": "red"}},
    {"type": "node", "id": 18, "lat": 31.837, "lon": 34.633, "tags": {"seamark:type": "light_minor", "seamark:light:colour": "green"}},
    {"type": "way", "id": 19, "tags": {"building": "yes", "man_made": "crane"}, "geometry": G((31.8, 34.64), (31.8, 34.6402), (31.8002, 34.6402), (31.8, 34.64))},
]}


def test_parse_overpass_keeps_maritime_tags():
    o = sources_osm.parse_overpass(OVERPASS)
    kinds = sorted(m["kind"] for m in o["maritime"])
    assert kinds == sorted(["breakwater", "pier", "port_area", "marina", "river", "crane", "buoy", "light"])
    bw = next(m for m in o["maritime"] if m["kind"] == "breakwater")
    assert bw["geom"].geom_type == "LineString" and bw["tags"]["name"] == "שובר גלים" and bw["geom"].length > 1000
    port = next(m for m in o["maritime"] if m["kind"] == "port_area")
    assert port["geom"].geom_type == "Polygon" and port["geom"].area > 1e6
    buoy = next(m for m in o["maritime"] if m["kind"] == "buoy")
    assert buoy["tags"]["seamark:buoy_lateral:colour"] == "red" and buoy["id"] == "n17"
    assert len(o["buildings"]) == 1                     # crane-tagged building stays a building


def test_maritime_kind_rules():
    k = sources_osm.maritime_kind
    assert k({"man_made": "groyne"}) == "groyne"
    assert k({"seamark:type": "light_major"}) == "lighthouse"
    assert k({"seamark:type": "beacon_lateral"}) == "beacon"
    assert k({"harbour": "yes"}, closed=True) == "port_area" and k({"harbour": "yes"}) is None
    assert k({"highway": "residential"}) is None


def test_mar_layer_written_and_decodable():
    o = sources_osm.parse_overpass(OVERPASS)
    d = tempfile.mkdtemp()
    bw = next(m for m in o["maritime"] if m["kind"] == "breakwater")
    x0, y0, x1, y1 = bw["geom"].bounds
    study = box(x0 - 500, y0 - 500, x1 + 500, y1 + 500)
    land = box(x1 + 300, y0 - 600, x1 + 2000, y1 + 600)
    keys = tiles.write_city(d, {"slug": "t"}, [], [], land, lambda x, y: np.full(np.shape(x), 3.0), study, maritime=o["maritime"])
    recs = []
    for k in keys:
        v = json.loads(gzip.decompress(open(os.path.join(d, "tiles/v", k + ".json.gz"), "rb").read()))
        for r in v.get("mar", []):
            # decode exactly like swarm/maritime/maritime.js decodeMarLayer
            x, y, pts = v["o"][0], v["o"][1], []
            ring = r["p"] if r["g"] == "p" else r["r"]
            for i in range(0, len(ring), 2):
                x += ring[i] / 10; y += ring[i + 1] / 10; pts.append((x, y))
            recs.append((sources_osm.MAR_KINDS[r["k"]], r["g"], pts, r))
    bws = [r for r in recs if r[0] == "breakwater"]
    assert bws and all(g == "l" for _, g, _, _ in bws)
    total = sum(np.hypot(np.diff([p[0] for p in pts]), np.diff([p[1] for p in pts])).sum() for _, _, pts, _ in bws)
    assert total >= bw["geom"].length * 0.98            # clipped pieces (+50 m overlap) cover the whole line
    buoy = [r for r in recs if r[0] == "buoy"]
    assert buoy and buoy[0][3]["t"]["seamark:buoy_lateral:colour"] == "red"
    pier = [r for r in recs if r[0] == "pier"]
    assert not pier or pier[0][3].get("w") == 2.5


def test_keep_sea_outside_study_area():
    d = tempfile.mkdtemp()
    land = box(166500, 634000, 167000, 635000)                       # sea west of x=166500
    study = box(166400, 634100, 166950, 634900)
    tiles.write_city(d, {"slug": "t"}, [], [], land, lambda x, y: np.full(np.shape(x), 5.0), study, keep_sea_outside=True)
    raw = gzip.decompress(open(os.path.join(d, "tiles/t/166_634.bin.gz"), "rb").read())
    nt = struct.unpack("<4sHiiHHH", raw[:20])[4]
    z = np.frombuffer(raw[20:20 + nt * nt * 2], dtype="<i2").reshape(nt, nt)
    assert z[20, 0] == tiles.SEA                  # open sea outside the study area stays SEA (was OUTSIDE)
    assert z[0, 40] == tiles.OUTSIDE              # land outside the study area is still OUTSIDE
    assert z[20, 30] == 50                        # inside: 5.0 m


def test_bathy_esri_ascii_to_tiles():
    from yazam.geo import to_wgs
    lon0, lat0 = to_wgs(165000, 636000)
    p = os.path.join(tempfile.mkdtemp(), "b.asc")
    nc, nr, cs = 40, 30, 0.002
    xs = lon0 - 0.03 + np.arange(nc) * cs
    rows = []
    for j in range(nr):                       # file rows: north first
        lat = lat0 - 0.03 + (nr - 1 - j) * cs
        rows.append(" ".join(f"{-(34.66 - x) * 1000:.2f}" for x in xs))   # depth grows westward: 1 m per 0.001 deg
    open(p, "w").write(f"ncols {nc}\nnrows {nr}\nxllcenter {lon0 - 0.03}\nyllcenter {lat0 - 0.03}\ncellsize {cs}\nNODATA_value -9999\n" + "\n".join(rows) + "\n")
    g = bathy.EsriAsciiGrid(p)
    assert abs(g.sample(34.62, lat0) - (-40.0)) < 0.01        # file values rounded to cm
    out = tempfile.mkdtemp()
    assert bathy.write_tiles(out, ["165_636"], g) == 1
    raw = gzip.decompress(open(os.path.join(out, "tiles/b/165_636.bin.gz"), "rb").read())
    magic, ver, tx, ty, nt, st = struct.unpack("<4sHiiHH", raw[:18])
    d = np.frombuffer(raw[18:18 + nt * nt * 2], dtype="<i2").reshape(nt, nt)
    lon, lat = to_wgs(165000, 636000)
    assert magic == b"YZB1" and (tx, ty, nt, st) == (165, 636, 41, 25)
    assert abs(d[40, 0] / 10 - (34.66 - lon) * 1000) < 0.2         # SW corner node = (165000, 636000)
    assert (np.diff(d[20].astype(float)) <= 0.001).all()             # shallower toward the east
