"""Land / sea / inland-water mask – the fix for the blue speckles and stripes on the coast.

Root cause in the current page (see report §2): sea is "SRTM cell is void or 0", the terrain mesh
puts sea vertices at y=-4 and a 120 km water plane at y=0 is drawn UNDER all land. Low coastal
land (1-4 m) is then within the depth-buffer precision of the water plane at typical phone camera
distances, so the water "z-fights" through the sand as speckles and banded stripes.

The fix has two halves:
  data   – a vector land polygon from OSM natural=coastline (OSMCoastline semantics: land on the
           LEFT of the way), minus inland water, rasterised at 10 m per tile + kept as vectors;
  client – draw the sea ONLY as the vector sea polygon (no infinite plane under land), add
           polygonOffset / logarithmic depth, and keep land >= +0.3 m (see client/yazam-tiles.js).
"""
from __future__ import annotations

from collections import deque

import numpy as np
import shapely
from shapely.geometry import LineString, Point, box
from shapely.ops import linemerge, polygonize, unary_union


def _extend_dangling(line, frame):
    """If a coastline piece starts/ends INSIDE the frame (extract cut, unfinished way), extend it
    straight along its end direction past the frame so polygonize can split land from sea."""
    c = list(line.coords)
    if len(c) < 2 or line.is_ring:
        return line
    L = 2 * max(frame.bounds[2] - frame.bounds[0], frame.bounds[3] - frame.bounds[1])
    def ext(p, q):          # extend from q away from p
        dx, dy = q[0] - p[0], q[1] - p[1]; n = (dx * dx + dy * dy) ** 0.5 or 1
        return (q[0] + dx / n * L, q[1] + dy / n * L)
    inner = frame.buffer(-1e-6)
    if inner.contains(Point(c[0])):
        c.insert(0, ext(c[1], c[0]))
    if inner.contains(Point(c[-1])):
        c.append(ext(c[-2], c[-1]))
    return LineString(c)


def land_polygon_from_coastline(coast_lines, bbox_itm, water=()):
    """Build the land area inside bbox_itm from OSM coastline ways.

    Works for partial coastlines that cross the bbox (the normal case for a city extract):
    polygonize(bbox ring + coastline) gives faces; a face is land if its interior point lies on
    the LEFT side of the nearest coastline segment.
    """
    frame = box(*bbox_itm)
    if not coast_lines:
        land = frame
    else:
        u = unary_union(coast_lines)
        merged = linemerge(u) if u.geom_type == "MultiLineString" else u
        lines = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
        lines = [_extend_dangling(l, frame) for l in lines]
        lines = [l.intersection(frame) for l in lines]
        lines = [g for l in lines for g in (l.geoms if hasattr(l, "geoms") else [l])
                 if isinstance(g, LineString) and not g.is_empty]
        faces = list(polygonize(unary_union(lines + [frame.exterior])))
        land_faces = []
        segs = []
        for l in lines:
            c = list(l.coords)
            segs += [(c[i], c[i + 1]) for i in range(len(c) - 1)]
        S = np.array(segs, dtype=float).reshape(-1, 4) if segs else np.zeros((0, 4))
        for f in faces:
            p = f.representative_point()
            if len(S) == 0:
                land_faces.append(f); continue
            ax, ay, bx, by = S.T
            dx, dy = bx - ax, by - ay
            t = np.clip(((p.x - ax) * dx + (p.y - ay) * dy) / np.maximum(dx * dx + dy * dy, 1e-9), 0, 1)
            d2 = (ax + t * dx - p.x) ** 2 + (ay + t * dy - p.y) ** 2
            k = int(np.argmin(d2))
            cross = dx[k] * (p.y - ay[k]) - dy[k] * (p.x - ax[k])
            if cross > 0:          # left of the way direction -> land
                land_faces.append(f)
        land = unary_union(land_faces) if land_faces else frame.difference(frame)
    if water:
        land = land.difference(unary_union(list(water)))
    return land.buffer(0)


def rasterize(geom, x0, y0, step, nx, ny):
    """Boolean grid [row, col], row 0 = NORTH (y0 is the south edge). Cell-centre sampling."""
    xs = x0 + (np.arange(nx) + 0.5) * step
    ys = y0 + (np.arange(ny)[::-1] + 0.5) * step
    X, Y = np.meshgrid(xs, ys)
    if geom.is_empty:
        return np.zeros((ny, nx), bool)
    shapely.prepare(geom)
    return shapely.contains_xy(geom, X, Y)


def pack_bits(mask):
    return np.packbits(mask.astype(np.uint8).ravel()).tobytes()


# ----------------------------------------------------------- fallback without OSM coastline
def clean_dem_sea_mask(sea, min_island_cells=4, min_lake_cells=50):
    """Repair a DEM-derived sea mask (void/0 = sea):
       * sea = only cells 4-connected to the raster edge through sea cells (drops inland
         'sea' speckles: SRTM voids, 0 m pits);
       * small land islands inside the sea (< min_island_cells) are removed;
       * 3x3 majority smoothing removes 1-cell stair-steps / stripes along the shore.
    """
    H, W = sea.shape
    con = np.zeros_like(sea)
    q = deque()
    for r in range(H):
        for c in (0, W - 1):
            if sea[r, c] and not con[r, c]:
                con[r, c] = True; q.append((r, c))
    for c in range(W):
        for r in (0, H - 1):
            if sea[r, c] and not con[r, c]:
                con[r, c] = True; q.append((r, c))
    while q:
        r, c = q.popleft()
        for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if 0 <= rr < H and 0 <= cc < W and sea[rr, cc] and not con[rr, cc]:
                con[rr, cc] = True; q.append((rr, cc))
    # remove tiny land islands surrounded by sea
    land = ~con
    seen = np.zeros_like(land)
    for r in range(H):
        for c in range(W):
            if land[r, c] and not seen[r, c]:
                comp = [(r, c)]; seen[r, c] = True; i = 0
                while i < len(comp):
                    y, x = comp[i]; i += 1
                    for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= yy < H and 0 <= xx < W and land[yy, xx] and not seen[yy, xx]:
                            seen[yy, xx] = True; comp.append((yy, xx))
                if len(comp) < min_island_cells:
                    for y, x in comp:
                        con[y, x] = True
    # majority filter
    p = np.pad(con.astype(np.int8), 1, mode="edge")
    s = sum(p[1 + dy:H + 1 + dy, 1 + dx:W + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    return s >= 5


def qa(land_geom, frame_bounds, buildings, step=10.0, water=()):
    """Quality gates for the land/sea layer (written into the manifest; CI fails if violated):
       sea_components   – 4-connected sea regions in a 10 m raster of the frame (1 = clean coast;
                          the old SRTM mask produced many speckles); mapped inland water excluded
       buildings_in_sea – footprints whose representative point falls in the sea (should be ~0)"""
    from collections import deque
    x0, y0, x1, y1 = frame_bounds
    nx, ny = int((x1 - x0) // step), int((y1 - y0) // step)
    sea = ~rasterize(land_geom.union(unary_union(list(water))) if water else land_geom, x0, y0, step, nx, ny)
    seen = np.zeros_like(sea); comps = 0
    for r0 in range(ny):
        for c0 in np.where(sea[r0] & ~seen[r0])[0]:
            if seen[r0, c0]:
                continue
            comps += 1; q = deque([(r0, c0)]); seen[r0, c0] = True
            while q:
                r, c = q.popleft()
                for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= rr < ny and 0 <= cc < nx and sea[rr, cc] and not seen[rr, cc]:
                        seen[rr, cc] = True; q.append((rr, cc))
    shapely.prepare(land_geom)
    pts = [b["geom"].representative_point() for b in buildings]
    bad = int(sum(1 for p in pts if not land_geom.covers(p)))
    return {"sea_components": comps, "buildings_in_sea": bad, "sea_km2": round(float(sea.sum()) * step * step / 1e6, 2)}
