"""גאומטריה משותפת: מצלמת חריר (pinhole), אזימוטים, פענוח אריחים, המרת קואורדינטות."""
import math, gzip, json, os

SAMPLE_TO_ITM = (1524.6, 753.6)   # ITM אמיתי = מסגרת הדגימה + היסט (לפי HQ)
FOV_LONG, FOV_SHORT = 69.4, 54.9   # משוער: מצלמה ראשית ~26 מ"מ שקול, אין EXIF

def pixel_dir(u, v, portrait, heading, pitch):
    """כיוון (אזימוט, גובה) של פיקסל u,v (0..1) במצלמה עם heading/pitch במעלות, בלי roll."""
    hx = math.radians((FOV_SHORT if portrait else FOV_LONG) / 2)
    hy = math.radians((FOV_LONG if portrait else FOV_SHORT) / 2)
    nx = (u - 0.5) * 2 * math.tan(hx); ny = (0.5 - v) * 2 * math.tan(hy)
    h, p = math.radians(heading), math.radians(pitch)
    f = (math.sin(h) * math.cos(p), math.cos(h) * math.cos(p), math.sin(p))
    r = (math.cos(h), -math.sin(h), 0.0)
    up = (-math.sin(h) * math.sin(p), -math.cos(h) * math.sin(p), math.cos(p))
    d = [f[i] + nx * r[i] + ny * up[i] for i in range(3)]
    L = math.sqrt(sum(c * c for c in d))
    return math.degrees(math.atan2(d[0], d[1])) % 360, math.degrees(math.asin(d[2] / L))

def az(a, b):
    return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 360

def angdiff(a, b):
    return (a - b + 180) % 360 - 180

def dec(r, q=10):
    x = y = 0; o = []
    for i in range(0, len(r), 2):
        x += r[i]; y += r[i + 1]; o.append((x / q, y / q))
    return o

def load_tile(tdir, key):
    return json.load(gzip.open(os.path.join(tdir, key + '.json.gz')))

def to_itm(x, y):
    return [round(x + SAMPLE_TO_ITM[0], 1), round(y + SAMPLE_TO_ITM[1], 1)]

def to_wgs84(x, y):
    try:
        from pyproj import Transformer
        t = Transformer.from_crs('EPSG:2039', 'EPSG:4326', always_xy=True)
        lon, lat = t.transform(*to_itm(x, y))
        return [round(lat, 6), round(lon, 6)]
    except Exception:
        return None
