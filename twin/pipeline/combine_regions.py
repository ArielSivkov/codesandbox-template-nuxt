#!/usr/bin/env python3
"""מאחד את תוצרי האזורים (כל אזור = תיקיית out של build_city) לסט אריחים אחד ב-ITM, ומעדכן את הצ'קליסט.
אריח שמופיע בכמה אזורים (גבול בין תאים): בניינים לפי מזהה, כבישים בלי כפילויות, קרקע – כל תא לוקח ערך ידוע (לא OUTSIDE).
שימוש: python3 combine_regions.py <תיקיית artifacts> <פלט ITM> <israel_regions.json>
"""
import sys, os, glob, json, gzip
import numpy as np

SRC, OUT, REG = sys.argv[1], sys.argv[2], sys.argv[3]
NT, OUTV = 41, -32767
os.makedirs(os.path.join(OUT, 'tiles/v'), exist_ok=True); os.makedirs(os.path.join(OUT, 'tiles/t'), exist_ok=True)
V, T, stat = {}, {}, {}
for d in sorted(glob.glob(os.path.join(SRC, 'out-*'))):
    rid = os.path.basename(d)[4:]
    vs = glob.glob(os.path.join(d, '**/tiles/v/*.json.gz'), recursive=True)
    nb = 0
    for f in vs:
        k = os.path.basename(f)[:-8]; t = json.load(gzip.open(f)); nb += len(t.get('b', []))
        if k not in V: V[k] = t; V[k]['_rd'] = {json.dumps(r['r']) for r in t.get('rd', [])}; continue
        A = V[k]; ids = {b['i'] for b in A['b']}
        A['b'] += [b for b in t.get('b', []) if b['i'] not in ids]
        for r in t.get('rd', []):
            h = json.dumps(r['r'])
            if h not in A['_rd']: A['_rd'].add(h); A['rd'].append(r)
        if len(t.get('sea', [])) > len(A.get('sea', [])): A['sea'] = t['sea']
    for f in glob.glob(os.path.join(d, '**/tiles/t/*.bin.gz'), recursive=True):
        k = os.path.basename(f)[:-7]; raw = gzip.decompress(open(f, 'rb').read())
        z = np.frombuffer(raw[20:20 + NT * NT * 2], '<i2').copy()
        if k not in T: T[k] = [raw[:20], z, raw[20 + NT * NT * 2:]]
        else:
            cur = T[k][1]; m = (cur == OUTV) & (z != OUTV); cur[m] = z[m]
    stat[rid] = nb
for k, t in V.items():
    t.pop('_rd', None)
    open(os.path.join(OUT, 'tiles/v', k + '.json.gz'), 'wb').write(gzip.compress(json.dumps(t, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
for k, (h, z, rest) in T.items():
    open(os.path.join(OUT, 'tiles/t', k + '.bin.gz'), 'wb').write(gzip.compress(h + z.astype('<i2').tobytes() + rest, mtime=0))
R = json.load(open(REG))
for c in R['cells']:
    if c['id'] in stat: c['status'] = 'done' if stat[c['id']] else 'empty'; c['buildings'] = stat[c['id']]
    # בלי תוצר = נכשל או לא רץ → נשאר todo וייבנה שוב בריצה הבאה
json.dump(R, open(REG, 'w'), ensure_ascii=False, indent=0)
print('אריחים', len(V), 'קרקע', len(T), 'בניינים', sum(len(t['b']) for t in V.values()), 'אזורים', len(stat))
