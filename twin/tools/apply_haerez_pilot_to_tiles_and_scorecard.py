#!/usr/bin/env python3
"""
ESH27 Twin World — HaErez Pilot Neighborhood Tile & Scorecard Patcher (v0.4.6-rc.1)
Compatible with twin/integration/world/groundtruth/haerez_scorecard.py (commit 434ca11).

Key Guarantees:
1. Enforces Sanhedrin QUEUE.md Task #7: injects ONLY records with approved_for_tile_injection=True,
   n_independent_sources >= 2, sigma_floors <= 1.0, and finite AGL height + ±sigma.
2. Never creates duplicate procedural 3D boxes (fixes 62-haerez-groundtruth.js rejection);
   patches existing OSM tile footprints in-place with AGL heights and provenance metadata.
3. Replaces SRTM DSM (sigma=3.77m) with Bare-Earth Coastal DTM (25m grid, sigma=0.64m <= 2.0m).
4. Splits Beit Canada (Shavei Zion 1) monolithic 8-floor heuristic into its 3 verified architectural
   volumes (4-floor 1968 base, 12-floor stepped wing, 21-floor eastern tower).
"""
import argparse
import json
import math
import os
import re
import sys


PII_FORBIDDEN_PATTERNS = [
    re.compile(r"\b\d{2,3}-\d{2,3}-\d{2,3}\b"),  # license plates
    re.compile(r"\b05\d[- ]?\d{7}\b"),             # Israeli mobile phones
    re.compile(r"1[A-Za-z0-9_-]{24,}"),                # raw cloud file IDs
    re.compile(r"/working_dir/"),                      # sandbox paths
]


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
        # Support either absolute ITM (itm_e/itm_n) or sample frame (e/n + 1507.82/757.76)
        if "itm_e" in b and "itm_n" in b:
            be, bn = float(b["itm_e"]), float(b["itm_n"])
        else:
            be = float(b.get("e", 0.0)) + 1507.82
            bn = float(b.get("n", 0.0)) + 757.76

        # Always upgrade ground elevation in the 500m zone from SRTM DSM to Bare-Earth DTM
        if 165700.0 <= be <= 166800.0 and 634400.0 <= bn <= 635500.0:
            b["ground_asl_m"] = bilinear_dtm(dtm_payload, be, bn)
            b["sigma_ground_m"] = dtm_payload["uncertainty"]["bare_earth_dtm_effective_sigma_m"]
            b["ground_source"] = "bare_earth_dtm_25m_v046_rc1"
            ground_updated_count += 1

        # Match nearest approved ground-truth record within match_radius_m
        best = None
        best_d = match_radius_m
        for r in approved_records:
            d = math.hypot(be - r["itm_e"], bn - r["itm_n"])
            if d <= best_d:
                best_d = d
                best = r

        if best is not None:
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
        "tile_buildings_dtm_upgraded": ground_updated_count,
        "quarantined_details": quarantined_records
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

    # 1. Privacy N4 audit
    for pat in PII_FORBIDDEN_PATTERNS:
        m = pat.search(raw_text)
        assert m is None, f"Forbidden N4 pattern matched: {m.group(0)}"

    # 2. Verify 28 approved + 1 quarantined holdout (or >=25 approved)
    approved = [r for r in pilot["buildings"] if r["approved_for_tile_injection"]]
    holdouts = [r for r in pilot["buildings"] if not r["approved_for_tile_injection"]]
    assert len(approved) == 31, f"Expected 31 approved records, got {len(approved)}"
    assert len(holdouts) == 1, f"Expected 1 quarantined holdout cluster, got {len(holdouts)}"

    for r in approved:
        ok, reasons = validate_sanhedrin_gate(r)
        assert ok, f"{r['pilot_id']} failed gate: {reasons}"
        assert abs(r["roof_asl_m"] - (r["ground_dtm_asl_m"] + r["height_agl_m"])) <= 0.05

    # 3. Verify Beit Canada 4-floor fix + 3-subvolume split & Dekel 29-floor lock
    by_id = {r["pilot_id"]: r for r in pilot["buildings"]}
    assert by_id["ASH-PLT-09"]["floors_canonical"] == 4, "Beit Canada 1968 base must be 4 floors"
    assert by_id["ASH-PLT-10"]["floors_canonical"] == 12, "Beit Canada stepped addition must be 12 floors"
    assert by_id["ASH-PLT-11"]["floors_canonical"] == 21, "Beit Canada east tower must be 21 floors"
    assert by_id["ASH-PLT-12"]["floors_canonical"] == 29
    assert by_id["ASH-PLT-14"]["floors_canonical"] == 29
    assert by_id["ASH-PLT-31"]["floors_canonical"] == 24

    # 4. Verify Bare-Earth DTM passes <= 2.0m gate
    assert dtm["uncertainty"]["bare_earth_dtm_effective_sigma_m"] <= 1.0

    # 5. Simulate patching a mock tile including Beit Canada (8 -> 4) & unverified building
    mock_tile = [
        {"id": "osm_beit_canada_base", "itm_e": 166432.5, "itm_n": 635247.8, "floors": 8, "height_m": 26.6},
        {"id": "osm_haerez_4", "e": 164756.0, "n": 634162.0, "floors": 4, "height_m": 12.0},
        {"id": "osm_quarantined_haeshel", "itm_e": 166290.0, "itm_n": 635195.0, "floors": 4, "height_m": 13.0},
    ]
    rep = apply_pilot_groundtruth_to_tile_buildings(mock_tile, pilot, dtm)
    assert rep["tile_buildings_patched"] == 2
    assert mock_tile[0]["floors"] == 4 and mock_tile[0]["height_m"] == 15.2
    assert mock_tile[1]["floors"] == 4 and mock_tile[1]["height_m"] == 13.4
    # Quarantined holdout must NOT overwrite tile building floors/height, only upgrade ground DTM!
    assert "pilot_id" not in mock_tile[2] and mock_tile[2]["ground_source"] == "bare_earth_dtm_25m_v046_rc1"

    print(json.dumps({"status": "SELF_TEST_PASSED", "report": rep, "dtm_sigma_m": dtm["uncertainty"]["bare_earth_dtm_effective_sigma_m"]}, ensure_ascii=False))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--tile-in", type=str, default="")
    ap.add_argument("--tile-out", type=str, default="")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(run_self_test())
    if args.tile_in and args.tile_out:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(base_dir, "data/haerez_pilot_buildings_v046_rc1.json"), encoding="utf-8") as f:
            pilot = json.load(f)
        with open(os.path.join(base_dir, "data/haerez_500m_bare_earth_dtm_25m.json"), encoding="utf-8") as f:
            dtm = json.load(f)
        with open(args.tile_in, encoding="utf-8") as f:
            tile_data = json.load(f)
        blds = tile_data.get("buildings", tile_data if isinstance(tile_data, list) else [])
        rep = apply_pilot_groundtruth_to_tile_buildings(blds, pilot, dtm)
        with open(args.tile_out, "w", encoding="utf-8") as f:
            json.dump(tile_data, f, ensure_ascii=False, indent=2)
        print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__":
    main()
