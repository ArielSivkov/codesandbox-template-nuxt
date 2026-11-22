#!/usr/bin/env python3
"""SYNTHETIC experiment: how much does each data source / the contractor correction loop
reduce height error?  Real Ashdod footprints (from the current map) + a SYNTHETIC ground truth
(neighbourhood typologies).  The numbers it prints are about the METHOD, not about Ashdod.

  python tests/simulate_flywheel.py /path/to/yazam/map/index.html
"""
import copy
import math
import random
import sys
import os

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from yazam import heights, yz_sample  # noqa: E402


def make_truth(blds, seed=7):
    rnd = random.Random(seed)
    typ = {}
    for b in blds:
        key = (int(b["cx"] // 250), int(b["cy"] // 250))
        if key not in typ:          # neighbourhood typology (synthetic)
            typ[key] = rnd.choice([1, 2, 3, 4, 4, 4, 8, 9, 12])
        base = typ[key]
        if b["area"] < 120:
            f = rnd.choice([1, 2])
        elif b["area"] > 1500:
            f = max(base, rnd.choice([8, 10, 15, 20]))
        else:
            f = max(1, base + rnd.choice([-1, 0, 0, 0, 1]))
        b["_true_f"] = f
        b["_true_h"] = heights.floors_to_m(f, "res") + rnd.gauss(0, 0.4)


def run(blds, p_osm, p_meas, seed=1):
    rnd = random.Random(seed)
    bs = copy.deepcopy(blds)
    for b in bs:
        b["tags"] = dict(b["tags"]); b["measurements"] = []
        if rnd.random() < p_osm:     # OSM building:levels, sometimes off by one
            b["tags"]["building:levels"] = str(max(1, b["_true_f"] + rnd.choice([0, 0, 0, 0, -1, 1])))
        if rnd.random() < p_meas:    # contractor confirms floors while quoting
            b["measurements"] = [{"floors": b["_true_f"], "method": "manual"}]
    heights.attach_heights(bs)
    test = [b for b in bs if not b["measurements"] and "building:levels" not in b["tags"]]
    err = np.array([b["h"] - b["_true_h"] for b in test])
    sig = np.array([b["sigma"] for b in test])
    within = float(np.mean(np.abs(err) <= sig))
    floors_ok = float(np.mean([b["floors"] == b["_true_f"] for b in test]))
    return len(test), float(np.sqrt(np.mean(err ** 2))), float(np.median(np.abs(err))), within, floors_ok


def main():
    html = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/repo/yazam/map/index.html"
    raw, _, _, _ = yz_sample.to_inputs(yz_sample.load(html))
    blds = []
    for b in raw:
        g = b["geom"]; c = g.representative_point(); t = b["tags"].get("building", "yes")
        blds.append({"id": b["id"], "geom": g, "tags": b["tags"], "type": "" if t == "yes" else t,
                     "name": b["tags"].get("name", ""), "area": g.area, "cx": c.x, "cy": c.y})
    make_truth(blds)
    print("scenario | buildings evaluated (no direct data) | RMSE m | median |err| m | share |err|<=sigma | exact floors")
    for name, po, pm in [("rule only", 0, 0), ("OSM levels 3%", 0.03, 0), ("+ contractors 5%", 0.03, 0.05),
                         ("+ contractors 20%", 0.03, 0.20), ("+ contractors 50%", 0.03, 0.50)]:
        n, rmse, med, within, fo = run(blds, po, pm)
        print(f"{name:18s} | {n:5d} | {rmse:5.2f} | {med:5.2f} | {within:5.2f} | {fo:5.2f}")


if __name__ == "__main__":
    main()
