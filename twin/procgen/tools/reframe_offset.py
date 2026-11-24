"""העברה חד-פעמית (24.11.2026): תיקון שדות ITM/WGS84 בנתוני procgen שנבנו עם ההיסט הישן 1524.6/753.6.

מה זה עושה: לכל רשומה עם x,y (מסגרת הדגימה – לא משתנה) מחשב מחדש itm ו-wgs84 מההיסט הנכון (twin/pipeline/frame.py).
בקובצי geojson: קואורדינטות ITM מוזזות ב-(נכון − ישן); קואורדינטות WGS84 מומרות ל-ITM, מוזזות ומומרות בחזרה (pyproj).
אידמפוטנטי: ריצה שנייה לא משנה כלום (sample_to_itm כבר נכון → מדלגים). הרצה: python3 -I procgen/tools/reframe_offset.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from geo import to_itm, to_wgs84  # noqa: E402
sys.path.insert(0, os.path.join(HERE, '..', '..', 'pipeline'))
from frame import SAMPLE_TO_ITM, LEGACY_WRONG  # noqa: E402
DATA = os.path.join(HERE, '..', 'data')
DE, DN = SAMPLE_TO_ITM[0] - LEGACY_WRONG[0], SAMPLE_TO_ITM[1] - LEGACY_WRONG[1]


def fix_records(o, n=[0]):
    if isinstance(o, dict):
        if isinstance(o.get('x'), (int, float)) and isinstance(o.get('y'), (int, float)) and 'itm' in o:
            o['itm'] = to_itm(o['x'], o['y'])
            if 'wgs84' in o: o['wgs84'] = to_wgs84(o['x'], o['y'])
            n[0] += 1
        if o.get('sample_to_itm') is not None: o['sample_to_itm'] = list(SAMPLE_TO_ITM)
        for v in o.values(): fix_records(v, n)
    elif isinstance(o, list):
        for v in o: fix_records(v, n)
    return n[0]


def stale(o):
    s = json.dumps(o)
    return '1524.6' in s and '753.6' in s   # legacy marker


def main():
    from pyproj import Transformer
    w2i = Transformer.from_crs('EPSG:4326', 'EPSG:2039', always_xy=True)
    i2w = Transformer.from_crs('EPSG:2039', 'EPSG:4326', always_xy=True)
    for f in ('observations.json', 'camera_poses.json', 'route_photos.json'):
        p = os.path.join(DATA, f); d = json.load(open(p, encoding='utf-8'))
        if f != 'route_photos.json' and not stale(d): print(f, 'כבר מתוקן'); continue
        n = fix_records(d, [0]); json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); print(f, n, 'רשומות')
    marker = os.path.join(DATA, 'route.geojson')
    g = json.load(open(marker, encoding='utf-8'))
    if g.get('sample_to_itm') == list(SAMPLE_TO_ITM): print('geojson כבר מתוקן'); return
    def walk(c, fn):
        if isinstance(c[0], (int, float)): return fn(c)
        return [walk(x, fn) for x in c]
    for name, fn in (('route.geojson', lambda c: [round(c[0] + DE, 1), round(c[1] + DN, 1)]),
                     ('route_wgs84.geojson', lambda c: (lambda e, n: [round(v, 6) for v in i2w.transform(e + DE, n + DN)])(*w2i.transform(c[0], c[1])))):
        p = os.path.join(DATA, name); d = json.load(open(p, encoding='utf-8'))
        for ft in d['features']: ft['geometry']['coordinates'] = walk(ft['geometry']['coordinates'], fn)
        d['sample_to_itm'] = list(SAMPLE_TO_ITM)
        json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False); print(name, len(d['features']), 'ישויות')


if __name__ == '__main__':
    main()
