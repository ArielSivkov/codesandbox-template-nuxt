#!/usr/bin/env python3
"""Battalion 7 - street-level photo COVERAGE layer for Yazam ("שטחים מכוסים / לא מכוסים").

Given a bbox it (1) pulls open, privacy-blurred street-level photo METADATA from Mapillary
(API v4, CC-BY-SA imagery), (2) casts the field of view of every photo against building
footprints (occlusion-aware 2-D ray casting), and writes:

  buildings_coverage.geojson  one polygon per building: coverage %, seen facades, newest date
  facades.geojson             one line per facade edge: seen / partial / unseen, n_photos, date,
                              best photo id + thumbnail link + attribution
  coverage_grid.geojson       square ITM cells (default 100 m) or H3 cells if `h3` installed:
                              photo count, facade metres seen/total, status
  missions.json / .csv        capture missions: streets whose facades nobody photographed yet

Usage
  export MAPILLARY_TOKEN=MLY|...              # free client token from mapillary.com/dashboard
  python coverage.py --bbox 34.640,31.795,34.655,31.805 --b5-tiles ../b5/pipeline/sample-out-ashdod/tiles/v
  python coverage.py --bbox ... --buildings my_buildings.geojson     # WGS84 polygons
  python coverage.py --mock --out out_mock                           # offline synthetic sample
  python coverage.py --bbox ... --images-json cached.json            # re-run on cached metadata

Nothing is downloaded except metadata + thumbnail URLs; images stay on Mapillary (their
license: CC-BY-SA, attribution "by <username> on Mapillary").  Faces/plates are blurred by
Mapillary; we never run face or person detection.
"""
from __future__ import annotations

import argparse
import csv
import glob
import gzip
import json
import math
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon, box, mapping

B5_PIPELINE = os.environ.get("YAZAM_B5", "/home/claude/swarm/b5/pipeline")
API = "https://graph.mapillary.com/images"
FIELDS = ("id,geometry,computed_geometry,compass_angle,computed_compass_angle,camera_type,"
          "camera_parameters,width,height,captured_at,is_pano,sequence,thumb_1024_url,creator")

# ------------------------------------------------------------------ projection (ITM, as B5)
_TF = None


def _tf():
    global _TF
    if _TF is None:
        from pyproj import Transformer
        _TF = (Transformer.from_crs(4326, 2039, always_xy=True), Transformer.from_crs(2039, 4326, always_xy=True))
    return _TF


def to_itm(lon, lat):
    return _tf()[0].transform(lon, lat)


def to_wgs(x, y):
    return _tf()[1].transform(x, y)


def geom_to_wgs(g):
    import shapely

    def f(a):
        x, y = _tf()[1].transform(a[:, 0], a[:, 1])
        return np.column_stack([x, y])
    return shapely.transform(g, f)


# ------------------------------------------------------------------ Mapillary client
def _split(bbox, tile_deg):
    w, s, e, n = bbox
    out, y = [], s
    while y < n:
        x = w
        while x < e:
            out.append((x, y, min(x + tile_deg, e), min(y + tile_deg, n)))
            x += tile_deg
        y += tile_deg
    return out


def fetch_mapillary(bbox, token, tile_deg=0.01, limit=2000, min_captured_at=None, log=print):
    """All images in bbox. API: bbox must be small (doc: 'smaller than 0.01 degrees square'),
    max 2000 per call and no pagination for bbox -> split into tiles and recurse on full tiles."""
    import requests
    sess = requests.Session()
    sess.headers["Authorization"] = "OAuth " + token
    seen, out = set(), []

    def get(bb, depth=0):
        params = {"bbox": ",".join(f"{v:.6f}" for v in bb), "fields": FIELDS, "limit": limit}
        if min_captured_at:
            params["start_captured_at"] = min_captured_at
        for attempt in range(5):
            r = sess.get(API, params=params, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt); continue
            r.raise_for_status()
            break
        data = r.json().get("data", [])
        if len(data) >= limit and depth < 6:      # tile saturated -> quarter it
            w, s, e, n = bb; mx, my = (w + e) / 2, (s + n) / 2
            for q in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
                get(q, depth + 1)
            return
        for d in data:
            if d["id"] not in seen:
                seen.add(d["id"]); out.append(d)

    tiles = _split(bbox, tile_deg)
    for i, bb in enumerate(tiles):
        get(bb)
        if i % 20 == 0:
            log(f"mapillary tiles {i + 1}/{len(tiles)}  images so far {len(out)}")
    return out


# ------------------------------------------------------------------ camera model
def hfov_deg(img, default=60.0):
    """Horizontal field of view. Panoramas: 360. Perspective: from camera_parameters[0] =
    focal length normalised by max(width,height) (OpenSfM convention - [unverified for every
    upload]); clamp to 20..120 deg; default 60 if unknown."""
    if img.get("is_pano") or img.get("camera_type") in ("spherical", "equirectangular"):
        return 360.0
    cp = img.get("camera_parameters") or []
    w, h = img.get("width") or 0, img.get("height") or 0
    if cp and cp[0] and w and h:
        half = 0.5 * (w / max(w, h)) / float(cp[0])
        return float(min(120.0, max(20.0, 2 * math.degrees(math.atan(half)))))
    if img.get("camera_type") == "fisheye":
        return 120.0
    return default


def camera(img):
    g = img.get("computed_geometry") or img.get("geometry")
    if not g:
        return None
    lon, lat = g["coordinates"][:2]
    head = img.get("computed_compass_angle")
    if head is None:
        head = img.get("compass_angle")
    if head is None and not img.get("is_pano"):
        return None
    x, y = to_itm(lon, lat)
    ts = img.get("captured_at")
    date = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d") if ts else ""
    cr = img.get("creator") or {}
    return {"id": str(img["id"]), "x": x, "y": y, "heading": float(head or 0.0), "fov": hfov_deg(img),
            "date": date, "thumb": img.get("thumb_1024_url", ""),
            "by": cr.get("username", "") if isinstance(cr, dict) else str(cr),
            "computed": bool(img.get("computed_geometry"))}


# ------------------------------------------------------------------ buildings
def _dec_ring(r, ox, oy, q=10.0):
    pts, x, y = [], ox, oy
    for i in range(0, len(r), 2):
        x += r[i] / q; y += r[i + 1] / q
        pts.append((x, y))
    return pts


def load_b5_tiles(tiles_dir, bbox_itm):
    """Read Battalion 5 vector tiles (tiles/v/<tx>_<ty>.json.gz, ITM dm delta rings)."""
    x0, y0, x1, y1 = bbox_itm
    blds, roads = [], []
    for tx in range(int(x0 // 1000), int(x1 // 1000) + 1):
        for ty in range(int(y0 // 1000), int(y1 // 1000) + 1):
            p = os.path.join(tiles_dir, f"{tx}_{ty}.json.gz")
            if not os.path.exists(p):
                continue
            with gzip.open(p, "rb") as fh:
                T = json.loads(fh.read())
            ox, oy = T["o"]
            for b in T["b"]:
                rings = [_dec_ring(r, ox, oy) for r in b["r"]]
                if len(rings[0]) < 3:
                    continue
                g = Polygon(rings[0], rings[1:])
                if not g.is_valid:
                    g = g.buffer(0)
                if g.is_empty or not g.intersects(box(*bbox_itm)) or g.geom_type != "Polygon":
                    continue
                blds.append({"id": b["i"], "geom": g, "type": b.get("t", ""), "h": b.get("h", 0) / 10.0,
                             "floors": b.get("f")})
            for r in T.get("rd", []):
                pts = _dec_ring(r["r"], ox, oy)
                if len(pts) >= 2:
                    roads.append({"name": r.get("n", ""), "geom": LineString(pts)})
    return blds, roads


def load_geojson_buildings(path, bbox_itm):
    import shapely
    from shapely.geometry import shape

    def fwd(a):
        x, y = _tf()[0].transform(a[:, 0], a[:, 1])
        return np.column_stack([x, y])
    js = json.load(open(path, encoding="utf-8"))
    out = []
    for i, f in enumerate(js["features"]):
        g = shapely.transform(shape(f["geometry"]), fwd)
        polys = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
        for k, p in enumerate(polys):
            if p.intersects(box(*bbox_itm)):
                pid = str(f.get("id") or f["properties"].get("id") or i) + (f"_{k}" if k else "")
                out.append({"id": pid, "geom": p, "type": f["properties"].get("building", ""), "h": 0, "floors": None})
    return out


# ------------------------------------------------------------------ facades
def facades_of(blds, min_len=2.0, slot_m=2.0):
    """Exterior edges >= min_len m. Each facade is cut into slots of ~slot_m for partial coverage."""
    out = []
    for bi, b in enumerate(blds):
        ext = b["geom"].exterior
        c = list(ext.coords)
        if not ext.is_ccw:
            c = c[::-1]
        for k in range(len(c) - 1):
            (ax, ay), (bx, by) = c[k], c[k + 1]
            L = math.hypot(bx - ax, by - ay)
            if L < min_len:
                continue
            nx, ny = (by - ay) / L, -(bx - ax) / L   # CCW ring -> outward normal = edge turned right
            ns = max(1, int(round(L / slot_m)))
            out.append({"b": bi, "k": k, "a": (ax, ay), "bb": (bx, by), "len": L, "n": (nx, ny),
                        "az": (math.degrees(math.atan2(nx, ny)) + 360) % 360,
                        "slots": np.zeros(ns, bool), "imgs": {}, "dates": [], "best": None})
    return out


def _ray_hits(ox, oy, dx, dy, A, B):
    """Vectorised ray (o + t d, t>=0) vs segments A->B. Returns (t, u) arrays (nan if miss)."""
    ex, ey = B[:, 0] - A[:, 0], B[:, 1] - A[:, 1]
    den = dx * ey - dy * ex
    with np.errstate(divide="ignore", invalid="ignore"):
        wx, wy = A[:, 0] - ox, A[:, 1] - oy
        t = (wx * ey - wy * ex) / den
        u = (wx * dy - wy * dx) / den
    ok = (np.abs(den) > 1e-12) & (t > 0.05) & (u >= 0) & (u <= 1)
    return np.where(ok, t, np.nan), u


def cast(cams, facades, blds, max_range=60.0, ray_step=1.0, max_incidence=75.0, min_rays=1):
    """For every camera cast rays every ray_step deg across its FOV; the FIRST facade hit along
    each ray is what the photo sees (occlusion by nearer buildings handled). A hit counts when
    the ray meets the facade from outside and within max_incidence deg of its normal."""
    A = np.array([f["a"] for f in facades]); B = np.array([f["bb"] for f in facades])
    N = np.array([f["n"] for f in facades])
    segs = [LineString([f["a"], f["bb"]]) for f in facades]
    tree = STRtree(segs)
    footprints = STRtree([b["geom"] for b in blds])
    cos_max = math.cos(math.radians(max_incidence))
    skipped_inside = 0
    for c in cams:
        if len(footprints.query(Point(c["x"], c["y"]), predicate="within")):
            skipped_inside += 1                      # GPS put the camera inside a building
            continue
        near = tree.query(Point(c["x"], c["y"]).buffer(max_range))
        if not len(near):
            continue
        a, b_, n_ = A[near], B[near], N[near]
        half = c["fov"] / 2
        angs = np.arange(-half, half + 1e-9, ray_step) if c["fov"] < 360 else np.arange(0, 360, ray_step)
        hits_here = defaultdict(int)
        for da in angs:
            az = math.radians(c["heading"] + da)
            dx, dy = math.sin(az), math.cos(az)              # azimuth from north, clockwise
            t, u = _ray_hits(c["x"], c["y"], dx, dy, a, b_)
            if np.all(np.isnan(t)):
                continue
            j = int(np.nanargmin(t))
            if t[j] > max_range:
                continue
            facing = -(dx * n_[j, 0] + dy * n_[j, 1])        # cos(incidence) if hitting from outside
            if facing < cos_max:
                continue
            fi = int(near[j]); f = facades[fi]
            s = min(len(f["slots"]) - 1, int(u[j] * len(f["slots"])))
            f["slots"][s] = True
            hits_here[fi] += 1
            if f["best"] is None or t[j] < f["best"][0]:
                f["best"] = (float(t[j]), c["id"], c["thumb"], c["by"], c["date"])
        for fi, n in hits_here.items():
            if n >= min_rays:
                facades[fi]["imgs"][c["id"]] = n
                if c["date"]:
                    facades[fi]["dates"].append(c["date"])
    return skipped_inside


def facade_status(f, seen_frac=0.6):
    fr = float(f["slots"].mean())
    return ("seen" if fr >= seen_frac else "partial" if fr > 0 else "unseen"), fr


# ------------------------------------------------------------------ grid
def grid_cells(bbox_itm, cell_m):
    x0, y0, x1, y1 = bbox_itm
    out = {}
    for i in range(int(x0 // cell_m), int(x1 // cell_m) + 1):
        for j in range(int(y0 // cell_m), int(y1 // cell_m) + 1):
            out[(i, j)] = box(i * cell_m, j * cell_m, (i + 1) * cell_m, (j + 1) * cell_m)
    return out


def cell_key(x, y, cell_m, h3res=None):
    if h3res is not None:
        import h3
        lon, lat = to_wgs(x, y)
        return h3.latlng_to_cell(lat, lon, h3res)
    return (int(x // cell_m), int(y // cell_m))


# ------------------------------------------------------------------ main pipeline
def run(cams, blds, roads, bbox_itm, out_dir, cell_m=100.0, h3res=None, **kw):
    os.makedirs(out_dir, exist_ok=True)
    facades = facades_of(blds)
    skipped = cast(cams, facades, blds, **{k: v for k, v in kw.items() if k in ("max_range", "ray_step", "max_incidence")})
    # ---- per facade + per building
    per_b = defaultdict(list)
    fac_feats = []
    for f in facades:
        st, fr = facade_status(f)
        per_b[f["b"]].append((f, st, fr))
        best = f["best"]
        props = {"building": blds[f["b"]]["id"], "edge": f["k"], "len_m": round(f["len"], 1),
                 "facing_az": round(f["az"]), "status": st, "seen_frac": round(fr, 2),
                 "n_photos": len(f["imgs"]), "first": min(f["dates"]) if f["dates"] else "",
                 "last": max(f["dates"]) if f["dates"] else "",
                 "best_photo": best[1] if best else "", "best_dist_m": round(best[0], 1) if best else None,
                 "thumb": best[2] if best else "", "attribution": (f"{best[3]} / Mapillary, CC-BY-SA" if best else "")}
        fac_feats.append({"type": "Feature", "geometry": mapping(geom_to_wgs(LineString([f["a"], f["bb"]]))),
                          "properties": props})
    b_feats = []
    for bi, b in enumerate(blds):
        fl = per_b.get(bi, [])
        tot = sum(f["len"] for f, _, _ in fl)
        seen = sum(f["len"] * fr for f, _, fr in fl)
        dates = [d for f, _, _ in fl for d in f["dates"]]
        photos = set(i for f, _, _ in fl for i in f["imgs"])
        b["cov"] = seen / tot if tot else 0.0
        b_feats.append({"type": "Feature", "geometry": mapping(geom_to_wgs(b["geom"])), "properties": {
            "id": b["id"], "type": b.get("type", ""), "perimeter_m": round(tot, 1),
            "facade_cov": round(b["cov"], 2), "facades_seen": sum(1 for _, s, _ in fl if s == "seen"),
            "facades_partial": sum(1 for _, s, _ in fl if s == "partial"),
            "facades_unseen": sum(1 for _, s, _ in fl if s == "unseen"), "n_photos": len(photos),
            "last_photo": max(dates) if dates else "",
            "status_he": "מכוסה" if b["cov"] >= 0.5 else "חלקי" if b["cov"] > 0 else "לא מכוסה"}})
    # ---- grid
    cells = defaultdict(lambda: {"img": 0, "tot": 0.0, "seen": 0.0, "last": "", "nb": 0})
    for c in cams:
        cells[cell_key(c["x"], c["y"], cell_m, h3res)]["img"] += 1
    for f in facades:
        mx, my = (f["a"][0] + f["bb"][0]) / 2, (f["a"][1] + f["bb"][1]) / 2
        k = cell_key(mx, my, cell_m, h3res)
        cells[k]["tot"] += f["len"]; cells[k]["seen"] += f["len"] * float(f["slots"].mean())
        if f["dates"]:
            cells[k]["last"] = max(cells[k]["last"], max(f["dates"]))
    for b in blds:
        c = b["geom"].representative_point()
        cells[cell_key(c.x, c.y, cell_m, h3res)]["nb"] += 1
    g_feats = []
    for k, v in cells.items():
        if h3res is not None:
            import h3
            ring = [(lon, lat) for lat, lon in h3.cell_to_boundary(k)]
            geom = {"type": "Polygon", "coordinates": [ring + [ring[0]]]}
        else:
            geom = mapping(geom_to_wgs(box(k[0] * cell_m, k[1] * cell_m, (k[0] + 1) * cell_m, (k[1] + 1) * cell_m)))
        r = v["seen"] / v["tot"] if v["tot"] else None
        st = "אין בניינים" if r is None else "מכוסה" if r >= 0.5 else "חלקי" if r >= 0.1 else "לא מכוסה"
        g_feats.append({"type": "Feature", "geometry": geom, "properties": {
            "cell": str(k), "photos": v["img"], "buildings": v["nb"], "facade_m": round(v["tot"]),
            "facade_seen_m": round(v["seen"]), "ratio": None if r is None else round(r, 2),
            "last_photo": v["last"], "status_he": st}})
    # ---- missions: unseen facade metres per street (nearest named road), else per cell
    named = [r for r in roads if r.get("name")]
    rtree = STRtree([r["geom"] for r in named]) if named else None
    miss = defaultdict(lambda: {"unseen_m": 0.0, "buildings": set(), "pts": []})
    for f in facades:
        st, fr = facade_status(f)
        if st == "seen":
            continue
        mx, my = (f["a"][0] + f["bb"][0]) / 2, (f["a"][1] + f["bb"][1]) / 2
        name = None
        if rtree is not None:   # the street the facade FACES: first named road along its normal
            ray = LineString([(mx, my), (mx + f["n"][0] * 80, my + f["n"][1] * 80)])
            cand = [j for j in rtree.query(ray, predicate="intersects")]
            if cand:
                j = min(cand, key=lambda j: named[j]["geom"].distance(Point(mx, my)))
                name = named[j]["name"]
            else:
                j = rtree.nearest(Point(mx, my))
                if named[j]["geom"].distance(Point(mx, my)) <= 60:
                    name = named[j]["name"]
        key = name or f"תא {cell_key(mx, my, cell_m, h3res)}"
        m = miss[key]; m["unseen_m"] += f["len"] * (1 - fr); m["buildings"].add(blds[f["b"]]["id"]); m["pts"].append((mx, my))
    missions = []
    for k, v in sorted(miss.items(), key=lambda kv: -kv[1]["unseen_m"]):
        cx, cy = np.mean([p[0] for p in v["pts"]]), np.mean([p[1] for p in v["pts"]])
        lon, lat = to_wgs(cx, cy)
        missions.append({"משימה": k, "מטר_חזית_לא_מצולם": round(v["unseen_m"]), "בניינים": len(v["buildings"]),
                         "lat": round(lat, 6), "lon": round(lon, 6),
                         "הנחיה": "לצלם ברצף עם אפליקציית Mapillary/Panoramax, מצלמה בגובה העיניים, "
                                  "פנים לחזיתות, כל 3–5 מ'; בלי לצלם לתוך חלונות או חצרות פרטיות"})
    # ---- write
    def dump(name, feats):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "features": feats}, fh, ensure_ascii=False)
    dump("buildings_coverage.geojson", b_feats)
    dump("facades.geojson", fac_feats)
    dump("coverage_grid.geojson", g_feats)
    json.dump(missions, open(os.path.join(out_dir, "missions.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if missions:
        with open(os.path.join(out_dir, "missions.csv"), "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(missions[0].keys())); w.writeheader(); w.writerows(missions)
    tot = sum(f["len"] for f in facades); seen = sum(f["len"] * float(f["slots"].mean()) for f in facades)
    summary = {"images": len(cams), "images_inside_footprint_skipped": skipped, "buildings": len(blds),
               "facades": len(facades), "facade_m": round(tot), "facade_seen_m": round(seen),
               "facade_cov": round(seen / tot, 3) if tot else 0,
               "buildings_any_photo": sum(1 for b in blds if b.get("cov", 0) > 0),
               "missions": len(missions), "license": "Mapillary imagery CC-BY-SA; buildings per source (OSM ODbL)"}
    json.dump(summary, open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return summary


# ------------------------------------------------------------------ mock sample (offline)
def mock_sample(origin_lonlat=(34.6500, 31.8000)):
    """Synthetic block in Ashdod ITM space: a street running east-west (y = 0), 2 rows of
    buildings north of it (front row + a second row hidden behind), 1 row south, and a
    Mapillary-like sequence driving east along the street with a forward camera, plus 2 panos.
    Returns (images_as_api_json, buildings, roads, bbox_itm)."""
    ox, oy = to_itm(*origin_lonlat)
    blds = []
    for i in range(5):                                   # north front row, 12 m wide, 6 m gaps
        x = ox + i * 18
        blds.append({"id": f"N{i}", "geom": box(x, oy + 8, x + 12, oy + 22), "type": "apartments", "h": 0, "floors": None})
        blds.append({"id": f"NB{i}", "geom": box(x, oy + 30, x + 12, oy + 44), "type": "apartments", "h": 0, "floors": None})
    for i in range(3):                                   # south row, further along the street
        x = ox + 100 + i * 20
        blds.append({"id": f"S{i}", "geom": box(x, oy - 22, x + 14, oy - 8), "type": "apartments", "h": 0, "floors": None})
    roads = [{"name": "רחוב הניסוי", "geom": LineString([(ox - 50, oy), (ox + 200, oy)])},
             {"name": "סמטת האחור", "geom": LineString([(ox - 50, oy + 52), (ox + 200, oy + 52)])}]
    imgs, t0 = [], 1730000000000
    for k in range(0, 15):                               # forward camera looking NE (heading 45) every 6 m
        x, y = ox - 10 + k * 6, oy - 2
        lon, lat = to_wgs(x, y)
        imgs.append({"id": f"m{k}", "computed_geometry": {"type": "Point", "coordinates": [lon, lat]},
                     "computed_compass_angle": 20.0, "camera_type": "perspective", "camera_parameters": [0.8, 0, 0],
                     "width": 2048, "height": 1536, "captured_at": t0 + k * 2000, "is_pano": False,
                     "thumb_1024_url": f"https://example.invalid/thumb/m{k}.jpg", "creator": {"username": "mock_user"}})
    for k, xx in enumerate((ox + 110, ox + 140)):        # two 360 panos further east
        lon, lat = to_wgs(xx, oy + 1)
        imgs.append({"id": f"p{k}", "computed_geometry": {"type": "Point", "coordinates": [lon, lat]},
                     "computed_compass_angle": 90.0, "camera_type": "spherical", "is_pano": True,
                     "captured_at": t0 + 10 ** 8, "thumb_1024_url": "", "creator": {"username": "mock_user"}})
    bbox = (ox - 60, oy - 60, ox + 210, oy + 70)
    return imgs, blds, roads, bbox


def mock_images_on_roads(roads, spacing=12.0, frac=0.5, seed=1):
    """SYNTHETIC Mapillary-like metadata along real road lines (to test scale/perf offline):
    a random `frac` of roads gets a drive with a forward camera every `spacing` m."""
    rng = np.random.default_rng(seed)
    imgs, n = [], 0
    for r in roads:
        g = r["geom"]
        if g.length < spacing or rng.random() > frac:
            continue
        for d in np.arange(0, g.length, spacing):
            p, q = g.interpolate(d), g.interpolate(min(g.length, d + 1.0))
            head = (np.degrees(np.arctan2(q.x - p.x, q.y - p.y)) + 360) % 360
            lon, lat = to_wgs(p.x, p.y)
            imgs.append({"id": f"syn{n}", "computed_geometry": {"type": "Point", "coordinates": [lon, lat]},
                         "computed_compass_angle": float(head + rng.choice([-30, 0, 30])), "camera_type": "perspective",
                         "camera_parameters": [0.85, 0, 0], "width": 2048, "height": 1536,
                         "captured_at": 1700000000000 + n * 1000, "is_pano": False, "creator": {"username": "synthetic"}})
            n += 1
    return imgs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", help="WGS84 w,s,e,n")
    ap.add_argument("--b5-tiles", default=os.path.join(B5_PIPELINE, "sample-out-ashdod/tiles/v"))
    ap.add_argument("--buildings", help="GeoJSON WGS84 polygons (instead of B5 tiles)")
    ap.add_argument("--images-json", help="cached Mapillary metadata (list) - offline re-run")
    ap.add_argument("--save-images-json", help="write fetched metadata here")
    ap.add_argument("--mock", action="store_true", help="synthetic offline sample")
    ap.add_argument("--out", default="out")
    ap.add_argument("--cell-m", type=float, default=100.0)
    ap.add_argument("--h3", type=int, default=None, help="H3 resolution instead of square cells (needs `pip install h3`)")
    ap.add_argument("--max-range", type=float, default=60.0)
    ap.add_argument("--ray-step", type=float, default=1.0)
    ap.add_argument("--since", help="only photos captured after YYYY-MM-DD")
    ap.add_argument("--tile-deg", type=float, default=0.01)
    ap.add_argument("--mock-images-on-roads", action="store_true",
                    help="real buildings/roads from B5 tiles + SYNTHETIC photo metadata (offline scale test)")
    a = ap.parse_args(argv)
    if a.mock:
        imgs, blds, roads, bbox_itm = mock_sample()
    else:
        if not a.bbox:
            sys.exit("--bbox w,s,e,n required (or --mock)")
        bb = tuple(map(float, a.bbox.split(",")))
        xs, ys = zip(*[to_itm(lon, lat) for lon, lat in ((bb[0], bb[1]), (bb[2], bb[3]), (bb[0], bb[3]), (bb[2], bb[1]))])
        bbox_itm = (min(xs), min(ys), max(xs), max(ys))
        if a.buildings:
            blds, roads = load_geojson_buildings(a.buildings, bbox_itm), []
        else:
            blds, roads = load_b5_tiles(a.b5_tiles, bbox_itm)
        if a.mock_images_on_roads:
            imgs = mock_images_on_roads(roads)
        elif a.images_json:
            imgs = json.load(open(a.images_json, encoding="utf-8"))
        else:
            tok = os.environ.get("MAPILLARY_TOKEN")
            if not tok:
                sys.exit("set MAPILLARY_TOKEN (free client token: mapillary.com/dashboard/developers)")
            since = None
            if a.since:
                since = datetime.strptime(a.since, "%Y-%m-%d").replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            imgs = fetch_mapillary(bb, tok, a.tile_deg, min_captured_at=since)
            if a.save_images_json:
                json.dump(imgs, open(a.save_images_json, "w"), ensure_ascii=False)
    cams = [c for c in (camera(i) for i in imgs) if c]
    s = run(cams, blds, roads, bbox_itm, a.out, cell_m=a.cell_m, h3res=a.h3, max_range=a.max_range, ray_step=a.ray_step)
    print(json.dumps(s, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
