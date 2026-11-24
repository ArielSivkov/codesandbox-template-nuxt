#!/usr/bin/env python3
"""compare.py – השוואה מספרית צילום ↔ רינדור, בלי מודל. python3 -I compare.py [--out DIR] [--sizes 360x800,1080x1920] [--only 096,095]

לכל משימה ולכל גודל רינדור:
 1. חלון זוויתי משותף: התמונה (נוף 4:3, ‎75.4°×60.2°) והרינדור (פורטרט, 68° אנכי) נחתכים לאותו חלון סביב ציר המבט,
    אחרי תיקון גלגול (roll) של התמונה. סימן המים של הטלפון מוחרג מכל המדדים – באותו מקום בשתי התמונות.
 2. רצועות (אותו אלגוריתם לשתיהן): שמיים = אזור חלק שמחובר לקצה העליון ונמצא מעל קו האופק הגאומטרי;
    קרקע = לא-שמיים מתחת לשורה שבה קרן מגובה 1.6 מ' פוגעת בקרקע במרחק 25 מ' (‎−3.66°); מבנים/צמחייה = כל השאר.
 3. מדדים לכל רצועה: צבע ממוצע (CIELAB) ו-ΔE2000, פלטה (k-means, 5 צבעים) ו-ΔE פלטה, בהירות (L* ממוצע ואחוזונים),
    צפיפות קצוות (Canny, באותה רזולוציה) = "פרטים/טקסטורה", אורות מלאכותיים (כתמים בהירים וחמים לכל 10k פיקסלים).
 4. קו רקיע: גובה זוויתי (מעלות) של גבול השמיים בכל עמודה, בצילום מול רינדור; יחס שמיים/מבנים.
 5. רמז יישור: הזזה (כיוון/הטיה) שממקסמת חפיפת מסכות השמיים – משוב לתנוחה, לא מתקן את המדדים.
 6. תמונת צד-מול-צד עם כיתוב עברי. פרטיות: רק משימות שעברו בדיקת פרטיות (pose_notes.privacy_review) נכתבות בחדות;
    אחרות – הצילום מפוקסל (פסיפס 10 פיקסלים) בתמונת הפלט. המדדים מחושבים תמיד על המקור.
פלט: <out>/compare/<size>/<id>.json + <id>.jpg, ו-<out>/compare/metrics.json
"""
import json, os, sys, math, glob
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
from skimage.color import rgb2lab, deltaE_ciede2000

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
NEAR_GROUND_M = 25.0
MAX_AW = 720            # רוחב ניתוח מרבי (פיקסלים)
BANDS = ('sky', 'mid', 'ground')
BAND_HE = {'sky': 'שמיים', 'mid': 'מבנים/צמחייה', 'ground': 'קרקע/כביש'}

# ---------------------------------------------------------------- גאומטריה
def common_window(job, meta):
    fh, fv = job['camera']['fov_h_deg'], job['camera']['fov_v_deg']
    tv_r = math.tan(math.radians(meta['camera']['fov_v_deg']) / 2); th_r = tv_r * meta['camera']['aspect']
    th_p, tv_p = math.tan(math.radians(fh) / 2), math.tan(math.radians(fv) / 2)
    th, tv = min(th_p, th_r), min(tv_p, tv_r)
    return {'tan_h': th, 'tan_v': tv, 'fov_h_deg': 2 * math.degrees(math.atan(th)), 'fov_v_deg': 2 * math.degrees(math.atan(tv)),
            'photo_frac': (th / th_p, tv / tv_p), 'render_frac': (th / th_r, tv / tv_r)}

def crop_center(img, fx, fy):
    h, w = img.shape[:2]; cw, ch = w * fx / 2, h * fy / 2
    x0, x1, y0, y1 = int(round(w / 2 - cw)), int(round(w / 2 + cw)), int(round(h / 2 - ch)), int(round(h / 2 + ch))
    return img[max(0, y0):y1, max(0, x0):x1], (x0, y0, x1, y1)

def level(img, roll_deg):
    if abs(roll_deg) < 0.5: return img
    h, w = img.shape[:2]; M = cv2.getRotationMatrix2D((w / 2, h / 2), -roll_deg, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

def row_of_elev(e_deg, pitch_deg, tan_v, H):
    return H / 2 - math.tan(math.radians(e_deg - pitch_deg)) / tan_v * H / 2

def elev_of_row(y, pitch_deg, tan_v, H):
    return pitch_deg + math.degrees(math.atan((H / 2 - y) / (H / 2) * tan_v))

# ---------------------------------------------------------------- צבע
def to_lab(bgr):
    return rgb2lab(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0)

def de2000(a, b):
    return float(deltaE_ciede2000(np.array(a, np.float64).reshape(1, 1, 3), np.array(b, np.float64).reshape(1, 1, 3))[0, 0])

def palette(lab, mask, k=5):
    px = lab[mask]
    if len(px) < 50: return []
    if len(px) > 20000: px = px[np.random.default_rng(7).choice(len(px), 20000, replace=False)]
    k = min(k, max(1, len(px) // 50))
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.2)
    cv2.setRNGSeed(7); _, lbl, cen = cv2.kmeans(px.astype(np.float32), k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    w = np.bincount(lbl.ravel(), minlength=k) / len(lbl)
    out = sorted([{'lab': [round(float(x), 1) for x in cen[i]], 'w': round(float(w[i]), 3), 'hex': lab_hex(cen[i])} for i in range(k)], key=lambda d: -d['w'])
    return out

def lab_hex(lab):
    from skimage.color import lab2rgb
    rgb = np.clip(lab2rgb(np.array(lab, np.float64).reshape(1, 1, 3))[0, 0], 0, 1)
    return '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in rgb)

def palette_de(p, q):
    """ΔE סימטרי: לכל צבע בפלטה אחת – הצבע הקרוב בשנייה, ממוצע משוקלל, ממוצע שני הכיוונים."""
    if not p or not q: return None
    d1 = sum(c['w'] * min(de2000(c['lab'], e['lab']) for e in q) for c in p)
    d2 = sum(e['w'] * min(de2000(e['lab'], c['lab']) for c in p) for e in q)
    return round((d1 + d2) / 2, 2)

# ---------------------------------------------------------------- רצועות
def sky_mask(bgr, valid, horizon_row):
    """שמיים בלי מודל: רכיב חלק (שיפוע נמוך) ובהיר יחסית מעל האופק הגאומטרי – הגדול ביותר – ועוד רכיבים חלקים
    בצבע קרוב לשמיים באותן שורות (שמיים בין ענפים). בדמדומים השמיים בהירים מהצלליות; כך גם נדחית חופה כהה של עץ."""
    lab = to_lab(bgr); H, W = lab.shape[:2]
    Lb = cv2.GaussianBlur(lab[..., 0], (0, 0), 1.6); ab = [cv2.GaussianBlur(lab[..., c], (0, 0), 1.6) for c in (1, 2)]
    g = np.sqrt(sum(cv2.Sobel(c, cv2.CV_32F, 1, 0) ** 2 + cv2.Sobel(c, cv2.CV_32F, 0, 1) ** 2 for c in (Lb, ab[0] * 0.6, ab[1] * 0.6)))
    hr = int(np.clip(round(horizon_row), 1, H)); above = np.zeros((H, W), bool); above[:hr] = True; above &= valid
    if above.sum() < 100: return np.zeros((H, W), bool), 0.0
    thr = float(np.clip(np.percentile(g[above], 30) * 2.5 + 1.2, 3.0, 16.0))
    # סף בהירות מעל האופק: מפריד צלליות כהות (חופות, בניינים לא מוארים) משמיים בהירים יותר – רק כשיש מצב כהה
    La = Lb[above]; p95 = float(np.percentile(La, 95)); cut = 0.35 * p95; dark = La < cut
    if dark.mean() > 0.08 and (~dark).sum() > 50: Lmin = 0.5 * (float(np.median(La[dark])) + float(np.median(La[~dark])))   # יש מצב כהה (צלליות): סף באמצע בין המצבים
    else: Lmin = max(8.0, 0.2 * p95)
    smooth = (g < thr) & above & (Lb >= Lmin)
    smooth = cv2.morphologyEx(smooth.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(bool)
    n, lbl, st, _ = cv2.connectedComponentsWithStats(smooth.astype(np.uint8), connectivity=4)
    if n <= 1: return np.zeros((H, W), bool), thr
    fl = lbl.ravel(); cnt = np.bincount(fl, minlength=n).astype(np.float64); cnt[cnt == 0] = 1
    mean = np.stack([np.bincount(fl, weights=lab[..., c].ravel(), minlength=n) / cnt for c in range(3)], 1)
    yrow = (np.bincount(fl, weights=np.repeat(np.arange(H), W).astype(np.float64), minlength=n) / cnt)
    area = st[:, cv2.CC_STAT_AREA].astype(float); area[0] = 0
    cand = (mean[:, 0] >= Lmin) & (area >= 40)
    if not cand.any(): return np.zeros((H, W), bool), thr
    seed = int(np.argmax(np.where(cand, area * (1.2 - yrow / hr * 0.4), -1)))
    sky = lbl == seed
    prof = np.full((H, 3), np.nan)
    for y0 in range(0, H, 6):
        m = sky[y0:y0 + 6]
        if m.sum() > 10: prof[y0:y0 + 6] = np.median(lab[y0:y0 + 6][m], axis=0)
    j = np.where(~np.isnan(prof[:, 0]))[0]
    if len(j):
        for i in range(H):
            if np.isnan(prof[i, 0]): prof[i] = prof[j[np.argmin(np.abs(j - i))]]
        dist = np.linalg.norm(mean - prof[yrow.astype(int).clip(0, H - 1)], axis=1)
        add = cand & (dist < 10.0); add[seed] = False; add[0] = False
        # זוהר שקיעה/אופק בהיר: רכיב חלק גדול (≥0.4% מהחלון) ובהיר לפחות כמו השמיים שנמצאו – גם אם צבעו שונה (כתום/ורוד)
        big = cand & (area >= 0.001 * above.sum()) & (mean[:, 0] >= 0.7 * mean[seed, 0]); big[0] = False
        add |= big
        if add.any(): sky |= add[lbl]
    sky = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)).astype(bool) & above
    return sky, thr

def skyline(sky, valid):
    """שורת קו הרקיע בכל עמודה = הפיקסל הנמוך ביותר של שמיים (מתחתיו: מבנים/עצים/קרקע). ענפים מעליו לא משנים."""
    H, W = sky.shape; out = np.full(W, np.nan)
    for x in range(W):
        nz = np.nonzero(sky[:, x])[0]
        if len(nz) and valid[min(H - 1, nz[-1] + 1), x]: out[x] = nz[-1] + 1
    return out

def lights(lab, mask):
    """אורות מלאכותיים: כתמים קטנים בהירים (L*>78) וחמים/לבנים בתוך הרצועה; לכל 10k פיקסלים."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    m = (L > 78) & ((b > 18) | (L > 90)) & mask
    n, _, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    small = int(((st[1:, cv2.CC_STAT_AREA] >= 1) & (st[1:, cv2.CC_STAT_AREA] <= 400)).sum()) if n > 1 else 0
    return round(small / max(mask.sum(), 1) * 1e4, 2), round(float(m.sum() / max(mask.sum(), 1)), 4)

def band_stats(bgr, lab, band, edges):
    n = int(band.sum())
    if n < 50: return {'frac': round(n / band.size, 4), 'n': n}
    L = lab[..., 0][band]; lt = lights(lab, band)
    return {'frac': round(n / band.size, 4), 'n': n, 'lab_mean': [round(float(x), 2) for x in lab[band].mean(axis=0)],
            'L_p10_p50_p90': [round(float(x), 1) for x in np.percentile(L, [10, 50, 90])], 'L_mean': round(float(L.mean()), 2),
            'edge_density': round(float(edges[band].mean()), 4), 'palette': palette(lab, band), 'lights_per_10k': lt[0], 'light_px_frac': lt[1]}

def analyse(bgr, valid, pitch, tan_v, eye_h, dip, sky_true=None):
    H, W = bgr.shape[:2]; lab = to_lab(bgr)
    hr = row_of_elev(-dip - 0.3, pitch, tan_v, H)
    sky_h, thr = sky_mask(bgr, valid, hr)
    sky = (sky_true & valid) if sky_true is not None else sky_h
    gy = int(np.clip(round(row_of_elev(-math.degrees(math.atan(eye_h / NEAR_GROUND_M)), pitch, tan_v, H)), 0, H))
    rows = np.arange(H)[:, None] * np.ones((1, W), bool)
    ground = (~sky) & valid & (rows >= gy); mid = (~sky) & valid & (rows < gy)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY); edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 40, 110) > 0
    st = {k: band_stats(bgr, lab, m, edges) for k, m in (('sky', sky), ('mid', mid), ('ground', ground))}
    st['all'] = {'L_mean': round(float(lab[..., 0][valid].mean()), 2), 'edge_density': round(float(edges[valid].mean()), 4), 'lab_mean': [round(float(x), 2) for x in lab[valid].mean(axis=0)]}
    if sky.sum() >= 80:
        ys = np.nonzero(sky)[0]; q1, q3 = np.percentile(ys, [25, 75])
        st['sky']['lab_top'] = [round(float(x), 2) for x in lab[sky & (np.arange(H)[:, None] <= q1)].mean(axis=0)]
        st['sky']['lab_low'] = [round(float(x), 2) for x in lab[sky & (np.arange(H)[:, None] >= q3)].mean(axis=0)]
    sl = skyline(sky, valid); el = np.array([elev_of_row(y, pitch, tan_v, H) if not np.isnan(y) else np.nan for y in sl])
    return {'stats': st, 'masks': {'sky': sky, 'mid': mid, 'ground': ground, 'sky_heuristic': sky_h}, 'skyline_row': sl, 'skyline_elev': el, 'sky_thr': thr, 'horizon_row': hr, 'ground_row': gy, 'lab': lab}

def align_hint(sp, sr, tan_h, tan_v, max_h=6.0, max_v=4.0):
    """הזזה בפיקסלים של מסכת שמיים ברינדור שממקסמת IoU עם הצילום → מעלות כיוון/הטיה (ימינה/למעלה חיובי)."""
    H, W = sp.shape; best = (0, 0, 0.0)
    dpx_h = W / 2 / tan_h; dpx_v = H / 2 / tan_v
    u0 = (sp | sr).sum(); base = (sp & sr).sum() / u0 if u0 else 0.0; best = (0, 0, base)
    for dy in range(-int(dpx_v * math.tan(math.radians(max_v))), int(dpx_v * math.tan(math.radians(max_v))) + 1, 2):
        for dx in range(-int(dpx_h * math.tan(math.radians(max_h))), int(dpx_h * math.tan(math.radians(max_h))) + 1, 2):
            r = np.roll(np.roll(sr, dy, 0), dx, 1)
            sl = (slice(max(0, dy), H + min(0, dy)), slice(max(0, dx), W + min(0, dx)))
            a, b = sp[sl], r[sl]; u = (a | b).sum(); iou = (a & b).sum() / u if u else 0
            if iou > best[2] + 1e-9: best = (dx, dy, iou)
    dx, dy, iou = best; mx, my = int(dpx_h * math.tan(math.radians(max_h))), int(dpx_v * math.tan(math.radians(max_v)))
    at_bound = abs(dx) >= mx - 1 or abs(dy) >= my - 1
    return {'at_bound': bool(at_bound), 'reliable': bool(not at_bound and iou - (base or 0) >= 0.05 and iou >= 0.5), 'iou0': round(float(base or 0), 3), 'iou_best': round(float(iou), 3), 'heading_shift_deg': round(-math.degrees(math.atan(dx / dpx_h)), 2), 'pitch_shift_deg': round(math.degrees(math.atan(dy / dpx_v)), 2),
            'note': 'הזזה שמשפרת חפיפת שמיים; חיובי = לסובב את המצלמה ימינה/למעלה. משוב לתנוחה בלבד.'}

# ---------------------------------------------------------------- תמונת צד-מול-צד
def hebrew(draw, xy, text, size=14, fill=(255, 255, 255), bold=False, anchor='ra'):
    f = ImageFont.truetype(FONT_B if bold else FONT, size)
    draw.text(xy, text, font=f, fill=fill, direction='rtl', language='he', anchor=anchor)

def overlay_bands(bgr, A):
    o = bgr.copy(); col = {'sky': (255, 160, 60), 'mid': (60, 200, 255), 'ground': (60, 220, 80)}
    for k, c in col.items():
        m = A['masks'][k]; o[m] = (0.55 * o[m] + 0.45 * np.array(c)).astype(np.uint8)
    for x, y in enumerate(A['skyline_row']):
        if not np.isnan(y): cv2.circle(o, (x, int(min(y, o.shape[0] - 1))), 0, (0, 0, 255), 1)
    return o

def side_by_side(job, size, ph, rd, Ap, Ar, d, path, private_ok):
    H, W = ph.shape[:2]
    p_show = ph.copy()
    if not private_ok:
        s = cv2.resize(p_show, (max(1, W // 10), max(1, H // 10)), interpolation=cv2.INTER_AREA); p_show = cv2.resize(s, (W, H), interpolation=cv2.INTER_NEAREST)
    panels = [p_show, rd, overlay_bands(ph, Ap), overlay_bands(rd, Ar)]
    if W > 540: panels = [cv2.resize(p, (540, int(H * 540 / W)), interpolation=cv2.INTER_AREA) for p in panels]
    ph2 = panels[0].shape[0]; pw = panels[0].shape[1]; gap = 6; head = 74; foot = 150
    canvas = Image.new('RGB', (pw * 4 + gap * 3, ph2 + head + foot), (18, 22, 30)); dr = ImageDraw.Draw(canvas)
    for i, p in enumerate(panels): canvas.paste(Image.fromarray(cv2.cvtColor(p, cv2.COLOR_BGR2RGB)), (i * (pw + gap), head))
    Wc = canvas.width
    hebrew(dr, (Wc - 8, 6), f"תמונה {job['id']} · {job['date']} {job['time_il']} · רינדור {size} · ביטחון תנוחה: {job['confidence']['overall']}", 15, bold=True)
    P = job['pose']
    hebrew(dr, (Wc - 8, 28), f"ITM ‎{P['itm_real']['E']:.0f},{P['itm_real']['N']:.0f} (±{P['sigma']['position_m']} מ׳) · כיוון {P['heading_true_deg']:.1f}° (±{P['sigma']['heading_deg']}) · הטיה {P['pitch_deg']:+.1f}° · חלון {d['window']['fov_h_deg']:.1f}°×{d['window']['fov_v_deg']:.1f}°", 12, fill=(200, 210, 225))
    labels = ['הצילום (חלון משותף)', 'העולם התלת-ממדי', 'רצועות בצילום', 'רצועות ברינדור']
    for i, t in enumerate(labels): hebrew(dr, (i * (pw + gap) + pw - 6, 52), t, 13, fill=(242, 184, 75), bold=True)
    y = head + ph2 + 6; m = d['metrics']
    lines = []
    for k in BANDS:
        b = m['bands'][k]
        if b.get('dE_mean') is None: lines.append(f"{BAND_HE[k]}: שבר {b['frac_photo']:.0%} מול {b['frac_render']:.0%}"); continue
        lines.append(f"{BAND_HE[k]}: שבר {b['frac_photo']:.0%}/{b['frac_render']:.0%} · ΔE ממוצע {b['dE_mean']:.1f} · ΔE פלטה {b['dE_palette']:.1f} · ΔL* {b['dL']:+.1f} · קצוות {b['edge_photo']:.3f}/{b['edge_render']:.3f} · אורות {b['lights_photo']:.1f}/{b['lights_render']:.1f}")
    sk = m['skyline']
    lines.append(f"קו רקיע: הפרש חציוני {sk['median_diff_deg']:+.1f}° (חיובי = בצילום גבוה יותר) · יחס שמיים/מבנים {m['sky_to_mid_photo']}/{m['sky_to_mid_render']} · רמז יישור: כיוון {m['align']['heading_shift_deg']:+.1f}° הטיה {m['align']['pitch_shift_deg']:+.1f}° (IoU {m['align']['iou0']}→{m['align']['iou_best']})")
    lines.append('כחול=שמיים · כתום=מבנים/צמחייה · ירוק=קרקע · אדום=קו רקיע. ערכים: צילום/רינדור. ברינדור: שמיים מהמעבר הסמנטי (אמת).' + ('' if private_ok else ' הצילום מפוקסל – לא עבר בדיקת פרטיות.'))
    for t in lines: hebrew(dr, (Wc - 8, y), t, 12, fill=(225, 230, 238)); y += 20
    canvas.save(path, quality=86)

# ---------------------------------------------------------------- ראשי
def compare_one(job, meta, size, outdir, private_ok, wm_boxes):
    ph0 = cv2.imread(job['photo']); rd0 = cv2.imread(meta['png'])
    win = common_window(job, meta)
    phl = level(ph0, job['pose'].get('roll_deg', 0.0))
    pc, pbox = crop_center(phl, *win['photo_frac']); rc, _ = crop_center(rd0, *win['render_frac'])
    aw = min(MAX_AW, rc.shape[1]); ah = int(round(aw * win['tan_v'] / win['tan_h']))
    pc = cv2.resize(pc, (aw, ah), interpolation=cv2.INTER_AREA); rc = cv2.resize(rc, (aw, ah), interpolation=cv2.INTER_AREA)
    # סימן מים → מסכה (קואורדינטות התמונה המקורית → החלון)
    valid = np.ones((ah, aw), bool); h0, w0 = ph0.shape[:2]; x0, y0, x1, y1 = pbox
    for bx0, by0, bx1, by1 in wm_boxes:
        X0, X1 = (bx0 * w0 - x0) / (x1 - x0) * aw, (bx1 * w0 - x0) / (x1 - x0) * aw; Y0, Y1 = (by0 * h0 - y0) / (y1 - y0) * ah, (by1 * h0 - y0) / (y1 - y0) * ah
        xa, xb, ya, yb = int(max(0, X0)), int(min(aw, X1)), int(max(0, Y0)), int(min(ah, Y1))
        if xb > xa and yb > ya: valid[ya:yb, xa:xb] = False
    eye = job['pose']['cam_height_m']; pitch_p = job['pose']['pitch_deg']; pitch_r = meta['camera']['pitch_deg']
    dip_p = math.degrees(math.sqrt(2 * max(meta['camera']['y'], 1) / 6371000.0))
    cls_r = None
    if meta.get('seg') and os.path.exists(meta['seg']['png']):
        sg = cv2.cvtColor(cv2.imread(meta['seg']['png']), cv2.COLOR_BGR2RGB); sg, _ = crop_center(sg, *win['render_frac'])
        sg = cv2.resize(sg, (aw, ah), interpolation=cv2.INTER_NEAREST); keys = meta['seg']['keys']; names = list(keys.keys())
        dist = np.stack([np.abs(sg.astype(int) - np.array(keys[k])).sum(axis=2) for k in names], 0); cls_r = np.array(names, dtype=object)[np.argmin(dist, 0)]
    Ap = analyse(pc, valid, pitch_p, win['tan_v'], eye, dip_p)
    Ar = analyse(rc, valid, pitch_r, win['tan_v'], eye, 0.0, sky_true=(cls_r == 'sky') if cls_r is not None else None)
    bands = {}
    for k in BANDS:
        sp, sr = Ap['stats'][k], Ar['stats'][k]; e = {'frac_photo': sp['frac'], 'frac_render': sr['frac']}
        if 'lab_mean' in sp and 'lab_mean' in sr:
            e.update({'dE_mean': round(de2000(sp['lab_mean'], sr['lab_mean']), 2), 'dE_palette': palette_de(sp['palette'], sr['palette']),
                      'dL': round(sr['L_mean'] - sp['L_mean'], 2), 'da': round(sr['lab_mean'][1] - sp['lab_mean'][1], 2), 'db': round(sr['lab_mean'][2] - sp['lab_mean'][2], 2),
                      'L_photo': sp['L_mean'], 'L_render': sr['L_mean'], 'lab_photo': sp['lab_mean'], 'lab_render': sr['lab_mean'],
                      'edge_photo': sp['edge_density'], 'edge_render': sr['edge_density'], 'edge_ratio': round(sr['edge_density'] / max(sp['edge_density'], 1e-4), 3),
                      'lights_photo': sp['lights_per_10k'], 'lights_render': sr['lights_per_10k'], 'palette_photo': sp['palette'], 'palette_render': sr['palette'],
                      'L_pct_photo': sp['L_p10_p50_p90'], 'L_pct_render': sr['L_p10_p50_p90']})
            if k == 'sky': e.update({'lab_top_photo': sp.get('lab_top'), 'lab_low_photo': sp.get('lab_low'), 'lab_top_render': sr.get('lab_top'), 'lab_low_render': sr.get('lab_low')})
        bands[k] = e
    dif = Ap['skyline_elev'] - Ar['skyline_elev']; ok = ~np.isnan(dif)
    th = win['tan_h']; cols = np.arange(aw); rel_deg = np.degrees(np.arctan((cols - aw / 2) / (aw / 2) * th))
    sk = {'median_diff_deg': round(float(np.nanmedian(dif)), 2) if ok.any() else None, 'iqr_deg': [round(float(x), 2) for x in np.nanpercentile(dif, [25, 75])] if ok.any() else None,
          'cols_defined_frac': round(float(ok.mean()), 3),
          'profile': [{'rel_bearing_deg': round(float(rel_deg[x]), 2), 'photo_elev': None if np.isnan(Ap['skyline_elev'][x]) else round(float(Ap['skyline_elev'][x]), 2),
                       'render_elev': None if np.isnan(Ar['skyline_elev'][x]) else round(float(Ar['skyline_elev'][x]), 2)} for x in range(0, aw, max(1, aw // 72))]}
    if sk['median_diff_deg'] is None: sk['median_diff_deg'] = float('nan')
    m = {'bands': bands, 'skyline': sk,
         'sky_to_mid_photo': round(Ap['stats']['sky']['frac'] / max(Ap['stats']['mid']['frac'], 1e-3), 2), 'sky_to_mid_render': round(Ar['stats']['sky']['frac'] / max(Ar['stats']['mid']['frac'], 1e-3), 2),
         'brightness': {'photo_L': Ap['stats']['all']['L_mean'], 'render_L': Ar['stats']['all']['L_mean'], 'dL': round(Ar['stats']['all']['L_mean'] - Ap['stats']['all']['L_mean'], 2)},
         'edges_all': {'photo': Ap['stats']['all']['edge_density'], 'render': Ar['stats']['all']['edge_density']},
         'align': align_hint(Ap['masks']['sky'], Ar['masks']['sky'], win['tan_h'], win['tan_v']),
         'sky_thr': {'photo': round(Ap['sky_thr'], 2), 'render': round(Ar['sky_thr'], 2)}}
    if cls_r is not None:
        comp = {}
        for k in ('mid', 'ground'):
            m_ = Ar['masks'][k]; n_ = max(int(m_.sum()), 1); comp[k] = {c: round(float((cls_r[m_] == c).sum()) / n_, 3) for c in meta['seg']['keys'] if c != 'sky' and (cls_r[m_] == c).any()}
        whole = {c: round(float((cls_r[valid] == c).mean()), 4) for c in meta['seg']['keys']}
        st_, sh_ = (cls_r == 'sky') & valid, Ar['masks']['sky_heuristic']; u_ = (st_ | sh_).sum()
        m['render_classes'] = {'window': whole, 'by_band': comp, 'source': 'מעבר סמנטי (ID pass) של render.js – אמת לרינדור'}
        m['sky_heuristic_check'] = {'iou_vs_truth_on_render': round(float((st_ & sh_).sum() / u_), 3) if u_ else None, 'note': 'אותו אלגוריתם שמיים שמופעל על הצילום, נבדק מול האמת של הרינדור'}
    d = {'id': job['id'], 'size': size, 'date': job['date'], 'time_il': job['time_il'], 'window': {k: (round(v, 4) if isinstance(v, float) else [round(x, 4) for x in v]) for k, v in win.items()}, 'analysis_px': [aw, ah],
         'pose': job['pose'], 'confidence': job['confidence'], 'render_camera': meta['camera'], 'sun_render': meta['sun'], 'metrics': m,
         'quality': job.get('quality'), 'privacy': 'reviewed' if private_ok else 'pixelated-in-output'}
    os.makedirs(outdir, exist_ok=True)
    jp = os.path.join(outdir, job['id'] + '.jpg'); side_by_side(job, size, pc, rc, Ap, Ar, d, jp, private_ok); d['side_by_side'] = jp
    np.savez_compressed(os.path.join(outdir, job['id'] + '.masks.npz'), sky_p=Ap['masks']['sky'], sky_r=Ar['masks']['sky'], skyline_p=Ap['skyline_elev'], skyline_r=Ar['skyline_elev'], rel_deg=rel_deg)
    json.dump(d, open(os.path.join(outdir, job['id'] + '.json'), 'w'), ensure_ascii=False, indent=1, default=float)
    return d

def main():
    a = sys.argv; out = a[a.index('--out') + 1] if '--out' in a else '/home/claude/swarm/photomatch-out'
    sizes = (a[a.index('--sizes') + 1] if '--sizes' in a else '360x800,1080x1920').split(',')
    only = set(a[a.index('--only') + 1].split(',')) if '--only' in a else None
    shard = tuple(map(int, a[a.index('--shard') + 1].split('/'))) if '--shard' in a else None   # אותה חלוקה כמו render.js (לפי מיקום ברשימת jobs)
    J = json.load(open(os.path.join(out, 'jobs.json'), encoding='utf-8')); notes = json.load(open(os.path.join(HERE, 'pose_notes.json'), encoding='utf-8'))
    pr = notes.get('privacy_review', {}); reviewed = set(notes['photos'].keys()) if pr.get('faces') == 0 and pr.get('plates') == 0 else set()
    wm = notes['calibration']['watermark_boxes']; allm = {}
    for size in sizes:
        for ji, job in enumerate(J['jobs']):
            if not job.get('compare') or (only and job['id'] not in only) or (shard and ji % shard[1] != shard[0]): continue
            mp = os.path.join(out, 'renders', size, job['id'] + '.json')
            if not os.path.exists(mp): print('no render', size, job['id']); continue
            meta = json.load(open(mp, encoding='utf-8'))
            d = compare_one(job, meta, size, os.path.join(out, 'compare', size), job['id'] in reviewed, wm)
            allm.setdefault(job['id'], {})[size] = {'metrics': d['metrics'], 'confidence': d['confidence'], 'pose': d['pose'], 'window': d['window'], 'side_by_side': d['side_by_side'], 'quality': d['quality'], 'render_camera': d['render_camera']}
            b = d['metrics']['bands']; sk = d['metrics']['skyline']
            print(f"[{size}] {job['id']}  sky {b['sky']['frac_photo']:.2f}/{b['sky']['frac_render']:.2f} dE {b['sky'].get('dE_mean')}  mid dE {b['mid'].get('dE_mean')} dL {b['mid'].get('dL')}  ground dL {b['ground'].get('dL')}  "
                  f"edges {d['metrics']['edges_all']['photo']:.3f}/{d['metrics']['edges_all']['render']:.3f}  skyline {sk['median_diff_deg']:+.1f}°  align h{d['metrics']['align']['heading_shift_deg']:+.1f} p{d['metrics']['align']['pitch_shift_deg']:+.1f}")
    os.makedirs(os.path.join(out, 'compare'), exist_ok=True); mp = os.path.join(out, 'compare', 'metrics.json')
    if os.path.exists(mp):   # מיזוג: הרצות חלקיות (--only/--shard/גודל אחר) לא מוחקות תוצאות קודמות
        old = json.load(open(mp, encoding='utf-8'))
        for k, v in allm.items(): old.setdefault(k, {}).update(v)
        allm = old
    json.dump(allm, open(mp, 'w'), ensure_ascii=False, indent=1, default=float)

if __name__ == '__main__':
    main()
