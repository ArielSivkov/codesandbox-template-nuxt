#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QUEUE.md Task #2 — Injects the 17 verified Ashdod towers (AGL only) into twin-world city/tile JSONs.
Supports `--repo-root <TWIN_REPO_DIR>` (pure Python stdlib — zero shapely/pyproj needed) as well as `--tile-json` and `--self-test`.
"""
import argparse
import json
import math
from pathlib import Path
from typing import Dict, List, Tuple

SKIP_DIRS = {".git", "node_modules", "__pycache__", "scan", "workers", "deploy"}
SKIP_FILES = {
    "ashdod_17_towers_v041_rc2.json",
    "haerez_pilot_buildings_v046_rc1.json",
    "haerez_500m_bare_earth_dtm_25m.json",
    "VERSION.json",
    "package.json",
    "package-lock.json",
}

def polygon_centroid(coords: List[List[float]]) -> Tuple[float, float]:
    pts = coords[:-1] if len(coords) > 1 and coords[0] == coords[-1] else coords
    if not pts:
        return (0.0, 0.0)
    cx = sum(float(p[0]) for p in pts) / len(pts)
    cy = sum(float(p[1]) for p in pts) / len(pts)
    return (cx, cy)

def extract_building_xy_itm(b: dict, default_frame: str = "itm") -> Tuple[float, float] | None:
    if not isinstance(b, dict):
        return None
    if "itm_e" in b and "itm_n" in b:
        return (float(b["itm_e"]), float(b["itm_n"]))
    if "cx" in b and "cy" in b:
        x, y = float(b["cx"]), float(b["cy"])
    elif "e" in b and "n" in b:
        x, y = float(b["e"]), float(b["n"])
    elif "x" in b and "z" in b and isinstance(b["x"], (int, float)) and isinstance(b["z"], (int, float)):
        x, y = float(b["x"]), float(b["z"])
    elif "footprint" in b and isinstance(b["footprint"], list) and b["footprint"]:
        x, y = polygon_centroid(b["footprint"])
    elif "p" in b and isinstance(b["p"], list) and len(b["p"]) >= 2 and isinstance(b["p"][0], list):
        x, y = polygon_centroid(b["p"])
    else:
        return None
    # Auto-detect sample frame (~164500, ~633000) vs absolute ITM (~166000, ~635000)
    if default_frame == "sample" or (160000.0 <= x <= 165600.0 and 629000.0 <= y <= 634600.0):
        return (x + 1507.82, y + 757.76)
    return (x, y)

def match_towers_to_buildings(towers: List[dict], buildings: List[dict], coord_frame: str = "itm") -> Dict[int, dict]:
    assigned_buildings = set()
    matches: Dict[int, dict] = {}

    for tw in towers:
        way_id = str(tw.get("osm_way_id") or "").strip()
        if not way_id:
            continue
        for idx, b in enumerate(buildings):
            if idx in assigned_buildings or not isinstance(b, dict):
                continue
            b_osm = str(b.get("osm_id") or b.get("id") or b.get("i") or "").replace("way/", "").replace("w", "").strip()
            if b_osm == way_id:
                matches[idx] = tw
                assigned_buildings.add(idx)
                break

    unmatched_towers = [
        tw for tw in sorted(towers, key=lambda x: x["match_radius_m"])
        if tw not in matches.values()
    ]
    for tw in unmatched_towers:
        tx, ty = float(tw["itm_e"]), float(tw["itm_n"])
        best_idx = None
        best_dist = float(tw["match_radius_m"])
        for idx, b in enumerate(buildings):
            if idx in assigned_buildings:
                continue
            xy = extract_building_xy_itm(b, default_frame=coord_frame)
            if xy is None:
                continue
            d = math.hypot(xy[0] - tx, xy[1] - ty)
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
        agl = tw["height_agl_m"]
        fl = tw["floors"]
        # Preserve compact tile schema keys (`h`, `l`) if used, alongside explicit keys
        if "h" in b and "height" not in b:
            b["h"] = agl
            if "l" in b:
                b["l"] = fl
        else:
            b["height"] = agl
            b["levels"] = fl
            b["height_datum"] = "AGL"
            b["sigma_m"] = tw["sigma_height_m"]
            b["pos_sigma_m"] = tw["sigma_pos_m"]
            b["tower_id"] = tw["tower_id"]
            b["source_url"] = tw["source_url"]
        count += 1
    return count

def iter_candidate_tile_jsons(twin_dir: Path):
    for p in sorted(twin_dir.rglob("*.json")):
        if any(part in SKIP_DIRS for part in p.relative_to(twin_dir).parts):
            continue
        if p.name in SKIP_FILES:
            continue
        if p.stat().st_size > 15_000_000:
            continue
        yield p

def extract_building_list(tile_data):
    if isinstance(tile_data, dict):
        if isinstance(tile_data.get("buildings"), list):
            return tile_data["buildings"]
        if isinstance(tile_data.get("b"), list) and tile_data["b"] and isinstance(tile_data["b"][0], dict):
            return tile_data["b"]
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--towers", default=str(Path(__file__).resolve().parents[1] / "data/ashdod_17_towers_v041_rc2.json"))
    ap.add_argument("--tile-json", help="Path to a single target city/tile JSON")
    ap.add_argument("--repo-root", help="Path to repo root to scan and patch all Ashdod tile JSONs under twin/")
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
        print("PATCHER_SELF_TEST_OK: 4/4 CBD buildings matched cleanly (AGL only)")
        return

    if args.tile_json:
        tp = Path(args.tile_json)
        tile_data = json.loads(tp.read_text(encoding="utf-8"))
        b_list = extract_building_list(tile_data) or (tile_data if isinstance(tile_data, list) else [])
        m = match_towers_to_buildings(towers, b_list, coord_frame=args.frame)
        n_upd = apply_matches_in_place(b_list, m)
        if n_upd > 0:
            tp.write_text(json.dumps(tile_data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(json.dumps({"file": str(tp), "towers_patched": n_upd}))
        return

    if args.repo_root:
        twin_dir = Path(args.repo_root) / "twin"
        if not twin_dir.exists():
            twin_dir = Path(args.repo_root)
        files_scanned = 0
        files_modified = 0
        buildings_patched = 0
        for jp in iter_candidate_tile_jsons(twin_dir):
            try:
                data = json.loads(jp.read_text(encoding="utf-8"))
            except Exception:
                continue
            b_list = extract_building_list(data)
            if not b_list:
                continue
            files_scanned += 1
            m = match_towers_to_buildings(towers, b_list, coord_frame=args.frame)
            if m:
                n_upd = apply_matches_in_place(b_list, m)
                if n_upd > 0:
                    jp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                    files_modified += 1
                    buildings_patched += n_upd
        print(json.dumps({
            "task": "apply_ashdod_17_towers_to_tiles",
            "files_scanned": files_scanned,
            "files_modified": files_modified,
            "buildings_patched": buildings_patched
        }))
        return

if __name__ == "__main__":
    main()
