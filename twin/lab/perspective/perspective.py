#!/usr/bin/env python3
"""מנוע פרספקטיבה – פירוק תמונה לשכבות "דה וינצ'י":
1. שכבת סקיצה (קווי מתאר בסגנון רישום)
2. שכבת פרספקטיבה: קווים לפי נקודת מגוז, קו אופק, קרניים מנקודות המגוז
3. נתונים: נקודות מגוז, מוקד משוער (שקול 35 מ"מ), הטיית מצלמה וגלגול – עם סטיית תקן מ-bootstrap

שימוש: python3 perspective.py תמונה.jpg תיקיית_פלט [--blur x0,y0,x1,y1 ...]
"""
import sys, json, math, random
import numpy as np, cv2

def lines_of(gray):
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    L = lsd.detect(gray)[0]
    if L is None: return np.zeros((0, 4))
    L = L.reshape(-1, 4)
    ln = np.hypot(L[:, 2] - L[:, 0], L[:, 3] - L[:, 1])
    return L[ln > max(gray.shape) * 0.025]

def homog_line(s):
    p, q = np.array([s[0], s[1], 1.0]), np.array([s[2], s[3], 1.0])
    l = np.cross(p, q); return l / (np.hypot(l[0], l[1]) + 1e-12)

def vp_err(s, v):
    """זווית (מעלות) בין הקטע לבין הקו ממרכזו לנקודת המגוז"""
    m = np.array([(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]); d = np.array([s[2] - s[0], s[3] - s[1]])
    if abs(v[2]) < 1e-9: t = v[:2]
    else: t = v[:2] / v[2] - m
    c = abs(np.dot(d, t)) / (np.linalg.norm(d) * np.linalg.norm(t) + 1e-12)
    return math.degrees(math.acos(min(1, c)))

def ransac_vp(S, it=1500, th=1.5, seed=0):
    rnd = random.Random(seed); best, bi = None, []
    if len(S) < 2: return None, []
    H = [homog_line(s) for s in S]; W = np.hypot(S[:, 2] - S[:, 0], S[:, 3] - S[:, 1])
    for _ in range(it):
        i, j = rnd.sample(range(len(S)), 2); v = np.cross(H[i], H[j])
        if np.linalg.norm(v) < 1e-12: continue
        inl = [k for k in range(len(S)) if vp_err(S[k], v) < th]
        if W[inl].sum() > (W[bi].sum() if bi else 0): best, bi = v, inl
    if not bi: return None, []
    A = np.array([H[k] * W[k] for k in bi]); v = np.linalg.svd(A)[2][-1]   # התאמה במשקל אורך
    return v, bi

def pt(v): return None if abs(v[2]) < 1e-9 else v[:2] / v[2]

def analyze(S, c):
    ang = np.degrees(np.arctan2(S[:, 3] - S[:, 1], S[:, 2] - S[:, 0])) % 180
    vert = S[np.abs(ang - 90) < 25]; rest = S[np.abs(ang - 90) >= 25]
    vz, iz = ransac_vp(vert)
    v1, i1 = ransac_vp(rest, seed=1)
    rest2 = np.delete(rest, i1, axis=0) if len(i1) else rest
    v2, i2 = ransac_vp(rest2, seed=2)
    out = {'vz': vz, 'v1': v1, 'v2': v2, 'iz': vert[iz] if len(iz) else [], 'i1': rest[i1] if len(i1) else [], 'i2': rest2[i2] if len(i2) else []}
    # מוקד מנקודות מגוז אורתוגונליות: f^2 = -(va-c)·(vb-c)
    fs = []
    for a, b in (('vz', 'v1'), ('vz', 'v2'), ('v1', 'v2')):
        pa, pb = (pt(out[a]) if out[a] is not None else None), (pt(out[b]) if out[b] is not None else None)
        if pa is None or pb is None: continue
        f2 = -np.dot(pa - c, pb - c)
        if f2 > 0: fs.append(math.sqrt(f2))
    out['f_pairs'] = fs
    return out

def main():
    src, outd = sys.argv[1], sys.argv[2]; blur = [list(map(int, b.split(','))) for b in sys.argv[3:] if b[0].isdigit()]
    img = cv2.imread(src); h, w = img.shape[:2]
    for x0, y0, x1, y1 in blur:   # פרטיות: לוחיות רישוי ואנשים
        img[y0:y1, x0:x1] = cv2.GaussianBlur(img[y0:y1, x0:x1], (0, 0), 25)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); c = np.array([w / 2, h / 2])
    S = lines_of(cv2.equalizeHist(gray)); R = analyze(S, c)
    # bootstrap: מריצים שוב על דגימות חוזרות של הקווים → סטיית תקן אמיתית למוקד ולזוויות
    boots = []
    for b in range(25):
        idx = np.random.default_rng(b).integers(0, len(S), len(S)); r = analyze(S[idx], c)
        if r['f_pairs'] and r['vz'] is not None and pt(r['vz']) is not None: boots.append((np.median(r['f_pairs']), pt(r['vz'])))
    diag = math.hypot(w, h)
    f = float(np.median(R['f_pairs'])) if R['f_pairs'] else None
    fb = np.array([b[0] for b in boots]) if boots else np.array([])
    vz = pt(R['vz']) if R['vz'] is not None else None
    res = {'image': src.split('/')[-1], 'size': [w, h], 'lines': int(len(S)),
           'vanishing_points_px': {k: (None if R[k] is None or pt(R[k]) is None else [round(float(x), 1) for x in pt(R[k])]) for k in ('vz', 'v1', 'v2')},
           'inliers': {'vz': len(R['iz']), 'v1': len(R['i1']), 'v2': len(R['i2'])}}
    if f:
        res['focal_px'] = round(f, 1); res['focal_px_sigma'] = round(float(fb.std()), 1) if len(fb) > 2 else None
        res['f35_mm'] = round(f / diag * 43.27, 1); res['f35_sigma_mm'] = round(float(fb.std()) / diag * 43.27, 1) if len(fb) > 2 else None
    if vz is not None and f:
        d = vz - c
        res['camera_pitch_deg'] = round(math.degrees(math.atan(f / np.linalg.norm(d))) * (1 if d[1] < 0 else -1), 1)   # חיובי = מצלמה מוטה למעלה
        res['camera_roll_deg'] = round(math.degrees(math.atan2(d[0], abs(d[1]))) * (-1 if d[1] < 0 else 1), 2)
        # קו אופק: ניצב לכיוון נקודת המגוז האנכית, במרחק f^2/|d| מהמרכז בצד השני
        u = d / np.linalg.norm(d); hp = c - u * (f * f / np.linalg.norm(d)); res['horizon_point_px'] = [round(float(x), 1) for x in hp]
        res['horizon_dir'] = [round(float(-u[1]), 4), round(float(u[0]), 4)]
    res['method'] = 'LSD + RANSAC לנקודות מגוז; מוקד מזוגות אורתוגונליים; סטיית תקן מ-25 דגימות bootstrap'
    # ---------- שכבות ----------
    sk = 255 - cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 40, 120)
    paper = np.dstack([sk * 0.93 + 8, sk * 0.88 + 10, sk * 0.78 + 14]).clip(0, 255).astype(np.uint8)   # סגנון רישום על נייר
    cv2.imwrite(f'{outd}/1_sketch.jpg', paper, [cv2.IMWRITE_JPEG_QUALITY, 85])
    per = (img * 0.35).astype(np.uint8)
    cols = {'iz': (255, 160, 60), 'i1': (60, 140, 255), 'i2': (80, 230, 120)}
    for k, col in cols.items():
        for s in R[k]: cv2.line(per, (int(s[0]), int(s[1])), (int(s[2]), int(s[3])), col, 3, cv2.LINE_AA)
    for k, col in (('v1', (60, 140, 255)), ('v2', (80, 230, 120))):   # קרניים מנקודות המגוז האופקיות
        p = pt(R[k]) if R[k] is not None else None
        if p is None: continue
        for t in np.linspace(0, 1, 28):
            q = (0, t * h) if p[0] > w / 2 else (w, t * h)
            cv2.line(per, (int(np.clip(p[0], -1e5, 1e5)), int(np.clip(p[1], -1e5, 1e5))), (int(q[0]), int(q[1])), col, 1, cv2.LINE_AA)
    if 'horizon_point_px' in res:
        hp = np.array(res['horizon_point_px']); dv = np.array(res['horizon_dir'])
        a, b = hp - dv * 5000, hp + dv * 5000
        cv2.line(per, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), (40, 220, 255), 4, cv2.LINE_AA)
        cv2.putText(per, 'HORIZON (eye level)', (30, int(hp[1]) - 15), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (40, 220, 255), 3)
    cv2.imwrite(f'{outd}/2_perspective.jpg', per, [cv2.IMWRITE_JPEG_QUALITY, 85])
    mix = cv2.addWeighted(paper, 0.55, per, 0.9, 0)
    cv2.imwrite(f'{outd}/3_davinci.jpg', mix, [cv2.IMWRITE_JPEG_QUALITY, 85])
    json.dump(res, open(f'{outd}/perspective.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__': main()
