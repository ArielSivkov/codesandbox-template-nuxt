"""מחיל קובץ גבהים מתועדים (twin/data/height-overrides/*.json) על כל עותקי אריחי הדגימה.
שימוש: python3 apply_height_overrides.py <קובץ json> [--check]
כותב רק לבניינים לפי מזהה OSM; משאיר כל שדה אחר. --check: רק בודק שכל העותקים כבר מעודכנים וזהים."""
import gzip, json, sys, os, hashlib
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
COPIES = ['game/data', 'engine/map/data', 'integration/world/data', 'preview/world/data']
spec = json.load(open(sys.argv[1], encoding='utf-8')); check = '--check' in sys.argv
want = {b['id']: b for b in spec['buildings']}
tiles = sorted({f for c in COPIES for f in os.listdir(os.path.join(ROOT, c, 'tiles/v'))})
bad = 0; done = set(); digests = {}
for c in COPIES:
    for f in tiles:
        p = os.path.join(ROOT, c, 'tiles/v', f)
        if not os.path.exists(p): continue
        raw = gzip.open(p).read(); t = json.loads(raw); hit = False
        for b in t['b']:
            w = want.get(b['i'])
            if not w: continue
            new = dict(h=round(w['h'] * 10), s=round(w['s'] * 10), f=w['f'], fl=w['fl'], fh=w['fh'], src='Q', c=w['c'], u='Q')
            if any(b.get(k) != v for k, v in new.items()):
                if check: print('לא מעודכן', c, f, b['i']); bad += 1
                else: b.update(new); hit = True
            done.add((c, b['i']))
        if hit:
            with gzip.GzipFile(p, 'wb', mtime=0) as g: g.write(json.dumps(t, ensure_ascii=False, separators=(',', ':')).encode())
        if any(b['i'] in want for b in t['b']): digests.setdefault(f, set()).add(hashlib.md5(gzip.open(p).read()).hexdigest())
for c in COPIES:
    for i in want:
        if (c, i) not in done: print('חסר בעותק', c, i); bad += 1
for f, d in digests.items():
    if len(d) != 1: print('העותקים שונים', f); bad += 1
print('הכול תקין' if not bad else f'{bad} בעיות'); sys.exit(1 if bad else 0)
