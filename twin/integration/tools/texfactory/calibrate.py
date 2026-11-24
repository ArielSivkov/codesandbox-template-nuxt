#!/usr/bin/env python3
"""texfactory/calibrate.py - כיול צבעי החומרים לצילומי השטח של אריאל (גדוד טקסטורות, ESH27).

שימוש:  python3 -I calibrate.py <photos_dir> <out_json> [photo_097_path] [debug_dir]
  photos_dir  - twin/data/photos (083-096)
  097         - תמונת הלילה מרחוב ליד בית ספר היובל (בדרייב של אריאל; לא נשמרת בריפו - יש בה לוחיות רישוי של אחרים).
                בלעדיה מדלגים על האזורים שלה.
פלט: JSON עם ממוצע/חציון sRGB, ליניארי ו-Y לכל אזור, יחסים בתוך אותה תמונה (אותה תאורה), וההחלטה לכל חומר.

שיטה (מתועדת בדוח):
  1. בכל אזור: פיקסלים בין אחוזון 5 ל-95 של הבהירות (בלי השתקפויות ושוליים), ממוצע ב-sRGB ובליניארי.
  2. יחסים רק בין משטחים אופקיים באותה תמונה (אותה תאורה) - כך שעוצמת התאורה וחשיפת המצלמה מתבטלות.
  3. איזון לבן לפי ייחוס ניטרלי באותה תמונה (צבע לבן של אבן השפה ב-097; אבני הריצוף האפורות ב-093/094).
  4. העוגן לבהירות המוחלטת: האספלט של העולם היום (אחרי מכפיל היום של צוות היופי) - כך שהתאורה שכוילה כבר לא נשברת.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

# (photo, key, material_he, box x0,y0,x1,y1 | ('line', x0,y0,x1,y1,halfwidth), filter, note)
REGIONS = [
    ('097', 'asphalt_lit', 'אספלט (מואר בפנס לד)', (810, 1345, 950, 1395), None, 'כביש בין הרכבים, ליד מעבר החציה'),
    ('097', 'sidewalk_lit', 'מדרכה אפורה (מוארת)', (770, 1283, 880, 1298), None, 'רצועת מדרכה מעבר לאבן השפה'),
    ('097', 'curb_red', 'אבן שפה - צבע אדום', ('line', 905, 1311, 1062, 1339, 4), 'red', 'מקטעים אדומים באבן השפה'),
    ('097', 'curb_white', 'אבן שפה - צבע לבן', ('line', 905, 1311, 1062, 1339, 4), 'white', 'מקטעים לבנים באבן השפה'),
    ('097', 'plaster_lit', 'טיח חזית (מואר בפנס)', (1530, 420, 1680, 560), None, 'קיר מגדל בין החלונות'),
    ('097', 'sky_night', 'שמיים - לילה (18:12)', (100, 100, 900, 500), None, 'שמיים שחורים מעל העיר'),
    ('093', 'pavers_gray', 'אבני ריצוף אפורות (שביל)', (450, 1300, 1000, 1500), None, 'שביל גבעת יונה, דמדומים 17:10'),
    ('094', 'pavers_gray', 'אבני ריצוף אפורות (שביל)', (1650, 1330, 2150, 1520), None, 'שביל גבעת יונה, דמדומים 17:10'),
    ('093', 'stone_steps', 'מדרגות אבן (כורכר/אבן חולית)', (420, 900, 760, 1150), None, 'מדרגות לפרגולה'),
    ('094', 'stone_steps', 'מדרגות אבן (כורכר/אבן חולית)', (1760, 880, 2080, 1180), None, 'מדרגות לפרגולה'),
    ('085', 'concrete_wall', 'קיר בטון/טיח (קיר הגרפיטי)', (60, 320, 560, 440), None, 'מעל הגרפיטי, אור שקיעה'),
    ('095', 'dry_grass', 'עשב יבש', (500, 1300, 1600, 1530), None, 'גבעת יונה, דמדומים 17:09'),
    ('094', 'sand', 'חול (בין השיחים)', (200, 1150, 1200, 1350), 'bright', 'הפיקסלים הבהירים באזור קרקע מעורב'),
    ('094', 'dry_grass', 'עשב יבש', (200, 1150, 1200, 1350), 'dark', 'הפיקסלים הכהים באזור קרקע מעורב'),
    ('092', 'sky_dusk', 'שמיים - דמדומים (17:10)', (1000, 100, 2100, 500), None, 'מעל השקיעה'),
    ('092', 'sky_horizon', 'שמיים - אופק שקיעה', (1400, 700, 2000, 790), None, 'פס כתום מעל האופק'),
    ('093', 'sky_dusk', 'שמיים - דמדומים (17:10)', (100, 100, 700, 400), None, 'מעל הפרגולה'),
    ('096', 'sky_night', 'שמיים - תחילת לילה (17:09)', (1100, 80, 2100, 450), None, 'רחוק מהירח'),
    ('088', 'sky_night', 'שמיים - תחילת לילה (17:10)', (200, 100, 2000, 450), None, 'מעל הנמל'),
]


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def pixels(img, box):
    a = np.asarray(img, dtype=np.float64) / 255.0
    if box[0] == 'line':
        _, x0, y0, x1, y1, hw = box
        xs0, xs1, ys0, ys1 = min(x0, x1) - hw, max(x0, x1) + hw, min(y0, y1) - hw, max(y0, y1) + hw
        sub = a[ys0:ys1, xs0:xs1]
        yy, xx = np.mgrid[ys0:ys1, xs0:xs1]
        dx, dy = x1 - x0, y1 - y0
        L = np.hypot(dx, dy)
        dist = np.abs((xx - x0) * dy - (yy - y0) * dx) / L
        return sub[dist <= hw]
    x0, y0, x1, y1 = box
    return a[y0:y1, x0:x1].reshape(-1, 3)


def robust(px, flt):
    lum = px @ np.array([0.2126, 0.7152, 0.0722])
    if flt == 'red':
        sel = (px[:, 0] > px[:, 1] + 0.08) & (px[:, 0] > px[:, 2] + 0.06)
        px, lum = px[sel], lum[sel]
    elif flt == 'white':
        sat = px.max(1) - px.min(1)
        sel = (sat < 0.10) & (lum > np.percentile(lum, 70))
        px, lum = px[sel], lum[sel]
    elif flt == 'bright':
        sel = lum > np.percentile(lum, 75)
        px, lum = px[sel], lum[sel]
    elif flt == 'dark':
        sel = (lum < np.percentile(lum, 60)) & (lum > np.percentile(lum, 15))
        px, lum = px[sel], lum[sel]
    lo, hi = np.percentile(lum, 5), np.percentile(lum, 95)
    sel = (lum >= lo) & (lum <= hi)
    return px[sel]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    pdir, out = sys.argv[1], sys.argv[2]
    p097 = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != '-' else None
    dbg = sys.argv[4] if len(sys.argv) > 4 else None
    imgs, rows = {}, []
    for pid, key, he, box, flt, note in REGIONS:
        path = p097 if pid == '097' else os.path.join(pdir, pid + '.jpg')
        if not path or not os.path.exists(path):
            continue
        if pid not in imgs:
            imgs[pid] = Image.open(path).convert('RGB')
        px = robust(pixels(imgs[pid], box), flt)
        lin = srgb_to_lin(px)
        mlin = lin.mean(0)
        rows.append({'photo': pid, 'key': key, 'material_he': he, 'note_he': note, 'n_px': int(len(px)),
                     'box': list(box) if box[0] != 'line' else ['line'] + list(box[1:]), 'filter': flt,
                     'srgb8_mean': [round(float(v) * 255, 1) for v in lin_to_srgb(mlin)],
                     'srgb8_median': [round(float(v) * 255, 1) for v in np.median(px, 0)],
                     'lin_mean': [round(float(v), 5) for v in mlin],
                     'Y': round(float(mlin @ np.array([0.2126, 0.7152, 0.0722])), 5)})
    by = {}
    for r in rows:
        by.setdefault((r['photo'], r['key']), r)
    res = {'regions': rows, 'ratios': {}, 'white_balanced': {}}

    def Y(p, k):
        r = by.get((p, k))
        return r['Y'] if r else None

    def lin(p, k):
        r = by.get((p, k))
        return np.array(r['lin_mean']) if r else None

    # יחסי בהירות בתוך אותה תמונה (משטחים אופקיים, אותה תאורה)
    R = res['ratios']
    if Y('097', 'asphalt_lit'):
        R['097 sidewalk/asphalt'] = round(Y('097', 'sidewalk_lit') / Y('097', 'asphalt_lit'), 3)
        R['097 curb_white/asphalt'] = round(Y('097', 'curb_white') / Y('097', 'asphalt_lit'), 3)
        R['097 curb_red/curb_white'] = round(Y('097', 'curb_red') / Y('097', 'curb_white'), 3)
    if Y('094', 'pavers_gray'):
        R['094 sand/pavers'] = round(Y('094', 'sand') / Y('094', 'pavers_gray'), 3)
        R['094 dry_grass/pavers'] = round(Y('094', 'dry_grass') / Y('094', 'pavers_gray'), 3)
        R['094 steps/pavers'] = round(Y('094', 'stone_steps') / Y('094', 'pavers_gray'), 3)
    if Y('093', 'pavers_gray'):
        R['093 steps/pavers'] = round(Y('093', 'stone_steps') / Y('093', 'pavers_gray'), 3)
    # איזון לבן: 097 לפי הצבע הלבן של אבן השפה; 093/094 לפי אבני הריצוף האפורות (בטון ~ניטרלי)
    WB = res['white_balanced']
    ref097 = lin('097', 'curb_white')
    if ref097 is not None:
        g = ref097 / ref097.mean()
        for k in ('asphalt_lit', 'sidewalk_lit', 'curb_red', 'curb_white', 'plaster_lit'):
            c = lin('097', k)
            if c is not None:
                WB['097 ' + k] = {'chroma_lin': [round(float(v), 4) for v in (c / g) / (c / g).mean()], 'ref': 'curb_white'}
    for p in ('093', '094'):
        ref = lin(p, 'pavers_gray')
        if ref is None:
            continue
        g = ref / ref.mean()
        for k in ('stone_steps', 'sand', 'dry_grass', 'pavers_gray'):
            c = lin(p, k)
            if c is not None:
                WB[p + ' ' + k] = {'chroma_lin': [round(float(v), 4) for v in (c / g) / (c / g).mean()], 'ref': 'pavers_gray'}
    for p in ('095',):
        c = lin(p, 'dry_grass')
        ref = lin('094', 'pavers_gray')
        if c is not None and ref is not None:
            g = ref / ref.mean()
            WB['095 dry_grass'] = {'chroma_lin': [round(float(v), 4) for v in (c / g) / (c / g).mean()], 'ref': 'pavers_gray@094'}
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    for r in rows:
        print(f"{r['photo']} {r['key']:<14} sRGB {r['srgb8_mean']}  Y={r['Y']:.4f}  n={r['n_px']}")
    print(json.dumps(R, ensure_ascii=False))
    for k, v in WB.items():
        print(k, v['chroma_lin'])
    if dbg:
        os.makedirs(dbg, exist_ok=True)
        for pid, im in imgs.items():
            if pid == '097':
                continue   # לא שומרים עותק של 097 (לוחיות רישוי של צד שלישי)
            d = im.copy()
            dr = ImageDraw.Draw(d)
            for p2, key, he, box, flt, note in REGIONS:
                if p2 != pid:
                    continue
                if box[0] == 'line':
                    dr.line(box[1:5], fill=(255, 255, 0), width=box[5] * 2)
                else:
                    dr.rectangle(box, outline=(255, 255, 0), width=5)
                dr.text((box[1] + 6 if box[0] == 'line' else box[0] + 6, (box[2] if box[0] == 'line' else box[1]) + 6), key, fill=(255, 255, 0))
            d.resize((d.width // 2, d.height // 2)).save(os.path.join(dbg, f'calib-{pid}.jpg'), quality=80)


if __name__ == '__main__':
    main()
