"""ייצוא תנוחות מצלמה לצוות האווירה (השוואת צילום↔רינדור): data/camera_poses.json.
מערכת צירים: מסגרת הדגימה של האריחים (x=מזרח, y=צפון, מטרים) + ITM אמיתי + WGS84. heading = אזימוט מהצפון עם כיוון השעון.
הרצה: python3 -I export_poses.py data/observations.json data/camera_poses.json"""
import sys, json
obs = json.load(open(sys.argv[1], encoding='utf-8'))
out = {'v': 1, 'frame': obs['frame'], 'eye_height_m': {'v': 1.5, 'prov': 'משוער'}, 'note': 'roll לא נמדד (0). fov_h = שדה ראייה אופקי בתמונה כפי שצולמה. ערכים עם conf<0.3 – לא לכיול.', 'poses': []}
for p in obs['photos']:
    if p['pos']['x'] is None: continue
    out['poses'].append({'id': p['id'], 'file': p['file'], 'time_local': p['time_local'], 'orientation': p['orientation'],
        'x': p['pos']['x'], 'y': p['pos']['y'], 'itm': p['pos']['itm'], 'wgs84': p['pos']['wgs84'], 'pos_r_m': p['pos']['r_m'], 'pos_prov': p['pos']['prov'], 'pos_conf': p['pos']['conf'],
        'heading_deg': p['heading']['v'], 'heading_pm': p['heading'].get('pm'), 'heading_method': p['heading'].get('method'), 'heading_prov': p['heading']['prov'], 'heading_conf': p['heading']['conf'],
        'pitch_deg': p['pitch']['v'], 'fov_h_deg': p['fov_h']['v'], 'style_class': p['style_class']['v'],
        'calibration_grade': 'A' if p['heading']['conf'] >= 0.7 and p['pos']['conf'] >= 0.4 else 'B' if p['heading']['conf'] >= 0.35 else 'C'})
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out['poses']), 'poses;', {g: sum(1 for x in out['poses'] if x['calibration_grade'] == g) for g in 'ABC'})
