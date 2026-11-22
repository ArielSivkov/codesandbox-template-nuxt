"""Projection + national tile grid.

All geometry is stored in Israeli Transverse Mercator (ITM, EPSG:2039), metres.
The whole country shares ONE tile grid (1 km x 1 km ITM squares), so cities that
touch each other never duplicate or seam buildings, and the client can lazy-load
any tile by key without knowing which city it belongs to.
"""
from __future__ import annotations

import math
from functools import lru_cache

TILE_M = 1000          # tile edge (m) – ~1-3k buildings in dense Israeli centres
TERRAIN_STEP = 25      # terrain sample spacing (m) -> 41x41 samples per tile
MASK_STEP = 10         # land/sea mask resolution (m) -> 100x100 bits per tile
COORD_Q = 10           # coordinate quantisation: decimetres (same as current map)


@lru_cache(maxsize=1)
def _tf():
    from pyproj import Transformer
    fwd = Transformer.from_crs(4326, 2039, always_xy=True)
    inv = Transformer.from_crs(2039, 4326, always_xy=True)
    return fwd, inv


def to_itm(lon, lat):
    return _tf()[0].transform(lon, lat)


def to_wgs(x, y):
    return _tf()[1].transform(x, y)


def bbox_wgs_to_itm(bbox):
    """(minlon, minlat, maxlon, maxlat) -> (minx, miny, maxx, maxy) ITM, padded to corners."""
    w, s, e, n = bbox
    xs, ys = [], []
    for lon, lat in ((w, s), (w, n), (e, s), (e, n)):
        x, y = to_itm(lon, lat)
        xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def tile_key(tx: int, ty: int) -> str:
    return f"{tx}_{ty}"            # e.g. "166_634" = ITM km square [166000,167000) x [634000,635000)


def tile_of(x: float, y: float):
    return int(math.floor(x / TILE_M)), int(math.floor(y / TILE_M))


def tiles_for_bbox(minx, miny, maxx, maxy):
    tx0, ty0 = tile_of(minx, miny)
    tx1, ty1 = tile_of(maxx, maxy)
    return [(tx, ty) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1)]


def tile_bounds(tx, ty):
    return tx * TILE_M, ty * TILE_M, (tx + 1) * TILE_M, (ty + 1) * TILE_M
