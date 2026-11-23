"""Vegetation layer tests – run: python -m pytest -q tests/test_vegetation.py"""
import base64
import gzip
import json
import os
import struct
import sys
import tempfile

import numpy as np
import pytest
from shapely.geometry import LineString, Polygon, box

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from yazam import vegetation as V  # noqa: E402
from yazam import sources_osm  # noqa: E402

SAMPLE = os.path.join(os.path.dirname(__file__), "..", "sample-out-ashdod")


# ---------------------------------------------------------------- helpers: tiny synthetic city
def _write_tile(d, tx, ty, land_fn, buildings=(), roads=()):
    """land_fn(x, y)->bool on ITM; buildings: list of ITM rings; roads: (cls, name, [ITM pts])."""
    nt, nm = 41, 100
    os.makedirs(os.path.join(d, "tiles/t"), exist_ok=True); os.makedirs(os.path.join(d, "tiles/v"), exist_ok=True)
    x0, y0 = tx * 1000, ty * 1000
    xs = x0 + (np.arange(nm) + 0.5) * 10; ys = y0 + (np.arange(nm)[::-1] + 0.5) * 10
    X, Y = np.meshgrid(xs, ys)
    mask = np.vectorize(land_fn)(X, Y)
    z = np.full((nt, nt), 50, "<i2")
    hdr = struct.pack("<4sHiiHHH", b"YZT1", 1, tx, ty, nt, nm, 25)
    open(os.path.join(d, "tiles/t", f"{tx}_{ty}.bin.gz"), "wb").write(
        gzip.compress(hdr + z.tobytes() + np.packbits(mask.astype(np.uint8).ravel()).tobytes()))

    def enc(pts):
        out, px, py = [], x0, y0
        for x, y in pts:
            qx, qy = int(round((x - px) * 10)), int(round((y - py) * 10)); out += [qx, qy]; px += qx / 10; py += qy / 10
        return out
    v = {"v": 1, "k": f"{tx}_{ty}", "o": [x0, y0],
         "b": [{"i": f"w{i}", "t": "", "a": Polygon(r).area, "r": [enc(r)]} for i, r in enumerate(buildings)],
         "rd": [{"c": c, "n": n, "r": enc(p)} for c, n, p in roads], "sea": []}
    open(os.path.join(d, "tiles/v", f"{tx}_{ty}.json.gz"), "wb").write(gzip.compress(json.dumps(v).encode()))


def _city(tmp, sea_x=None, blocks=True, roads=True):
    land = (lambda x, y: x > sea_x) if sea_x else (lambda x, y: True)
    b = []
    if blocks:
        for i in range(6):
            for j in range(6):
                cx, cy = 100400 + i * 40, 200300 + j * 40
                b.append([(cx, cy), (cx + 20, cy), (cx + 20, cy + 15), (cx, cy + 15), (cx, cy)])
    rd = [(2, "הרצל", [(100000, 200250), (101000, 200250)])] if roads else []
    _write_tile(tmp, 100, 200, land, b, rd)
    _write_tile(tmp, 101, 200, land, [], [(2, "הרצל", [(101000, 200250), (102000, 200250)])] if roads else [])
    return ["100_200", "101_200"]


def _plants(tile, src=None):
    t = tile["t"]
    out = [(tile["o"][0] + t[i] / 10, tile["o"][1] + t[i + 1] / 10, tile["sp"][t[i + 2]], t[i + 3] / 10, t[i + 4])
           for i in range(0, len(t), 5)]
    return [p for p in out if src is None or p[4] == src]


def _lc(tile):
    return np.frombuffer(base64.b64decode(tile["lc"]), np.uint8).reshape(100, 100)


# ---------------------------------------------------------------- tags
@pytest.mark.parametrize("tags,cls", [
    ({"leisure": "park"}, V.LC["PARK"]), ({"landuse": "grass"}, V.LC["LAWN"]), ({"natural": "wood"}, V.LC["WOOD"]),
    ({"landuse": "forest"}, V.LC["WOOD"]), ({"natural": "scrub"}, V.LC["SCRUB"]), ({"natural": "sand"}, V.LC["SAND"]),
    ({"natural": "beach"}, V.LC["BEACH"]), ({"natural": "dune"}, V.LC["DUNE"]), ({"landuse": "cemetery"}, V.LC["CEMETERY"]),
    ({"landuse": "orchard"}, V.LC["ORCHARD"]), ({"landuse": "farmland"}, V.LC["FARM"]), ({"leisure": "pitch"}, V.LC["PITCH"]),
    ({"leisure": "garden"}, V.LC["GARDEN"]), ({"landuse": "meadow"}, V.LC["MEADOW"]), ({"building": "yes"}, None),
    ({"highway": "residential"}, None)])
def test_classify(tags, cls):
    assert V.classify(tags) == cls


@pytest.mark.parametrize("tags,code", [
    ({"species": "Washingtonia robusta"}, "WASH"), ({"species": "Ficus sycomorus"}, "FSYC"), ({"genus": "Ficus"}, "FMIC"),
    ({"species": "Jacaranda mimosifolia"}, "JACA"), ({"species:he": "צאלון נאה"}, "DELO"), ({"name": "שקמה עתיקה"}, "FSYC"),
    ({"leaf_type": "needleleaved"}, "PINU"), ({"taxon": "Phoenix dactylifera"}, "PHOE"), ({}, None)])
def test_species_from_tags(tags, code):
    assert V.species_from_tags(tags) == code


def test_species_db_has_sources_and_seasons():
    db = V.species_db()
    assert len(db["species"]) >= 15
    for s in db["species"]:
        assert len(s["leaf"]) == 12 and len(s["flower"]) == 12
        assert s["h"][0] <= s["h"][1] and s["crown"][0] <= s["crown"][1]
        assert s["src"] and all(x in db["sources"] for x in s["src"]), s["code"]
    for pal in db["palettes"].values():
        if isinstance(pal, dict):
            assert all(k in db["by_code"] for k in pal if not k.startswith("_"))


# ---------------------------------------------------------------- determinism
def test_hash_is_deterministic_and_uniform():
    a = V.hash_u(np.arange(10000), np.arange(10000) * 3, 7, 1)
    b = V.hash_u(np.arange(10000), np.arange(10000) * 3, 7, 1)
    assert np.array_equal(a, b) and 0.45 < a.mean() < 0.55 and a.min() >= 0 and a.max() < 1
    assert not np.array_equal(a, V.hash_u(np.arange(10000), np.arange(10000) * 3, 8, 1))


def test_build_is_byte_identical(tmp_path):
    keys = _city(str(tmp_path))
    park = {"geom": box(101200, 200400, 101500, 200700), "tags": {"leisure": "park"}}
    o1 = V.build_green(str(tmp_path), keys, [park])
    o2 = V.build_green(str(tmp_path), list(reversed(keys)), [park])
    for k in keys:
        assert json.dumps(o1[k], sort_keys=True) == json.dumps(o2[k], sort_keys=True)


# ---------------------------------------------------------------- land cover + placement rules
def test_osm_park_is_data_and_planted_at_expected_density(tmp_path):
    keys = _city(str(tmp_path))
    park = {"geom": box(101200, 200400, 101500, 200700), "tags": {"leisure": "park"}}
    o = V.build_green(str(tmp_path), keys, [park])
    t = o["101_200"]; lc = _lc(t)
    r0, c0 = 100 - 70, 20                  # a cell well inside the park (row 0 = north)
    assert lc[r0 + 10, c0 + 10] == V.LC["PARK"]            # not flagged estimated
    inside = [p for p in _plants(t, V.SRC["proc"]) if 101200 < p[0] < 101500 and 200400 < p[1] < 200700]
    trees = [p for p in inside if V.species_db()["by_code"][p[2]]["kind"] in ("tree", "palm")]
    exp = 300 * 300 / (11 * 11) * 0.55
    assert 0.7 * exp < len(trees) < 1.3 * exp, (len(trees), exp)


def test_osm_trees_rows_and_slots(tmp_path):
    keys = _city(str(tmp_path))
    trees = [{"x": 101100.0, "y": 200600.0, "tags": {"species": "Delonix regia", "height": "9"}}]
    rows = [{"geom": LineString([(101100, 200800), (101180, 200800)]), "tags": {"genus": "Phoenix"}}]
    slots = [{"x": 100100.0 + i * 12, "y": 200256.0, "cls": 2, "street": "הרצל"} for i in range(20)]
    o = V.build_green(str(tmp_path), keys, [], trees, rows, slots)
    p0 = _plants(o["101_200"], V.SRC["osm_tree"])
    assert len(p0) == 1 and p0[0][2] == "DELO" and abs(p0[0][3] - 9) < 0.05
    pr = _plants(o["101_200"], V.SRC["osm_row"])
    assert len(pr) == 10 and {p[2] for p in pr} == {"PHOE"}
    ps = _plants(o["100_200"], V.SRC["slot"])
    assert len(ps) == 20
    top = max(sum(1 for p in ps if p[2] == c) for c in {p[2] for p in ps})
    assert top >= 0.7 * len(ps)                            # one species per street (85%), a few mixed
    assert not _plants(o["100_200"], V.SRC["slot_est"])    # transport slots replace our estimate


def test_estimated_street_trees_follow_roads_and_avoid_buildings(tmp_path):
    keys = _city(str(tmp_path))
    o = V.build_green(str(tmp_path), keys)
    ps = _plants(o["100_200"], V.SRC["slot_est"]) + _plants(o["101_200"], V.SRC["slot_est"])
    assert len(ps) > 60
    for x, y, code, h, s in ps:
        d = abs(y - 200250)
        assert 5.5 < d < 7.5, d                           # half width 3.5 + 2.5 m
    pal = V.species_db()["palettes"]["street_c2"]
    assert all(p[2] in pal for p in ps)


def test_beach_dune_and_estimated_flag(tmp_path):
    keys = _city(str(tmp_path), sea_x=100150, blocks=False, roads=False)
    o = V.build_green(str(tmp_path), keys)
    lc = _lc(o["100_200"])
    assert (lc[:, 10] & 0x7F == V.LC["SEA"]).all()
    assert (lc[50, 16:20] == (V.LC["BEACH"] | V.EST)).all()          # 10-50 m from the water line
    assert (lc[50, 30] & 0x7F) == V.LC["MOBILE"] and lc[50, 30] & V.EST   # < 250 m from the sea: mobile dune
    assert (lc[50, 80] & 0x7F) == V.LC["DUNE"]                        # stabilised dune further inland
    sp = {p[2] for p in _plants(o["100_200"])}
    assert sp <= {"ARTE", "RETA", "AMMO"}
    assert not [p for p in _plants(o["100_200"]) if p[0] < 100150]    # nothing in the sea


def test_ndvi_formula_and_gating(tmp_path):
    nd = V.ndvi_from_l2a(np.array([1500, 1100]), np.array([4500, 1200]))
    assert abs(nd[0] - (0.35 - 0.05) / (0.35 + 0.05)) < 1e-9 and abs(nd[1] - (0.02 - 0.01) / 0.03) < 1e-9
    keys = _city(str(tmp_path))
    base = V.build_green(str(tmp_path), keys)
    # synthetic fixture: everything bare (0.05) except one irrigated 100x100 m patch (0.6)
    g = np.full((100, 200), 0.05); g[10:20, 150:160] = 0.6
    o = V.build_green(str(tmp_path), keys, ndvi={"x0": 100000, "y1": 201000, "step": 10, "ndvi": g})
    lc0, lc1 = _lc(base["100_200"]), _lc(o["100_200"])
    est_green0 = np.isin(lc0 & 0x7F, [V.LC["PARK"], V.LC["GARDEN"]]).sum()
    est_green1 = np.isin(lc1 & 0x7F, [V.LC["PARK"], V.LC["GARDEN"]]).sum()
    assert est_green0 > 0 and est_green1 == 0                          # bare NDVI removes estimated gardens
    nd_trees = _plants(o["101_200"], V.SRC["ndvi"])
    assert len(nd_trees) > 20 and all(101500 <= p[0] <= 101600 and 200800 <= p[1] <= 200900 for p in nd_trees)
    assert o["101_200"]["stats"]["ndvi_green_frac"] == pytest.approx(0.01, abs=0.002)


def test_overpass_parsing_keeps_green_trees_rows():
    js = {"elements": [
        {"type": "node", "id": 1, "lat": 31.80, "lon": 34.65, "tags": {"natural": "tree", "species": "Ficus microcarpa"}},
        {"type": "way", "id": 2, "tags": {"leisure": "park"}, "geometry": [
            {"lat": 31.80, "lon": 34.65}, {"lat": 31.80, "lon": 34.651}, {"lat": 31.801, "lon": 34.651}, {"lat": 31.80, "lon": 34.65}]},
        {"type": "way", "id": 3, "tags": {"natural": "tree_row"}, "geometry": [{"lat": 31.80, "lon": 34.65}, {"lat": 31.801, "lon": 34.65}]},
    ]}
    o = sources_osm.parse_overpass(js)
    assert len(o["trees"]) == 1 and o["trees"][0]["tags"]["species"] == "Ficus microcarpa"
    assert len(o["green"]) == 1 and o["green"][0]["cls"] == V.LC["PARK"]
    assert len(o["tree_rows"]) == 1 and 100 < o["tree_rows"][0]["geom"].length < 120
    assert "natural" in sources_osm.overpass_query((34.6, 31.7, 34.7, 31.8))


@pytest.mark.skipif(not os.path.exists(os.path.join(SAMPLE, "tiles/t/164_634.bin.gz")), reason="sample tiles missing")
def test_real_sample_no_plants_in_buildings_or_sea():
    keys = ["164_634", "165_634", "164_633", "165_633"]
    o = V.build_green(SAMPLE, keys)
    from shapely import contains_xy
    from shapely.geometry import Polygon as P
    for k in keys:
        t = o[k]
        v = json.load(gzip.open(os.path.join(SAMPLE, "tiles/v", k + ".json.gz")))
        polys = [P(V.decode_ring(b["r"][0], *v["o"])) for b in v["b"]]
        pl = np.array([(p[0], p[1]) for p in _plants(t)])
        if not len(pl):
            continue
        inside = sum(int(contains_xy(q.buffer(0), pl[:, 0], pl[:, 1]).sum()) for q in polys if q.area > 30)
        assert inside <= 0.01 * len(pl), (k, inside, len(pl))    # 10 m raster: allow 1% edge cases
        lc = _lc(t)
        r = np.clip((t["o"][1] + 1000 - pl[:, 1]) // 10, 0, 99).astype(int); c = np.clip((pl[:, 0] - t["o"][0]) // 10, 0, 99).astype(int)
        assert not ((lc[r, c] & 0x7F) == V.LC["SEA"]).any()
