צייד התמונות והמסמכים הציבוריים - Ashdod public facts (v1, 2026-11-23)
=====================================================================

Files
  build_public_facts.py                 hand-curated rows (every number read from the cited page) -> all outputs. Run: python3 -I build_public_facts.py
  ashdod_public_facts.csv / .json       50 rows, one per building or building group (PUB-001..050)
  ashdod_reference_public_additions.json  31 rows in EXACTLY the ashdod_reference.json columns (ref_id PUB-nnn,
                                        osm_way_id=null, use_in_eval=0) - a separate file; ashdod_reference.json was not touched
  images_catalog.csv                    53 Wikimedia Commons file/category URLs (URLs only, nothing downloaded)

Where HaErez is (checked, not assumed)
  * OSM street 'הארז' is in sample tile 164_634: a ~70 m street, real ITM ~(166262,634886)-(166290,634950),
    i.e. WGS84 ~31.8058 N, 34.6428 E (centroid, via the pipeline's georeference offset). It meets 'הדקל'; neighbours השיטה, האורן, רוגוזין, הגפן, התאנה.
  * Rova Alef boundaries (nadlancenter/8384): sea/promenade (W), Ben Gurion blvd (N), Herzl blvd (E), Yitzhak HaNasi blvd (S).
    HaErez lies north of Yitzhak HaNasi (~110 m) and west of Herzl (~570 m) -> inside Rova Alef.
  * Direct check: yad2 project 18100 puts 'הדקל 9' (the crossing street) in 'רובע א''. Conclusion: הארז = רובע א' (Ashdod's first quarter).

Method
  1. Plan takanonim (apps.land.gov.il/IturTabotData/takanonim/...): read §1 (address, gush, ITM) and the explanatory note
     (existing buildings). Tables in §5 are usually garbled in text extraction -> numbers from them were NOT used.
  2. Hebrew real-estate news (nadlancenter, mako/N12, calcalist, ynet): sentences like "N buildings of F floors, U units".
  3. yad2 item pages ("קומה X מתוך Y") - only the building's total floor count and street/number; no prices, no people.
     yad2 /yad1/project/.../apartment pages are robots-disallowed and were NOT fetched. madlan.co.il refused all fetches.
  4. Commons categories through the download.osmand.net mirror (commons.wikimedia.org itself was not reachable here).
  Rules kept: facts only, a few words of source text at most, no photos stored, nothing invented (null when not stated).

Columns (ashdod_public_facts)
  street              OSM street name as it appears in tile 'rd' names (use for matching)
  street_min_dist_from_haerez_m  closest point of that STREET to HaErez (a street-level proxy, not the building distance)
  haerez_area         1 = Rova Alef and street within 600 m
  n_buildings/is_group  a group row's floors apply only to the buildings the source names - never to the whole street
  floors / floors_max floors_max set only when the source gives a range (e.g. "2-4 floors")
  floor_class         1-2 | 3-4 | 5-9 | 10-19 | 20+ (a range shows as e.g. 1-2..3-4)
  itm_x/itm_y, lat/lon only when a plan gives coordinates (plan centre point, EPSG:2039 -> WGS84 via pyproj)
  rel                 high = exact address + explicit number in an official/news source; medium = single specific source or
                      listing with house number; low = no house number, conflicting sources, or plan right rather than as-built

Matching to OSM buildings (for the main pipeline)
  A. When the full OSM extract runs: join on addr:street + addr:housenumber (Hebrew). Rows list numbers in 'address'
     (e.g. 'הרב אבן דנן 3, 7, 9' -> 3 buildings). Then set osm_way_id, id_match_method='address', use_in_eval=1 for high/medium.
  B. Until then (sample tiles have no addr:*): take buildings whose centroid (sample + offset dx=1524.6, dy=753.6) lies within
     ~40 m of the named street in the tile road names; only rows with house numbers or a plan ITM point should be promoted.
     For plan ITM points: pick the footprint containing / nearest to the point, but remember it is the PLAN centre.
  C. Group rows (e.g. PUB-003 '14 buildings of 2-4 floors') are distribution checks, not per-building truth.
  Finding: all 387 sample buildings within 550 m of HaErez are rule-based (src 'R', 331 of them floors=4). The 5 Hadekel
  towers (29 floors) are not represented: footprints along הדקל are small (130-690 m2, floors 4) - possibly stale
  pre-demolition blocks. Check with fresh imagery before scoring.

Known conflicts / doubts (kept in notes)
  * Hadekel old compound: 150 vs 180 units. Harotem Peladot 7-floor part: 1 vs 3 buildings.
  * Bezeq exchange student dorm: ashdod_reference ASH-016 says 'נתן אלתרמן 38'; plan 603-0593087 summary says 'נתן אלבז 38'.
  * 'North of stadium' (mako, 124 apts/7 bldgs) vs plan 603-0346031 - link unconfirmed.

Blocked / not used
  commons.wikimedia.org (unreachable - licences in images_catalog are UNVERIFIED), madlan.co.il, hamichlol, he.wikipedia page
  for Rova Alef, yad2 project-apartment pages (robots), shell has no internet (all via WebFetch). Google Street View: terms forbid
  extraction - not used. Mapillary (CC BY-SA 4.0) and KartaView (open) are the legal street-level options - not queried here
  (need API token / API not reachable from this sandbox).
