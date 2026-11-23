"""צנרת קליטה: תמונה חדשה → שורת אינדקס → שלד תצפית → אימות → עדכון כללים → חידוש אריחים → דוח "תמונה ↔ מודל".
כל שלב הוא פקודה עם קלט/פלט JSON וקוד יציאה, כדי שסוכנים מרוחקים (מודלים אחרים) יוכלו להריץ ולבדוק.
הרצה: python3 -I tools/ingest.py --photos <fieldphotos> --tiles <tiles_v> [--sidecars <dir עם *.json ממצלמת השטח>] [--skip-gen]
פלט: data/index.generated.csv, data/observations.json, data/style_rules.json, data/gen/*, data/camera_poses.json, reports/ingest_run.json, reports/diff_photo_model.{json,txt}"""
import sys, os, json, csv, re, math, hashlib, subprocess, argparse, time
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from geo import load_tile, dec, az, angdiff

FNAME = re.compile(r'^(\d{3})_(\d{8})_(\d{4})\.jpg$')
PLATE = re.compile(r'\b\d{2,3}-\d{2,3}-\d{2,3}\b')   # תבנית לוחית רישוי ישראלית

def step(run, name, fn):
    t0 = time.time()
    try: res = fn(); run['steps'].append({'step': name, 'ok': True, 'sec': round(time.time() - t0, 2), 'out': res}); return res
    except Exception as e: run['steps'].append({'step': name, 'ok': False, 'sec': round(time.time() - t0, 2), 'error': str(e)}); raise

def s1_index(photos):
    rows = []; state_p = os.path.join(ROOT, 'data', 'ingest_state.json')
    state = json.load(open(state_p)) if os.path.exists(state_p) else {}
    new = []
    for f in sorted(os.listdir(photos)):
        m = FNAME.match(f)
        if not m: continue
        h = hashlib.sha256(open(os.path.join(photos, f), 'rb').read()).hexdigest()
        if state.get(f) != h: new.append(f)
        state[f] = h
        d, t = m.group(2), m.group(3)
        rows.append({'מס\'': m.group(1), 'קובץ': f, 'תאריך ושעה': f'{d[6:8]}.{d[4:6]}.{d[0:4]} {t[:2]}:{t[2:]}', 'sha256': h})
    with open(os.path.join(ROOT, 'data', 'index.generated.csv'), 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    json.dump(state, open(state_p, 'w'), indent=0)
    return {'photos': len(rows), 'new': new}

def s2_observations(photos, tiles, sidecars):
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'photo_measure.py'), photos, os.path.join(ROOT, 'data/measure.json'), os.path.join(ROOT, 'data/moon_refs.json')], check=True, capture_output=True)
    out = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'build_observations.py'), photos, tiles, os.path.join(ROOT, 'data/observations.json'), os.path.join(ROOT, 'data/measure.json')], check=True, capture_output=True, text=True).stdout.strip()
    merged = 0
    if sidecars and os.path.isdir(sidecars):   # קבצי צד ממצלמת השטח: GPS/מצפן מחליפים מיקום/כיוון של שלד
        obs = json.load(open(os.path.join(ROOT, 'data/observations.json'), encoding='utf-8')); byf = {p['file']: p for p in obs['photos']}
        for fn in sorted(os.listdir(sidecars)):
            if not fn.endswith('.json'): continue
            sc = json.load(open(os.path.join(sidecars, fn), encoding='utf-8'))
            for p in sc.get('photos', []):
                if p['file'] in byf and byf[p['file']].get('status') == 'stub':
                    for k in ('pos', 'heading', 'pitch', 'fov_h'): byf[p['file']][k] = p[k]
                    merged += 1
                elif p['file'] not in byf: obs['photos'].append(p); merged += 1
        json.dump(obs, open(os.path.join(ROOT, 'data/observations.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return {'build': out, 'sidecars_merged': merged}

def s3_validate():
    import jsonschema
    obs = json.load(open(os.path.join(ROOT, 'data/observations.json'), encoding='utf-8'))
    jsonschema.validate(obs, json.load(open(os.path.join(ROOT, 'schema/observation.schema.json'), encoding='utf-8')))
    issues = []
    txt = json.dumps(obs, ensure_ascii=False)
    if PLATE.search(txt): issues.append('תבנית לוחית רישוי נמצאה בטקסט')
    for p in obs['photos']:
        h = p['heading']['v']
        if h is not None and not (0 <= h < 360): issues.append(f"{p['id']}: כיוון מחוץ לטווח")
        if p['pos']['x'] is not None and not (161000 < p['pos']['x'] < 171000 and 629000 < p['pos']['y'] < 640000): issues.append(f"{p['id']}: מיקום מחוץ לאשדוד")
        if p['pos']['prov'] == 'נצפה' and p['pos']['src'].find('GPS') < 0: issues.append(f"{p['id']}: מיקום 'נצפה' בלי GPS – צריך להיות נגזר/משוער")
        if p['heading'].get('method') == 'גרם שמיים' and p['heading']['prov'] != 'נגזר': issues.append(f"{p['id']}: כיוון מירח חייב להיות 'נגזר'")
        for f in p['findings']:
            if f['prov'] == 'נצפה' and f['conf'] < 0.3: issues.append(f"{p['id']}/{f['kind']}: 'נצפה' עם ביטחון נמוך")
    stubs = [p['id'] for p in obs['photos'] if p.get('status') == 'stub']
    if issues: raise RuntimeError('; '.join(issues))
    return {'schema': 'ok', 'photos': len(obs['photos']), 'stubs_waiting_analysis': stubs, 'issues': issues}

def s4_rules(tiles):
    out = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'learn_rules.py'), os.path.join(ROOT, 'data/observations.json'), tiles, os.path.join(ROOT, 'data/style_rules.json')], check=True, capture_output=True, text=True).stdout
    r = json.load(open(os.path.join(ROOT, 'data/style_rules.json'), encoding='utf-8'))
    for c, v in r['classes'].items():
        for g, pri in v['priors'].items():
            s = sum(x['p'] for k, x in pri.items() if not k.startswith('_'))
            if abs(s - 1) > 0.01: raise RuntimeError(f'הסתברויות לא מסתכמות ל-1: {c}/{g}={s}')
    return {'classes': {c: v['n_photos'] for c, v in r['classes'].items()}}

def s5_gen(tiles, keys=None):
    cmd = ['node', os.path.join(HERE, 'gen_tiles.js'), tiles, os.path.join(ROOT, 'data/style_rules.json'), os.path.join(ROOT, 'data/gen')] + ([','.join(keys)] if keys else [])
    return json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1])

def s6_poses():
    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'export_poses.py'), os.path.join(ROOT, 'data/observations.json'), os.path.join(ROOT, 'data/camera_poses.json')], check=True, capture_output=True)
    return {'file': 'data/camera_poses.json'}

# ---------- דוח "תמונה ↔ מודל" ----------
OBS2GEN = {'lamp_curved_led': 'lamp_curved_led', 'lamp_led_white': 'lamp_led_white', 'lamp_ornate_red_double': 'lamp_ornate_red_double'}

def s7_diff(tiles):
    obs = json.load(open(os.path.join(ROOT, 'data/observations.json'), encoding='utf-8'))
    cache = {}; rows = []
    def tile(k):
        if k not in cache:
            try: cache[k] = load_tile(tiles, k)
            except FileNotFoundError: cache[k] = None
            gp = os.path.join(ROOT, 'data/gen', k + '.json'); cache[k + ':g'] = json.load(open(gp)) if os.path.exists(gp) else None
        return cache[k], cache[k + ':g']
    for p in obs['photos']:
        if p['pos']['x'] is None or p.get('status') != 'analyzed': continue
        x, y = p['pos']['x'], p['pos']['y']; kx, ky = int(x // 1000), int(y // 1000)
        blds, gens = [], []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                t, g = tile(f'{kx + dx}_{ky + dy}')
                if t:
                    for b in t['b']:
                        q = dec(b['r'][0]); cx = sum(v[0] for v in q) / len(q) + t['o'][0]; cy = sum(v[1] for v in q) / len(q) + t['o'][1]
                        d = math.hypot(cx - x, cy - y)
                        if d < 350: blds.append((d, az((x, y), (cx, cy)), b['h'] / 10, b['i'], b.get('rs')))
                if g:
                    for k, v in g['kinds'].items():
                        if not k.startswith('lamp') and k != 'street_sign': continue
                        dd = v['d']
                        for j in range(0, len(dd), 6):
                            gx, gy = g['origin'][0] + dd[j], g['origin'][1] + dd[j + 1]
                            if math.hypot(gx - x, gy - y) < 60: gens.append((k, dd[j + 5]))
        h = p['heading']['v']; fov = p['fov_h']['v'] or 60
        inview = [b for b in blds if h is None or abs(angdiff(b[1], h)) <= fov / 2 + 5]
        kinds = {f['kind'] for f in p['findings']}
        checks = []
        if 'tower_highrise' in kinds:
            mx = max((b[2] for b in inview), default=0)
            checks.append({'check': 'מגדל 20+ קומות בתצפית מול גובה מרבי במודל בשדה הראייה', 'model_max_h_m': mx, 'ok': mx >= 55,
                           'he': 'תואם' if mx >= 55 else f'במודל הבניין הגבוה בשדה הראייה {mx:.0f} מ\' – המגדל חסר/נמוך מדי'})
        if 'old_house_tile_roof' in kinds:
            near = [b for b in blds if b[0] < 30]; gab = [b for b in near if b[4] in ('gabled', 'hipped')]
            checks.append({'check': 'בית גג רעפים בתצפית מול צורת גג במודל (≤30 מ\')', 'ok': bool(gab), 'he': 'תואם' if gab else f'{len(near)} בניינים קרובים – כולם גג שטוח במודל'})
        obs_l = {OBS2GEN[k] for k in kinds if k in OBS2GEN}
        gen_l = {k for k, _ in gens if k.startswith('lamp')}
        if obs_l:
            checks.append({'check': 'סוג פנס בתצפית מול הפנסים שנוצרו (≤60 מ\')', 'observed': sorted(obs_l), 'generated': sorted(gen_l), 'ok': bool(obs_l & gen_l),
                           'he': 'תואם' if obs_l & gen_l else 'המחולל בחר סוג פנס אחר ליד נקודה זו'})
        so = {'new_blue' if k == 'street_name_sign' else 'old_white' for k in kinds if k in ('street_name_sign', 'street_name_sign_old')}
        sg = {'old_white' if e else 'new_blue' for k, e in gens if k == 'street_sign'}
        if so:
            checks.append({'check': 'סגנון שלט רחוב בתצפית מול שנוצר (≤60 מ\')', 'observed': sorted(so), 'generated': sorted(sg), 'ok': bool(so & sg) or not sg, 'he': 'תואם' if so & sg else ('אין שלט שנוצר בקרבת מקום' if not sg else 'סגנון שונה')})
        rows.append({'id': p['id'], 'pos_conf': p['pos']['conf'], 'heading_known': h is not None, 'n_bld_in_view': len(inview), 'checks': checks})
    n = sum(len(r['checks']) for r in rows); ok = sum(c['ok'] for r in rows for c in r['checks'])
    rep = {'v': 1, 'photos_checked': len(rows), 'checks': n, 'ok': ok, 'mismatch': n - ok, 'rows': rows,
           'note': 'כל בדיקה תלויה במיקום/כיוון התמונה – בתמונות עם ביטחון מיקום < 0.4 התוצאה מסומנת כחלשה'}
    json.dump(rep, open(os.path.join(ROOT, 'reports/diff_photo_model.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, 'reports/diff_photo_model.txt'), 'w', encoding='utf-8') as fh:
        fh.write(f'דוח תמונה ↔ מודל: {len(rows)} תמונות, {n} בדיקות, {ok} תואמות, {n - ok} לא תואמות\n')
        for r in rows:
            for c in r['checks']:
                fh.write(f"{r['id']} {'✓' if c['ok'] else '✗'} {c['check']}: {c['he']}{' (מיקום חלש)' if r['pos_conf'] < 0.4 else ''}\n")
    return {'photos': len(rows), 'checks': n, 'ok': ok, 'mismatch': n - ok}

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--photos', required=True); ap.add_argument('--tiles', required=True); ap.add_argument('--sidecars'); ap.add_argument('--skip-gen', action='store_true')
    a = ap.parse_args(); os.makedirs(os.path.join(ROOT, 'reports'), exist_ok=True); os.makedirs(os.path.join(ROOT, 'data/gen'), exist_ok=True)
    run = {'v': 1, 'started': time.strftime('%Y-%m-%dT%H:%M:%S'), 'steps': []}; code = 0
    try:
        subprocess.run(['node', os.path.join(HERE, 'moon_refs.mjs'), a.photos, os.path.join(ROOT, 'data/moon_refs.json')], check=True, capture_output=True)
        idx = step(run, '1 אינדקס', lambda: s1_index(a.photos))
        step(run, '2 שלד תצפית + מדידות', lambda: s2_observations(a.photos, a.tiles, a.sidecars))
        step(run, '3 אימות (סכמה, פרטיות, טווחים, תוויות מקור)', s3_validate)
        step(run, '4 עדכון כללי סגנון', lambda: s4_rules(a.tiles))
        if not a.skip_gen: step(run, '5 חידוש אריחים', lambda: s5_gen(a.tiles))
        step(run, '6 תנוחות מצלמה לצוות האווירה', s6_poses)
        step(run, '7 דוח תמונה ↔ מודל', lambda: s7_diff(a.tiles))
    except Exception: code = 1
    run['ok'] = code == 0
    json.dump(run, open(os.path.join(ROOT, 'reports/ingest_run.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for s in run['steps']: print(('✓' if s['ok'] else '✗'), s['step'], s['sec'], 's', json.dumps(s.get('out', s.get('error')), ensure_ascii=False)[:220])
    sys.exit(code)
