#!/usr/bin/env python3
"""הרחבת כיסוי המשחק: מאחד את אריחי "הארצי" (ענף national-v1, רשת ישראל אמיתית) עם אריחי אשדוד (מסגרת "sample").

1. מודד את ההיסט בין המסגרות לפי אותם בניינים (אותו מזהה OSM) בשני המקורות.
2. מעביר כל בניין/כביש מהארצי למסגרת sample ומחלק מחדש לאריחי 1000 מ' (לפי מרכז). אריחים שכבר קיימים באשדוד נשארים של אשדוד.
3. קרקע: לארצי אין גבהים (0.3 מ' בכל מקום). ים נלקח מהארצי; גובה היבשה דועך מהקצה של אשדוד ל-1 מ' (משוער), כדי שלא יהיה צוק בגבול.

שימוש: python3 merge_national.py <תיקיית tiles של הארצי> <תיקיית data של אשדוד> <פלט>
"""
import sys, os, json, gzip, glob, math, statistics, struct
import numpy as np
from scipy.spatial import cKDTree

NAT, ASH, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
TILE, NT, STEP, SEA, OUTV = 1000, 41, 25, -32768, -32767

def flat(r):
    while r and isinstance(r[0], list): r = r[0]
    return r
def dec(r, o):   # דלתות בדצימטרים → קואורדינטות מוחלטות
    x, y, out = o[0], o[1], []
    for i in range(0, len(r) - 1, 2): x += r[i] / 10; y += r[i + 1] / 10; out.append((x, y))
    return out
def enc(pts, o):
    out, px, py = [], round(o[0] * 10), round(o[1] * 10)
    for x, y in pts:
        qx, qy = round(x * 10), round(y * 10); out += [qx - px, qy - py]; px, py = qx, qy
    return out
def rings_of(b):   # בניין: r הוא רשימת טבעות (חיצונית + חורים) או טבעת אחת
    r = b['r']; return r if r and isinstance(r[0], list) else [r]
def load(path): return json.load(gzip.open(path))

# ---------- 1. היסט בין המסגרות
ash_v = {os.path.basename(f)[:-8]: f for f in glob.glob(os.path.join(ASH, 'tiles/v/*.json.gz'))}
ash_keys = set(ash_v)
ours = {}
for k, f in ash_v.items():
    d = load(f)
    for b in d.get('b', []):
        p = dec(flat(b['r']), d['o']); ours[b['i']] = (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
nat_files = sorted(glob.glob(os.path.join(NAT, 'v/*.json.gz')))
dx, dy = [], []
for f in nat_files:
    k = os.path.basename(f)[:-8]; tx, ty = map(int, k.split('_'))
    if not (160 <= tx <= 172 and 627 <= ty <= 641): continue
    d = load(f)
    for b in d.get('b', []):
        if b['i'] in ours:
            p = dec(flat(b['r']), d['o']); c = (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))
            dx.append(c[0] - ours[b['i']][0]); dy.append(c[1] - ours[b['i']][1])
if len(dx) >= 50: DX, DY = statistics.median(dx), statistics.median(dy); SX, SY = statistics.pstdev(dx), statistics.pstdev(dy)
else: DX, DY, SX, SY = 1507.82, 757.76, 0.40, 0.38   # מדידה של 23.11.2026 (7,427 בניינים) – כשאין מספיק בניינים משותפים
print(f'היסט (ITM − sample): dE={DX:.2f} dN={DY:.2f} מ\', פיזור {SX:.2f}/{SY:.2f} מ\', לפי {len(dx)} בניינים משותפים')

# ---------- 2. חלוקה מחדש
newt = {}
def tile(k):
    if k not in newt:
        tx, ty = map(int, k.split('_')); newt[k] = {'v': 1, 'k': k, 'o': [tx * TILE, ty * TILE], 'b': [], 'rd': [], 'sea': [], 'src': 'national-v1'}
    return newt[k]
def key_of(x, y): return f'{math.floor(x / TILE)}_{math.floor(y / TILE)}'
nb = nr = 0
for f in nat_files:
    d = load(f); o = d['o']
    for b in d.get('b', []):
        R = [[(x - DX, y - DY) for x, y in dec(r, o)] for r in rings_of(b)]
        P = R[0]; cx, cy = sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P); k = key_of(cx, cy)
        if k in ash_keys: continue
        t = tile(k); nb2 = dict(b); nb2['r'] = [enc(r, t['o']) for r in R]; t['b'].append(nb2); nb += 1
    for rd in d.get('rd', []):
        P = [(x - DX, y - DY) for x, y in dec(rd['r'], o)]
        if len(P) < 2: continue
        m = P[len(P) // 2]; k = key_of(*m)
        if k in ash_keys: continue
        t = tile(k); r2 = dict(rd); r2['r'] = enc(P, t['o']); t['rd'].append(r2); nr += 1
print('בניינים', nb, 'כבישים', nr, 'אריחים חדשים', len(newt))

# ---------- 3. קרקע
nat_t = {}
def nat_grid(k):
    if k not in nat_t:
        p = os.path.join(NAT, 't', k + '.bin.gz')
        nat_t[k] = np.frombuffer(gzip.decompress(open(p, 'rb').read())[20:20 + NT * NT * 2], '<i2') if os.path.exists(p) else None
    return nat_t[k]
def nat_val(E, N):   # הערך הקרוב ברשת הארצית
    k = key_of(E, N); g = nat_grid(k)
    if g is None: return None
    tx, ty = map(int, k.split('_')); c = min(NT - 1, max(0, round((E - tx * TILE) / STEP))); r = min(NT - 1, max(0, round(((ty + 1) * TILE - N) / STEP)))
    return int(g[r * NT + c])
# גבהי יבשה של אשדוד (בקצוות) לדעיכה
pts, hs = [], []
for k in ash_keys:
    tx, ty = map(int, k.split('_')); z = np.frombuffer(gzip.decompress(open(os.path.join(ASH, 'tiles/t', k + '.bin.gz'), 'rb').read())[20:20 + NT * NT * 2], '<i2')
    for r in range(0, NT, 2):
        for c in range(0, NT, 2):
            v = int(z[r * NT + c])
            if v > -30000: pts.append((tx * TILE + c * STEP, (ty + 1) * TILE - r * STEP)); hs.append(v / 10)
tree = cKDTree(np.array(pts)); hs = np.array(hs)
hdr_src = gzip.decompress(open(glob.glob(os.path.join(ASH, 'tiles/t/*.bin.gz'))[0], 'rb').read())[:20]
os.makedirs(os.path.join(OUT, 'tiles/v'), exist_ok=True); os.makedirs(os.path.join(OUT, 'tiles/t'), exist_ok=True)
L = 600.0   # מרחק דעיכה (משוער)
for k, t in newt.items():
    tx, ty = map(int, k.split('_')); z = np.zeros(NT * NT, '<i2')
    E = np.array([tx * TILE + c * STEP for r in range(NT) for c in range(NT)], float); N = np.array([(ty + 1) * TILE - r * STEP for r in range(NT) for c in range(NT)], float)
    dist, idx = tree.query(np.c_[E, N]); h = 1.0 + np.maximum(hs[idx] - 1.0, 0) * np.exp(-dist / L)
    for i in range(NT * NT):
        v = nat_val(E[i] + DX, N[i] + DY)
        z[i] = SEA if v == SEA else (int(v) if (v is not None and v > 5) else int(round(h[i] * 10)))   # גובה אמיתי מהמקור אם יש (DEM), אחרת דעיכה משוערת
    hdr = bytearray(hdr_src); struct.pack_into('<ii', hdr, 6, tx, ty)
    with open(os.path.join(OUT, 'tiles/t', k + '.bin.gz'), 'wb') as fh: fh.write(gzip.compress(bytes(hdr) + z.tobytes(), mtime=0))
    with open(os.path.join(OUT, 'tiles/v', k + '.json.gz'), 'wb') as fh: fh.write(gzip.compress(json.dumps(t, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
keys = sorted(newt)
xs = [int(k.split('_')[0]) for k in keys]; ys = [int(k.split('_')[1]) for k in keys]
json.dump({'v': 1, 'source': 'national-v1 (TAMA/Geofabrik, ITM) → מסגרת sample', 'offset_itm_minus_sample': [round(DX, 2), round(DY, 2)], 'offset_sigma_m': [round(SX, 2), round(SY, 2)],
           'matched_buildings': len(dx), 'tiles': keys, 'buildings': nb, 'roads': nr, 'bbox_sample': [min(xs) * TILE, min(ys) * TILE, (max(xs) + 1) * TILE, (max(ys) + 1) * TILE],
           'terrain': 'גובה מהמקור כשיש (Copernicus GLO-30); כשאין – ים מהמקור, יבשה דועכת מקצה אשדוד ל-1 מ\' (משוער, L=600 מ\')'}, open(os.path.join(OUT, 'nat.json'), 'w'), ensure_ascii=False, indent=1)
print('נכתב', OUT)
