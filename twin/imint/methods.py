"""Battalion 7 - classic photo-interpretation (IMINT) height methods for civil mapping.

Every public estimator returns the same dict, so it plugs straight into Battalion 5's fusion
(/home/claude/swarm/b5/pipeline/yazam/heights.py, fuse() takes (key, h, sigma) tuples):

    {"h": metres, "sigma": 1-sigma metres, "method": key, "confidence": Hebrew label,
     "inputs": {...}, "notes": "..."}

Implemented (all unit-tested on synthetic geometry in test_methods.py):
  1. stereo_parallax_height    h = H*dp / (P + dp)        overlapping vertical aerial photos
  2. relief_displacement_height h = d*H / r               one vertical aerial photo
  3. floor_count_height         h = floors*floor_h + extras   storeys counted on a facade photo
  4. single_view_height         Criminisi-Reid-Zisserman single-view metrology with a reference
  5. shadow_height              adapter around Battalion 5's yazam.shadow (not re-implemented)

Units: any consistent unit for photo measurements (mm on film, or pixels); H in metres above
the GROUND at the building (not above sea level - subtract terrain from DEM first).
All default sigmas below marked (P) are placeholders until calibrated on verified buildings.
"""
from __future__ import annotations

import math
import os
import sys
from typing import Optional, Sequence

import numpy as np

# ------------------------------------------------------------------ shared with Battalion 5
B5_PIPELINE = os.environ.get("YAZAM_B5", "/home/claude/swarm/b5/pipeline")

# same thresholds as B5 heights.CONF (copied so this file also runs without B5 on the path)
CONF = [(1.0, "מאומת"), (2.5, "גבוה"), (5.0, "בינוני"), (math.inf, "נמוך")]

# fusion keys -> one-letter source code (letters not used by B5's SRC_CODE) + Hebrew label
METHODS = {
    "I_stereo": ("T", "סטריאו – פרלקסה מזוג תצלומי אוויר"),
    "I_relief": ("E", "העתק תבליט בתצלום אוויר אנכי"),
    "I_floors": ("K", "ספירת קומות בצילום חזית"),
    "I_svm": ("W", "מטרולוגיה מתמונה אחת (נקודות מגוז)"),
    "I_shadow": ("C", "אורך צל + מיקום השמש"),
}

# Israeli storey assumptions (P) - aligned with B5 heights.FLOOR_H / PARAPET
FLOOR_H = {"res": 3.0, "pub": 4.0, "ind": 5.0, "low": 3.0}
PARAPET = 1.0


def conf_label(sigma: float) -> str:
    for lim, lab in CONF:
        if sigma <= lim:
            return lab
    return CONF[-1][1]


def _result(h, sigma, method, inputs, notes="", cap_conf=None):
    if not (math.isfinite(h) and math.isfinite(sigma)):
        raise ValueError("non-finite estimate")
    lab = conf_label(sigma)
    if cap_conf and [c[1] for c in CONF].index(lab) < [c[1] for c in CONF].index(cap_conf):
        lab = cap_conf
    return {"h": float(h), "sigma": float(sigma), "method": method, "confidence": lab,
            "inputs": inputs, "notes": notes}


# ------------------------------------------------------------------ 1. stereo parallax
def parallax(x_left: float, x_right: float) -> float:
    """Absolute stereoscopic parallax p = x - x' (photo x-coordinates measured along the flight
    line, each relative to its own principal point)."""
    return x_left - x_right


def stereo_parallax_height(H: float, P: float, dp: float, sigma_dp: float,
                           sigma_H: float = 0.0, sigma_P: float = 0.0) -> dict:
    """Height of a building from a stereo pair of near-vertical aerial photos.

    h = H * dp / (P + dp)
      H  - flying height above the building's base (m)
      P  - absolute parallax of the building BASE (photo units; ~ the photo base b)
      dp - parallax difference top minus base (same photo units; parallax bar reading)
    Exact for truly vertical photos at equal flying height (proved in the synthetic test).
    Error: first-order propagation of sigma_dp, sigma_H, sigma_P.
    Typical: 1:10,000 scanned photo at 14 um/px, f=152 mm, 60% overlap -> P~92 mm; reading
    dp to +-1 px (0.014 mm) gives sigma_h ~ H/P*0.014 = 1520/92*0.014 ~ 0.23 m (plus tilt).
    """
    if H <= 0 or P <= 0:
        raise ValueError("H and P must be positive")
    if P + dp <= 0:
        raise ValueError("P + dp must be positive")
    den = P + dp
    h = H * dp / den
    dh_dH = dp / den
    dh_ddp = H * P / den ** 2
    dh_dP = -H * dp / den ** 2
    s = math.sqrt((dh_dH * sigma_H) ** 2 + (dh_ddp * sigma_dp) ** 2 + (dh_dP * sigma_P) ** 2)
    return _result(h, s, "I_stereo", {"H": H, "P": P, "dp": dp, "sigma_dp": sigma_dp},
                   "שיטת פס הפרלקסה; מניח תצלומים אנכיים וגובה טיסה שווה")


# ------------------------------------------------------------------ 2. relief displacement
def relief_displacement_height(d: float, r: float, H: float, sigma_d: float,
                               sigma_r: float = 0.0, sigma_H: float = 0.0) -> dict:
    """Height from relief displacement on ONE vertical photo (top leans away from nadir).

    h = d * H / r
      d - displacement top-to-base along the radial line (photo units)
      r - radial distance from the principal point (nadir) to the TOP (photo units)
      H - flying height above the building's base (m)
    Useless near the nadir (d -> 0); best at the photo edges. Requires a truly vertical photo
    (tilt < ~2-3 deg) and the base visible.
    """
    if r <= 0 or H <= 0:
        raise ValueError("r and H must be positive")
    if d < 0 or d >= r:
        raise ValueError("need 0 <= d < r")
    h = d * H / r
    s = math.sqrt((H / r * sigma_d) ** 2 + (d * H / r ** 2 * sigma_r) ** 2 + (d / r * sigma_H) ** 2)
    return _result(h, s, "I_relief", {"d": d, "r": r, "H": H, "sigma_d": sigma_d},
                   "העתק תבליט; תמונה אנכית בלבד, בסיס הבניין חייב להיראות")


# ------------------------------------------------------------------ 3. floors x storey height
def floor_count_height(floors: int, group: str = "res", floor_h: Optional[float] = None,
                       count_sigma_floors: float = 0.5, floor_h_sigma: float = 0.15,
                       ground_floor_extra_m: float = 0.0, roof_storey: bool = False,
                       parapet: float = PARAPET, parapet_sigma: float = 0.4) -> dict:
    """Height from storeys counted on a ground-level / oblique photo.

    h = floors*floor_h + ground_floor_extra + (0.5*floor_h if roof storey) + parapet
    count_sigma_floors: 0.3 for a clear frontal photo, 0.5 default, 1.0 for partly hidden (P).
    floor_h_sigma: spread of storey height inside one typology (P, calibrate per city).
    ground_floor_extra_m: e.g. +1.0..1.5 for a commercial ground floor or pilotis (P).
    """
    if floors < 1:
        raise ValueError("floors >= 1")
    fh = floor_h if floor_h is not None else FLOOR_H.get(group, 3.0)
    roof = 0.5 * fh if roof_storey else 0.0
    h = floors * fh + ground_floor_extra_m + roof + parapet
    s = math.sqrt((floors * floor_h_sigma) ** 2 + (count_sigma_floors * fh) ** 2 + parapet_sigma ** 2
                  + (0.5 if ground_floor_extra_m else 0.0) ** 2 + ((0.25 * fh) if roof_storey else 0.0) ** 2)
    return _result(h, s, "I_floors", {"floors": floors, "floor_h": fh, "group": group,
                                      "count_sigma_floors": count_sigma_floors},
                   "ספירת קומות × גובה קומה (הנחה 3.0 מ' למגורים, לכייל)")


# ------------------------------------------------------------------ 4. single-view metrology
def _h(p):
    p = np.asarray(p, float)
    return np.array([p[0], p[1], 1.0]) if p.shape[-1] == 2 else p


def vanishing_point(seg_a: Sequence, seg_b: Sequence) -> np.ndarray:
    """Intersection of two image line segments ((x1,y1),(x2,y2)) -> homogeneous point."""
    la = np.cross(_h(seg_a[0]), _h(seg_a[1]))
    lb = np.cross(_h(seg_b[0]), _h(seg_b[1]))
    return np.cross(la, lb)


def vanishing_line(vp1, vp2) -> np.ndarray:
    """Horizon (vanishing line of the ground plane) through two horizontal vanishing points."""
    return np.cross(_h(vp1), _h(vp2))


def _affine_height(b, t, v, l):
    """Criminisi et al. (IJCV 2000) eq. 4:  gamma*Z = -||b x t|| / ((l.b) ||v x t||)
    with homogeneous points normalised to w=1 and l scaled so the sign is consistent."""
    b, t, v, l = _h(b), _h(t), _h(v), np.asarray(l, float)
    b = b / b[2]; t = t / t[2]
    vv = v / v[2] if abs(v[2]) > 1e-12 else v
    num = np.linalg.norm(np.cross(b, t))
    den = (l @ b) * np.linalg.norm(np.cross(vv, t))
    return num / den


def single_view_height(base_px, top_px, v_vert, horizon, ref_base_px, ref_top_px, ref_h: float,
                       sigma_px: float = 1.5, ref_h_sigma: float = 0.02, n_mc: int = 400,
                       seed: int = 0) -> dict:
    """Height of a building edge from ONE photo (e.g. a Mapillary frame) with one reference
    object of known height standing on the same ground plane (door 2.10 m, storey, car, the
    contractor's 2 m staff ...).

      Z / Z_ref = A(b,t) / A(b_ref,t_ref),  A = ||b x t|| / ((l.b) ||v x t||)
    v_vert  - vertical vanishing point (from >= 2 vertical building edges)
    horizon - vanishing line of the ground plane (from 2 horizontal vanishing points)
    Uncertainty: Monte Carlo over pixel noise on the 4 clicked points and on ref_h.
    Assumes lens distortion already removed (Mapillary gives k1,k2) and a flat ground plane.
    """
    l = np.asarray(horizon, float)
    l = l / np.linalg.norm(l[:2])

    def ratio(b, t, rb, rt):
        return _affine_height(b, t, v_vert, l) / _affine_height(rb, rt, v_vert, l)

    r0 = ratio(base_px, top_px, ref_base_px, ref_top_px)
    h = ref_h * r0
    if h <= 0:
        raise ValueError("inconsistent geometry (check horizon/vanishing point)")
    rng = np.random.default_rng(seed)
    pts = np.array([base_px, top_px, ref_base_px, ref_top_px], float)[:, :2]
    sims = []
    for _ in range(n_mc):
        q = pts + rng.normal(0, sigma_px, pts.shape)
        sims.append((ref_h + rng.normal(0, ref_h_sigma)) * ratio(q[0], q[1], q[2], q[3]))
    s = float(np.std(sims))
    # vanishing-point error is not in the MC -> never claim "verified" from one photo
    return _result(h, max(s, 0.03 * h), "I_svm",
                   {"ref_h": ref_h, "sigma_px": sigma_px, "ratio": float(r0)},
                   "מטרולוגיה מתמונה אחת עם עצם ייחוס; שגיאת נקודות המגוז לא נכללה – מינימום 3%",
                   cap_conf="גבוה")


# ------------------------------------------------------------------ 5. shadow (B5 adapter)
def shadow_height(shadow_len_m: float, dt_utc, lat: float, lon: float, len_sigma_m: float = 0.5,
                  elev_sigma_deg: float = 0.1) -> dict:
    """Uses Battalion 5's yazam.shadow.height_from_shadow (NOAA sun ephemeris) unchanged."""
    if B5_PIPELINE not in sys.path:
        sys.path.insert(0, B5_PIPELINE)
    from yazam import shadow  # noqa: WPS433
    r = shadow.height_from_shadow(shadow_len_m, dt_utc, lat, lon, len_sigma_m, elev_sigma_deg)
    return _result(r["h"], r["sigma"], "I_shadow",
                   {"L": shadow_len_m, "sun_elev": r["sun_elev"], "sun_az": r["sun_az"]},
                   "אורך צל על קרקע שטוחה; מימוש של גדוד 5")


# ------------------------------------------------------------------ plug into B5 fusion
def to_fusion(est: dict):
    """-> (source_key, h, sigma) tuple, the format heights.fuse() consumes."""
    return est["method"], est["h"], est["sigma"]


def register_with_b5(heights_module) -> None:
    """Add our keys to B5's SIGMA / SRC_CODE / SRC_HE tables (idempotent, no file edits)."""
    for key, (code, he) in METHODS.items():
        heights_module.SIGMA.setdefault(key, None)          # sigma comes per estimate
        heights_module.SRC_CODE.setdefault(key, code)
        heights_module.SRC_HE.setdefault(code, he)


def patch_b5(heights_module) -> None:
    """Make B5's attach_heights() also read b["imint"] (list of our result dicts).
    Recommended permanent version for B5: 3 lines at the end of direct_estimates():
        for r in b.get("imint", []): est.append((r["method"], r["h"], r["sigma"]))
    """
    register_with_b5(heights_module)
    if getattr(heights_module.direct_estimates, "_b7", False):
        return
    orig = heights_module.direct_estimates

    def direct_estimates(b):
        est = orig(b)
        for r in b.get("imint", []) or []:
            if r.get("sigma") and r["sigma"] > 0 and 1.5 <= r["h"] <= 400:
                est.append(to_fusion(r))
        return est

    direct_estimates._b7 = True
    heights_module.direct_estimates = direct_estimates
