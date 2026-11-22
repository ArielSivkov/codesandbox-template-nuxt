"""Read the twin's Ashdod sample tiles (twin/pipeline/sample-out-ashdod) back into building dicts."""
import os
import glob, gzip, json, os
from shapely.geometry import Polygon

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline", "sample-out-ashdod")
# ASSUMED origin used by yz_sample.py (the sample has no real georeference)
ASSUMED_ORIGIN_ITM = (166300.0, 634400.0)


def _dec(ring, ox, oy):
    px, py, pts = ox, oy, []
    for i in range(0, len(ring), 2):
        px += ring[i] / 10; py += ring[i + 1] / 10
        pts.append((px, py))
    return pts


def load(root=ROOT):
    out = {}
    for f in sorted(glob.glob(os.path.join(root, "tiles/v/*.json.gz"))):
        d = json.load(gzip.open(f))
        ox, oy = d["o"]
        for b in d["b"]:
            rings = [_dec(r, ox, oy) for r in b["r"]]
            try:
                g = Polygon(rings[0], rings[1:])
                if not g.is_valid:
                    g = g.buffer(0)
            except Exception:
                continue
            c = g.centroid
            out[b["i"]] = {"id": b["i"], "type": b["t"], "name": b["n"], "area": b["a"], "geom": g,
                           "cx": c.x, "cy": c.y, "tile_h": b["h"] / 10, "tile_sigma": b["s"] / 10,
                           "tile_floors": b["f"], "tile_src": b["src"]}
    return out
