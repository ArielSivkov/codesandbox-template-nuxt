"""Unit tests on synthetic geometry.  Run:  python -m pytest -q /home/claude/swarm/b7"""
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import methods as M  # noqa: E402


# ------------------------------------------------------------------ synthetic aerial camera
def vertical_photo_x(X, Z, cam_X, H, f):
    """Photo x (same unit as f) of ground point (X, Z) for a vertical camera at (cam_X, H)."""
    return f * (X - cam_X) / (H - Z)


@pytest.mark.parametrize("h_true", [3.5, 12.0, 31.0, 75.0])
def test_stereo_parallax_exact(h_true):
    f, H, B = 152.0, 1520.0, 600.0          # mm, m, m  (1:10,000, 60% overlap on 23 cm frame)
    X = 230.0
    p_base = M.parallax(vertical_photo_x(X, 0, 0, H, f), vertical_photo_x(X, 0, B, H, f))
    p_top = M.parallax(vertical_photo_x(X, h_true, 0, H, f), vertical_photo_x(X, h_true, B, H, f))
    r = M.stereo_parallax_height(H, p_base, p_top - p_base, sigma_dp=0.014)
    assert abs(r["h"] - h_true) < 1e-9
    assert 0.1 < r["sigma"] < 0.5          # ~1 px of 14 um on a 1:10,000 photo
    assert r["method"] == "I_stereo"


def test_stereo_sigma_grows_with_dp_noise():
    a = M.stereo_parallax_height(1520, 60.0, 0.6, sigma_dp=0.01)
    b = M.stereo_parallax_height(1520, 60.0, 0.6, sigma_dp=0.05)
    assert b["sigma"] > 4 * a["sigma"]


@pytest.mark.parametrize("h_true,X", [(9.0, 300.0), (24.0, 500.0), (60.0, 650.0)])
def test_relief_displacement_exact(h_true, X):
    f, H = 152.0, 1520.0
    xb = vertical_photo_x(X, 0, 0, H, f)
    xt = vertical_photo_x(X, h_true, 0, H, f)
    r = M.relief_displacement_height(xt - xb, xt, H, sigma_d=0.02, sigma_r=0.02)
    assert abs(r["h"] - h_true) < 1e-9
    assert r["sigma"] > 0


def test_relief_rejects_nonsense():
    with pytest.raises(ValueError):
        M.relief_displacement_height(5.0, 4.0, 1000, 0.01)


def test_floor_count_matches_b5_convention():
    r = M.floor_count_height(8)                    # 8 storeys residential
    assert r["h"] == pytest.approx(8 * 3.0 + 1.0)  # == B5 floors_to_m(8,"res")
    assert 1.5 < r["sigma"] < 2.5
    r2 = M.floor_count_height(8, count_sigma_floors=0.2)
    assert r2["sigma"] < r["sigma"]
    r3 = M.floor_count_height(4, ground_floor_extra_m=1.5, roof_storey=True)
    assert r3["h"] == pytest.approx(4 * 3 + 1.5 + 1.5 + 1.0)


# ------------------------------------------------------------------ synthetic street camera
def make_camera(cam=(0.0, -25.0, 1.6), yaw_deg=0.0, pitch_deg=12.0, f=1000.0, cx=960, cy=540):
    """World: X east, Y north, Z up. Camera looks along +Y (yaw 0), tilted up by pitch."""
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    fwd = np.array([math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)])
    right = np.array([math.cos(y), -math.sin(y), 0.0])
    down = np.cross(fwd, right)
    R = np.vstack([right, down, fwd])        # rows: camera x (right), y (down), z (forward)
    C = np.asarray(cam, float)

    def proj(Xw):
        Xc = R @ (np.asarray(Xw, float) - C)
        u = K @ Xc
        return u[:2] / u[2]

    def vp(direction):
        u = K @ (R @ np.asarray(direction, float))
        return u
    return proj, vp


@pytest.mark.parametrize("h_true", [6.0, 15.0, 27.5])
def test_single_view_metrology_exact(h_true):
    proj, vp = make_camera()
    corner = (8.0, 0.0, 0.0)                         # building corner on the street front
    door = (2.0, 0.0, 0.0)                           # door of known 2.10 m on same facade line
    v = vp((0, 0, 1))
    horizon = M.vanishing_line(vp((1, 0, 0)), vp((1, 1, 0)))
    r = M.single_view_height(proj(corner), proj((8.0, 0.0, h_true)), v, horizon,
                             proj(door), proj((2.0, 0.0, 2.10)), 2.10, sigma_px=0.0,
                             ref_h_sigma=0.0)
    assert abs(r["h"] - h_true) < 1e-6
    assert r["confidence"] != "מאומת"                # capped: one photo is never "verified"


def test_single_view_vanishing_from_segments_and_noise():
    proj, vp = make_camera(yaw_deg=20.0, pitch_deg=15.0)
    # vertical VP from two vertical edges, horizon from two pairs of horizontal edges
    v = M.vanishing_point((proj((0, 5, 0)), proj((0, 5, 10))), (proj((10, 5, 0)), proj((10, 5, 10))))
    h1 = M.vanishing_point((proj((0, 5, 0)), proj((10, 5, 0))), (proj((0, 5, 6)), proj((10, 5, 6))))
    h2 = M.vanishing_point((proj((0, 5, 0)), proj((0, 15, 0))), (proj((10, 5, 0)), proj((10, 15, 0))))
    hor = M.vanishing_line(h1, h2)
    r = M.single_view_height(proj((10, 5, 0)), proj((10, 5, 18.0)), v, hor,
                             proj((0, 5, 0)), proj((0, 5, 3.0)), 3.0, sigma_px=1.0)
    assert abs(r["h"] - 18.0) < 0.05
    assert 0.2 < r["sigma"] < 3.0                    # MC uncertainty from 1 px clicks


def test_shadow_adapter_uses_b5():
    pytest.importorskip("pyproj")
    if not os.path.isdir(M.B5_PIPELINE):
        pytest.skip("Battalion 5 pipeline not present")
    dt = datetime(2026, 6, 21, 9, 30, tzinfo=timezone.utc)   # ~12:30 Israel summer time
    r = M.shadow_height(5.0, dt, 31.80, 34.65)
    assert r["method"] == "I_shadow" and r["h"] > 10          # sun ~ 75-80 deg high in June


def test_plugs_into_b5_fusion():
    if not os.path.isdir(M.B5_PIPELINE):
        pytest.skip("Battalion 5 pipeline not present")
    sys.path.insert(0, M.B5_PIPELINE)
    from yazam import heights
    M.patch_b5(heights)
    # building with only a rule-of-thumb prior + our stereo + floor-count estimates
    b = {"id": "w1", "tags": {"building": "apartments"}, "type": "apartments", "name": "",
         "area": 600.0, "perimeter": 100.0, "cx": 0.0, "cy": 0.0, "measurements": [],
         "imint": [M.stereo_parallax_height(1520, 92.0, 1.52, sigma_dp=0.014),
                   M.floor_count_height(8)]}
    est = heights.direct_estimates(b)
    keys = [e[0] for e in est]
    assert "I_stereo" in keys and "I_floors" in keys
    f = heights.fuse(est)
    assert f["primary"] == "I_stereo"
    assert abs(f["h"] - 24.8) < 1.0
    stats = heights.attach_heights([b], self_calibrate=False)
    assert b["src"] == "T" and b["conf"] in ("מאומת", "גבוה")
    assert "T" in b["used"] and "K" in b["used"]
