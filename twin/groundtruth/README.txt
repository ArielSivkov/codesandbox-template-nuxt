Ashdod ground-truth set for the twin's building heights (v1, 2026-11-23)
=======================================================================
Files
  build_reference.py      hand-curated records (every number read from the cited page) -> csv/json
  ashdod_reference.csv    one row per building (first line is a comment)
  ashdod_reference.json   same rows + metadata (georeference offset)
  sample_io.py            reads twin/pipeline/sample-out-ashdod tiles back into building dicts
  evaluate.py             re-runs yazam/heights.py (unmodified) on the sample and scores it -> eval_result.json

Columns
  ref_id            ASH-nnn
  name, name_alt    name in the source / name as tagged in OSM sample
  address           as given by the source (null if none)
  osm_way_id        id in sample-out-ashdod (w<way>), null = not matched
  id_match_method   name | name+location | location+name | location | name_fuzzy | none
                    location = source lat/lon, shifted by the georeference offset below, falls inside
                    (or <60 m from, for coarse Wikipedia coords) the footprint
  match_note        how the match was made / doubts
  floors            above-ground floors as stated by the primary source (null = not stated)
  floors_alt        a conflicting floor count from another source
  height_m          height to architectural top / roof as stated (null = not stated - NEVER derived)
  height_alt_m      conflicting height from another source
  year_built, status, use, lat, lon (WGS84 as given by source)
  source_url, source_url_2
  reliability       high (CTBUH / Wikipedia list, agreeing sources) | medium (single specific source)
                    | low (ambiguous footprint, building changed since, or identity unsure) | n/a
  use_in_eval       1 = in headline metrics (high/medium, matched, unchanged building)
  notes

Georeference finding
  The sample tiles were built with ASSUMED_ORIGIN_ITM=(166300,634400) (yz_sample.py). Three independent
  coordinate sources (Ashdod Museum of Art / Monart, Dimri Tower, K Towers) show the sample is shifted:
  real ITM = sample + (1524.6, 753.6) m, i.e. the real origin is about (167824.6, 635153.6).
  Monart gave the offset; Dimri and K Towers coords then fall exactly inside the named footprints.

Reference height in evaluate.py: height_m if stated ("stated"), else floors*FLOOR_H+parapet ("derived" -
uses the model's own 3.0 m assumption, so for those rows only the floor count is really tested).
