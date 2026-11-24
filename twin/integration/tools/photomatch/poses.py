#!/usr/bin/env python3
"""poses.py – טבלת משימות (jobs): משימה אחת לכל צילום = מיקום ITM, כיוון, גובה מצלמה, שדה ראייה, שעה, רמת ביטחון.
python3 -I poses.py [--out DIR]     (קודם: python3 -I calib.py)

מקורות, לפי סדר עדיפות:
  כיוון/הטיה: calib.json (ירח + שרשרת הומוגרפיות) → קו אופק ים בתמונה (הטיה) → זוהר השקיעה (כיוון גס, σ≥15°).
  מיקום: חיישני הסורק (GPS+מצפן, photo-analysis/scan-*) → אשכול במפה (pose_notes.json, "תסתכל במפה") → הקטלוג.
  הקטלוג catalog-001-122 נבדק מול שעת הצילום שבתמונה: פער ≥ 30 דק' = הרשומה מתארת תמונה אחרת → לא בשימוש.
  שדה ראייה: אין EXIF בתמונות (נמחק) → מוקד מכיול עצמי (calib.json).
פלט: <out>/jobs.json
"""
import json, os, sys, glob, subprocess
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
TWIN = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DATA = os.path.join(TWIN, 'data')
EYE_H = 1.6          # גובה מצלמה מעל הקרקע (מ') – גובה העיניים של 35-camera
DIP_DEG = 0.22       # שקיעת אופק הים מגובה ~49 מ': √(2h/R)
DECL_DEG = 5.3       # סטייה מגנטית משוערת באשדוד 2026 (WMM, ~+5.3° מזרח) – לתיקון מצפן של הסורק [לא אומת מול WMM]

def itm_from_wgs(lat, lon):
    js = "const I=require('%s');console.log(JSON.stringify(I.wgs84ToItm(%f,%f)))" % (os.path.join(TWIN, 'integration', 'world', 'js', 'itm.js'), lat, lon)
    return json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=30).stdout)

def conf_label(sig_h, sig_pos):
    lh = 'high' if sig_h <= 2.5 else 'medium' if sig_h <= 6 else 'low'
    lp = 'high' if sig_pos <= 15 else 'medium' if sig_pos <= 40 else 'low'
    order = ['low', 'medium', 'high']
    return lh, lp, order[min(order.index(lh), order.index(lp))]

def weights(sig_h, sig_p, sig_pos):
    far = 1.0 / (1 + (sig_h / 4.0) ** 2 + (sig_p / 3.0) ** 2)          # שמיים / קו רקיע רחוק: כיוון והטיה
    near = far / (1 + (sig_pos / 20.0) ** 2)                            # עצמים קרובים: גם מיקום
    return round(far, 3), round(near, 3)

def catalog_check(cat, pid, time_il):
    for o in cat.get('observations', []):
        k = str(o.get('photo_index') or o.get('id') or '').zfill(3)
        if k != pid: continue
        ts = o.get('timestamp_il') or o.get('capturedAt') or ''
        try:
            t = datetime.strptime(ts.split()[-1], '%H:%M'); w = datetime.strptime(time_il, '%H:%M'); gap = abs((t - w).total_seconds()) / 60
        except Exception:
            gap = None
        return {'catalog_time': ts, 'catalog_file': o.get('filename'), 'gap_min': gap, 'usable': gap is not None and gap < 30,
                'catalog_itm': [o.get('itm_e') or o.get('easting'), o.get('itm_n') or o.get('northing')]}
    return None

def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '/home/claude/swarm/photomatch-out'
    notes = json.load(open(os.path.join(HERE, 'pose_notes.json'), encoding='utf-8'))
    cal = json.load(open(os.path.join(out, 'calib', 'calib.json'), encoding='utf-8'))
    cat = json.load(open(os.path.join(DATA, 'photos', 'catalog-001-122.gemini-v2.json'), encoding='utf-8'))
    f35, fov = cal['f35']['value'], cal['fov_deg']; f_px = fov['f_px']; Himg = fov['image'][1]
    import math
    jobs = []
    for pid, n in sorted(notes['photos'].items()):
        cl = notes['clusters'][n['cluster']]; c = cal['photos'].get(pid)
        if c:
            hd, pt, rl, sh = c['heading_true_deg'], c['pitch_deg'], c['roll_deg'], c['sigma_heading_deg']; hsrc = c['source']; sp = 1.0 if c['source'] == 'moon' else 1.5
        else:
            hd, sh = n['heading_fallback']; rl = 0.0
            if n.get('horizon_y_frac') is not None:
                pt = -DIP_DEG + math.degrees(math.atan((n['horizon_y_frac'] - 0.5) * Himg / f_px)); sp = 1.0
            else:
                pt, sp = 0.0, 4.0
            hsrc = 'זוהר-שקיעה (השמש ‎−7° מתחת לאופק, אזימוט 250°)' if n.get('glow_x_frac') is not None else (n.get('heading_fallback_why') or 'ניחוש')
        sig_pos = cl['sigma_m']; lh, lp, lab = conf_label(sh, sig_pos); wf, wn = weights(sh, sp, sig_pos)
        chk = catalog_check(cat, pid, n['time_il'])
        jobs.append({
            'id': pid, 'kind': 'photo', 'photo': os.path.join(DATA, 'photos', pid + '.jpg'), 'compare': True, 'render': True,
            'date': '2026-11-23', 'time_il': n['time_il'], 'time_source': 'סימן המים בתמונה (Redmi Note 14), דקה שלמה',
            'weather': {'cloud': 0.35, 'aqi': 60, 'windSpeed': 3},
            'pose': {'itm_real': {'E': cl['itm_real'][0], 'N': cl['itm_real'][1]}, 'heading_true_deg': round(hd, 2), 'pitch_deg': round(pt, 2), 'roll_deg': round(rl, 2), 'cam_height_m': EYE_H,
                     'sources': {'position': 'אשכול %s במפה: %s' % (n['cluster'], cl['why']), 'heading': hsrc, 'pitch': hsrc if c else ('אופק ים בתמונה' if n.get('horizon_y_frac') is not None else 'ברירת מחדל 0')},
                     'sigma': {'position_m': sig_pos, 'heading_deg': sh, 'pitch_deg': sp}},
            'camera': {'f35_mm': f35, 'fov_h_deg': fov['h'], 'fov_v_deg': fov['v'], 'image': fov['image'], 'source': 'כיול עצמי מסיבוב (calib.py) – אין EXIF', 'orientation': 'landscape 4:3'},
            'confidence': {'heading': lh, 'position': lp, 'overall': lab, 'weight_far': wf, 'weight_near': wn},
            'catalog_check': chk, 'quality': n.get('quality'), 'view': n.get('view'), 'missing_in_world_candidates': n.get('missing_in_world_candidates', []),
        })
    # צילומי סורק עם GPS+מצפן (התמונות עצמן לא בריפו – משימת רינדור בלבד עד שיגיעו)
    for p in sorted(glob.glob(os.path.join(DATA, 'photo-analysis', 'scan-*.json'))):
        d = json.load(open(p, encoding='utf-8')); sid = os.path.basename(p)[:-5]
        s = d.get('sensors') or {}; w = d.get('where') or {}
        lat, lon = s.get('lat', w.get('lat')), s.get('lon', w.get('lon'))
        if lat is None: continue
        it = itm_from_wgs(lat, lon); acc = s.get('gps_acc_m', w.get('acc_m', 10))
        heads = [s['heading_deg']] if 'heading_deg' in s else d.get('headings_deg', [])
        for k, hm in enumerate(heads):
            jid = sid + ('' if len(heads) == 1 else '-%d' % k)
            jobs.append({'id': jid, 'kind': 'scan', 'photo': None, 'compare': False, 'render': True, 'date': '2026-11-23', 'time_il': '18:27' if '16-26' in sid else '18:49',
                         'time_source': 'שם הקובץ + when=16:27Z (UTC 16:26/16:48 → שעון ישראל +2) [לא אומת מול התמונה]', 'weather': {'cloud': 0.3, 'aqi': 50},
                         'pose': {'itm_real': {'E': round(it['E'], 1), 'N': round(it['N'], 1)}, 'heading_true_deg': round((hm + DECL_DEG) % 360, 1), 'pitch_deg': s.get('pitch_deg', 0.0), 'roll_deg': 0.0, 'cam_height_m': EYE_H,
                                  'sources': {'position': 'GPS הסורק (±%.0f מ\')' % acc, 'heading': 'מצפן הסורק + סטייה מגנטית %.1f° [לא אומת]' % DECL_DEG, 'pitch': 'חיישן הסורק' if 'pitch_deg' in s else '0'},
                                  'sigma': {'position_m': acc, 'heading_deg': 10, 'pitch_deg': 3}},
                         'camera': {'f35_mm': s.get('f35_guess', 24), 'source': 'ניחוש הסורק'}, 'confidence': dict(zip(['heading', 'position', 'overall'], conf_label(10, acc)), weight_far=weights(10, 3, acc)[0], weight_near=weights(10, 3, acc)[1]),
                         'note': 'התמונה לא בריפו (בדרייב; בחלק יש אדם – לא מעתיקים). משימת רינדור בלבד: מראה מה העולם מציג בנקודה שה-GPS מדד.', 'itm_in_file': s.get('itm')})
    res = {'v': 1, 'made': datetime.now().isoformat(timespec='seconds'), 'frame': 'ITM אמיתי (EPSG:2039); העולם = אמיתי − (1507.82, 757.76)', 'heading': 'אזימוט אמיתי (צפון גאוגרפי); render.js ממיר לרשת (γ≈−0.29°)',
           'calib': {'f35': cal['f35'], 'fov_deg': cal['fov_deg'], 'anchors': cal['anchors'], 'loop_checks': cal.get('loop_checks')},
           'catalog_warning': notes['warning_catalog_mismatch'], 'privacy_review': notes['privacy_review'], 'jobs': jobs}
    os.makedirs(out, exist_ok=True); json.dump(res, open(os.path.join(out, 'jobs.json'), 'w'), ensure_ascii=False, indent=1)
    for j in jobs:
        P = j['pose']; cc = j.get('catalog_check') or {}
        print('%-28s %-5s h %6.1f±%-4.1f p %+5.1f pos %s±%sm conf %-6s %s' % (j['id'], j['time_il'], P['heading_true_deg'], P['sigma']['heading_deg'], P['pitch_deg'], [round(P['itm_real']['E']), round(P['itm_real']['N'])], P['sigma']['position_m'], j['confidence']['overall'],
              ('catalog gap %s min → %s' % (cc.get('gap_min'), 'used' if cc.get('usable') else 'NOT used')) if cc else ''))

if __name__ == '__main__':
    main()
