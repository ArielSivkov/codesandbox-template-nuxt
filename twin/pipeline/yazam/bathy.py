"""Bathymetry -> per-tile depth grids (maritime patch, המחלקה הימית).

Free sources for the Israeli coast (researched 23.11.2026; not downloadable from the build sandbox):
  * GEBCO 2025 Grid (15 arc-second, ~460 m): "placed in the public domain and may be used free of charge";
    commercial use allowed; must acknowledge the source; NOT for navigation.  https://www.gebco.net/
  * EMODnet Digital Bathymetry DTM (1/16 arc-minute, ~115 m; Mediterranean tiles incl. the Levant):
    Creative Commons Attribution 4.0 (CC BY 4.0); "DO NOT USE FOR NAVIGATION". https://emodnet.ec.europa.eu/
  * Israel Oceanographic & Limnological Research (IOLR / חיא"ל) publishes higher-resolution surveys; licence
    terms must be checked per dataset before use.
Both GEBCO and EMODnet offer ESRI ASCII (.asc) export of a chosen box -> read here with numpy only
(no GDAL needed in CI). Values: elevation in metres, negative below sea level.

Tile layout (new, optional layer):  tiles/b/<tx>_<ty>.bin.gz
  header  struct "<4sHiiHH" (18 bytes) = b"YZB1", version 1, tx, ty, nt (41), step (25)
  body    nt*nt int16 little-endian, depth in decimetres (positive down), row 0 = north;
          -32767 = no data / land.   Same lattice as tiles/t (terrain), so clients can index both alike.
"""
from __future__ import annotations

import gzip
import os
import struct

import numpy as np

from .geo import TILE_M, TERRAIN_STEP, to_wgs

LICENCE_HINT = "Bathymetry: GEBCO Compilation Group (public domain) or EMODnet Bathymetry Consortium (CC BY 4.0) - not for navigation"
NODATA = -32767


class EsriAsciiGrid:
    """ESRI ASCII raster in WGS84 (lon/lat cell centres or corners). sample(lon, lat) -> elevation (m), bilinear."""

    def __init__(self, path):
        hdr = {}
        with open(path, "r", encoding="ascii") as fh:
            while True:
                pos = fh.tell()
                line = fh.readline()
                parts = line.split()
                if len(parts) == 2 and parts[0].lower() in ("ncols", "nrows", "xllcorner", "yllcorner", "xllcenter",
                                                            "yllcenter", "cellsize", "nodata_value"):
                    hdr[parts[0].lower()] = float(parts[1])
                else:
                    fh.seek(pos)
                    break
            data = np.loadtxt(fh, dtype=np.float64)
        self.nc, self.nr, self.cs = int(hdr["ncols"]), int(hdr["nrows"]), hdr["cellsize"]
        # cell-centre coordinates of column 0 / bottom row
        self.x0 = hdr["xllcenter"] if "xllcenter" in hdr else hdr["xllcorner"] + self.cs / 2
        self.y0 = hdr["yllcenter"] if "yllcenter" in hdr else hdr["yllcorner"] + self.cs / 2
        nd = hdr.get("nodata_value", -9999)
        z = data.reshape(self.nr, self.nc)[::-1]          # row 0 = south
        self.z = np.where(z == nd, np.nan, z)

    def sample(self, lon, lat):
        c = (np.asarray(lon, float) - self.x0) / self.cs
        r = (np.asarray(lat, float) - self.y0) / self.cs
        c0 = np.clip(np.floor(c).astype(int), 0, self.nc - 2); r0 = np.clip(np.floor(r).astype(int), 0, self.nr - 2)
        fc, fr = np.clip(c - c0, 0, 1), np.clip(r - r0, 0, 1)
        Z = self.z
        v = (Z[r0, c0] * (1 - fc) * (1 - fr) + Z[r0, c0 + 1] * fc * (1 - fr) + Z[r0 + 1, c0] * (1 - fc) * fr + Z[r0 + 1, c0 + 1] * fc * fr)
        out = (c < 0) | (r < 0) | (c > self.nc - 1) | (r > self.nr - 1)
        return np.where(out, np.nan, v)


def tile_depth(grid, tx, ty, nt=TILE_M // TERRAIN_STEP + 1, step=TERRAIN_STEP):
    xs = tx * TILE_M + np.arange(nt) * step
    ys = (ty + 1) * TILE_M - np.arange(nt) * step
    X, Y = np.meshgrid(xs, ys)
    lon, lat = to_wgs(X, Y)
    z = grid.sample(lon, lat)
    d = np.where(np.isnan(z) | (z >= 0), NODATA, np.round(-z * 10)).astype("<i2")
    return d


def write_tiles(out_dir, keys, grid):
    n = 0
    for k in keys:
        tx, ty = map(int, k.split("_"))
        d = tile_depth(grid, tx, ty)
        if (d == NODATA).all():
            continue
        hdr = struct.pack("<4sHiiHH", b"YZB1", 1, tx, ty, d.shape[0], TERRAIN_STEP)
        p = os.path.join(out_dir, "tiles", "b", k + ".bin.gz")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(gzip.compress(hdr + d.tobytes(), compresslevel=9, mtime=0))
        n += 1
    return n
