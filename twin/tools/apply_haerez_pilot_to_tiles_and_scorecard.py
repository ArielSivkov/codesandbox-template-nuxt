#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ESH27 Twin World — HaErez Pilot Neighborhood Tile & Scorecard Patcher (v0.4.6 Build #31)
Supports `--repo-root <TWIN_REPO_DIR>` (pure Python stdlib — zero silent errors!), `--tile-in`/`--tile-out`, and `--self-test`.
"""
import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

PII_FORBIDDEN_PATTERNS = [
    re.compile(r"\b\d{2,3}-\d{2,3}-\d{2,3}\b"),
    re.compile(r"\b05\d[- ]?\d{7}\b"),
    re.compile(r"1[A-Za-z0-9_-]{24,}"),
    re.compile(r"/working_dir/"),
]

SKIP_DIRS = {".git", "node_modules", "__pycache__", "scan", "workers", "deploy"}
SKIP_FILES = {
    "ashdod_17_towers_v041_rc2.json",
    "haerez_pilot_buildings_v046_rc1.json",
    "haerez_500m_bare_earth_dtm_25m.json",
    "VERSION.json",
    "package.json",
    "package-lock.json",
}

def bilinear_dtm(dtm_payload: dict, itm_e: float, itm_n: float) -> float:
    spec = dtm_payload["grid_spec"]
    grid = dtm_payload["elevations_row_major_n_by_e_m"]
    step = float(spec["step_m"])
    fx = (itm_e - spec["e_min"]) / step
    fy = (itm_n - spec["n_min"]) / step
    ix = max(0, min(spec["cols"] - 2, int(math.floor(fx))))
    iy = max(0, min(spec["rows"] - 2, int(math.floor(fy))))
    tx = max(0.0, min(1.0, fx - ix))
    ty = max(0.0, min(1.0, fy - iy))
    z00 = grid[iy][ix]
    z10 = grid[iy][ix + 1]
    z01 = grid[iy + 1][ix]
    z11 = grid[iy + 1][ix + 1]
    z0 = z00 * (1.0 - tx) + z10 * tx
    z1 = z01 * (1.0 - tx) + z11 * tx
    return round(z0 * (1.0 - ty) + z1 * ty, 2)

def validate_sanhedrin_gate(record: dict) -> tuple[bool, list[str]]:
    reasons = []
    if not record.get("approved_for_tile_injection", False):
        reasons.append("not_approved_for_tile_injection")
    if int(record.get("n_independent_sources", 0)) < 2:
        reasons.append("fewer_than_2_independent_sources")
    if float(record.get("sigma_floors", 99.0)) > 1.0:
        reasons.append("sigma_floors_exceeds_1_0")
    if int(record.get("truth_tier", 5)) not in (1, 2, 3):
        reasons.append("disallowed_truth_tier")
    if record.get("extrusion_datum") != "AGL":
        reasons.append("datum_not_AGL")
    for num_key in ("itm_e", "itm_n", "floors_canonical", "sigma_floors", "height_agl_m", "sigma_height_m", "ground_dtm_asl_m", "sigma_ground_m"):
        val = record.get(num_key)
        if not isinstance(val, (int, float)) or not math.isfinite(val):
            reasons.append(f"non_finite_{num_key}")
    for url_key in ("primary_source_url", "secondary_source_url"):
        u = str(record.get(url_key, ""))
        if not u.startswith("https://"):
            reasons.append(f"missing_https_{url_key}")
    return (len(reasons) == 0), reasons

def extract_b_itm(b: dict):
    if not isinstance(b, dict):
        return None
    if "itm_e" in b and "itm_n" in b:
        return (float(b["itm_e"]), float(b["itm_n"]))
    if "e" in b and "n" in b:
        x, y = float(b["e"]), float(b["n"])
    elif "cx" in b and "cy" in b:
        x, y = float(b["cx"]), float(b["cy"])
    elif "p" in b and isinstance(b["p"], list) and len(b["p"]) >= 2 and isinstance(b["p"][0], list):
        pts = b["p"][:-1] if len(b["p"]) > 1 and b["p"][0] == b["p"][-1] else b["p"]
        x = sum(float(pt[0]) for pt in pts) / len(pts)
        y = sum(float(pt[1]) for pt in pts) / len(pts)
    else:
        return None
    if 160000.0 <= x <= 165600.0 and 629000.0 <= y <= 634600.0:
        return (x + 1507.82, y + 757.76)
    return (x, y)

def apply_pilot_groundtruth_to_tile_buildings(tile_buildings: list[dict], pilot_payload: dict, dtm_payload: dict, match_radius_m: float = 24.0) -> dict:
    approved_records = []
    quarantined_records = []
    for r in pilot_payload["buildings"]:
        ok, reasons = validate_sanhedrin_gate(r)
        if ok:
            approved_records.append(r)
        else:
            quarantined_records.append({"pilot_id": r["pilot_id"], "reasons": reasons})

    patched_count = 0
    ground_updated_count = 0
    for b in tile_buildings:
        xy = extract_b_itm(b)
        if xy is None:
            continue
        be, bn = xy
        compact = ("h" in b and "height_m" not in b and "floors" not in b)

        if 165700.0 <= be <= 166800.0 and 634400.0 <= bn <= 635500.0:
            gz = bilinear_dtm(dtm_payload, be, bn)
            if compact:
                b["gz"] = gz
            else:
                b["ground_asl_m"] = gz
                b["sigma_ground_m"] = dtm_payload["uncertainty"]["bare_earth_dtm_effective_sigma_m"]
                b["ground_source"] = "bare_earth_dtm_25m_v046_b31"
            ground_updated_count += 1

        best = None
        best_d = match_radius_m
        for r in approved_records:
            d = math.hypot(be - r["itm_e"], bn - r["itm_n"])
            if d <= best_d:
                best_d = d
                best = r

        if best is not None:
            if compact:
                b["h"] = best["height_agl_m"]
                b["l"] = best["floors_canonical"]
            else:
                b["floors"] = best["floors_canonical"]
                b["sigma_floors"] = best["sigma_floors"]
                b["height_m"] = best["height_agl_m"]
                b["sigma_height_m"] = best["sigma_height_m"]
                b["extrusion_datum"] = "AGL"
                b["height_source_rank"] = best["truth_tier"]
                b["n_sources"] = best["n_independent_sources"]
                b["pilot_id"] = best["pilot_id"]
                b["source_url"] = best["primary_source_url"]
                b["source_url_2"] = best["secondary_source_url"]
            patched_count += 1

    return {
        "approved_records_loaded": len(approved_records),
        "quarantined_records_held_out": len(quarantined_records),
        "tile_buildings_patched": patched_count,
        "tile_buildings_dtm_upgraded": ground_updated_count
    }

def run_self_test() -> int:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pilot_path = os.path.join(base_dir, "data/haerez_pilot_buildings_v046_rc1.json")
    dtm_path = os.path.join(base_dir, "data/haerez_500m_bare_earth_dtm_25m.json")
    with open(pilot_path, encoding="utf-8") as f:
        raw_text = f.read()
        pilot = json.loads(raw_text)
    with open(dtm_path, encoding="utf-8") as f:
        dtm = json.loads(f.read())
    for pat in PII_FORBIDDEN_PATTERNS:
        assert pat.search(raw_text) is None
    mock_tile = [
        {"id": "osm_beit_canada_base", "itm_e": 166432.5, "itm_n": 635247.8, "floors": 8, "height_m": 26.6},
        {"id": "osm_haerez_4", "e": 164756.0, "n": 634162.0, "floors": 4, "height_m": 12.0},
        {"id": "osm_quarantined_haeshel", "itm_e": 166290.0, "itm_n": 635195.0, "floors": 4, "height_m": 13.0},
    ]
    rep = apply_pilot_groundtruth_to_tile_buildings(mock_tile, pilot, dtm)
    assert rep["tile_buildings_patched"] == 2
    assert mock_tile[0]["floors"] == 4 and mock_tile[0]["height_m"] == 15.2
    print(json.dumps({"status": "SELF_TEST_PASSED", "report": rep}))
    return 0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--tile-in", type=str, default="")
    ap.add_argument("--tile-out", type=str, default="")
    ap.add_argument("--repo-root", type=str, default="")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(run_self_test())

    base_dir = Path(__file__).resolve().parents[1]
    pilot = json.loads((base_dir / "data/haerez_pilot_buildings_v046_rc1.json").read_text(encoding="utf-8"))
    dtm = json.loads((base_dir / "data/haerez_500m_bare_earth_dtm_25m.json").read_text(encoding="utf-8"))

    if args.tile_in and args.tile_out:
        tile_data = json.loads(Path(args.tile_in).read_text(encoding="utf-8"))
        blds = tile_data.get("buildings", tile_data if isinstance(tile_data, list) else [])
        rep = apply_pilot_groundtruth_to_tile_buildings(blds, pilot, dtm)
        Path(args.tile_out).write_text(json.dumps(tile_data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(rep, ensure_ascii=False))
        return

    if args.repo_root:
        twin_dir = Path(args.repo_root) / "twin"
        if not twin_dir.exists():
            twin_dir = Path(args.repo_root)
        files_scanned = 0
        files_modified = 0
        total_patched = 0
        total_dtm = 0
        for jp in sorted(twin_dir.rglob("*.json")):
            if any(part in SKIP_DIRS for part in jp.relative_to(twin_dir).parts) or jp.name in SKIP_FILES:
                continue
            if jp.stat().st_size > 15_000_000:
                continue
            try:
                data = json.loads(jp.read_text(encoding="utf-8"))
            except Exception:
                continue
            b_list = None
            if isinstance(data, dict):
                if isinstance(data.get("buildings"), list):
                    b_list = data["buildings"]
                elif isinstance(data.get("b"), list) and data["b"] and isinstance(data["b"][0], dict):
                    b_list = data["b"]
            if not b_list:
                continue
            files_scanned += 1
            rep = apply_pilot_groundtruth_to_tile_buildings(b_list, pilot, dtm)
            if rep["tile_buildings_patched"] > 0 or rep["tile_buildings_dtm_upgraded"] > 0:
                jp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                files_modified += 1
                total_patched += rep["tile_buildings_patched"]
                total_dtm += rep["tile_buildings_dtm_upgraded"]

        receipt = {
            "task": "apply_haerez_pilot_to_tiles_and_scorecard",
            "version": "0.4.6",
            "build": 31,
            "files_scanned": files_scanned,
            "files_modified": files_modified,
            "buildings_patched": total_patched,
            "buildings_dtm_upgraded": total_dtm,
            "dtm_sigma_m": dtm["uncertainty"]["bare_earth_dtm_effective_sigma_m"]
        }
        (twin_dir / "data/tile_injection_receipt_v046_b31.json").write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(receipt, ensure_ascii=False))
        return

if __name__ == "__main__":
    main()
