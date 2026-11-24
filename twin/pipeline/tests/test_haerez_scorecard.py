"""כרטיס הציון של שכונת הניסוי (רחוב הארז) – run: python -m pytest -q pipeline/tests/test_haerez_scorecard.py"""
import json
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "..", "groundtruth"))
import haerez_scorecard as H  # noqa: E402

R = H.score()


def test_boundary_is_the_worlds_home():
    # הגבול נקרא מהעולם עצמו (host.js HOME), לא מוגדר כאן מחדש
    E, N, r = H.read_home()
    assert (R["boundary"]["E"], R["boundary"]["N"], R["boundary"]["r_m"]) == (E, N, r)
    assert r == 500


def test_decoder_matches_tile_area():
    # הטבעת המפוענחת (פחות חורים) נותנת את השטח שהצינור כתב באריח – הפענוח זהה לקידוד של tiles.py
    assert R["decoder_check"]["max_rel_area_err"] < 0.01


def test_every_building_has_source_and_sigma():
    assert R["buildings"] > 300
    assert sum(R["height_sources"].values()) == R["buildings"]
    assert R["height_sigma_m_median"] > 0


def test_floor_rule_counts():
    f = R["floors"]
    assert 0 <= f["pass"] <= R["buildings"]
    assert R["phase1_met"]["floors"] == (f["pass"] == R["buildings"])


def test_terrain_sigma_from_documented_le90():
    # σ = LE90 / 1.645 (Rodriguez et al. 2006: 6.2 מ' באירואסיה) → 3.77 מ' > יעד 2 מ'
    assert abs(R["terrain"]["sigma_m_documented"] - 6.2 / 1.645) < 0.01
    assert R["terrain"]["pass"] is False
    # עקביות פנימית: בסיס הבניין (z) תואם את רשת הקרקע בפחות ממטר
    assert R["terrain"]["base_vs_grid_m"]["max_abs"] < 1.0


def test_position_never_claimed_without_measurement():
    assert R["position"]["status"] == "לא נמדד"
    assert R["phase1_met"]["position"] is False


def test_groundtruth_in_boundary_compared():
    g = {x["ref_id"]: x for x in R["groundtruth_buildings_in_boundary"]}
    assert "ASH-008" in g and g["ASH-008"]["ref_floors"] == 4   # בית קנדה, ashdod_reference.csv


def test_saved_scorecard_is_current():
    # כל שינוי באריחי השכונה חייב לעדכן את haerez_scorecard.json במודע (ולתעד ב-LOG.md)
    saved = json.load(open(H.OUT, encoding="utf-8"))
    assert saved == json.loads(json.dumps(R, ensure_ascii=False))
