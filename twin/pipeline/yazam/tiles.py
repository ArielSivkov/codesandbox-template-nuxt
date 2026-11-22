"""Tile + manifest writer.

Layout (everything under one R2 bucket / folder, served by worker/worker.js):

  index.json                       country index: cities, status, bbox, tile count, version
  cities/<slug>/manifest.json      one city: boundary, tiles, stats, sources, licences, sigmas
  tiles/v/<tx>_<ty>.json.gz        vectors of one 1 km ITM tile: buildings, roads, sea polygons
  tiles/t/<tx>_<ty>.bin.gz         terrain (41x41 int16 dm, 25 m) + land mask (100x100 bits, 10 m)

Tiles are national (ITM km grid) and shared by neighbouring cities: writing a tile MERGES by
building id with what is already there, so Bat-Yam and Holon never duplicate a building.

Vector tile JSON (compact, same delta/decimetre ring encoding as the current page):
  {"v":1,"k":"166_634","o":[166000,634000],
   "b":[{"i":"w239196797","t":"apartments","n":"","a":539.5,"z":251,       # z: base elevation dm
         "r":[[dx,dy,dx,dy,...]],                                          # dm, first pair from tile origin
         "h":154,"s":21,"f":5,"fl":4,"fh":5,"src":"L","c":1,"u":"LN"}],    # h,s dm; c: 0 verified..3 low
   "rd":[{"c":2,"n":"הרצל","r":[...]}],
   "sea":[[[dx,dy,...]]]}                                                  # sea polygons clipped to tile
"""
from __future__ import annotations

import gzip
import json
import os
import struct
import time

import numpy as np
from shapely.geometry import box, MultiPolygon, Polygon, LineString, MultiLineString

from .geo import TILE_M, TERRAIN_STEP, MASK_STEP, COORD_Q, tile_key, tile_bounds, tile_of
from .landmask import rasterize, pack_bits

NT = TILE_M // TERRAIN_STEP + 1     # 41 samples incl. both edges -> seamless neighbours
NM = TILE_M // MASK_STEP            # 100 cells
SEA, OUTSIDE = -32768, -32767
CONF_IDX = {"מאומת": 0, "גבוה": 1, "בינוני": 2, "נמוך": 3}


def _enc_ring(coords, ox, oy):
    out, px, py = [], ox, oy
    for x, y in coords[:-1] if coords[0] == coords[-1] else coords:
        qx, qy = int(round((x - px) * COORD_Q)), int(round((y - py) * COORD_Q))
        out += [qx, qy]
        px += qx / COORD_Q; py += qy / COORD_Q
    return out


def _enc_poly(p, ox, oy):
    return [_enc_ring(list(p.exterior.coords), ox, oy)] + [_enc_ring(list(r.coords), ox, oy) for r in p.interiors]


def _polys(g):
    if isinstance(g, Polygon): return [g]
    if isinstance(g, MultiPolygon): return list(g.geoms)
    return [x for x in getattr(g, "geoms", []) if isinstance(x, Polygon)]


def _write_gz(path, data: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:          # mtime=0 -> byte-identical output for unchanged tiles
        fh.write(gzip.compress(data, compresslevel=9, mtime=0))


def _read_json_gz(path):
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rb") as f:
        return json.loads(f.read())


def building_record(b, ox, oy):
    p = _polys(b["geom"])
    p = max(p, key=lambda q: q.area)
    return {"i": b["id"], "t": b.get("type") or "", "n": b.get("name") or "", "a": round(b["area"], 1),
            "z": int(round(b.get("base", 0) * 10)), "r": _enc_poly(p.simplify(0.05), ox, oy),
            "h": int(round(b["h"] * 10)), "s": int(round(b["sigma"] * 10)), "f": b["floors"],
            "fl": b["floors_lo"], "fh": b["floors_hi"], "src": b["src"], "c": CONF_IDX[b["conf"]],
            "u": "".join(b["used"]), "x": "".join(b.get("rejected", []))}


def write_city(out_dir, city, buildings, roads, land_geom, ground_fn, study_area):
    """city: dict(slug,name_he,...); ground_fn(x,y)->metres (vectorised); study_area: Polygon (ITM)."""
    import shapely
    shapely.prepare(study_area)
    by_tile = {}
    for b in buildings:
        by_tile.setdefault(tile_of(b["cx"], b["cy"]), []).append(b)
    minx, miny, maxx, maxy = study_area.bounds
    keys = []
    for tx in range(int(minx // TILE_M), int(maxx // TILE_M) + 1):
        for ty in range(int(miny // TILE_M), int(maxy // TILE_M) + 1):
            x0, y0, x1, y1 = tile_bounds(tx, ty)
            fr = box(x0, y0, x1, y1)
            if not fr.intersects(study_area):
                continue
            k = tile_key(tx, ty)
            keys.append(k)
            # ---------- terrain + land mask (binary)
            xs = x0 + np.arange(NT) * TERRAIN_STEP
            ys = y1 - np.arange(NT) * TERRAIN_STEP          # row 0 = north
            X, Y = np.meshgrid(xs, ys)
            z = ground_fn(X, Y)
            inside = shapely.contains_xy(study_area.buffer(TERRAIN_STEP * 2), X, Y)
            land_pts = shapely.contains_xy(land_geom.buffer(1.0), X, Y) if not land_geom.is_empty else np.zeros_like(inside)
            zz = np.where(np.isnan(z), 0, z)
            zz = np.where(land_pts, np.maximum(zz, 0.3), 0)          # land never below +0.3 m
            q = np.round(zz * 10).astype(np.int32)
            q = np.where(land_pts, q, SEA)
            q = np.where(inside, q, OUTSIDE).astype("<i2")
            mask = rasterize(land_geom, x0, y0, MASK_STEP, NM, NM)
            hdr = struct.pack("<4sHiiHHH", b"YZT1", 1, tx, ty, NT, NM, TERRAIN_STEP)
            _write_gz(os.path.join(out_dir, "tiles/t", k + ".bin.gz"), hdr + q.tobytes() + pack_bits(mask))
            # ---------- vectors (merge with existing tile from a neighbouring city)
            vp = os.path.join(out_dir, "tiles/v", k + ".json.gz")
            old = _read_json_gz(vp) or {"v": 1, "k": k, "o": [x0, y0], "b": [], "rd": [], "sea": []}
            mine = {b["id"] for b in by_tile.get((tx, ty), [])}
            recs = [r for r in old["b"] if r["i"] not in mine]
            recs += [building_record(b, x0, y0) for b in by_tile.get((tx, ty), [])]
            rd = []
            for r in roads:
                g = r["geom"].intersection(fr)
                for ln in (g.geoms if hasattr(g, "geoms") else [g]):
                    if isinstance(ln, LineString) and not ln.is_empty and ln.length > 1:
                        rd.append({"c": r["cls"], "n": r.get("name", ""), "r": _enc_ring(list(ln.coords), x0, y0)})
            sea = fr.difference(land_geom) if not land_geom.is_empty else fr
            sea = [_enc_poly(p.simplify(1.0), x0, y0) for p in _polys(sea) if p.area > 25]
            old.update({"b": recs, "rd": rd if rd else old.get("rd", []), "sea": sea})
            _write_gz(vp, json.dumps(old, ensure_ascii=False, separators=(",", ":")).encode())
    return keys


def write_manifest(out_dir, city, keys, study_area, stats, sources, sigma, extra=None):
    b = study_area.simplify(20)
    ring = _polys(b)
    m = {
        "v": 1, "slug": city["slug"], "name_he": city["name_he"], "crs": "EPSG:2039",
        "tile_m": TILE_M, "terrain_step": TERRAIN_STEP, "mask_step": MASK_STEP, "coord_q": COORD_Q,
        "bbox_itm": [round(v) for v in study_area.bounds], "tiles": sorted(keys),
        "boundary": [_enc_poly(p, 0, 0) for p in ring], "boundary_kind": city.get("boundary_kind", "osm_admin8"),
        "stats": stats, "sources": sources, "sigma_m": sigma,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if extra:
        m.update(extra)
    p = os.path.join(out_dir, "cities", city["slug"], "manifest.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(m, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return m


def update_index(out_dir, manifest):
    p = os.path.join(out_dir, "index.json")
    idx = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"v": 1, "crs": "EPSG:2039", "cities": {}}
    idx["cities"][manifest["slug"]] = {"name_he": manifest["name_he"], "bbox_itm": manifest["bbox_itm"],
                                       "tiles": len(manifest["tiles"]), "buildings": manifest["stats"]["buildings"],
                                       "built_at": manifest["built_at"],
                                       "manifest": f"cities/{manifest['slug']}/manifest.json"}
    idx["updated_at"] = manifest["built_at"]
    json.dump(idx, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return idx
