"""שחזור מסלול הליכת הלילה (23.11.2026) מתוכן התמונות בלבד – התאמה למפה בשיטת מודל מרקוב נסתר (ויטרבי + קדימה-אחורה).
קלט: data/observations.json (מיקום/כיוון קודמים + עוגנים), רשת הרחובות מאריחי rd, זמני שם הקובץ (דקה בלבד! לא שנייה).
פלט: data/route.geojson (קו המסלול + נקודות, ITM ו-WGS84), data/route_photos.json (מיקום/כיוון/הטיה + ודאי/נגזר/משוער + אי-ודאות).
הרצה: python3 -I route.py data/observations.json <tiles_v_dir> data/
הנחות (משוער): מהירות הליכה עד 1.6 מ'/ש'; זמן = אמצע הדקה ±30 ש'; ההליכה על ציר הרחוב (המדרכה בפועל ~4–8 מ' הצידה)."""
import sys, os, json, math, heapq
import numpy as np
import networkx as nx
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import load_tile, dec, to_itm, to_wgs84, angdiff

V_MAX = 1.6
DENS = 5.0
TILES = ['163_633', '163_634', '164_633', '164_634', '165_633', '165_634']
SIGN_ANCHORS = {'008': 'שלט "הארז 3"', '015': 'שלט "רח\' האורן"', '016': 'שלט "רח\' האורן"', '017': 'שלט "רח\' האורן"', '027': 'אבן "כיכר הפועלים" + שלט רוגוזין',
                '032': 'שלט "רח\' רוגוזין"', '033': 'שלט "שד\' יצחק הנשיא"', '020': 'עסק בשם + מגדל 20 קומות', '021': 'עסק בשם + מגדל', '026': 'כניסת עסק בשם'}
SHOP = (164717.0, 633900.0)

def build_graph(tdir):
    G = nx.Graph(); key = lambda p: (round(p[0] * 2) / 2, round(p[1] * 2) / 2)
    for k in TILES:
        try: t = load_tile(tdir, k)
        except FileNotFoundError: continue
        ox, oy = t['o']
        for r in t['rd']:
            pts = [(ox + x, oy + y) for x, y in dec(r['r'])]
            for a, b in zip(pts, pts[1:]):
                L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(math.ceil(L / DENS)))
                prev = key(a)
                for i in range(1, n + 1):
                    q = key((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
                    if q != prev: G.add_edge(prev, q, w=math.hypot(q[0] - prev[0], q[1] - prev[1]), name=r['n'], c=r['c'])
                    prev = q
    return G

def edge_bearing(G, n):
    nb = list(G[n]);
    if not nb: return None
    m = nb[0]; return math.degrees(math.atan2(m[0] - n[0], m[1] - n[1])) % 360

def minute_t(f):
    return int(f[13:15]) * 3600 + int(f[15:17]) * 60 + 30

def priors(obs):
    P = []
    for p in obs['photos']:
        pos = p['pos']; x, y, r, conf = pos['x'], pos['y'], pos['r_m'], pos['conf']
        if p.get('status') == 'excluded_indoor': x, y, r, conf = SHOP[0], SHOP[1], 25, 0.45
        if x is None: P.append(None if p.get('status') == 'stub' else dict(id=p['id'], file=p['file'], x=None)); continue
        sig = max(r, 8.0) if conf >= 0.3 else max(r, 80.0)
        P.append(dict(id=p['id'], file=p['file'], t=minute_t(p['file']), x=x, y=y, sig=sig, conf=conf, street=pos.get('street'),
                      head=p['heading']['v'], hmethod=p['heading'].get('method'), hpm=p['heading'].get('pm'), hconf=p['heading']['conf'], pitch=p['pitch']['v'], indoor=p.get('status') == 'excluded_indoor'))
    return [q for q in P if q and q.get('x') is not None]

def run(obs, tdir):
    G = build_graph(tdir); nodes = np.array(list(G.nodes)); nlist = [tuple(n) for n in nodes]
    P = priors(obs)
    cands, emis = [], []
    for p in P:
        d = np.hypot(nodes[:, 0] - p['x'], nodes[:, 1] - p['y'])
        idx = np.where(d <= min(3 * p['sig'], 260))[0]
        if len(idx) == 0: idx = np.argsort(d)[:20]
        if len(idx) > 120: idx = idx[np.argsort(d[idx])[:120]]
        e = 0.5 * (d[idx] / p['sig']) ** 2
        if p['hmethod'] == 'כיוון רחוב' and p['head'] is not None:   # כיוון הכביש תואם את כיוון המבט (בשני הכיוונים)
            for j, ii in enumerate(idx):
                b = edge_bearing(G, nlist[ii])
                if b is not None: e[j] += 0.5 * (min(abs(angdiff(p['head'], b)), abs(angdiff(p['head'], b + 180))) / 30.0) ** 2
        if p['street'] and p['conf'] >= 0.4:   # רחוב ידוע (שלט / סגנון) → קנס על צמתים ברחוב אחר
            for j, ii in enumerate(idx):
                names = {G.edges[nlist[ii], m].get('name') for m in G[nlist[ii]]}
                if p['street'] not in names: e[j] += 2.0
        cands.append(idx); emis.append(e)
    # מעברים: מרחק הליכה ברשת ≤ V_MAX × (Δt + 60 ש') (רזולוציית דקה)
    trans = []
    for i in range(len(P) - 1):
        dt = max(0, P[i + 1]['t'] - P[i]['t']); dmax = V_MAX * (dt + 60)
        tgt = {nlist[j]: k for k, j in enumerate(cands[i + 1])}
        T = np.full((len(cands[i]), len(cands[i + 1])), 1e6)   # 1e6 = לא אפשרי
        for a, ia in enumerate(cands[i]):
            dist = nx.single_source_dijkstra_path_length(G, nlist[ia], cutoff=dmax, weight='w')
            for n, dd in dist.items():
                b = tgt.get(n)
                if b is not None: T[a, b] = dd / 60.0   # העדפה קלה למסלול קצר
        trans.append(T)
    # ויטרבי
    D = [emis[0].copy()]; B = []
    for i, T in enumerate(trans):
        tot = D[-1][:, None] + T; arg = np.argmin(tot, axis=0); B.append(arg)
        D.append(tot[arg, np.arange(tot.shape[1])] + emis[i + 1])
    if D[-1].min() >= 1e5: raise RuntimeError('אין מסלול אפשרי – אילוץ המהירות סותר את העוגנים')
    path = [int(np.argmin(D[-1]))]
    for arg in reversed(B): path.append(int(arg[path[-1]]))
    path.reverse()
    # קדימה-אחורה → פיזור פוסטריורי (אי-ודאות כנה)
    lse = lambda v, ax: np.log(np.sum(np.exp(-(v - v.min(axis=ax, keepdims=True))), axis=ax)) * -1 + v.min(axis=ax)
    A = [emis[0]]
    for i, T in enumerate(trans): A.append(lse(A[-1][:, None] + T, 0) + emis[i + 1])
    Bt = [np.zeros(len(cands[-1]))]
    for i in range(len(trans) - 1, -1, -1): Bt.insert(0, lse(trans[i] + (emis[i + 1] + Bt[0])[None, :], 1))
    out = []; full = []
    for i, p in enumerate(P):
        post = A[i] + Bt[i]; post = np.exp(-(post - post.min())); post /= post.sum()
        xy = nodes[cands[i]]; mx = (post[:, None] * xy).sum(0); sd = float(np.sqrt((post * ((xy - mx) ** 2).sum(1)).sum()))
        n = nlist[cands[i][path[i]]]
        if i: full += nx.shortest_path(G, nlist[cands[i - 1][path[i - 1]]], n, weight='w')[1:]
        else: full.append(n)
        # כיוון
        hd, hprov, hpm, hsrc = p['head'], 'משוער', p['hpm'], p['hmethod']
        if p['hmethod'] == 'גרם שמיים': hprov = 'ודאי'
        elif p['hmethod'] == 'כיוון רחוב' and p['head'] is not None:
            b = edge_bearing(G, n); c2 = min([b, (b + 180) % 360], key=lambda z: abs(angdiff(p['head'], z)))
            hd, hprov, hpm, hsrc = round(c2, 1), 'נגזר', 15, 'כיוון הכביש בצומת שהותאם במסלול'
        err = round(max(sd, 6.0) + 5.0, 1)   # פיזור פוסטריורי + היסט מדרכה/צד רחוב
        if p['id'] in SIGN_ANCHORS and p['conf'] >= 0.45: pprov = 'ודאי'
        elif err <= 20: pprov = 'נגזר'
        else: pprov = 'משוער'
        edge = G.get_edge_data(n, next(iter(G[n]))) if len(G[n]) else {}
        out.append({'id': p['id'], 'file': p['file'], 't_local': f"{p['t'] // 3600:02d}:{p['t'] % 3600 // 60:02d}:30±30s",
                    'x': n[0], 'y': n[1], 'itm': to_itm(*n), 'wgs84': to_wgs84(*n), 'street_matched': edge.get('name') or None, 'street_prior': p['street'],
                    'pos_prov': pprov, 'pos_err_m': err, 'post_sd_m': round(sd, 1), 'anchor': SIGN_ANCHORS.get(p['id']),
                    'prior_shift_m': round(math.hypot(n[0] - p['x'], n[1] - p['y']), 1),
                    'heading_deg': hd, 'heading_prov': hprov if hd is not None else None, 'heading_err_deg': hpm, 'heading_src': hsrc,
                    'pitch_deg': p['pitch'], 'pitch_prov': 'ודאי' if p['hmethod'] == 'גרם שמיים' else None, 'indoor': p['indoor']})
    # בדיקת מהירות על המסלול שנבחר
    legs = []
    for i in range(1, len(out)):
        d = nx.shortest_path_length(G, (out[i - 1]['x'], out[i - 1]['y']), (out[i]['x'], out[i]['y']), weight='w')
        dt = P[i]['t'] - P[i - 1]['t']; legs.append({'from': out[i - 1]['id'], 'to': out[i]['id'], 'd_m': round(d, 1), 'dt_min': dt // 60, 'v_max_needed': round(d / (dt + 60), 2)})
    return out, full, legs, G

def write(out, full, legs, odir):
    feats = [{'type': 'Feature', 'properties': {'kind': 'route', 'he': 'מסלול משוחזר (ויטרבי על רשת הרחובות)', 'prov': 'נגזר', 'crs': 'ITM (EPSG:2039)'},
              'geometry': {'type': 'LineString', 'coordinates': [to_itm(*n) for n in full]}}]
    for o in out:
        feats.append({'type': 'Feature', 'properties': {k: v for k, v in o.items() if k not in ('itm', 'wgs84')}, 'geometry': {'type': 'Point', 'coordinates': o['itm']}})
    gj = {'type': 'FeatureCollection', 'name': 'night_walk_20261123', 'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:EPSG::2039'}}, 'features': feats}
    json.dump(gj, open(os.path.join(odir, 'route.geojson'), 'w', encoding='utf-8'), ensure_ascii=False)
    wfeats = [{'type': 'Feature', 'properties': feats[0]['properties'], 'geometry': {'type': 'LineString', 'coordinates': [to_wgs84(*n)[::-1] for n in full]}}] + \
             [{'type': 'Feature', 'properties': {'id': o['id'], 'pos_prov': o['pos_prov'], 'pos_err_m': o['pos_err_m'], 'heading_deg': o['heading_deg']}, 'geometry': {'type': 'Point', 'coordinates': o['wgs84'][::-1]}} for o in out]
    json.dump({'type': 'FeatureCollection', 'features': wfeats}, open(os.path.join(odir, 'route_wgs84.geojson'), 'w', encoding='utf-8'), ensure_ascii=False)
    L = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(full, full[1:]))
    json.dump({'v': 1, 'length_m': round(L), 'photos': out, 'legs': legs, 'route_sample_xy': [list(n) for n in full],
               'notes': ['זמני הצילום בשם הקובץ ברזולוציית דקה בלבד (לא שנייה) – ±30 ש\'',
                         'המיקום מוצמד לציר הרחוב; המדרכה בפועל 4–8 מ\' הצידה (נכלל בשגיאה)',
                         'ודאי = עוגן שלט/עסק/ירח; נגזר = נקבע ע"י אילוצי המסלול (פיזור ≤15 מ\'); משוער = השאר']},
              open(os.path.join(odir, 'route_photos.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return L

if __name__ == '__main__':
    obs = json.load(open(sys.argv[1], encoding='utf-8'))
    out, full, legs, G = run(obs, sys.argv[2])
    L = write(out, full, legs, sys.argv[3])
    print(f'graph {G.number_of_nodes()} nodes; route {L:.0f} m; photos {len(out)}')
    for o in out: print(o['id'], o['street_matched'], o['pos_prov'], o['pos_err_m'], 'shift', o['prior_shift_m'], 'head', o['heading_deg'], o['heading_prov'])
    print('max leg speed needed', max(l['v_max_needed'] for l in legs))
