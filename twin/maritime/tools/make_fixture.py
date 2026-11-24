#!/usr/bin/env python3
"""Write fixtures/ashdod_maritime_fixture.json — the maritime layer for the Ashdod sample, in REAL ITM (EPSG:2039).

HONESTY LABELS (also inside the JSON):
  * OSM (Overpass / Geofabrik) is NOT reachable from this sandbox, so this is NOT OpenStreetMap data.
  * 'traced-srtm': traced by hand from the land/sea + elevation grid of the twin's Ashdod sample
    (twin/pipeline/sample-out-ashdod, SRTM-2000 derived): the port quays bump and the Lachish valley/mouth
    are visible there (see tools/overview.py).  Accuracy ≈ ±50 m, epoch 2000.
  * 'schematic': breakwaters, basin, marina, anchorage, fairway, buoys, lights — plausible layout only,
    placed from general knowledge (entrance facing north, main breakwater on the west). NOT surveyed.
    Must be replaced by the pipeline's 'mar' layer (real OSM tags) as soon as the pipeline runs with network.
The sample tiles are in the sample frame; real ITM = sample + SAMPLE_TO_ITM (twin/pipeline/frame.py, 1507.82/757.76).
Coordinates below are written in the sample frame (so they line up with the sample's coastline) and shifted.
(Until 24.11.2026 the shift here was the old wrong 1524.6/753.6 while the world adapter already subtracted
1507.82/757.76, so every sea feature sat 17.29 m off the traced coastline in the world.)
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pipeline"))
from frame import SAMPLE_TO_ITM  # noqa: E402
DE, DN = SAMPLE_TO_ITM
S = lambda pts: [[round(e + DE, 2), round(n + DN, 2)] for e, n in pts]

F = []
RAW = {}   # id -> authored sample-frame coords (for the round-trip test)
def add(kind, geom, pts, src, **kw):
    RAW[f"fx-{kind}-{len(F)}"] = [list(pts)] if geom == "point" else [list(p) for p in pts]
    F.append({"id": f"fx-{kind}-{len(F)}", "kind": kind, "geom": geom,
              "coords": S(pts) if geom != "point" else S([pts])[0], "src": src, **kw})

# ---------------------------------------------------------------- Ashdod port (schematic + SRTM traced)
main_bw = [(164470, 635420), (164250, 635700), (164100, 636200), (164100, 636800), (164250, 637300), (164500, 637700), (164750, 638000)]
lee_bw = [(165650, 637900), (165350, 638000), (165050, 638050)]
add("breakwater", "line", main_bw, "schematic", width=26, crest=5.5, tags={"man_made": "breakwater"}, name="שובר הגלים הראשי (סכמטי)")
add("breakwater", "line", lee_bw, "schematic", width=22, crest=5.0, tags={"man_made": "breakwater"}, name="שובר הגלים המשני (סכמטי)")
basin = main_bw + [(165050, 638050), (165350, 638000), (165650, 637900), (165600, 637400), (165400, 637000),
                   (165200, 636950), (164700, 636900), (164650, 636000), (164560, 635500)]
add("basin", "area", basin, "schematic", depth=15.0, shelter=0.12, tags={"harbour": "yes"}, name="אגן הנמל (עומק משוער 15 מ')")
port_area = [(164560, 635520), (165250, 635560), (165300, 636000), (165250, 636950), (164700, 636950), (164650, 636500), (164660, 636000)]
add("port_area", "area", port_area, "traced-srtm", tags={"landuse": "port"}, name="נמל אשדוד – שטח רציפים (שורטט מה-SRTM)")
north_yard = [(165420, 637050), (165620, 637400), (165700, 637850), (165560, 637820), (165400, 637300)]
add("port_area", "area", north_yard, "traced-srtm", tags={"landuse": "port"}, name="רציפים צפוניים (שורטט מה-SRTM)")
# channel lights at the entrance (IALA region A: entering southward, starboard = west = green)
add("light", "point", (164750, 638000), "schematic", tags={"seamark:type": "light_minor", "seamark:light:colour": "green"})
add("light", "point", (165050, 638050), "schematic", tags={"seamark:type": "light_minor", "seamark:light:colour": "red"})
for (gx, gy), (rx, ry) in [((164760, 638350), (165060, 638380)), ((164700, 638750), (165000, 638780))]:
    add("buoy", "point", (gx, gy), "schematic", tags={"seamark:type": "buoy_lateral", "seamark:buoy_lateral:colour": "green"})
    add("buoy", "point", (rx, ry), "schematic", tags={"seamark:type": "buoy_lateral", "seamark:buoy_lateral:colour": "red"})
add("anchorage", "area", [(160800, 636600), (162600, 636600), (162600, 638600), (160800, 638600)], "schematic",
    tags={"seamark:type": "anchorage"}, name="מעגן המתנה (סכמטי)")
add("fairway", "line", [(161900, 637600), (163600, 638600), (164900, 638600), (164900, 638050), (164600, 637400), (164420, 636750)],
    "schematic", tags={"seamark:type": "fairway"}, name="נתיב כניסה (סכמטי)")
# ---------------------------------------------------------------- Lachish river mouth (traced from the SRTM valley)
add("river", "line", [(164440, 635225), (164700, 635290), (165000, 635390), (165300, 635470), (165480, 635520), (165650, 635700),
                      (165850, 635880), (166050, 636000), (166300, 636150), (166600, 636300)], "traced-srtm",
    width=28, tags={"waterway": "river", "name": "נחל לכיש"}, name="נחל לכיש (מסלול משוער מהעמק ב-SRTM)")
# ---------------------------------------------------------------- Marina (schematic, location approximate)
m_bw1 = [(163130, 632200), (162880, 632290), (162830, 632550), (162900, 632700)]
m_bw2 = [(163270, 632760), (163050, 632770)]
add("breakwater", "line", m_bw1, "schematic", width=16, crest=4.0, tags={"man_made": "breakwater"}, name="שובר גלים מרינה (סכמטי)")
add("breakwater", "line", m_bw2, "schematic", width=14, crest=3.5, tags={"man_made": "breakwater"})
add("marina", "area", m_bw1 + [(163050, 632770), (163270, 632760), (163200, 632200)], "schematic",
    depth=4.0, shelter=0.08, tags={"leisure": "marina"}, name="מרינה אשדוד (מיקום וצורה משוערים)")
for n in (632350, 632450, 632550, 632650):
    add("pier", "line", [(163150, n), (162950, n)], "schematic", width=2.6, floating=True, tags={"man_made": "pier", "floating": "yes"})
add("light", "point", (162900, 632700), "schematic", tags={"seamark:type": "light_minor", "seamark:light:colour": "green"})
add("light", "point", (163050, 632770), "schematic", tags={"seamark:type": "light_minor", "seamark:light:colour": "red"})

out = {
    "v": 1, "crs": "EPSG:2039", "kind": "maritime-fixture",
    "label_he": "שכבה ימית לדוגמה – לא נתוני OSM. רציפים ונחל לכיש שורטטו מנתוני הגובה של הדגימה (SRTM, ±50 מ'); "
                "שוברי גלים, אגן, מרינה, מעגן, נתיב ומצופים – סכמטיים משוערים בלבד.",
    "src_codes": {"traced-srtm": "שורטט ידנית מרשת הגובה/ים של הדגימה (SRTM 2000), דיוק ±50 מ'",
                  "schematic": "פריסה סכמטית משוערת – לא מדידה, לא OSM"},
    "frame_note": f"coords are REAL ITM = sample frame + ({DE}, {DN}) (twin/pipeline/frame.py)",
    "sample_to_itm": [DE, DN],
    "features": F,
}
if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    twin = os.path.join(here, "..", "..")
    for rel in ("maritime/fixtures", "integration/world/mods/maritime/fixtures", "preview/world/mods/maritime/fixtures"):
        p = os.path.normpath(os.path.join(twin, rel, "ashdod_maritime_fixture.json"))
        json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("wrote", p, len(F), "features")
