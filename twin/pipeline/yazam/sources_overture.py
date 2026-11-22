"""Overture Maps buildings (GeoParquet, ODbL) via DuckDB – footprints + height/num_floors.

Overture conflates OSM (highest priority) with Esri Community Maps, Microsoft and Google
ML footprints; height attributes are merged between matches (docs.overturemaps.org/guides/buildings).
We use it (a) to fill footprints missing from OSM, (b) as a height/num_floors source when its
`sources[].dataset` says where the value came from.

Release ids look like "2026-10-22.0"; pass one explicitly (OVERTURE_RELEASE) for reproducibility.
Needs outbound access to s3://overturemaps-us-west-2 (anonymous) – blocked in the Claude sandbox,
works in GitHub Actions / any normal server.
"""
from __future__ import annotations

import os

from shapely import wkb as swkb

from .geo import _tf
from shapely.ops import transform as shp_transform

S3 = "s3://overturemaps-us-west-2/release/{rel}/theme=buildings/type=building/*"


def latest_release():
    """Best-effort: list release prefixes anonymously and take the max."""
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    rows = con.execute(
        "SELECT DISTINCT regexp_extract(file, 'release/([^/]+)/', 1) r "
        "FROM glob('s3://overturemaps-us-west-2/release/*/theme=buildings/type=building/*') "
        "ORDER BY r DESC LIMIT 1").fetchall()
    return rows[0][0]


def buildings(bbox, release=None):
    import duckdb
    rel = release or os.environ.get("OVERTURE_RELEASE") or latest_release()
    w, s, e, n = bbox
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    q = f"""
      SELECT id, height, num_floors, roof_height, min_height, class, subtype,
             to_json(sources) AS sources, ST_AsWKB(geometry) AS wkb
      FROM read_parquet('{S3.format(rel=rel)}', hive_partitioning=1)
      WHERE bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}
    """
    fwd = _tf()[0]
    out = []
    for id_, h, nf, rh, mh, cls, sub, srcs, wkb in con.execute(q).fetchall():
        g = shp_transform(lambda x, y, z=None: fwd.transform(x, y), swkb.loads(bytes(wkb)))
        out.append({"id": "ov:" + id_, "geom": g, "height": h, "num_floors": nf,
                    "roof_height": rh, "min_height": mh, "class": cls, "subtype": sub,
                    "sources": srcs, "release": rel})
    return out


def match_to_osm(osm_buildings, ov_buildings, iou_min=0.5):
    """Attach Overture height/num_floors to OSM footprints by IoU; return unmatched Overture
    footprints so they can be ADDED (ML footprints fill OSM gaps – mark them src=overture)."""
    from shapely.strtree import STRtree
    if not ov_buildings:
        return [], []
    tree = STRtree([o["geom"] for o in ov_buildings])
    used = set()
    pairs = []
    for b in osm_buildings:
        best, bi = 0.0, None
        for j in tree.query(b["geom"]):
            g = ov_buildings[j]["geom"]
            inter = b["geom"].intersection(g).area
            if inter <= 0:
                continue
            iou = inter / (b["geom"].area + g.area - inter)
            if iou > best:
                best, bi = iou, j
        if bi is not None and best >= iou_min:
            used.add(bi)
            pairs.append((b, ov_buildings[bi], best))
    unmatched = [o for j, o in enumerate(ov_buildings) if j not in used]
    return pairs, unmatched
