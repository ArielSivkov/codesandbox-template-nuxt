"""Elevation: read global DSMs, derive a bare-ground DTM inside cities, and nDSM building heights.

Inputs (all global, ~30 m, they are SURFACE models – they include roofs and trees):
  * Copernicus GLO-30 COG (AWS open data bucket `copernicus-dem-30m`) – preferred
  * SRTM 1" .hgt (e.g. AWS `elevation-tiles-prod/skadi`) – fallback, measured Feb-2000

Why we need a DTM: the current map uses raw SRTM as "ground", so in dense areas the ground is
lifted by roofs/trees (the current page itself warns about this) and building bases float.
Here we mask building footprints, in-paint the ground from open cells, and only then:
  ground(x,y)      -> terrain tiles and building base elevation
  DSM - ground     -> an nDSM height estimate per footprint (useful only for tall, large
                      buildings: 30 m pixels mix roofs with streets; see report for accuracy).
"""
from __future__ import annotations

import gzip
import io
import math
import os

import numpy as np

COP_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
SKADI_URL = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/{ns}{lat:02d}/{ns}{lat:02d}{ew}{lon:03d}.hgt.gz"


class GeoGrid:
    """A lon/lat raster: data[row, col], row 0 = north. Pixel-is-point georeference."""

    def __init__(self, data, lon0, lat0, dlon, dlat, nodata=None, epoch="unknown", name="dem"):
        self.data = data.astype(np.float32)
        if nodata is not None:
            self.data[data == nodata] = np.nan
        self.lon0, self.lat0, self.dlon, self.dlat = lon0, lat0, dlon, dlat  # lat0 = north edge sample
        self.epoch, self.name = epoch, name

    def sample(self, lon, lat):
        """Bilinear sample (arrays ok). NaN outside / on voids."""
        c = (np.asarray(lon) - self.lon0) / self.dlon
        r = (self.lat0 - np.asarray(lat)) / self.dlat
        H, W = self.data.shape
        c0 = np.clip(np.floor(c).astype(int), 0, W - 2)
        r0 = np.clip(np.floor(r).astype(int), 0, H - 2)
        fc, fr = np.clip(c - c0, 0, 1), np.clip(r - r0, 0, 1)
        d = self.data
        v = (d[r0, c0] * (1 - fc) * (1 - fr) + d[r0, c0 + 1] * fc * (1 - fr)
             + d[r0 + 1, c0] * (1 - fc) * fr + d[r0 + 1, c0 + 1] * fc * fr)
        out = (c < 0) | (r < 0) | (c > W - 1) | (r > H - 1)
        return np.where(out, np.nan, v)


def _tile_ids(bbox):
    w, s, e, n = bbox
    for lat in range(math.floor(s), math.floor(n) + 1):
        for lon in range(math.floor(w), math.floor(e) + 1):
            yield lat, lon


def read_hgt(raw: bytes, lat: int, lon: int):
    n = int(round(math.sqrt(len(raw) // 2)))
    a = np.frombuffer(raw, dtype=">i2").reshape(n, n)
    step = 1.0 / (n - 1)
    return GeoGrid(a, lon, lat + 1, step, step, nodata=-32768, epoch="2000-02", name="SRTM")


def read_geotiff(raw: bytes, name="COP30", epoch="2011-2015"):
    import tifffile
    with tifffile.TiffFile(io.BytesIO(raw)) as tf:
        p = tf.pages[0]
        a = p.asarray()
        scale = p.tags["ModelPixelScaleTag"].value
        tie = p.tags["ModelTiepointTag"].value
        raster_type = 1  # 1 = PixelIsArea (default), 2 = PixelIsPoint
        try:
            gk = p.tags["GeoKeyDirectoryTag"].value
            for i in range(4, len(gk), 4):
                if gk[i] == 1025:
                    raster_type = gk[i + 3]
        except KeyError:
            pass
    lon0, lat0 = tie[3], tie[4]
    if raster_type == 1:  # convert corner to first pixel centre
        lon0 += scale[0] / 2
        lat0 -= scale[1] / 2
    return GeoGrid(a, lon0, lat0, scale[0], scale[1], nodata=-32767.0, epoch=epoch, name=name)


def fetch_dem(bbox, cache_dir=".cache/dem", prefer="cop30"):
    """Return a list of GeoGrid covering bbox (1x1 degree tiles)."""
    import requests
    os.makedirs(cache_dir, exist_ok=True)
    grids = []
    for lat, lon in _tile_ids(bbox):
        ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
        kw = dict(ns=ns, lat=abs(lat), ew=ew, lon=abs(lon))
        order = [("cop30", COP_URL), ("srtm", SKADI_URL)]
        if prefer != "cop30":
            order.reverse()
        for kind, url in order:
            fn = os.path.join(cache_dir, os.path.basename(url.format(**kw)))
            if not os.path.exists(fn):
                r = requests.get(url.format(**kw), timeout=300)
                if r.status_code != 200:
                    continue
                open(fn, "wb").write(r.content)
            raw = open(fn, "rb").read()
            grids.append(read_geotiff(raw) if kind == "cop30" else read_hgt(gzip.decompress(raw), lat, lon))
            break
    if not grids:
        raise RuntimeError("no DEM tile reachable for bbox %s" % (bbox,))
    return grids


def sample_grids(grids, lon, lat):
    v = np.full(np.shape(lon), np.nan, dtype=np.float32)
    for g in grids:
        s = g.sample(lon, lat)
        v = np.where(np.isnan(v), s, v)
    return v


# ----------------------------------------------------------------- DTM from DSM
def inpaint(z, hole, iters=400):
    """Fill `hole` cells of z by iterative 4-neighbour averaging of known cells (Laplace)."""
    z = z.copy()
    known = ~hole & ~np.isnan(z)
    if not known.any():
        return z
    z[~known] = np.nanmean(z[known])
    for _ in range(iters):
        p = np.pad(z, 1, mode="edge")
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        z = np.where(known, z, avg)
    return z


def min_filter(z, r):
    """Square minimum filter of radius r cells (pure numpy)."""
    out = z.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out = np.fmin(out, np.roll(np.roll(z, dy, 0), dx, 1))
    return out


def max_filter(z, r):
    out = z.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out = np.fmax(out, np.roll(np.roll(z, dy, 0), dx, 1))
    return out


def ground_from_dsm(dsm, building_mask, open_radius_cells=2):
    """dsm: 2-D grid (m), NaN = void/sea. building_mask: cells covered by footprints (+buffer).

    1) remove footprint cells and in-paint from open ground (streets, parks)
    2) cap with a morphological OPENING (erode then dilate): removes un-mapped roofs / tree
       clumps narrower than the window but, unlike a plain minimum, keeps linear slopes
       (important for Haifa / Jerusalem)
    3) never let ground exceed the original DSM
    """
    g = inpaint(dsm, building_mask | np.isnan(dsm))
    opened = max_filter(min_filter(g, open_radius_cells), open_radius_cells)
    g = np.minimum(g, opened + 1.5)
    g = np.where(np.isnan(dsm), g, np.minimum(g, dsm))
    return g
