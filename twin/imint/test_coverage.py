"""Tests for coverage.py on synthetic geometry (no network)."""
import json
import os
import sys
import tempfile

import numpy as np
import pytest
from shapely.geometry import box, LineString

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coverage as C  # noqa: E402

OX, OY = 180000.0, 635000.0           # arbitrary ITM point (Ashdod area)


def cam(x, y, heading, fov=60.0, cid="c", date="2025-01-01"):
    return {"id": cid, "x": OX + x, "y": OY + y, "heading": heading, "fov": fov, "date": date,
            "thumb": "", "by": "t", "computed": True}


def bld(i, x0, y0, x1, y1):
    return {"id": i, "geom": box(OX + x0, OY + y0, OX + x1, OY + y1), "type": "", "h": 0, "floors": None}


def status_by_facing(facades, bi):
    out = {}
    for f in facades:
        if f["b"] == bi:
            out[round(f["az"]) % 360] = C.facade_status(f)[0]
    return out


def test_front_seen_back_unseen_and_occlusion():
    blds = [bld("front", -10, 10, 10, 20), bld("behind", -10, 30, 10, 40)]
    fac = C.facades_of(blds)
    C.cast([cam(0, 0, 0.0, 60)], fac, blds)
    f0 = status_by_facing(fac, 0)
    assert f0[180] == "seen"            # south facade faces the camera
    assert f0[0] == "unseen"            # north (back) facade
    f1 = status_by_facing(fac, 1)
    assert all(s == "unseen" for s in f1.values())   # fully hidden behind the front building


def test_field_of_view_respected():
    blds = [bld("b", -10, 10, 10, 20)]
    fac = C.facades_of(blds)
    C.cast([cam(0, 0, 180.0, 60)], fac, blds)        # looking away
    assert all(C.facade_status(f)[0] == "unseen" for f in fac)
    fac = C.facades_of(blds)
    C.cast([cam(0, 0, 180.0, 360)], fac, blds)       # panorama sees it anyway
    assert status_by_facing(fac, 0)[180] == "seen"


def test_grazing_incidence_rejected():
    blds = [bld("b", 5, 2, 60, 12)]
    fac = C.facades_of(blds)
    C.cast([cam(0, 0, 87.0, 4, )], fac, blds, max_incidence=75)   # ray nearly parallel to south facade
    assert status_by_facing(fac, 0).get(180) == "unseen"


def test_range_limit():
    blds = [bld("far", -10, 100, 10, 110)]
    fac = C.facades_of(blds)
    C.cast([cam(0, 0, 0.0, 60)], fac, blds, max_range=60)
    assert all(C.facade_status(f)[0] == "unseen" for f in fac)


def test_camera_inside_footprint_skipped():
    blds = [bld("b", -10, -10, 10, 10)]
    fac = C.facades_of(blds)
    assert C.cast([cam(0, 0, 0.0)], fac, blds) == 1


def test_hfov_from_camera_parameters():
    assert C.hfov_deg({"is_pano": True}) == 360
    # normalised focal 0.5 on landscape -> tan(half)=1 -> 90 deg
    assert abs(C.hfov_deg({"camera_parameters": [0.5, 0, 0], "width": 4000, "height": 3000}) - 90) < 1e-6
    assert C.hfov_deg({}) == 60.0


def test_b5_tile_ring_roundtrip():
    sys.path.insert(0, C.B5_PIPELINE)
    tiles = pytest.importorskip("yazam.tiles")
    ring = [(166012.3, 630045.6), (166030.0, 630045.6), (166030.0, 630070.1), (166012.3, 630070.1), (166012.3, 630045.6)]
    enc = tiles._enc_ring(ring, 166000, 630000)
    dec = C._dec_ring(enc, 166000, 630000)
    assert np.allclose(dec, ring[:-1], atol=0.06)


def test_end_to_end_mock_outputs():
    imgs, blds, roads, bbox = C.mock_sample()
    cams = [c for c in (C.camera(i) for i in imgs) if c]
    with tempfile.TemporaryDirectory() as d:
        s = C.run(cams, blds, roads, bbox, d)
        for n in ("buildings_coverage.geojson", "facades.geojson", "coverage_grid.geojson", "missions.json", "summary.json"):
            assert os.path.exists(os.path.join(d, n))
        fc = json.load(open(os.path.join(d, "facades.geojson"), encoding="utf-8"))
        st = {f["properties"]["status"] for f in fc["features"]}
        assert {"seen", "unseen"} <= st
        assert 0 < s["facade_cov"] < 1
        m = json.load(open(os.path.join(d, "missions.json"), encoding="utf-8"))
        assert m and m[0]["מטר_חזית_לא_מצולם"] >= m[-1]["מטר_חזית_לא_מצולם"]
