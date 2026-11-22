"""Building-height fusion: every source -> one height with ±sigma and a confidence label.

Model
-----
Each source i gives an estimate h_i (metres above ground, roof/parapet top) with a 1-sigma
error s_i.  We (1) anchor on the most precise source, (2) reject sources that disagree with the
anchor by more than 3*sqrt(s_i^2 + s_anchor^2) (outdated DSM, wrong OSM tag, ML failure),
(3) combine the survivors by inverse-variance weighting:  h = sum(h_i/s_i^2)/sum(1/s_i^2),
s = 1/sqrt(sum(1/s_i^2)), floored at the anchor's own systematic floor (SIGMA_FLOOR).

Default sigmas below are PLACEHOLDERS (marked) until `calibrate()` replaces them with the RMSE
measured in each city against verified buildings (contractor-confirmed / official 3D). Published
figures used as conservative defaults are cited in report.md.

Floors <-> metres: h = floors * FLOOR_H[type] + PARAPET.  Israeli residential floor-to-floor
~3.0 m is an ASSUMPTION to calibrate (current page uses 3.0 m too).
"""
from __future__ import annotations

import math
import re
from collections import defaultdict

import numpy as np

FLOOR_H = {"res": 3.0, "pub": 4.0, "ind": 5.0, "low": 3.0}      # m per storey  (assumption)
PARAPET = 1.0                                                     # m roof parapet (assumption)

# 1-sigma (m) defaults.  P = placeholder/assumption, C = conservative published value.
SIGMA = {
    "M_laser":   0.3,   # P: laser distance meter on site
    "M_lidar":   0.5,   # P: phone LiDAR / RoomPlan-style capture
    "M_floors":  None,  # contractor confirmed floor count -> floors*0.15 + 0.5 (P)
    "O_3d":      1.0,   # P: official municipal / Survey-of-Israel 3D model (verify per city)
    "H_osm":     1.5,   # P: OSM height=*
    "L_osm":     None,  # OSM building:levels -> floors*0.25 + 0.8 (P)
    "V_overture": 4.0,  # P: Overture height from non-OSM dataset (origin in sources[].dataset)
    "S_ai":      None,  # street-level photo + vision model -> by confidence (P)
    "P_plan":    None,  # approved plan floors (only if building is newer than plan) (P)
    "G_gba":     8.9,   # C: GlobalBuildingAtlas, worst continental RMSE 1.5-8.9 m (ESSD 2025)
    "F_globfp":  14.6,  # C: 3D-GloBFP, worst sub-regional RMSE 1.9-14.6 m (ESSD 2024)
    "D_ndsm":    6.92,  # C: AW3D30 object-level RMSE (Remote Sens. 2018); only h>=9 m, big roofs
    "B_ghsl":    8.0,   # P: GHSL 100 m cell-average height used as a weak prior
    "N_knn":     None,  # neighbour prior -> MAD-based, >= 3 m
    "R_rule":    6.0,   # P: typology rule of thumb
}
SIGMA_FLOOR = 0.25
SRC_CODE = {"M_laser": "M", "M_lidar": "M", "M_floors": "M", "O_3d": "O", "H_osm": "H", "L_osm": "L",
            "V_overture": "V", "S_ai": "S", "P_plan": "P", "G_gba": "G", "F_globfp": "F",
            "D_ndsm": "D", "B_ghsl": "B", "N_knn": "N", "R_rule": "R"}
SRC_HE = {"M": "נמדד/אושר בשטח", "O": "מודל תלת־ממד רשמי", "H": "גובה מ-OSM", "L": "קומות מ-OSM",
          "V": "Overture", "S": "צילום חזית + AI", "P": "תב\"ע מאושרת", "G": "GlobalBuildingAtlas",
          "F": "3D-GloBFP", "D": "מודל פני שטח פחות קרקע", "B": "GHSL", "N": "בניינים שכנים", "R": "כלל אצבע"}
# Native support for twin/imint methods (sigma comes per estimate).
IMINT_KEYS = {"I_stereo": "T", "I_relief": "E", "I_floors": "K", "I_svm": "W", "I_shadow": "C"}
IMINT_NATIVE = True
for _k, _c in IMINT_KEYS.items():
    SIGMA.setdefault(_k, None)
    SRC_CODE.setdefault(_k, _c)
SRC_HE.update({"T": "סטריאו מתצלומי אוויר", "E": "העתק תבליט בתצלום אנכי", "K": "ספירת קומות בצילום חזית",
               "W": "מדידה מתמונה אחת (נקודות מגוז)", "C": "אורך צל ומיקום השמש"})
CONF = [(1.0, "מאומת"), (2.5, "גבוה"), (5.0, "בינוני"), (math.inf, "נמוך")]

LOW = {"house", "detached", "semidetached_house", "bungalow", "roof", "garage", "garages", "shed",
       "kiosk", "hut", "greenhouse", "cowshed", "carport"}
PUB = {"commercial", "retail", "school", "kindergarten", "university", "college", "public", "civic",
       "synagogue", "townhall", "hospital", "office", "train_station", "transportation", "church",
       "mosque", "sports_hall", "sports_centre", "hotel"}
IND = {"industrial", "warehouse", "manufacture", "hangar"}


def tgroup(t):
    t = t or ""
    if t in LOW: return "low"
    if t in PUB: return "pub"
    if t in IND: return "ind"
    return "res"


def _num(v):
    if v is None:
        return None
    m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)", str(v).replace(",", "."))
    return float(m.group(1)) if m else None


# High-rise residential storeys are taller than 3.0 m. Calibrated on 3 Ashdod towers where both
# height and floors are published (K Towers 1: 142 m/40 fl, Damari tower: 160 m/46 fl and K Towers 2),
# implied floor-to-floor 3.42–3.52 m -> 3.45 m from the 15th floor up (ground truth, twin/groundtruth).
TOWER_FLOOR_H = 3.45
TOWER_FROM = 15


def floors_to_m(f, grp):
    if grp == "res" and f >= TOWER_FROM:
        return f * TOWER_FLOOR_H + PARAPET
    return f * FLOOR_H[grp] + PARAPET


def m_to_floors(h, grp):
    fh = TOWER_FLOOR_H if grp == "res" and (h - PARAPET) / FLOOR_H[grp] >= TOWER_FROM else FLOOR_H[grp]
    return max(1, int(round((h - PARAPET) / fh)))


# ------------------------------------------------------------------ per-source estimators
def direct_estimates(b):
    """b: normalised building dict. Returns list of (source_key, h, sigma). Neighbour/rule
    priors are added later because they need the whole city."""
    tags, grp, est = b.get("tags", {}), tgroup(b.get("type")), []
    anon_floors = []
    for m in b.get("measurements", []):                       # data flywheel – highest value
        if m.get("trust") == "anon":                          # unauthenticated web correction
            if m.get("floors"):
                anon_floors.append(int(m["floors"]))
            continue
        if m.get("height_m"):
            k = "M_laser" if m.get("method") == "laser" else "M_lidar"
            est.append((k, float(m["height_m"]), SIGMA[k]))
        elif m.get("floors"):
            f = int(m["floors"])
            est.append(("M_floors", floors_to_m(f, grp), f * 0.15 + 0.5))
    if anon_floors:
        # Anonymous corrections are untrusted: N identical anonymous votes must not shrink the
        # uncertainty N-fold (that would let one person spamming the same value override real data).
        # Collapse them into ONE estimate at the median, with the single-vote sigma.
        f = int(np.median(anon_floors) + 0.5)
        est.append(("S_ai", floors_to_m(f, grp), math.hypot(1.0 * FLOOR_H[grp], 0.15 * f)))
    if b.get("official_h"):
        est.append(("O_3d", float(b["official_h"]), SIGMA["O_3d"]))
    h = _num(tags.get("height"))
    if h and 2 <= h <= 400:
        mh = _num(tags.get("min_height")) or 0
        est.append(("H_osm", h - mh, SIGMA["H_osm"]))
    lv = _num(tags.get("building:levels"))
    if lv and 1 <= lv <= 120:
        rl = _num(tags.get("roof:levels")) or 0
        est.append(("L_osm", floors_to_m(lv + 0.5 * rl, grp), lv * 0.25 + 0.8))
    ov = b.get("overture")
    if ov and not str(ov.get("height_src", "")).lower().startswith("openstreetmap"):
        if ov.get("height"):
            est.append(("V_overture", float(ov["height"]), SIGMA["V_overture"]))
        elif ov.get("num_floors"):
            f = int(ov["num_floors"])
            est.append(("V_overture", floors_to_m(f, grp), f * 0.3 + 1.0))
    ai = b.get("streetview_ai")
    if ai and ai.get("floors"):
        fs = {"גבוהה": 0.5, "בינונית": 1.0, "נמוכה": 2.0}.get(ai.get("confidence"), 2.0)
        f = int(ai["floors"])
        est.append(("S_ai", floors_to_m(f, grp), math.hypot(fs * FLOOR_H[grp], 0.15 * f)))
    pl = b.get("plan")
    if pl and pl.get("floors") and pl.get("built_after_plan"):
        f = int(pl["floors"])
        est.append(("P_plan", floors_to_m(f, grp), 1.5 * FLOOR_H[grp]))
    for key, fld in (("G_gba", "gba_h"), ("F_globfp", "globfp_h"), ("B_ghsl", "ghsl_h")):
        v = b.get(fld)
        if v and v > 0:
            est.append((key, float(v), b.get(fld + "_sigma") or SIGMA[key]))
    nd = b.get("ndsm_h")
    if nd is not None and nd >= 9 and b.get("area", 0) >= 900 and not b.get("newer_than_dsm"):
        est.append(("D_ndsm", float(nd), SIGMA["D_ndsm"]))
    # Classic photogrammetry / image-interpretation results from twin/imint/methods.py
    # (stereo parallax, relief displacement, floor count, single-view metrology, shadow).
    for r in b.get("imint", []) or []:
        k, hv, sv = r.get("method"), r.get("h"), r.get("sigma")
        if k in IMINT_KEYS and sv and sv > 0 and hv and 1.5 <= hv <= 400:
            est.append((k, float(hv), float(sv)))
    return est


def rule_prior(b):
    """Same spirit as the current page's estimate(), but returns metres + sigma."""
    t, a, name = b.get("type") or "", b.get("area", 0), b.get("name") or ""
    # Rule-of-thumb priors. Sigmas were widened after the Ashdod ground-truth check (23.11.2026):
    # with the old values only 29% of reference buildings fell inside ±σ (target ≈68%).
    if re.search(r"מגדל|טאוו?ר|tower", name, re.I): return 100.0, 45.0   # Ashdod towers: 138–160 m
    if t in LOW: return (4.0 if t == "roof" else 3.5), 1.5
    if (t in PUB or t in IND) and a > 2500: return 20.0, 12.0          # large hospital/office/hotel
    if t in PUB or t in IND: return 8.0, 5.0
    if t == "" and a > 2500: return 12.0, 8.0
    if a <= 150: return 6.0, 3.0
    if a <= 1000: return floors_to_m(4, "res"), SIGMA["R_rule"]
    return floors_to_m(8, "res"), 12.0


# ------------------------------------------------------------------ neighbour prior (kNN)
def knn_prior(buildings, anchors, radius=250.0, k=8):
    """For each building, weighted median height of up to k nearest anchors (buildings with a
    precise direct estimate) of the same type group and similar footprint (log-area
    within 0.7). Returns {index: (h, sigma, n)}."""
    if not anchors:
        return {}
    cell = radius
    grid = defaultdict(list)
    for j in anchors:
        x, y = buildings[j]["cx"], buildings[j]["cy"]
        grid[(int(x // cell), int(y // cell))].append(j)
    out = {}
    for i, b in enumerate(buildings):
        gx, gy = int(b["cx"] // cell), int(b["cy"] // cell)
        la, grp = math.log(max(b["area"], 1)), tgroup(b.get("type"))
        cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if j == i:
                        continue
                    o = buildings[j]
                    d = math.hypot(o["cx"] - b["cx"], o["cy"] - b["cy"])
                    if d > radius or tgroup(o.get("type")) != grp:
                        continue
                    if abs(math.log(max(o["area"], 1)) - la) > 0.7:
                        continue
                    cand.append((d, o["_anchor_h"]))
        if len(cand) < 3:
            continue
        cand.sort()
        cand = cand[:k]
        hs = np.array([c[1] for c in cand]); w = 1.0 / (np.array([c[0] for c in cand]) + 25.0)
        order = np.argsort(hs); cw = np.cumsum(w[order]) / w.sum()
        med = float(hs[order][np.searchsorted(cw, 0.5)])
        mad = float(np.median(np.abs(hs - med))) * 1.4826
        sig = max(3.0, mad) * (1 + 1.5 / math.sqrt(len(cand)))
        out[i] = (med, sig, len(cand))
    return out


# ------------------------------------------------------------------ fusion
def fuse(est):
    if not est:
        return None
    est = sorted(est, key=lambda e: e[2])
    a_key, a_h, a_s = est[0]
    keep = [e for e in est if abs(e[1] - a_h) <= 3 * math.hypot(e[2], a_s)]
    rejected = [e[0] for e in est if e not in keep]
    w = np.array([1 / e[2] ** 2 for e in keep]); h = np.array([e[1] for e in keep])
    hh = float((w * h).sum() / w.sum())
    ss = max(SIGMA_FLOOR, float(1 / math.sqrt(w.sum())))
    return {"h": hh, "sigma": ss, "primary": a_key, "used": [e[0] for e in keep], "rejected": rejected}


def conf_label(s):
    for lim, lab in CONF:
        if s <= lim:
            return lab


def _area_bin(a):
    return 0 if a <= 150 else 1 if a <= 1000 else 2 if a <= 2500 else 3


def attach_heights(buildings, self_calibrate=True, min_anchors=30):
    """Mutates buildings: adds h, sigma, floors, floors_lo/hi, src, conf, used, rejected.

    Self-calibration (per city, automatic): buildings with a precise direct source (sigma<=2 m:
    contractor-confirmed, official 3D, OSM height/levels) are 'anchors'. With >= min_anchors of
    them we measure, leave-one-out, the real error of the neighbour prior and of the rule of
    thumb in THIS city and replace their sigmas – so the ± shown to the contractor is honest
    (target: ~68% of true heights inside ±sigma) and the bias of the rule is removed."""
    direct = [direct_estimates(b) for b in buildings]
    anchors = []
    for i, (b, e) in enumerate(zip(buildings, direct)):
        f = fuse(e)
        if f and f["sigma"] <= max(2.0, 0.15 * f["h"]):   # relative: tall buildings can be anchors too
            b["_anchor_h"] = f["h"]; anchors.append(i)
    knn = knn_prior(buildings, anchors)
    calib = {"anchors": len(anchors)}
    knn_scale, rule_fix = 1.0, {}
    if self_calibrate and len(anchors) >= min_anchors:
        z = [(buildings[i]["_anchor_h"] - knn[i][0]) / knn[i][1] for i in anchors if i in knn]
        if len(z) >= 10:   # scale so that 68% of |z| <= 1
            knn_scale = max(0.8, float(np.percentile(np.abs(z), 68)))
        res = defaultdict(list)
        for i in anchors:
            b = buildings[i]; rh, _ = rule_prior(b)
            res[(tgroup(b.get("type")), _area_bin(b["area"]))].append(b["_anchor_h"] - rh)
        for k, v in res.items():
            if len(v) >= 8:
                v = np.array(v); bias = float(np.mean(v))
                rule_fix[k] = (bias, max(1.0, float(np.percentile(np.abs(v - bias), 68))))
        calib.update({"knn_sigma_scale": round(knn_scale, 2), "rule_bins": {f"{k[0]}:{k[1]}": [round(a, 1), round(b_, 1)] for k, (a, b_) in rule_fix.items()}})
    stats = defaultdict(int)
    for i, (b, e) in enumerate(zip(buildings, direct)):
        e = list(e)
        if i in knn:
            h, s, n = knn[i]
            e.append(("N_knn", h, s * knn_scale))
        if not e:   # rule of thumb only as the last resort (its bias would pull good data)
            rh, rs = rule_prior(b)
            fix = rule_fix.get((tgroup(b.get("type")), _area_bin(b["area"])))
            if fix:
                rh, rs = max(2.5, rh + fix[0]), fix[1]
            e.append(("R_rule", rh, rs))
        f = fuse(e)
        grp = tgroup(b.get("type"))
        b["h"], b["sigma"] = f["h"], f["sigma"]
        b["floors"] = m_to_floors(f["h"], grp)
        b["floors_lo"] = m_to_floors(max(2.5, f["h"] - f["sigma"]), grp)
        b["floors_hi"] = m_to_floors(f["h"] + f["sigma"], grp)
        b["src"] = SRC_CODE[f["primary"]]
        b["conf"] = conf_label(f["sigma"])
        if f["primary"] in ("R_rule", "N_knn") and b["conf"] in ("מאומת", "גבוה"):
            b["conf"] = "בינוני"     # a prior is never shown as high confidence, whatever its sigma
        b["used"] = [SRC_CODE[k] for k in f["used"]]
        b["rejected"] = [SRC_CODE[k] for k in f["rejected"]]
        stats[b["src"]] += 1
    for b in buildings:
        b.pop("_anchor_h", None)
    stats = dict(stats)
    stats["_calibration"] = calib
    return stats


def calibrate(buildings, reference_keys=("M_laser", "M_lidar", "M_floors", "O_3d")):
    """Empirical RMSE of every source vs. the reference subset (verified buildings).
    Run per city after enough contractor confirmations; write result into SIGMA overrides."""
    errs = defaultdict(list)
    for b in buildings:
        e = direct_estimates(b)
        ref = [x for x in e if x[0] in reference_keys]
        if not ref:
            continue
        r = min(ref, key=lambda x: x[2])[1]
        for k, h, s in e:
            if k not in reference_keys:
                errs[k].append(h - r)
        rh, _ = rule_prior(b)
        errs["R_rule"].append(rh - r)
    return {k: {"n": len(v), "bias": float(np.mean(v)), "rmse": float(np.sqrt(np.mean(np.square(v))))}
            for k, v in errs.items() if len(v) >= 5}


def envelope(perimeter, h, sigma, open_ratio=0.2):
    """Facade quantities with uncertainty – what goes into the quote ("בסיס הכמויות")."""
    g = perimeter * h
    return {"gross": g, "gross_lo": perimeter * max(0.0, h - sigma), "gross_hi": perimeter * (h + sigma),
            "net": g * (1 - open_ratio), "rel_err": sigma / h if h else None}
