#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QUEUE.md Task #2 — Injects the 17 verified Ashdod towers (v0.4.1-rc.2) into twin-world city/tile JSONs.
Guarantees:
1. Injects height_agl_m ONLY (never ASL, preventing +12..14 m terrain double-counting).
2. Attaches sigma_m, height_datum='AGL', levels, and verified source_url on every matched building.
3. Uses 1-to-1 mutual-exclusion matching (OSM way ID first, then closest polygon centroid within match_radius_m)
   so K1, K2 (51.98 m apart), Dimri, and Unitrade (29.60 m apart) never overwrite one another.
"""
import argparse
import json
import math
from pathlib import Path
from typing import Dict, List, Tuple

def polygon_centroid(coords: List[List[float]]) -> Tuple[float, float]:
    pts = coords[:-1] if len(coords) > 1 and coords[0] == coords[-1] else coords
    if not pts:
        return (0.0, 0.0)
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return (cx, cy)

def match_towers_to_buildings(towers: List[dict], buildings: List[dict], coord_frame: str = "itm") -> Dict[int, dict]:
    assigned_buildings = set()
    matches: Dict[int, dict] = {}

    for tw in towers:
        way_id = str(tw.get("osm_way_id") or "").strip()
        if not way_id:
            continue
        for idx, b in enumerate(buildings):
            if idx in assigned_buildings:
                continue
            b_osm = str(b.get("osm_id") or b.get("id") or "").replace("way/", "").strip()
            if b_osm == way_id:
                matches[idx] = tw
                assigned_buildings.add(idx)
                break

    unmatched_towers = [
        tw for tw in sorted(towers, key=lambda x: x["match_radius_m"])
        if tw not in matches.values()
    ]
    for tw in unmatched_towers:
        tx = tw["itm_e"] if coord_frame == "itm" else tw["twin_sample_e"]
        ty = tw["itm_n"] if coord_frame == "itm" else tw["twin_sample_n"]
        best_idx = None
        best_dist = float(tw["match_radius_m"])
        for idx, b in enumerate(buildings):
            if idx in assigned_buildings:
                continue
            if "cx" in b and "cy" in b:
                bx, by = float(b["cx"]), float(b["cy"])
            elif "footprint" in b:
                bx, by = polygon_centroid(b["footprint"])
            else:
                continue
            d = math.hypot(bx - tx, by - ty)
            if d <= best_dist:
                best_dist = d
                best_idx = idx
        if best_idx is not None:
            matches[best_idx] = {**tw, "_matched_distance_m": round(best_dist, 2)}
            assigned_buildings.add(best_idx)

    return matches

def apply_matches_in_place(buildings: List[dict], matches: Dict[int, dict]) -> int:
    count = 0
    for idx, tw in matches.items():
        b = buildings[idx]
        b["height"] = tw["height_agl_m"]
        b["levels"] = tw["floors"]
        b["height_datum"] = "AGL"
        b["sigma_m"] = tw["sigma_height_m"]
        b["pos_sigma_m"] = tw["sigma_pos_m"]
        b["tower_id"] = tw["tower_id"]
        b["source_url"] = tw["source_url"]
        count += 1
    return count

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--towers", default=str(Path(__file__).resolve().parents[1] / "data/ashdod_17_towers_v041_rc2.json"))
    ap.add_argument("--tile-json", help="Path to target city/tile JSON containing a 'buildings' array")
    ap.add_argument("--frame", choices=["itm", "sample"], default="itm")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    payload = json.loads(Path(args.towers).read_text(encoding="utf-8"))
    towers = payload["towers"]

    if args.self_test:
        synth = [
            {"id": "b_k2", "cx": 166081.0, "cy": 633695.0, "height": 12.0},
            {"id": "b_k1", "cx": 166090.5, "cy": 633744.0, "height": 12.0},
            {"id": "b_dimri", "cx": 166016.0, "cy": 633575.5, "height": 12.0},
            {"id": "way/98483002", "cx": 166041.3, "cy": 633588.7, "height": 12.0},
        ]
        m = match_towers_to_buildings(towers, synth, coord_frame="itm")
        updated = apply_matches_in_place(synth, m)
        assert updated == 4, f"Expected 4 distinct CBD matches, got {updated}"
        assert synth[0]["height"] == 148.0 and synth[0]["sigma_m"] == 3.0
        assert synth[1]["height"] == 148.0 and synth[1]["tower_id"] == "ASH-T02"
        assert synth[2]["height"] == 141.52 and synth[2]["sigma_m"] == 0.5
        assert synth[3]["height"] == 32.0 and synth[3]["tower_id"] == "ASH-T04"
        print("PATCHER_SELF_TEST_OK: 4/4 CBD buildings matched cleanly (AGL only, zero collision)")
        return

    if args.tile_json:
        tp = Path(args.tile_json)
        tile_data = json.loads(tp.read_text(encoding="utf-8"))
        b_list = tile_data["buildings"] if isinstance(tile_data, dict) else tile_data
        m = match_towers_to_buildings(towers, b_list, coord_frame=args.frame)
        n_upd = apply_matches_in_place(b_list, m)
        tp.write_text(json.dumps(tile_data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Updated {n_upd} buildings in {tp}")

if __name__ == "__main__":
    main()
