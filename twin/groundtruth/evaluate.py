"""Real accuracy of the twin's building heights in Ashdod, against ashdod_reference.json.

Runs the fusion model (twin/pipeline/yazam/heights.py, unmodified) on the Ashdod sample buildings
exactly as the pipeline does (same inputs: type, name, area, centroid; no direct sources exist in
the sample, so everything falls back to the rule prior), then compares matched buildings with the
reference.

Reference height per building:
  * height_m stated by a source -> used as is ("stated")
  * only floors stated          -> floors_to_m(floors, type-group) ("derived": uses the SAME
    3.0 m/floor + 1 m assumption as the model, so it measures floor-count error only)

Usage: python3 evaluate.py [--all]     (--all also includes reliability=low rows)
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
sys.path.insert(0, HERE)
from yazam import heights as H  # noqa: E402
import sample_io  # noqa: E402

CLASSES = [("1-4 קומות", 1, 4), ("5-9", 5, 9), ("10-16", 10, 16), ("17-30", 17, 30), ("31+", 31, 999)]


def hclass(f):
    for lab, lo, hi in CLASSES:
        if lo <= f <= hi:
            return lab
    return "?"


def run_model():
    S = sample_io.load()
    blds = []
    for b in S.values():
        tags = {"building": b["type"] or "yes"}
        if b["name"]:
            tags["name"] = b["name"]
        blds.append({"id": b["id"], "type": b["type"], "name": b["name"], "area": b["area"],
                     "cx": b["cx"], "cy": b["cy"], "tags": tags, "_tile_h": b["tile_h"]})
    stats = H.attach_heights(blds)
    idx = {b["id"]: b for b in blds}
    # sanity: re-run must reproduce what is in the tiles (dm rounding)
    d = [abs(b["h"] - b["_tile_h"]) for b in blds]
    return idx, stats, float(np.max(d))


def metrics(rows):
    if not rows:
        return None
    e = np.array([r["err_m"] for r in rows])
    z = np.array([abs(r["err_m"]) <= r["sigma"] for r in rows])
    fe = np.array([r["pred_floors"] == r["ref_floors"] for r in rows if r["ref_floors"]])
    rel = np.array([abs(r["err_m"]) / r["ref_h"] for r in rows])
    return {"n": len(rows), "median_abs_m": float(np.median(np.abs(e))), "rmse_m": float(np.sqrt(np.mean(e ** 2))),
            "bias_m": float(np.mean(e)), "in_sigma": float(z.mean()), "floor_exact": float(fe.mean()) if len(fe) else None,
            "median_rel": float(np.median(rel))}


def main():
    use_all = "--all" in sys.argv
    ref = json.load(open(os.path.join(HERE, "ashdod_reference.json"), encoding="utf-8"))
    model, stats, repro = run_model()
    rows = []
    for r in ref["records"]:
        if not r["osm_way_id"] or r["osm_way_id"] not in model:
            continue
        if not (r["use_in_eval"] or (use_all and r["floors"])):
            continue
        b = model[r["osm_way_id"]]
        grp = H.tgroup(b["type"])
        if r["height_m"]:
            ref_h, kind = float(r["height_m"]), "stated"
        elif r["floors"]:
            ref_h, kind = H.floors_to_m(r["floors"], grp), "derived"
        else:
            continue
        ref_f = r["floors"] or H.m_to_floors(ref_h, grp)
        rows.append({"ref_id": r["ref_id"], "name": r["name"], "osm": r["osm_way_id"], "type": b["type"] or "-",
                     "area": b["area"], "ref_floors": ref_f, "ref_h": ref_h, "kind": kind,
                     "pred_h": b["h"], "sigma": b["sigma"], "pred_floors": b["floors"],
                     "flo": b["floors_lo"], "fhi": b["floors_hi"], "src": b["src"], "conf": b["conf"],
                     "err_m": b["h"] - ref_h, "cls": hclass(ref_f), "reliability": r["reliability"],
                     "implied_floor_h": ((ref_h - H.PARAPET) / r["floors"]) if (kind == "stated" and r["floors"]) else None})

    print(f"model re-run reproduces tile heights: max |diff| = {repro:.2f} m; sources used: "
          f"{ {k: v for k, v in stats.items() if not k.startswith('_')} }")
    print(f"\nper building ({'all rows with floors' if use_all else 'use_in_eval=1'}):")
    print(f"{'ref':8} {'osm':12} {'type':10} {'area':>7} {'ref_fl':>6} {'ref_h':>6} {'kind':8} {'pred_h':>6} {'±σ':>5} "
          f"{'pred_fl':>7} {'err_m':>7} {'in±σ':>5} cls")
    for r in rows:
        print(f"{r['ref_id']:8} {r['osm']:12} {r['type'][:10]:10} {r['area']:7.0f} {r['ref_floors']:6d} {r['ref_h']:6.1f} "
              f"{r['kind']:8} {r['pred_h']:6.1f} {r['sigma']:5.1f} {r['pred_floors']:4d}({r['flo']}-{r['fhi']}) "
              f"{r['err_m']:7.1f} {str(abs(r['err_m']) <= r['sigma']):>5} {r['cls']}")

    out = {"all": metrics(rows)}
    for lab, _, _ in CLASSES:
        out[lab] = metrics([r for r in rows if r["cls"] == lab])
    out["stated_height_only"] = metrics([r for r in rows if r["kind"] == "stated"])
    print("\nmetrics:")
    print(f"{'group':20} {'n':>3} {'MedAE m':>8} {'RMSE m':>8} {'bias m':>8} {'in ±σ':>6} {'floor=':>6} {'med rel':>7}")
    for k, m in out.items():
        if not m:
            print(f"{k:20} {0:3d}  (no reference buildings)")
            continue
        fe = "-" if m["floor_exact"] is None else f"{m['floor_exact']:.0%}"
        print(f"{k:20} {m['n']:3d} {m['median_abs_m']:8.1f} {m['rmse_m']:8.1f} {m['bias_m']:8.1f} {m['in_sigma']:6.0%} {fe:>6} {m['median_rel']:7.0%}")
    imp = [r["implied_floor_h"] for r in rows if r["implied_floor_h"]]
    if imp:
        print(f"\nimplied floor-to-floor height where both height and floors are stated: "
              f"{', '.join(f'{x:.2f}' for x in imp)} m  (model assumes {H.FLOOR_H['res']} res / {H.FLOOR_H['pub']} pub)")
    json.dump({"rows": rows, "metrics": out}, open(os.path.join(HERE, "eval_result.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1, default=float)


if __name__ == "__main__":
    main()
