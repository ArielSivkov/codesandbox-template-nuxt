"""OpenStreetMap inputs: buildings, coastline, inland water, city boundary, roads.

Two interchangeable back-ends produce the SAME normalised records:
  * overpass(bbox)  – fine for one city / ad-hoc runs (be polite: 1 query at a time)
  * pbf(path, bbox) – Geofabrik `israel-and-palestine-latest.osm.pbf`; preferred in CI
                      (one ~daily download, no load on public Overpass servers)

Normalised record shapes (geometry already in ITM metres, shapely objects):
  building: {"id": "w123", "geom": Polygon|MultiPolygon, "tags": {...}}
  coast:    LineString (OSM natural=coastline – land is on the LEFT of the way direction)
  water:    Polygon (lakes, reservoirs, riverbanks, ponds)
  boundary: Polygon|MultiPolygon (admin_level=8 municipality) or None
  road:     {"geom": LineString, "cls": int, "name": str}
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time

from shapely.geometry import LineString, Polygon, MultiPolygon, shape
from shapely.ops import polygonize, unary_union, transform as shp_transform

from .geo import to_itm, _tf

OVERPASS_URLS = [
    os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
    "https://overpass.kumi.systems/api/interpreter",
]

ROAD_CLASS = {  # same 0..3 buckets idea as the current map's "c" field
    "motorway": 3, "trunk": 3, "primary": 3, "motorway_link": 2, "trunk_link": 2,
    "secondary": 2, "tertiary": 2, "primary_link": 2, "secondary_link": 2,
    "residential": 1, "unclassified": 1, "living_street": 1, "tertiary_link": 1,
    "service": 0, "pedestrian": 0, "footway": 0, "path": 0, "cycleway": 0, "track": 0,
}
WATER_TAGS = {("natural", "water"), ("waterway", "riverbank"), ("landuse", "reservoir"),
              ("landuse", "basin"), ("water", None)}


def _itm_geom(g):
    fwd = _tf()[0]
    return shp_transform(lambda x, y, z=None: fwd.transform(x, y), g)


def _is_water(tags):
    for k, v in WATER_TAGS:
        if k in tags and (v is None or tags[k] == v):
            return True
    return False


# ---------------------------------------------------------------- Overpass
def overpass_query(bbox, city_name=None):
    w, s, e, n = bbox
    b = f"{s},{w},{n},{e}"
    city = ""
    if city_name:
        city = (f'relation["boundary"="administrative"]["admin_level"="8"]'
                f'["name"="{city_name}"]({b});out geom;')
    return f"""[out:json][timeout:300];
(
  way["building"]({b}); relation["building"]["type"="multipolygon"]({b});
);
out tags geom;
way["natural"="coastline"]({b}); out geom;
(
  way["natural"="water"]({b}); relation["natural"="water"]({b});
  way["waterway"="riverbank"]({b}); way["landuse"="reservoir"]({b});
);
out tags geom;
way["highway"]({b}); out tags geom;
{city}"""


def _fetch_overpass(q, retries=4):
    import requests
    last = None
    for attempt in range(retries):
        for url in OVERPASS_URLS:
            try:
                r = requests.post(url, data={"data": q}, timeout=600,
                                  headers={"User-Agent": "yazam-map-pipeline/0.1"})
                if r.status_code == 200:
                    return r.json()
                last = f"{url}: HTTP {r.status_code}"
            except Exception as ex:  # network / proxy
                last = f"{url}: {ex}"
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def _way_coords(el):
    return [(p["lon"], p["lat"]) for p in el.get("geometry", []) if p]


def _relation_polygon(el):
    outers, inners = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        ls = LineString([(p["lon"], p["lat"]) for p in m["geometry"] if p])
        (inners if m.get("role") == "inner" else outers).append(ls)
    polys = list(polygonize(unary_union(outers))) if outers else []
    holes = list(polygonize(unary_union(inners))) if inners else []
    if not polys:
        return None
    g = unary_union(polys)
    if holes:
        g = g.difference(unary_union(holes))
    return g if not g.is_empty else None


def parse_overpass(js, city_name=None):
    out = {"buildings": [], "coast": [], "water": [], "boundary": None, "roads": []}
    for el in js.get("elements", []):
        tags = el.get("tags", {})
        t = el["type"]
        geom = None
        if t == "way":
            c = _way_coords(el)
            if len(c) < 2:
                continue
            closed = len(c) >= 4 and c[0] == c[-1]
            if tags.get("natural") == "coastline":
                out["coast"].append(_itm_geom(LineString(c)))
                continue
            if "highway" in tags and "building" not in tags:
                out["roads"].append({"geom": _itm_geom(LineString(c)),
                                     "cls": ROAD_CLASS.get(tags["highway"], 0),
                                     "name": tags.get("name:he") or tags.get("name", "")})
                continue
            if not closed:
                continue
            geom = Polygon(c)
        elif t == "relation":
            if tags.get("boundary") == "administrative":
                g = _relation_polygon(el)
                if g is not None:
                    out["boundary"] = _itm_geom(g)
                continue
            geom = _relation_polygon(el)
        if geom is None or geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        geom = _itm_geom(geom)
        if "building" in tags:
            out["buildings"].append({"id": f"{t[0]}{el['id']}", "geom": geom, "tags": tags})
        elif _is_water(tags):
            out["water"].append(geom)
    return out


def overpass(bbox, city_name=None):
    return parse_overpass(_fetch_overpass(overpass_query(bbox, city_name)), city_name)


# ---------------------------------------------------------------- PBF (Geofabrik)
def _extract_bbox(pbf, bbox):
    """Cut the country PBF to the city bbox with osmium-tool if available (fast, low RAM)."""
    exe = shutil.which("osmium")
    if not exe:
        return pbf, False
    tmp = tempfile.NamedTemporaryFile(suffix=".osm.pbf", delete=False).name
    w, s, e, n = bbox
    subprocess.run([exe, "extract", "-b", f"{w},{s},{e},{n}", "--overwrite", "-o", tmp, pbf],
                   check=True)
    return tmp, True


def pbf(path, bbox, city_name=None):
    import osmium
    from shapely import wkb as swkb

    src, cut = _extract_bbox(path, bbox)
    w, s, e, n = bbox
    fab = osmium.geom.WKBFactory()
    out = {"buildings": [], "coast": [], "water": [], "boundary": None, "roads": []}

    def inside(g):
        minx, miny, maxx, maxy = g.bounds
        return not (maxx < w or minx > e or maxy < s or miny > n)

    class H(osmium.SimpleHandler):
        def way(self, wy):
            tags = dict(wy.tags)
            if tags.get("natural") == "coastline" or ("highway" in tags and "building" not in tags):
                try:
                    g = swkb.loads(fab.create_linestring(wy), hex=True)
                except Exception:
                    return
                if not inside(g):
                    return
                if tags.get("natural") == "coastline":
                    out["coast"].append(_itm_geom(g))
                else:
                    out["roads"].append({"geom": _itm_geom(g), "cls": ROAD_CLASS.get(tags["highway"], 0),
                                         "name": tags.get("name:he") or tags.get("name", "")})

        def area(self, a):
            tags = dict(a.tags)
            is_b = "building" in tags
            is_city = (tags.get("boundary") == "administrative" and tags.get("admin_level") == "8"
                       and city_name and city_name in (tags.get("name"), tags.get("name:he"), tags.get("name:en")))
            if not (is_b or is_city or _is_water(tags)):
                return
            try:
                g = swkb.loads(fab.create_multipolygon(a), hex=True)
            except Exception:
                return
            if not inside(g):
                return
            if not g.is_valid:
                g = g.buffer(0)
            g = _itm_geom(g)
            if is_city:
                out["boundary"] = g
            elif is_b:
                if isinstance(g, MultiPolygon) and len(g.geoms) == 1:
                    g = g.geoms[0]
                oid = ("w" if a.from_way() else "r") + str(a.orig_id())
                out["buildings"].append({"id": oid, "geom": g, "tags": tags})
            else:
                out["water"].append(g)

    H().apply_file(src, locations=True)
    if cut:
        os.unlink(src)
    return out


# ---------------------------------------------------------------- GeoJSON (tests / any provider)
def from_geojson(path):
    """FeatureCollection in WGS84 with properties.kind in {building, coast, water, boundary, road}."""
    fc = json.load(open(path, encoding="utf-8"))
    out = {"buildings": [], "coast": [], "water": [], "boundary": None, "roads": []}
    for f in fc["features"]:
        p = f.get("properties", {}) or {}
        g = _itm_geom(shape(f["geometry"]))
        k = p.get("kind", "building")
        if k == "building":
            out["buildings"].append({"id": str(p.get("id", f.get("id"))), "geom": g, "tags": p.get("tags", {})})
        elif k == "coast":
            out["coast"].append(g)
        elif k == "water":
            out["water"].append(g)
        elif k == "boundary":
            out["boundary"] = g
        elif k == "road":
            out["roads"].append({"geom": g, "cls": int(p.get("cls", 1)), "name": p.get("name", "")})
    return out
