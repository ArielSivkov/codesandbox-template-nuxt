#!/usr/bin/env python3
"""לוח היזם · גדוד 6 · המרת הנתונים המוטמעים במפה (window.YZ_DATA) לאריחים בינאריים.

קלט : yazam/map/index.html (קריאה בלבד)
פלט : map/data/manifest.json, map/data/search.json, map/data/t/<tx>_<ty>.bin(.gz), map/vendor/three.min.js

פורמט האריח "YZT1" מתועד ב-report.md (§ פורמט אריחים) ובראש הקובץ הזה:
  כותרת: magic 'YZT1' | u32 version | i32 tx | i32 ty | u32 nSections | n × (fourcc, u32 offset, u32 length)
  כל המקטעים מיושרים ל-4 בתים, little-endian. קואורדינטות: דצימטרים (int16) יחסית לפינה הדרומית-מערבית של האריח.
שימוש: python3 build_tiles.py <src_index.html> <out_map_dir>
"""
import gzip, json, math, os, re, struct, sys
from collections import deque

import numpy as np
import mapbox_earcut as earcut
from scipy import ndimage
import shapely
from shapely.geometry import Polygon, box, MultiPolygon
from shapely.ops import unary_union

SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/repo/yazam/map/index.html'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/swarm/b6/map'
TILE = 1000            # מ' — זהה לרשת הארצית של גדוד 5 (TILE_M)
TSTEP = 25             # מ' — דגימת שטח, 41×41 לאריח (TERRAIN_STEP של גדוד 5)
TN = TILE // TSTEP + 1
Q = 10                 # דצימטרים
HEAT = 100             # תא מפת חום (מ')

html = open(SRC, encoding='utf-8').read()
# --- three.js: מועתק כפי שהוא לקובץ נפרד (נשמר במטמון הדפדפן, לא נטען מחדש עם הנתונים) ---
a = html.index('<script>') + 8
e = html.index('</script>', a)
os.makedirs(f'{OUT}/vendor', exist_ok=True)
open(f'{OUT}/vendor/three.min.js', 'w', encoding='utf-8').write(html[a:e])
i = html.index('window.YZ_DATA=') + len('window.YZ_DATA=')
D, _ = json.JSONDecoder().raw_decode(html[i:])
j = html.index('window.YZ_ACC=') + len('window.YZ_ACC=')
ACC, _ = json.JSONDecoder().raw_decode(html[j:])
M = D['meta']
STEP, GX, GY, X0, Y1 = M['step'], M['GX'], M['GY'], M['X0'], M['Y1']
X1, Y0 = X0 + (GX - 1) * STEP, Y1 - (GY - 1) * STEP

# ------------------------------------------------------------------ שטח + מסכת ים מתוקנת
import base64
raw = np.frombuffer(base64.b64decode(D['terrain']), dtype='<i2').reshape(GY, GX).astype(np.float64)
cb = np.frombuffer(base64.b64decode(D['city']), dtype=np.uint8)
city = np.unpackbits(cb)[:GX * GY].reshape(GY, GX).astype(bool)
sea0 = raw == -32768
# 1) ים = רק תאי "אין נתון" המחוברים לשולי הרשת (חורים בתוך היבשה אינם ים)
lab, n = ndimage.label(sea0)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
sea = np.isin(lab, list(edge))
# 2) איים קטנים בתוך הים (< 4 תאים) → ים ; 3) החלקת רוב 3×3 – מסיר מדרגות/פסים לאורך החוף
lab2, n2 = ndimage.label(~sea)
sizes = ndimage.sum(np.ones_like(lab2), lab2, index=np.arange(1, n2 + 1))
small = np.isin(lab2, np.where(sizes < 4)[0] + 1)
sea = sea | small
sea = ndimage.uniform_filter(sea.astype(float), 3, mode='nearest') > 0.5
voids_filled = int((sea0 & ~sea).sum())
# גובה: dm → מ'; חורי SRTM ביבשה מתמלאים בממוצע שכנים (אינטרפולציה איטרטיבית)
hm = np.where(sea0, np.nan, raw / 10.0)
for _ in range(60):
    m = np.isnan(hm) & ~sea
    if not m.any():
        break
    p = np.pad(hm, 1, mode='edge')
    nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
    with np.errstate(invalid='ignore'), __import__('warnings').catch_warnings():
        __import__('warnings').simplefilter('ignore')
        mean = np.nanmean(nb, axis=0)
    hm[m] = mean[m]
hm = np.where(sea, -2.0, np.nan_to_num(hm, nan=1.0))
hm = np.where(~sea, np.maximum(hm, 0.6), hm)   # יבשה ≥ +0.6 מ' – מעל מישור הים (y=0), אין z-fighting
# אזור תצוגה: העיר + שוליים רכים (600 מ' דעיכה)
dist_out = ndimage.distance_transform_edt(~city) * STEP
fade = np.clip(1 - (dist_out - 150) / 600, 0, 1)


def bil(grid, x, n):
    c = np.clip((x - X0) / STEP, 0, GX - 1.0001)
    r = np.clip((Y1 - n) / STEP, 0, GY - 1.0001)
    i0, j0 = np.floor(r).astype(int), np.floor(c).astype(int)
    a, b = r - i0, c - j0
    return (grid[i0, j0] * (1 - a) * (1 - b) + grid[i0, j0 + 1] * (1 - a) * b +
            grid[i0 + 1, j0] * a * (1 - b) + grid[i0 + 1, j0 + 1] * a * b)


def outside_grid(x, n):
    return (x < X0) | (x > X1) | (n < Y0) | (n > Y1)


# קו חוף וקטורי: איחוד ריצות של תאי ים → פוליגון, פישוט והחלקה
runs = []
for r in range(GY):
    row = sea[r]
    c = 0
    while c < GX:
        if row[c]:
            c0 = c
            while c < GX and row[c]:
                c += 1
            n_top = Y1 - r * STEP + STEP / 2
            runs.append(box(X0 + c0 * STEP - STEP / 2, n_top - STEP, X0 + (c - 1) * STEP + STEP / 2, n_top))
        else:
            c += 1
sea_poly = unary_union(runs).simplify(8).buffer(25, join_style=1).buffer(-25, join_style=1).simplify(4)
# הרחבת הים אל מחוץ לרשת (מערבה, ובצפון/דרום מערבית לקו החוף) – פוליגון "ים רחוק" אחד במניפסט
def coast_x(row):
    land = np.where(~sea[row])[0]
    return X0 + (land[0] if len(land) else GX - 1) * STEP
cxt, cxb = coast_x(0), coast_x(GY - 1)
FAR = 40000
sea_far = [[X0 - FAR, Y0 - FAR], [cxb, Y0 - FAR], [cxb, Y0], [X0, Y0], [X0, Y1], [cxt, Y1], [cxt, Y1 + FAR], [X0 - FAR, Y1 + FAR]]

# ------------------------------------------------------------------ בניינים
LOW = {'house', 'detached', 'semidetached_house', 'bungalow', 'roof', 'garage', 'garages', 'shed', 'kiosk', 'hut', 'greenhouse', 'cowshed'}
PUB = {'commercial', 'retail', 'industrial', 'warehouse', 'school', 'kindergarten', 'university', 'college', 'public', 'civic', 'synagogue', 'townhall', 'hospital', 'office', 'train_station', 'transportation', 'church', 'mosque', 'sports_hall', 'sports_centre', 'construction', 'hotel', 'manufacture'}
RES = {'', 'apartments', 'residential', 'dormitory', 'house', 'detached', 'semidetached_house'}


def estimate(b):
    """הכלל המקורי של המפה (ללא שינוי, כדי שהכמויות יתאימו לגרסה הקיימת) + סטיית תקן משוערת σ.
    σ = חצי מטווח הקומות הסביר לקטגוריה × 3 מ'. הקוד: (קומות, גובה מ', σ מ', קוד כלל)."""
    if re.search(r'מגדל|tower', b['n'], re.I): return 20, 60.0, 15.0, 1
    if b['t'] in LOW: return 1, (4.0 if b['t'] == 'roof' else 3.5), 1.5, 2
    if b['t'] in PUB: return 2, 8.0, 4.0, 3
    if b['t'] == '' and b['a'] > 2500: return 2, 10.0, 5.0, 4
    if b['a'] <= 150: return 2, 6.0, 3.0, 5
    if b['a'] <= 1000 or b['t'] == '': return 4, 12.0, 6.0, 6
    return 8, 24.0, 9.0, 7


def ring_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def visvalingam(ring, maxn):
    a = list(map(tuple, ring))
    while len(a) > maxn:
        best, bi = 1e30, 0
        L = len(a)
        for k in range(L):
            p, q, r = a[k - 1], a[k], a[(k + 1) % L]
            ar = abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]))
            if ar < best:
                best, bi = ar, k
        a.pop(bi)
    return np.array(a)


types = [t for t, _ in M['types']]
tix = {t: k for k, t in enumerate(types)}
tiles = {}
area_err = []


def T(key):
    if key not in tiles:
        tiles[key] = {'b': [], 'rd': []}
    return tiles[key]


for b in D['b']:
    rings = []
    for f in b['r']:
        v = np.cumsum(np.array(f, dtype=np.int64).reshape(-1, 2), axis=0)  # dm, מוחלט
        if len(v) > 3 and (v[0] == v[-1]).all():
            v = v[:-1]
        # ניקוי נקודות כפולות עוקבות
        keep = np.ones(len(v), bool)
        keep[1:] = np.any(v[1:] != v[:-1], axis=1)
        v = v[keep]
        if len(v) < 3:
            continue
        rings.append(v)
    if not rings:
        continue
    # כיוון: חיצוני נגד כיוון השעון, חצרות עם כיוון השעון (נורמלים עקביים)
    rings = [r if (ring_area(r.astype(float)) > 0) == (k == 0) else r[::-1] for k, r in enumerate(rings)]
    outer = rings[0].astype(float) / Q
    A = ring_area(outer) - sum(abs(ring_area(r.astype(float) / Q)) for r in rings[1:])
    area_err.append((A - b['a']) / max(b['a'], 1))
    cx, cn = outer.mean(axis=0)
    tx, ty = math.floor(cx / TILE), math.floor(cn / TILE)
    f, h, sg, rule = estimate(b)
    T((tx, ty))['b'].append(dict(src=b, rings=rings, f=f, h=h, sg=sg, rule=rule, cx=cx, cn=cn, A=A))

# כבישים: כל קטע מוקצה לאריח של נקודת האמצע שלו; קטעים רצופים באותו אריח מתאחדים לקו
names = D['names']
for r in D['rd']:
    v = np.cumsum(np.array(r['r'], dtype=np.int64).reshape(-1, 2), axis=0)
    cur, ckey = None, None
    for k in range(len(v) - 1):
        mx, mn = (v[k] + v[k + 1]) / 2 / Q
        key = (math.floor(mx / TILE), math.floor(mn / TILE))
        if key != ckey:
            if cur is not None:
                T(ckey)['rd'].append((r['c'], r['n'], np.array(cur)))
            cur, ckey = [v[k]], key
        cur.append(v[k + 1])
    if cur is not None:
        T(ckey)['rd'].append((r['c'], r['n'], np.array(cur)))

# אריחים שיש בהם רק שטח/ים בתוך אזור התצוגה
for tx in range(math.floor(X0 / TILE), math.floor(X1 / TILE) + 1):
    for ty in range(math.floor(Y0 / TILE), math.floor(Y1 / TILE) + 1):
        xs = np.linspace(tx * TILE, tx * TILE + TILE, 9)
        ns = np.linspace(ty * TILE, ty * TILE + TILE, 9)
        X, N = np.meshgrid(xs, ns)
        ok = ~outside_grid(X, N)
        if ok.any() and (bil(fade, X[ok], N[ok]) > 0.01).any():
            T((tx, ty))
        elif sea_poly.intersects(box(tx * TILE, ty * TILE, tx * TILE + TILE, ty * TILE + TILE)):
            T((tx, ty))   # אריח ים בלבד – בלי זה נשאר "חור" בצבע הרקע בין החוף לים הרחוק

# ------------------------------------------------------------------ מפת חום (הדגמה) – אותה נוסחה כמו במקור
def pot(e):
    b = e['src']
    return b['a'] * max(0, 8 - e['f']) / 8 if (b['t'] in RES and not re.search(r'מגדל|tower', b['n'], re.I)) else 0
heat_cells = {}
for key, t in tiles.items():
    for e in t['b']:
        p = pot(e)
        if p:
            c = (math.floor(e['cx'] / HEAT), math.floor(e['cn'] / HEAT))
            heat_cells[c] = heat_cells.get(c, 0) + p / (HEAT * HEAT)
nz = sorted(v for v in heat_cells.values() if v > 0)
P95 = nz[int(len(nz) * 0.95)] if nz else 1

# ------------------------------------------------------------------ כתיבה
def pad4(bs):
    return bs + b'\0' * (-len(bs) % 4)


def tri_earcut(rings_dm):
    verts = np.concatenate(rings_dm).astype(np.float64)
    ends = np.cumsum([len(r) for r in rings_dm]).astype(np.uint32)
    return earcut.triangulate_float64(verts, ends).astype(np.uint32)


os.makedirs(f'{OUT}/data/t', exist_ok=True)
for fn in os.listdir(f'{OUT}/data/t'):
    os.remove(f'{OUT}/data/t/{fn}')
manifest_tiles = {}
search_bld = []
tot_raw = tot_gz = 0
for (tx, ty), t in sorted(tiles.items()):
    ox, oy = tx * TILE * Q, ty * TILE * Q   # dm
    secs, hsecs = [], []      # secs → קובץ lo (תמיד נטען), hsecs → קובץ hi (רק בקרבת המצלמה)
    B = t['b']
    nb = len(B)
    ndet = 0
    if nb:
        B.sort(key=lambda e: int(e['src']['i']))   # מיון לפי מזהה OSM → המזהים נשמרים כדלתא (נדחסים היטב)
        ids_abs = np.array([int(e['src']['i']) for e in B], np.int64)
        ids = np.diff(ids_abs, prepend=0).astype(np.uint32)
        typ = np.array([tix.get(e['src']['t'], 0) for e in B], np.uint8)
        flo = np.array([e['f'] for e in B], np.uint8)
        roof = np.array([1 if e['src']['t'] == 'roof' else 0 for e in B], np.uint8)  # 0 שטוח+מעקה, 1 שטוח, 2 גמלון, 3 ארבע־שיפועים
        hsrc = np.array([e['rule'] for e in B], np.uint8)   # 1..7 כלל משוער; 20 תגית height; 21 levels; 30 מודל/LiDAR (גדוד 5)
        base = np.array([round(e['src']['b'] * Q) for e in B], np.int16)
        hdm = np.array([round(e['h'] * Q) for e in B], np.uint16)
        sdm = np.array([round(e['sg'] * Q) for e in B], np.uint16)
        area = np.array([round(e['src']['a'] * Q) for e in B], np.uint32)
        cen = np.array([[round(e['cx'] * Q - ox), round(e['cn'] * Q - oy)] for e in B], np.int16)
        bldg = (ids.tobytes() + area.tobytes() + base.tobytes() + hdm.tobytes() + sdm.tobytes() + cen.tobytes() +
                typ.tobytes() + flo.tobytes() + roof.tobytes() + hsrc.tobytes())
        secs.append((b'BLDG', bldg))
        # LOD0: טביעה מפושטת (עד 8 פינות, בלי חצרות) לכל הבניינים
        lo_n, lo_v, lo_t = [], [], []
        det = []
        for k, e in enumerate(B):
            lo = visvalingam(e['rings'][0], 8)
            if ring_area(lo.astype(float)) < 0:
                lo = lo[::-1]
            if len(e['rings']) > 1 or len(e['rings'][0]) > 8:
                det.append(k)
            lo_n.append(len(lo))
            loc = lo - np.array([ox, oy])
            lo_v.append(np.diff(loc, axis=0, prepend=np.zeros((1, 2), np.int64)))
            lo_t.append(tri_earcut([lo]))
        secs.append((b'LOD0', pad4(np.array(lo_n, np.uint8).tobytes()) + pad4(np.concatenate(lo_v).astype(np.int16).tobytes()) +
                     np.concatenate(lo_t).astype(np.uint8).tobytes()))
        ndet = len(det)
        # פירוט מלא – רק לבניינים שהטביעה המפושטת שונה מהמקור (יותר מ-8 פינות או חצר פנימית)
        if det:
            D_ = [B[k] for k in det]
            nr = np.array([len(e['rings']) for e in D_], np.uint16)
            rl = np.array([len(r) for e in D_ for r in e['rings']], np.uint16)
            hsecs.append((b'RING', struct.pack('<I', len(det)) + pad4(np.array(det, np.uint16).tobytes()) + pad4(nr.tobytes()) + rl.tobytes()))
            vv = []
            for e in D_:
                for r in e['rings']:
                    loc = r - np.array([ox, oy])
                    vv.append(np.diff(loc, axis=0, prepend=np.zeros((1, 2), np.int64)))
            V = np.concatenate(vv)
            assert np.abs(V).max() < 32767
            hsecs.append((b'VERT', V.astype(np.int16).tobytes()))
            tc = np.array([0] * 0 + [0 for _ in D_], np.uint16)
            tl = []
            for q_, e in enumerate(D_):
                tr = tri_earcut(e['rings'])
                tc[q_] = len(tr) // 3
                tl.append(tr)
            ti = np.concatenate(tl)
            assert ti.max() < 65535
            hsecs.append((b'TRI_', pad4(tc.tobytes()) + ti.astype(np.uint16).tobytes()))
        if any(e['src']['n'] for e in B):
            secs.append((b'NAME', '\0'.join(e['src']['n'] for e in B).encode('utf-8')))
        for k, e in enumerate(B):
            if e['src']['n']:
                search_bld.append([e['src']['n'], round(e['cx'], 1), round(e['cn'], 1), f'{tx}_{ty}', k, types[typ[k]]])
    # שטח 41×41 (dm; ים = -20) בקידוד דלתא לאורך השורה + דעיכה u8
    xs = tx * TILE + np.arange(TN) * TSTEP
    ns = ty * TILE + np.arange(TN) * TSTEP
    X, N = np.meshgrid(xs, ns)            # שורה 0 = דרום
    og = outside_grid(X, N)
    ff = np.where(og, 0.0, bil(fade, X, N))
    hh = np.where(og, -2.0, bil(hm, X, N))
    hh = np.where(ff <= 0, np.where(hh < 0, -2.0, 0.6), hh)   # מחוץ לאזור התצוגה לא מצויר – ערך קבוע (נדחס היטב)
    # כימות ל-0.5 מ' (דיוק SRTM הוא כמה מטרים); יבשה נשארת ≥ +0.5 מ' מעל מישור הים
    hh = np.where(hh < 0, -20, np.maximum(np.round(hh * 2) * 5, 5)).astype(np.int64)
    hd = np.diff(hh, axis=1, prepend=np.zeros((TN, 1), np.int64))
    secs.append((b'TERR', hd.astype(np.int16).tobytes() + pad4(np.round(ff * 255).astype(np.uint8).tobytes())))
    # ים וקטורי חתוך לאריח
    tb = box(tx * TILE, ty * TILE, tx * TILE + TILE, ty * TILE + TILE)
    sp = sea_poly.intersection(tb)
    gl = [g for g in (sp.geoms if hasattr(sp, 'geoms') else [sp]) if isinstance(g, Polygon) and not g.is_empty and g.area > 1]
    if gl:
        sv, st = [], []
        off = 0
        for g in gl:
            rings_ = [np.array(g.exterior.coords)[:-1]] + [np.array(h.coords)[:-1] for h in g.interiors]
            rings_ = [np.round((r - [tx * TILE, ty * TILE]) * Q).astype(np.int64) for r in rings_ if len(r) >= 3]
            tr = tri_earcut(rings_)
            vv_ = np.concatenate(rings_)
            sv.append(vv_)
            st.append(tr + off)
            off += len(vv_)
        SV = np.concatenate(sv).astype(np.int16)
        ST = np.concatenate(st).astype(np.uint16)
        secs.append((b'SEA_', struct.pack('<II', len(SV), len(ST)) + SV.tobytes() + pad4(ST.tobytes())))
    # כבישים: u32 nLines | u8 cls[n] | i16 nameIdx[n] | u16 nPts[n] | i16 coords (דלתא, dm). הגובה נדגם בלקוח משטח האריח.
    def roads_sec(R):
        cls = np.array([c for c, _, _ in R], np.uint8)
        nmi = np.array([n_ for _, n_, _ in R], np.int16)
        npt = np.array([len(p) for _, _, p in R], np.uint16)
        co = [np.diff(p - np.array([ox, oy]), axis=0, prepend=np.zeros((1, 2), np.int64)) for _, _, p in R]
        return (struct.pack('<I', len(R)) + pad4(cls.tobytes()) + pad4(nmi.tobytes()) + pad4(npt.tobytes()) +
                np.concatenate(co).astype(np.int16).tobytes())
    major = [r for r in t['rd'] if r[0] >= 3]
    minor = [r for r in t['rd'] if r[0] < 3]
    if major:
        secs.append((b'ROAD', roads_sec(major)))
    if minor:
        hsecs.append((b'ROAD', roads_sec(minor)))
    # מפת חום 10×10 (תאי 100 מ'), u16 = ציון/P95 × 1000
    hv = np.zeros((TILE // HEAT, TILE // HEAT), np.float64)
    for cy in range(TILE // HEAT):
        for cxx in range(TILE // HEAT):
            hv[cy, cxx] = heat_cells.get((tx * (TILE // HEAT) + cxx, ty * (TILE // HEAT) + cy), 0)
    if hv.any():
        secs.append((b'HEAT', np.clip(hv / P95 * 1000, 0, 65535).astype(np.uint16).tobytes()))
    key = f'{tx}_{ty}'
    sizes = {}
    for lvl, S in (('lo', secs), ('hi', hsecs)):
        if not S:
            continue
        head = struct.pack('<4sIiiI', b'YZT1', 1, tx, ty, len(S))
        off = len(head) + 12 * len(S)
        dirb, body = b'', b''
        for fc, data in S:
            data = pad4(data)
            dirb += struct.pack('<4sII', fc, off + len(body), len(data))
            body += data
        blob = head + dirb + body
        open(f'{OUT}/data/t/{key}.{lvl}.bin', 'wb').write(blob)
        gz = gzip.compress(blob, 9, mtime=0)
        open(f'{OUT}/data/t/{key}.{lvl}.bin.gz', 'wb').write(gz)
        tot_raw += len(blob); tot_gz += len(gz)
        sizes[lvl] = len(gz)
    hmax = max([e['h'] + e['sg'] for e in B], default=0) + max([e['src']['b'] for e in B], default=0)
    manifest_tiles[key] = {'n': nb, 'det': ndet, 'lo': sizes.get('lo', 0), 'hi': sizes.get('hi', 0), 'hmax': round(hmax + 2, 1)}

# ------------------------------------------------------------------ אינדקס חיפוש (רחובות + מבנים בעלי שם)
acc = [dict(xs=[]) for _ in names]
for r in D['rd']:
    if r['n'] < 0:
        continue
    v = np.cumsum(np.array(r['r'], dtype=np.int64).reshape(-1, 2), axis=0) / Q
    acc[r['n']]['xs'].append(v)
streets = []
for ni, o in enumerate(acc):
    if not o['xs']:
        continue
    P = np.concatenate(o['xs'])
    c = P.mean(axis=0)
    best = P[np.argmin(((P - c) ** 2).sum(1))]
    ext = float(np.sqrt(((P - best) ** 2).sum(1)).max())
    streets.append([names[ni], round(float(best[0]), 1), round(float(best[1]), 1), round(ext), ni])

manifest = {
    'format': 'yz-tiles', 'version': 1,
    'crs': {'name': 'local-ITM', 'note': 'מטרים, x=מזרח, n=צפון, ראשית = נקודת המרכז של מפת אשדוד המקורית. בגרסה הארצית: EPSG:2039 עם origin=[0,0].',
            'origin': [0, 0]},
    'tile_m': TILE, 'coord_q': Q, 'terrain': {'step': TSTEP, 'n': TN}, 'heat': {'cell': HEAT, 'p95': P95},
    'grid_bounds': [X0, Y0, X1, Y1],
    'home': None,
    'types': types, 'roof_codes': ['flat_parapet', 'flat', 'gable', 'hip', 'pyramidal'],
    'hsrc_codes': {'1': 'שם המבנה כולל "מגדל"/Tower → 20 קומות', '2': 'בית/צמוד קרקע/גגון → קומה אחת',
                   '3': 'ציבור/מסחר/תעשייה → 2 קומות × 4 מ\'', '4': 'לא מסווג מעל 2,500 מ"ר → אולם, 2 × 5 מ\'',
                   '5': 'מגורים/לא מסווג עד 150 מ"ר → 2 קומות', '6': 'מגורים/לא מסווג 150–1,000 מ"ר → 4 קומות',
                   '7': 'מגורים מעל 1,000 מ"ר → 8 קומות', '20': 'תגית height מ-OSM', '21': 'תגית building:levels מ-OSM',
                   '30': 'מודל גובה (DSM−DTM) – גדוד 5'},
    'sea_far': sea_far,
    'tiles': manifest_tiles,
    'stats': {'buildings': sum(len(t['b']) for t in tiles.values()), 'roads': len(D['rd']), 'tiles': len(tiles),
              'bytes_raw': tot_raw, 'bytes_gz': tot_gz, 'bytes_gz_lo': sum(v['lo'] for v in manifest_tiles.values()), 'bytes_gz_hi': sum(v['hi'] for v in manifest_tiles.values()), 'srtm_inland_voids_fixed': voids_filled,
              'area_check_median_rel_err': float(np.median(np.abs(area_err))), 'area_check_max_rel_err': float(np.max(np.abs(area_err)))},
    'acc': ACC,
}
# מרכז העיר (לכפתור "מרכז העיר") = ממוצע מרכזי הבניינים, כמו במקור
allc = np.array([[e['cx'], e['cn']] for t in tiles.values() for e in t['b']])
manifest['home'] = [round(float(allc[:, 0].mean()), 1), round(float(allc[:, 1].mean()), 1)]
json.dump(manifest, open(f'{OUT}/data/manifest.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump({'streets': streets, 'buildings': search_bld}, open(f'{OUT}/data/search.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
for fn in ('manifest.json', 'search.json'):
    p = f'{OUT}/data/{fn}'
    open(p + '.gz', 'wb').write(gzip.compress(open(p, 'rb').read(), 9, mtime=0))
print(json.dumps(manifest['stats'], ensure_ascii=False, indent=1))
print('tiles', len(tiles), 'search', len(streets), len(search_bld))
