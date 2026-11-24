#!/usr/bin/env python3
"""calib.py – כיול מצלמה וכיוון מתוך התמונות עצמן (בלי EXIF, בלי GPS). python3 -I calib.py [--out DIR]

1. מוקד (שדה ראייה) – כיול עצמי מסיבוב: זוגות תמונות שצולמו מאותה נקודה בהפרש סיבוב (פנורמה ידנית).
   הומוגרפיה H (SIFT + RANSAC) = K·R·K⁻¹ → מחפשים f שבו K⁻¹HK הכי קרוב למטריצת סיבוב (Shum & Szeliski 2000).
2. עוגן שמיימי – הירח: מיקום הירח בתמונה (כתם רווי) + מיקומו האמיתי בשמיים (twin/sky/src/sky.js, Meeus פרק 47,
   טופוצנטרי) → כיוון (אזימוט אמיתי) והטיה של המצלמה. גלגול (roll) לא נקבע מנקודה אחת – מניחים 0.
3. שרשרת: R_wc(b) = R_wc(a) · R_baᵀ – כל תמונה שמחוברת לעוגן בזוג עם ≥ MIN_INL התאמות מקבלת כיוון מוחלט.
מוסכמה: מצלמה x ימינה, y למטה, z קדימה (OpenCV). עולם x=מזרח, y=צפון, z=מעלה. אזימוט אמיתי (לא רשת).
פלט: <out>/calib/calib.json (כולל אי-ודאות מוערכת לכל תמונה).
"""
import json, os, sys, subprocess, itertools, math
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
TWIN = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PHOTOS = os.path.join(TWIN, 'data', 'photos')
NOTES = os.path.join(HERE, 'pose_notes.json')
DIAG35 = 43.27            # אלכסון פריים 35 מ"מ
SCALE = 0.5               # עיבוד בחצי רזולוציה
MIN_INL = 40              # מינימום התאמות לזוג שנכנס לשרשרת

def load_gray(pid, wm_boxes):
    im = cv2.imread(os.path.join(PHOTOS, pid + '.jpg'), cv2.IMREAD_GRAYSCALE)
    im = cv2.resize(im, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA)
    m = np.full(im.shape, 255, np.uint8); h, w = im.shape
    for x0, y0, x1, y1 in wm_boxes: m[int(h * y0):int(h * y1), int(w * x0):int(w * x1)] = 0   # סימן מים של המצלמה
    return im, m

_sift = None
def homography(a, b, wm):
    global _sift; _sift = _sift or cv2.SIFT_create(5000)
    A, ma = load_gray(a, wm); B, mb = load_gray(b, wm)
    ka, da = _sift.detectAndCompute(A, ma); kb, db = _sift.detectAndCompute(B, mb)
    if da is None or db is None: return None, 0, A.shape
    mt = cv2.BFMatcher().knnMatch(da, db, k=2); g = [x for x, y in (p for p in mt if len(p) == 2) if x.distance < 0.72 * y.distance]
    if len(g) < 12: return None, len(g), A.shape
    pa = np.float32([ka[x.queryIdx].pt for x in g]); pb = np.float32([kb[x.trainIdx].pt for x in g])
    Hm, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 2.5)
    return Hm, int(inl.sum()) if inl is not None else 0, A.shape

def centered(Hm, shape):
    h, w = shape; T = np.array([[1, 0, -w / 2], [0, 1, -h / 2], [0, 0, 1.0]]); return T @ Hm @ np.linalg.inv(T)

def rot_from_H(Hc, f):
    K = np.diag([f, f, 1.0]); M = np.linalg.inv(K) @ Hc @ K; M = M / np.cbrt(np.linalg.det(M))
    U, _, Vt = np.linalg.svd(M); R = U @ Vt
    return R, float(np.linalg.norm(M @ M.T - np.eye(3)))

def best_f(Hc, diag):
    fs = np.linspace(0.5 * diag, 1.6 * diag, 900); e = np.array([rot_from_H(Hc, f)[1] for f in fs]); i = int(np.argmin(e))
    return float(fs[i]), float(e[i]), float(e[0]), float(e[-1])

def R_wc(h, p, r=0.0):
    h, p, r = np.radians([h, p, r])
    F = np.array([np.sin(h) * np.cos(p), np.cos(h) * np.cos(p), np.sin(p)])
    R0 = np.array([np.cos(h), -np.sin(h), 0.0]); U0 = np.array([-np.sin(h) * np.sin(p), -np.cos(h) * np.sin(p), np.cos(p)])
    Rr = R0 * np.cos(r) - U0 * np.sin(r); Ur = U0 * np.cos(r) + R0 * np.sin(r)
    return np.column_stack([Rr, -Ur, F])

def hpr(R):
    F = R[:, 2]; h = np.degrees(np.arctan2(F[0], F[1])) % 360; p = np.degrees(np.arcsin(np.clip(F[2], -1, 1)))
    hr = np.radians(h); pr = np.radians(p)
    R0 = np.array([np.cos(hr), -np.sin(hr), 0.0]); U0 = np.array([-np.sin(hr) * np.sin(pr), -np.cos(hr) * np.sin(pr), np.cos(pr)])
    Rr = R[:, 0]; r = np.degrees(np.arctan2(-Rr @ U0, Rr @ R0))
    return float(h), float(p), float(r)

def selftest():
    """בדיקה סינתטית: הומוגרפיה מסיבוב ידוע → שחזור f ו-R."""
    W, Hh, f = 1106, 830, 712.0; K = np.array([[f, 0, 0], [0, f, 0], [0, 0, 1.0]])
    Ra, Rb = R_wc(100.0, 7.0, 0.0), R_wc(131.0, 4.0, -2.0); Rba = Rb.T @ Ra
    Hc = K @ Rba @ np.linalg.inv(K); fe, err, _, _ = best_f(Hc, np.hypot(W, Hh)); R, _ = rot_from_H(Hc, f)
    hb = hpr(Ra @ R.T)
    ok = abs(fe - f) / f < 0.01 and abs(hb[0] - 131) < 0.05 and abs(hb[1] - 4) < 0.05 and abs(hb[2] + 2) < 0.05
    return {'ok': bool(ok), 'f_true': f, 'f_est': round(fe, 1), 'b_hpr_est': [round(x, 3) for x in hb], 'b_hpr_true': [131, 4, -2]}

def moon_pixel(pid, max_y_frac=0.6):
    g = cv2.cvtColor(cv2.imread(os.path.join(PHOTOS, pid + '.jpg')), cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = g.shape; b = cv2.GaussianBlur(g[:int(h * max_y_frac)], (0, 0), 3); y, x = np.unravel_index(np.argmax(b), b.shape)
    y0, x0 = max(0, y - 40), max(0, x - 40); win = g[y0:y + 40, x0:x + 40]; ys, xs = np.nonzero(win >= win.max() * 0.92)
    return float(xs.mean() + x0), float(ys.mean() + y0), (w, h), int(len(xs))

def sky_body(name, date, time_il, lat, lon, elev):
    """מיקום גרם שמיים מ-twin/sky/src/sky.js (Node). זמן ישראל → UTC לפי היסט מפורש בהערות (חורף: +2)."""
    js = ("import('%s').then(S=>{const o=S.observer(%f,%f,%f);const [y,m,d]='%s'.split('-').map(Number);const [hh,mm]='%s'.split(':').map(Number);"
          "const t=new Date(Date.UTC(y,m-1,d,hh-2,mm,30));const r=S.%s;console.log(JSON.stringify({az:r.az,alt:r.alt,altApparent:r.altApparent,phase:r.phase}))})") % (
        os.path.join(TWIN, 'sky', 'src', 'sky.js'), lat, lon, elev, date, time_il, "moon(t,o)" if name == 'Moon' else "body('%s',t,o)" % name)
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout.strip().splitlines()[-1])

def solve_moon(mm, f35):
    from scipy.optimize import least_squares
    (px, py, (w, h), _), m = mm; f = f35 / DIAG35 * float(np.hypot(w, h)); u, v = px - w / 2, h / 2 - py
    def resid(x):
        d = R_wc(x[0], x[1], 0.0) @ np.array([u / f, -v / f, 1.0]); az = np.degrees(np.arctan2(d[0], d[1])) % 360; alt = np.degrees(np.arctan2(d[2], np.hypot(d[0], d[1])))
        return [((az - m['az'] + 180) % 360) - 180, alt - m['altApparent']]
    s_ = least_squares(resid, [m['az'], 0.0]); return float(s_.x[0] % 360), float(s_.x[1])

def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '/home/claude/swarm/photomatch-out'
    os.makedirs(os.path.join(out, 'calib'), exist_ok=True)
    notes = json.load(open(NOTES, encoding='utf-8')); C = notes['calibration']; wm = C['watermark_boxes']
    res = {'method': __doc__.strip().splitlines()[0], 'selftest': selftest(), 'pairs': {}, 'anchors': {}, 'photos': {}}
    assert res['selftest']['ok'], res['selftest']
    # 1. זוגות
    shape = None
    for a, b in C['pairs']:
        Hm, n, shape = homography(a, b, wm)
        if Hm is None: res['pairs'][a + '-' + b] = {'inliers': n, 'ok': False}; continue
        Hc = centered(Hm, shape); diag = float(np.hypot(shape[1], shape[0])); f, e, e0, e1 = best_f(Hc, diag)
        Rr, _ = rot_from_H(Hc, f); ang = float(np.degrees(np.arccos(np.clip((np.trace(Rr) - 1) / 2, -1, 1))))
        res['pairs'][a + '-' + b] = {'inliers': n, 'H_centered_halfres': Hc.tolist(), 'f35_self': round(f / diag * DIAG35, 2), 'rotation_deg': round(ang, 1), 'ortho_err': round(e, 4), 'err_at_range_ends': [round(e0, 3), round(e1, 3)]}
    # מוקד גלובלי: חציון משוקלל של זוגות חזקים (≥150 התאמות, סיבוב ≥ 15°)
    strong = [v['f35_self'] for v in res['pairs'].values() if v.get('inliers', 0) >= 150 and v.get('ortho_err', 1) < 0.05 and v.get('rotation_deg', 0) >= 15]   # בסיבוב קטן המוקד לא מוגדר
    f_rot = float(np.median(strong)) if strong else None
    # אילוץ שני: סגירת מעגל בין שני עוגני ירח דרך הסיבוב הנמדד ביניהם (זוג 090-096). f שבו הכיוון דרך השרשרת = הכיוון מהירח.
    lat, lon, elev = C['observer']; moons = {pid: (moon_pixel(pid), sky_body('Moon', a['date'], a['time_il'], lat, lon, elev)) for pid, a in C['moon_anchors'].items()}
    f_loop, loop_tab = None, []
    ak = list(moons.keys()); lp = [k for k in res['pairs'] if set(k.split('-')) == set(ak) and 'H_centered_halfres' in res['pairs'][k]] if len(ak) == 2 else []
    if lp:
        k = lp[0]; a_, b_ = k.split('-'); Hc = np.array(res['pairs'][k]['H_centered_halfres']); dh_prev = None
        for f35_try in np.arange(20.0, 28.01, 0.1):
            hpa = solve_moon(moons[a_], f35_try); hpb = solve_moon(moons[b_], f35_try)
            Rba, _ = rot_from_H(Hc, f35_try / DIAG35 * float(np.hypot(shape[1], shape[0]))); hb = hpr(R_wc(hpa[0], hpa[1], 0.0) @ Rba.T)
            dh = ((hb[0] - hpb[0] + 180) % 360) - 180; loop_tab.append([round(float(f35_try), 1), round(dh, 2)])
            if dh_prev is not None and np.sign(dh) != np.sign(dh_prev): f_loop = float(f35_try - 0.1 * dh / (dh - dh_prev))
            dh_prev = dh
    ests = [(f_rot, 1.5, 'כיול עצמי מסיבוב (זוגות ≥150 התאמות)')] if f_rot else []
    if f_loop: ests.append((f_loop, 0.6, 'סגירת מעגל ירח %s (פרלקסה בין מיקומים ±0.6)' % '-'.join(ak)))
    if ests:
        w = np.array([1 / e[1] ** 2 for e in ests]); f35 = float(sum(e[0] * wi for e, wi in zip(ests, w)) / w.sum()); sf = float(1 / math.sqrt(w.sum()))
    else:
        f35, sf = C['f35_fallback'], 2.0
    res['f35'] = {'value': round(f35, 2), 'sigma': round(sf, 2), 'estimates': [{'f35': round(e[0], 2), 'sigma': e[1], 'how': e[2]} for e in ests], 'from_pairs': strong, 'loop_dh_by_f35': loop_tab[::5], 'fallback': C['f35_fallback'],
                  'note': 'מוקד שקול 35 מ"מ – אין EXIF. שתי הערכות בלתי תלויות, ממוצע משוקלל לפי אי-ודאות.'}
    diag_full = float(np.hypot(2212, 1659)); f_full = f35 / DIAG35 * diag_full
    res['fov_deg'] = {'h': round(2 * np.degrees(np.arctan(1106 / f_full)), 2), 'v': round(2 * np.degrees(np.arctan(829.5 / f_full)), 2), 'image': [2212, 1659], 'f_px': round(f_full, 1)}
    # 2. עוגני ירח
    R = {}
    for pid, ((px, py, (w, h), npx), m) in moons.items():
        hd, pt = solve_moon(moons[pid], f35); R[pid] = R_wc(hd, pt, 0.0)
        res['anchors'][pid] = {'moon_px': [round(px, 1), round(py, 1)], 'core_px': npx, 'moon_true_az': round(m['az'], 3), 'moon_alt_apparent': round(m['altApparent'], 3), 'moon_phase': round(m['phase'], 3),
                               'heading_true_deg': round(hd, 2), 'pitch_deg': round(pt, 2), 'roll_deg': 0.0, 'sigma_heading_deg': 1.5, 'sigma_pitch_deg': 1.0,
                               'note': 'גלגול לא ידוע (הונח 0); σ כולל את אי-הוודאות במוקד וגלגול ±3°'}
        res['photos'][pid] = {'heading_true_deg': round(hd, 2), 'pitch_deg': round(pt, 2), 'roll_deg': 0.0, 'source': 'moon', 'sigma_heading_deg': 1.5}
    # 3. שרשרת (BFS מהעוגנים על זוגות חזקים מספיק)
    f_half = f35 / DIAG35 * float(np.hypot(shape[1], shape[0])) if shape else None
    edges = {}
    for k, v in res['pairs'].items():
        if v.get('inliers', 0) < MIN_INL or 'H_centered_halfres' not in v: continue
        a, b = k.split('-'); Rba, err = rot_from_H(np.array(v['H_centered_halfres']), f_half); v['rot_err_at_global_f'] = round(err, 4)
        edges.setdefault(a, []).append((b, Rba, v['inliers'])); edges.setdefault(b, []).append((a, Rba.T, v['inliers']))
    frontier = list(R.keys()); depth = {k: 0 for k in R}
    while frontier:
        a = frontier.pop(0)
        for b, Rba, n in sorted(edges.get(a, []), key=lambda t: -t[2]):
            if b in R: continue
            R[b] = R[a] @ Rba.T; depth[b] = depth[a] + 1; h_, p_, r_ = hpr(R[b])
            res['photos'][b] = {'heading_true_deg': round(h_, 2), 'pitch_deg': round(p_, 2), 'roll_deg': round(r_, 2), 'source': f'chain:{a}', 'chain_inliers': n, 'chain_depth': depth[b],
                                'sigma_heading_deg': round(1.5 + 1.5 * depth[b] + (60 / n), 1)}
            frontier.append(b)
    # בדיקת עקביות: זוגות שסוגרים מעגל בין שני עוגנים
    checks = []
    for k, v in res['pairs'].items():
        a, b = k.split('-')
        if a in res['anchors'] and b in res['anchors'] and 'H_centered_halfres' in v:
            Rba, _ = rot_from_H(np.array(v['H_centered_halfres']), f_half); hb = hpr(R[a] @ Rba.T)
            checks.append({'pair': k, 'inliers': v['inliers'], 'b_heading_from_chain': round(hb[0], 2), 'b_heading_from_moon': res['anchors'][b]['heading_true_deg'], 'diff_deg': round(((hb[0] - res['anchors'][b]['heading_true_deg'] + 180) % 360) - 180, 2)})
    res['loop_checks'] = checks
    p = os.path.join(out, 'calib', 'calib.json'); json.dump(res, open(p, 'w'), ensure_ascii=False, indent=1)
    print('f35', res['f35']['value'], 'fov', res['fov_deg'], '| anchors', {k: (v['heading_true_deg'], v['pitch_deg']) for k, v in res['anchors'].items()})
    for k, v in sorted(res['photos'].items()): print(' ', k, v['source'], 'h %.1f p %.1f r %.1f σh %.1f' % (v['heading_true_deg'], v['pitch_deg'], v['roll_deg'], v['sigma_heading_deg']))
    print('loop checks', checks, '→', p)

if __name__ == '__main__':
    main()
