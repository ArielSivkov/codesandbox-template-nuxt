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


def test_beach_feeds_both_green_and_maritime_and_duplicates_are_dropped():
    """merge with the vegetation layer: natural=beach is sand for 'green' AND a maritime feature;
    an element returned by two Overpass blocks is kept once."""
    beach = {"type": "way", "id": 50, "tags": {"natural": "beach", "name": "חוף לידו"},
             "geometry": G((31.80, 34.630), (31.80, 34.632), (31.802, 34.632), (31.802, 34.630), (31.80, 34.630))}
    pier = {"type": "way", "id": 51, "tags": {"man_made": "pier"}, "geometry": G((31.81, 34.63), (31.811, 34.629))}
    o = sources_osm.parse_overpass({"elements": [beach, pier, pier]})
    assert [m["kind"] for m in o["maritime"]] == ["beach", "pier"]
    assert o["maritime"][0]["geom"].geom_type == "Polygon"
    assert len(o["green"]) == 1                          # still in the vegetation layer
    assert all(len(v) == 0 for k, v in o.items() if k in ("buildings", "roads", "coast"))


def test_query_has_maritime_block_and_mar_kinds_order_is_stable():
    q = sources_osm.overpass_query((34.6, 31.7, 34.7, 31.9))
    assert 'nwr["seamark:type"]' in q and 'way["leisure"="marina"]' in q
    assert q.count('"natural"="beach"') == 0 or 'beach' in q.split('node["natural"="tree"]')[0]
    assert sources_osm.MAR_KINDS[0] == "breakwater" and sources_osm.MAR_KINDS[13] == "beach"


def test_build_city_end_to_end_writes_mar_layer():
    """the whole CLI (GeoJSON input) carries a breakwater into the 'mar' layer of the vector tiles"""
    import glob
    import build_city
    def poly(w, s, e, n):
        return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}
    F = [{"type": "Feature", "properties": {"kind": "building", "id": "w1", "tags": {"building": "yes", "building:levels": "4"}},
          "geometry": poly(34.650, 31.800, 34.6503, 31.8003)},
         {"type": "Feature", "properties": {"kind": "coast"}, "geometry": {"type": "LineString", "coordinates": [[34.64, 31.82], [34.64, 31.79]]}},
         {"type": "Feature", "properties": {"kind": "maritime", "id": "w9", "tags": {"man_made": "breakwater", "name": "שובר"}},
          "geometry": {"type": "LineString", "coordinates": [[34.638, 31.80], [34.636, 31.805]]}}]
    with tempfile.TemporaryDirectory() as d:
        gj = os.path.join(d, "in.geojson")
        json.dump({"type": "FeatureCollection", "features": F}, open(gj, "w"))
        out = os.path.join(d, "out")
        build_city.main(["--osm", "geojson", "--geojson", gj, "--dem", "none", "--no-green",
                         "--bbox", "34.635,31.795,34.66,31.81", "--slug", "e2e", "--out", out])
        recs = []
        for f in glob.glob(os.path.join(out, "**", "tiles", "v", "*.gz"), recursive=True):
            recs += json.loads(gzip.open(f).read()).get("mar", [])
        assert recs and all(r["i"] == "w9" and r["k"] == sources_osm.MAR_KINDS.index("breakwater") and r["g"] == "l" for r in recs)
        # the breakwater is ~1.2 km offshore, beyond the estimated study area: its tiles exist, but claim no terrain
        n_off = 0
        for f in glob.glob(os.path.join(out, "**", "tiles", "t", "*.gz"), recursive=True):
            raw = gzip.open(f).read()
            nt = struct.unpack("<4sHiiHHH", raw[:20])[4]
            q = np.frombuffer(raw[20:20 + 2 * nt * nt], "<i2")
            k = os.path.basename(f).split(".")[0]
            v = json.loads(gzip.open(f.replace("/t/", "/v/").replace(".bin.gz", ".json.gz")).read())
            if v.get("mar") and not v["b"]:                       # a pure offshore maritime tile
                assert set(np.unique(q).tolist()) <= {tiles.SEA, tiles.OUTSIDE}, k
                n_off += 1
        assert n_off >= 1
