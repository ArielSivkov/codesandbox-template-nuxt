#!/usr/bin/env python3
"""Build one city (or bbox) of the Yazam all-Israel 3D map.

Examples
  # production (GitHub Actions / Ariel's server): Geofabrik PBF + Copernicus DEM (+ Overture)
  python build_city.py --city ashdod --osm pbf --pbf israel-and-palestine-latest.osm.pbf --dem cop30 --overture
  # ad-hoc, one city via Overpass
  python build_city.py --city ramla --osm overpass --dem cop30
  # arbitrary bbox (WGS84 w,s,e,n)
  python build_city.py --bbox 34.64,31.79,34.66,31.81 --slug test-box --osm overpass
  # offline test on the data embedded in the current single-file map
  python build_city.py --city ashdod --osm yzsample --yz ../../repo/yazam/map/index.html
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import numpy as np
from shapely.geometry import box
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from yazam import geo, heights, landmask, tiles, dem as demmod, sources_osm  # noqa: E402

LICENCES = {
    "osm": "© OpenStreetMap contributors, ODbL 1.0",
    "overture": "Overture Maps Foundation, ODbL (buildings theme)",
    "cop30": "Copernicus DEM GLO-30 © DLR e.V. / Airbus, provided under COPERNICUS by the EU and ESA",
    "srtm": "NASA SRTM (public domain)",
}


def load_city(args):
    cfg = json.load(open(os.path.join(HERE, "cities.json"), encoding="utf-8"))
    if args.city:
        c = next((c for c in cfg["cities"] if c["slug"] == args.city), None)
        if not c:
            sys.exit(f"unknown city {args.city}")
        return dict(c)
    w, s, e, n = map(float, args.bbox.split(","))
    return {"slug": args.slug or "bbox", "name_he": args.slug or "תחום", "osm_name": None, "bbox": [w, s, e, n]}


def normalise_buildings(raw):
    out = []
    for b in raw:
        g = b["geom"]
        if g.is_empty or g.area < 4:          # drop slivers < 4 m²
            continue
        c = g.representative_point()
        t = b["tags"].get("building", "yes")
        out.append({"id": b["id"], "geom": g, "tags": b["tags"], "type": "" if t == "yes" else t,
                    "name": b["tags"].get("name:he") or b["tags"].get("name", ""), "area": g.area,
                    "perimeter": g.length, "cx": c.x, "cy": c.y, "measurements": b.get("measurements", [])})
    return out


def city_grid_bounds(study):
    x0, y0, x1, y1 = study.bounds
    s = geo.TERRAIN_STEP
    return math.floor(x0 / s) * s, math.floor(y0 / s) * s, math.ceil(x1 / s) * s, math.ceil(y1 / s) * s


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--city"); ap.add_argument("--bbox"); ap.add_argument("--slug")
    ap.add_argument("--osm", choices=["pbf", "overpass", "geojson", "yzsample"], default="overpass")
    ap.add_argument("--pbf"); ap.add_argument("--geojson"); ap.add_argument("--yz")
    ap.add_argument("--dem", choices=["cop30", "srtm", "none", "yzsample"], default="cop30")
    ap.add_argument("--overture", action="store_true")
    ap.add_argument("--measurements", help="JSON from the correction loop (worker /api/corrections export)")
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--context-m", type=float, default=300.0, help="buffer around city boundary")
    ap.add_argument("--no-green", action="store_true", help="skip the vegetation layer (tiles/g)")
    ap.add_argument("--tree-slots", help="street-tree slots JSON from the transport team [{x,y,cls,street}] ITM")
    ap.add_argument("--ndvi", help="Sentinel-2 NDVI .npz on the ITM 10 m grid (see vegetation.load_ndvi_npz)")
    ap.add_argument("--no-keep-sea", action="store_true", help="old behaviour: OUTSIDE also for open sea beyond the study area")
    ap.add_argument("--bathy", help="bathymetry grid (ESRI ASCII .asc from EMODnet/GEBCO, WGS84) -> tiles/b/*.bin.gz")
    args = ap.parse_args(argv)
    t0 = time.time()
    city = load_city(args)
    w, s, e, n = city["bbox"]
    pad = 0.01
    bbox = (w - pad, s - pad, e + pad, n + pad)
    sources_used = {}
    log = lambda *a: print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)

    # ---------------------------------------------------------------- 1. OSM inputs
    yzgrid = None
    if args.osm == "yzsample":
        from yazam import yz_sample
        D = yz_sample.load(args.yz)
        raw_b, roads, dsm_fn, yzgrid = yz_sample.to_inputs(D)
        sea0 = landmask.clean_dem_sea_mask(yzgrid["sea"])
        osm = {"buildings": raw_b, "roads": roads, "water": [], "boundary": None, "maritime": [],
               "coast": [yz_sample.synthetic_coastline(sea0, yzgrid)]}
        args.dem = "yzsample"
        sources_used["osm"] = "sample embedded in current map (Geofabrik free extract) + SYNTHETIC coastline"
    elif args.osm == "pbf":
        osm = sources_osm.pbf(args.pbf, bbox, city.get("osm_name"))
        sources_used["osm"] = LICENCES["osm"] + f" (pbf {os.path.basename(args.pbf)})"
    elif args.osm == "geojson":
        osm = sources_osm.from_geojson(args.geojson)
        sources_used["osm"] = "geojson input " + os.path.basename(args.geojson)
    else:
        osm = sources_osm.overpass(bbox, city.get("osm_name"))
        sources_used["osm"] = LICENCES["osm"] + " (Overpass)"
    log("osm:", len(osm["buildings"]), "buildings,", len(osm["coast"]), "coast ways,", len(osm["roads"]), "roads,",
        len(osm.get("maritime", [])), "maritime features")

    if args.measurements and os.path.exists(args.measurements):
        meas = json.load(open(args.measurements, encoding="utf-8"))
        by_id = {}
        for m in meas:
            by_id.setdefault(str(m["osm_id"]), []).append(m)
        for b in osm["buildings"]:
            b["measurements"] = by_id.get(b["id"], []) + by_id.get(b["id"][1:], [])
        sources_used["measurements"] = f"{len(meas)} contractor confirmations"

    blds = normalise_buildings(osm["buildings"])

    # ---------------------------------------------------------------- 2. study area
    if osm.get("boundary") is not None:
        city_poly = osm["boundary"]; city["boundary_kind"] = "osm_admin8"
    else:  # fallback: concave-ish hull of buildings – labelled as estimated in the UI
        city_poly = unary_union([b["geom"].buffer(80) for b in blds]).buffer(-60)
        city["boundary_kind"] = "estimated_from_buildings"
    study = city_poly.buffer(args.context_m).intersection(box(*geo.bbox_wgs_to_itm(bbox)))
    blds = [b for b in blds if study.contains(b["geom"].representative_point())]
    log("study area km2:", round(city_poly.area / 1e6, 1), city["boundary_kind"], "| buildings in area:", len(blds))

    # ---------------------------------------------------------------- 3. Overture (optional)
    if args.overture:
        from yazam import sources_overture as so
        ov = so.buildings(bbox)
        pairs, unmatched = so.match_to_osm(blds, ov)
        for b, o, iou in pairs:
            ds = ""
            try:
                ds = ",".join(sorted({x.get("dataset", "") for x in json.loads(o["sources"]) if x.get("property", "") in ("", "/properties/height", "/properties/num_floors")}))
            except Exception:
                pass
            b["overture"] = {"height": o["height"], "num_floors": o["num_floors"], "height_src": ds}
        extra = normalise_buildings([{"id": o["id"], "geom": o["geom"], "tags": {"building": o.get("class") or "yes"}}
                                     for o in unmatched if study.contains(o["geom"].representative_point())])
        for x in extra:
            x["footprint_src"] = "overture"
        blds += extra
        sources_used["overture"] = LICENCES["overture"] + f" release {ov[0]['release'] if ov else '?'}; +{len(extra)} footprints"
        log("overture:", len(pairs), "matched,", len(extra), "added")

    # ---------------------------------------------------------------- 4. DEM -> DTM + nDSM
    gx0, gy0, gx1, gy1 = city_grid_bounds(study)
    st = geo.TERRAIN_STEP
    xs = np.arange(gx0, gx1 + st, st); ys = np.arange(gy1, gy0 - st, -st)
    X, Y = np.meshgrid(xs, ys)
    if args.dem == "yzsample":
        dsm = dsm_fn(X, Y); sources_used["dem"] = "SRTM grid embedded in current map (DSM, 2000)"
        dsm_epoch = 2000
    elif args.dem == "none":
        dsm = np.zeros_like(X, dtype=np.float32); dsm_epoch = None
    else:
        grids = demmod.fetch_dem(bbox, prefer=args.dem)
        lon, lat = geo.to_wgs(X, Y)
        dsm = demmod.sample_grids(grids, lon, lat)
        sources_used["dem"] = "; ".join(sorted({LICENCES["cop30" if g.name == "COP30" else "srtm"] for g in grids}))
        dsm_epoch = 2015 if grids[0].name == "COP30" else 2000
    import shapely
    foot = unary_union([b["geom"].buffer(8) for b in blds]) if blds else box(0, 0, 0, 0)
    shapely.prepare(foot)
    bmask = shapely.contains_xy(foot, X, Y)
    # coast: NaN or <=0 => sea in the DSM
    ground = demmod.ground_from_dsm(np.where(dsm <= 0, np.nan, dsm), bmask)

    def bil(Z):
        def f(x, y):
            c = (np.asarray(x) - gx0) / st; r = (gy1 - np.asarray(y)) / st
            H, W = Z.shape
            c0 = np.clip(np.floor(c).astype(int), 0, W - 2); r0 = np.clip(np.floor(r).astype(int), 0, H - 2)
            fc, fr = np.clip(c - c0, 0, 1), np.clip(r - r0, 0, 1)
            return (Z[r0, c0] * (1 - fc) * (1 - fr) + Z[r0, c0 + 1] * fc * (1 - fr)
                    + Z[r0 + 1, c0] * (1 - fc) * fr + Z[r0 + 1, c0 + 1] * fc * fr)
        return f
    ground_fn, dsm_f = bil(ground), bil(np.where(np.isnan(dsm), 0, dsm))
    for b in blds:
        c = b["geom"].representative_point()
        b["base"] = float(np.nan_to_num(ground_fn(c.x, c.y)))
        if dsm_epoch and b["area"] >= 900:
            # p90 of DSM over a 5 m lattice inside the footprint minus ground
            x0_, y0_, x1_, y1_ = b["geom"].bounds
            px, py = np.meshgrid(np.arange(x0_, x1_, 5.0), np.arange(y0_, y1_, 5.0))
            ins = shapely.contains_xy(b["geom"], px, py)
            if ins.sum() >= 4:
                vals = dsm_f(px[ins], py[ins])
                b["ndsm_h"] = float(np.percentile(vals, 90) - b["base"])
            sd = b["tags"].get("start_date", "")
            b["newer_than_dsm"] = bool(sd[:4].isdigit() and int(sd[:4]) > dsm_epoch)
    log("dem: grid", X.shape, "ground range", float(np.nanmin(ground)), float(np.nanmax(ground)))

    # ---------------------------------------------------------------- 5. land / sea
    frame = box(*study.bounds).buffer(geo.TILE_M)
    land = landmask.land_polygon_from_coastline(osm["coast"], frame.bounds, osm["water"])
    if not osm["coast"]:
        # inland city, or coastline missing: keep everything land except mapped water
        land = frame.difference(unary_union(osm["water"])) if osm["water"] else frame
    land_qa = landmask.qa(land, frame.bounds, blds, water=osm["water"])
    log("land polygon km2:", round(land.area / 1e6, 1), "QA:", land_qa)

    # ---------------------------------------------------------------- 6. heights
    stats_src = heights.attach_heights(blds)
    calibration = stats_src.pop("_calibration", {})
    confs = {}
    for b in blds:
        confs[b["conf"]] = confs.get(b["conf"], 0) + 1
    log("heights by primary source:", stats_src, "conf:", confs)

    # ---------------------------------------------------------------- 7. tiles + manifest
    mar_area = tiles.maritime_tile_area(osm.get("maritime", []), box(*geo.bbox_wgs_to_itm(bbox)))
    keys = tiles.write_city(args.out, city, blds, osm["roads"], land, ground_fn, study,
                            maritime=osm.get("maritime", []), keep_sea_outside=not args.no_keep_sea,
                            extra_area=mar_area)
    if args.bathy:
        from yazam import bathy
        nb = bathy.write_tiles(args.out, keys, bathy.EsriAsciiGrid(args.bathy))
        sources_used["bathy"] = bathy.LICENCE_HINT + f" ({os.path.basename(args.bathy)}, {nb} tiles)"
    hs = np.array([b["h"] for b in blds]) if blds else np.zeros(1)
    ss = np.array([b["sigma"] for b in blds]) if blds else np.zeros(1)
    stats = {"buildings": len(blds), "tiles": len(keys), "area_km2": round(city_poly.area / 1e6, 2),
             "height_primary_source": stats_src, "confidence": confs,
             "h_median_m": round(float(np.median(hs)), 1), "sigma_median_m": round(float(np.median(ss)), 1),
             "distinct_heights_dm": int(len(np.unique(np.round(hs * 10)))),
             "land_qa": land_qa, "calibration": calibration, "seconds": round(time.time() - t0, 1)}
    m = tiles.write_manifest(args.out, city, keys, study, stats, sources_used, heights.SIGMA,
                             extra={"attribution": " | ".join(sorted(set(sources_used.values())))})
    tiles.update_index(args.out, m)

    # ---------------------------------------------------------------- 8. vegetation layer (tiles/g)
    if not args.no_green:
        from yazam import vegetation
        slots = json.load(open(args.tree_slots, encoding="utf-8")) if args.tree_slots else None
        nd = vegetation.load_ndvi_npz(args.ndvi) if args.ndvi else None
        gsrc = {"osm_green": f"{len(osm.get('green', []))} polygons, {len(osm.get('trees', []))} trees, "
                             f"{len(osm.get('tree_rows', []))} tree rows"}
        if slots:
            gsrc["slots"] = f"transport: {len(slots)} slots"
        if nd:
            gsrc["ndvi"] = ("SYNTHETIC FIXTURE " if nd["synthetic"] else "Sentinel-2 L2A ") + nd["scene"]
        gt = vegetation.build_green(args.out, keys, osm.get("green", []), osm.get("trees", []),
                                    osm.get("tree_rows", []), slots, nd)
        gs = vegetation.write_green(args.out, gt, city["slug"], gsrc)
        log("green:", gs["plants"], "plants by source", gs["by_src"])
    log("done:", json.dumps(stats, ensure_ascii=False))
    return m


if __name__ == "__main__":
    main()
