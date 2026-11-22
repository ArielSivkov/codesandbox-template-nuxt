"""Unit tests – run: python -m pytest -q tests  (or: python tests/test_pipeline.py)"""
import gzip
import json
import math
import os
import struct
import sys
import tempfile
from datetime import datetime, timezone

import numpy as np
from shapely.geometry import LineString, Polygon, box

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from yazam import heights, landmask, shadow, tiles  # noqa: E402


def test_coastline_left_is_land():
    frame = (0, 0, 1000, 1000)
    # coast runs north -> south at x=400; OSM rule: land on the LEFT = east side
    coast = LineString([(400, 1200), (400, -200)])
    land = landmask.land_polygon_from_coastline([coast], frame)
    assert land.contains(box(500, 100, 900, 900).centroid)
    assert not land.contains(box(0, 0, 300, 1000).centroid)
    assert abs(land.area - 600 * 1000) < 1


def test_dangling_coast_extended():
    frame = (0, 0, 1000, 1000)
    coast = LineString([(400, 900), (400, 100)])          # stops inside the frame
    land = landmask.land_polygon_from_coastline([coast], frame)
    assert 550_000 < land.area < 650_000


def test_dem_speckles_removed():
    sea = np.zeros((50, 50), bool); sea[:, :20] = True
    sea[30, 40] = True; sea[10, 35] = True                 # inland speckles (SRTM voids)
    sea[25, 5] = False                                     # 1-cell land island in the sea
    c = landmask.clean_dem_sea_mask(sea)
    assert not c[30, 40] and not c[10, 35] and c[25, 5]


def test_qa_counts_sea_components():
    frame = (0, 0, 1000, 1000)
    land = box(400, 0, 1000, 1000).difference(box(600, 600, 620, 620))  # unmapped 'hole'
    q = landmask.qa(land, frame, [])
    assert q["sea_components"] == 2
    q2 = landmask.qa(land, frame, [], water=[box(600, 600, 620, 620)])
    assert q2["sea_components"] == 1


def test_fusion_prefers_precise_and_rejects_outlier():
    est = [("M_floors", 15.7, 1.1), ("L_osm", 16.0, 1.8), ("D_ndsm", 40.0, 6.92)]
    f = heights.fuse(est)
    assert "D_ndsm" in f["rejected"] and f["primary"] == "M_floors"
    assert 15.5 < f["h"] < 16.0 and f["sigma"] < 1.1


def test_levels_and_envelope():
    b = {"tags": {"building:levels": "4"}, "type": "apartments", "area": 500}
    e = heights.direct_estimates(b)
    assert e[0][0] == "L_osm" and abs(e[0][1] - 13.0) < 1e-6
    env = heights.envelope(100.0, 13.0, 1.8)
    assert env["gross"] == 1300 and env["gross_lo"] == 1120 and abs(env["gross_hi"] - 1480) < 1e-9


def test_shadow_height():
    # Ashdod, 21 June 09:00 UTC: sun high; 10 m shadow -> height = 10*tan(elev)
    r = shadow.height_from_shadow(10.0, datetime(2026, 6, 21, 9, 0, tzinfo=timezone.utc), 31.8, 34.65)
    assert 70 < r["sun_elev"] < 82
    assert abs(r["h"] - 10 * math.tan(math.radians(r["sun_elev"]))) < 1e-9


def test_tile_roundtrip():
    d = tempfile.mkdtemp()
    poly = box(166100, 634100, 166130, 634120)
    b = {"id": "w1", "geom": poly, "tags": {}, "type": "apartments", "name": "", "area": poly.area,
         "cx": 166115, "cy": 634110, "base": 12.3, "h": 13.0, "sigma": 1.8, "floors": 4, "floors_lo": 3,
         "floors_hi": 4, "src": "L", "conf": "גבוה", "used": ["L"], "rejected": []}
    land = box(166000, 634000, 167000, 635000).difference(box(166000, 634000, 166100, 635000))
    study = box(166050, 634050, 166950, 634950)
    keys = tiles.write_city(d, {"slug": "t"}, [b], [], land, lambda x, y: np.full(np.shape(x), 12.0), study)
    assert keys == ["166_634"]
    v = json.loads(gzip.decompress(open(os.path.join(d, "tiles/v/166_634.json.gz"), "rb").read()))
    r = v["b"][0]["r"][0]
    x, y, pts = 166000, 634000, []
    for i in range(0, len(r), 2):
        x += r[i] / 10; y += r[i + 1] / 10; pts.append((x, y))
    assert abs(Polygon(pts).area - poly.area) < 0.5
    raw = gzip.decompress(open(os.path.join(d, "tiles/t/166_634.bin.gz"), "rb").read())
    magic, ver, tx, ty, nt, nm, st = struct.unpack("<4sHiiHHH", raw[:20])
    z = np.frombuffer(raw[20:20 + nt * nt * 2], dtype="<i2").reshape(nt, nt)
    assert magic == b"YZT1" and (tx, ty) == (166, 634)
    assert z[20, 0] == tiles.OUTSIDE            # outside the study area
    assert z[20, 2] == tiles.SEA                # x=166050 inside study, sea strip x<166100
    assert z[20, 20] == 120                     # 12.0 m in decimetres


def test_parse_overpass_fixture():
    from yazam import sources_osm
    js = {"elements": [
        {"type": "way", "id": 1, "tags": {"building": "yes", "building:levels": "5"},
         "geometry": [{"lat": 31.8, "lon": 34.64}, {"lat": 31.8, "lon": 34.6402}, {"lat": 31.8002, "lon": 34.6402},
                      {"lat": 31.8002, "lon": 34.64}, {"lat": 31.8, "lon": 34.64}]},
        {"type": "way", "id": 2, "tags": {"natural": "coastline"},
         "geometry": [{"lat": 31.82, "lon": 34.63}, {"lat": 31.78, "lon": 34.62}]},
        {"type": "relation", "id": 3, "tags": {"boundary": "administrative", "admin_level": "8", "name": "x"},
         "members": [{"type": "way", "role": "outer", "geometry": [
             {"lat": 31.7, "lon": 34.6}, {"lat": 31.7, "lon": 34.7}, {"lat": 31.9, "lon": 34.7}, {"lat": 31.9, "lon": 34.6},
             {"lat": 31.7, "lon": 34.6}]}]}]}
    o = sources_osm.parse_overpass(js)
    assert len(o["buildings"]) == 1 and o["buildings"][0]["id"] == "w1"
    assert len(o["coast"]) == 1 and o["boundary"] is not None and o["boundary"].area > 1e8


if __name__ == "__main__":
    n = 0
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); n += 1; print("ok", k)
    print(n, "tests passed")
