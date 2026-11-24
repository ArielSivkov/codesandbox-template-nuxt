#!/usr/bin/env python3
"""fixes.py – רשימת תיקונים מדורגת מתוך ההשוואות (בלי מודל). python3 -I fixes.py [--out DIR] [--size 360x800]

לכל תיקון: מה · איפה · עד כמה · ראיה (מספרים לכל תמונה + קישור לתמונת צד-מול-צד) · הצעה לשינוי פרמטר אמיתי בקוד/בנתונים
· איך לאמת. ציון = 100 × חומרה × עקביות × ביטחון × √השפעה (שבר פיקסלים). ביטחון = משקלי התנוחה מ-poses.py
(weight_far לשמיים/קו רקיע רחוק, weight_near לעצמים קרובים) כפול אמינות המדד.
שום תיקון לא מוחל כאן – זו הצעה לבדיקת קלוד/אריאל. גבהים שמוצעים כאן = הערכה מתמונה (src "P"), לא מדידה.
"""
import json, os, sys, math, gzip
import numpy as np
from skimage.color import lab2rgb

HERE = os.path.dirname(os.path.abspath(__file__))
MIN_DIST = 400   # מטרים: בתמונות מהפסגה המדרון הקרוב מכוסה שיחייה כהה וקו הרקיע הוא העיר הרחוקה – בניינים קרובים מזה לא יוצרים אותו
TWIN = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WORLD = os.path.join(TWIN, 'integration', 'world')
OFF = (1507.82, 757.76)

def hexlab(lab):
    rgb = np.clip(lab2rgb(np.array(lab, float).reshape(1, 1, 3))[0, 0], 0, 1); return '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in rgb)

def wavg(vals, ws):
    v = np.array(vals, float); w = np.array(ws, float); m = ~np.isnan(v)
    return float((v[m] * w[m]).sum() / w[m].sum()) if m.any() and w[m].sum() > 0 else float('nan')

def direction(h):
    h %= 360
    return 'מערב' if 200 <= h < 300 else 'מזרח' if 40 <= h < 170 else 'צפון' if (h >= 300 or h < 40) else 'דרום'

def line_of(path, needle):
    try:
        for i, l in enumerate(open(path, encoding='utf-8'), 1):
            if needle in l: return i
    except Exception: pass
    return None

def rel(p): return os.path.relpath(p, os.path.join(TWIN, '..'))

def main():
    a = sys.argv; out = a[a.index('--out') + 1] if '--out' in a else '/home/claude/swarm/photomatch-out'; size = a[a.index('--size') + 1] if '--size' in a else '360x800'
    J = {j['id']: j for j in json.load(open(os.path.join(out, 'jobs.json'), encoding='utf-8'))['jobs']}
    M = json.load(open(os.path.join(out, 'compare', 'metrics.json'), encoding='utf-8'))
    ids = [i for i in sorted(M) if size in M[i]]
    def g(i): return M[i][size]
    fixes = []

    # ------------------------------------------------------------ 1. שמיים בדמדומים (כל התמונות: שמש ‎−6.8° עד ‎−7.2°)
    ev, sev, ws, cons = [], [], [], []
    groups = {}
    for i in ids:
        m = g(i)['metrics']; b = m['bands']['sky']; c = g(i)['confidence']; sun = g(i)['render_camera']
        if b.get('dE_mean') is None: continue
        dL = b['dL']; ws.append(c['weight_far']); sev.append(min(1.0, b['dE_mean'] / 40)); cons.append(1.0 if (dL < -8 or b['dE_mean'] > 15) else 0.0)
        d = direction(J[i]['pose']['heading_true_deg']); groups.setdefault(d, []).append((b, c['weight_far']))
        ev.append({'photo': i, 'direction': d, 'sky_L_photo': b['L_photo'], 'sky_L_render': b['L_render'], 'dL_render_minus_photo': dL, 'dE2000_mean': b['dE_mean'], 'dE_palette': b['dE_palette'],
                   'sky_top_photo': hexlab(b['lab_top_photo']) if b.get('lab_top_photo') else None, 'sky_low_photo': hexlab(b['lab_low_photo']) if b.get('lab_low_photo') else None,
                   'sky_top_render': hexlab(b['lab_top_render']) if b.get('lab_top_render') else None, 'sky_low_render': hexlab(b['lab_low_render']) if b.get('lab_low_render') else None,
                   'side_by_side': g(i)['side_by_side']})
    target = {}
    for d, lst in groups.items():
        tops = [x[0]['lab_top_photo'] for x in lst if x[0].get('lab_top_photo')]; lows = [x[0]['lab_low_photo'] for x in lst if x[0].get('lab_low_photo')]
        wt = [x[1] for x in lst if x[0].get('lab_top_photo')]; wl = [x[1] for x in lst if x[0].get('lab_low_photo')]
        if tops and lows:
            t = [wavg([v[k] for v in tops], wt) for k in range(3)]; l_ = [wavg([v[k] for v in lows], wl) for k in range(3)]
            target[d] = {'top_hex': hexlab(t), 'low_hex': hexlab(l_), 'top_lab': [round(x, 1) for x in t], 'low_lab': [round(x, 1) for x in l_], 'n': len(lst)}
    beauty = os.path.join(WORLD, 'adapters', '61-beauty.js'); ln_night = line_of(beauty, 'Z.night = clamp((2 - el) / 8, 0, 1)'); game = os.path.join(WORLD, 'js', 'game.js'); ln_day = line_of(game, 'day = clamp((el + 4) / 14, 0, 1)')
    meanL = wavg([e['sky_L_photo'] for e in ev], ws); meanLr = wavg([e['sky_L_render'] for e in ev], ws)
    fixes.append({'key': 'twilight-sky', 'what': 'שמיים של דמדומים: העולם עובר ל"לילה מלא" כבר בשמש ‎−6°, בתמונות (17:09–17:11, שמש ‎−6.8° עד ‎−7.2°) השמיים עדיין בהירים – כחול-סגול למעלה וזוהר כתום-ורוד באופק המערבי',
                  'where': 'כל העולם, שעות דמדומים (שמש בין ‎−2° ל-‎−12°; 23.11 באשדוד: 16:45–17:35 בערך)',
                  'how_much': f'בהירות השמיים (L*, ממוצע משוקלל): צילום {meanL:.1f} מול רינדור {meanLr:.1f}; ΔE2000 ממוצע {wavg([e["dE2000_mean"] for e in ev], ws):.1f}',
                  'evidence': ev, 'target_colors_from_photos': target,
                  'proposal': [
                      {'file': rel(beauty), 'line': ln_night, 'param': 'Z.night', 'from': 'clamp((2 - el) / 8, 0, 1)  → לילה מלא ב-‎−6°', 'to': 'clamp((-4 - el) / 10, 0, 1)  → לילה מלא ב-‎−14° (סוף דמדומי ים)'},
                      {'file': rel(beauty), 'line': ln_night, 'param': 'B.twilight (חדש)', 'to': {'on_from_el': 2, 'off_at_el': -12, 'top': target.get('מזרח', target.get('מערב', {})).get('top_hex'), 'hor_sun_side': target.get('מערב', {}).get('low_hex'), 'hor_away': target.get('מזרח', {}).get('low_hex'), 'exposure': 1.45},
                       'how': 'Z.twi = clamp(1 − |el + 5| / 7, 0, 1); u.top.lerp(top, Z.twi), u.hor.lerp(hor_sun_side|hor_away לפי הזווית לשמש, Z.twi); חשיפה ‎→ exposure. רק בשכבת האינטגרציה – game.js לא משתנה.'},
                      {'file': rel(game), 'line': ln_day, 'param': 'day (לידיעה בלבד – ליבת המשחק לא משתנה)', 'note': 'כאן השמיים של המשחק עוברים לצבעי לילה ב-‎−4°; ההחלפה נעשית ב-61-beauty שדורס top/hor בכל פריים'}],
                  'verify': 'להריץ photomatch על אותן 14 משימות: ΔE2000 ממוצע בשמיים צריך לרדת מתחת ל-15, ו-ΔL* בטווח ±8',
                  'severity': round(float(np.mean(sev)), 3), 'consistency': round(float(np.mean(cons)), 3), 'confidence': round(float(np.mean(ws)), 3),
                  'impact': round(wavg([g(i)['metrics']['bands']['sky']['frac_photo'] for i in ids], [1] * len(ids)), 3)})

    # ------------------------------------------------------------ 2. צמחייה בפסגת גבעת יונה חוסמת את התצפית
    ev, ws, vfr = [], [], []
    for i in ids:
        m = g(i)['metrics']; rc = m.get('render_classes')
        if not rc: continue
        veg = rc['window'].get('veg', 0); skyp = m['bands']['sky']['frac_photo']; skyr = rc['window'].get('sky', 0)
        ev.append({'photo': i, 'veg_frac_render': veg, 'sky_frac_render': skyr, 'sky_frac_photo': skyp, 'mid_composition_render': rc['by_band'].get('mid'), 'side_by_side': g(i)['side_by_side']})
        ws.append(g(i)['confidence']['weight_far'] * 0.8); vfr.append(veg)   # כל מיקום בטווח ±50 מ' עדיין בפסגה עם אותם עצים – לכן משקל "רחוק" ולא "קרוב"
    vt = os.path.join(WORLD, 'mods', 'vegetation', 'data', 'tiles', 'g', '165_635.json.gz'); veg_stats = None
    try:
        d = json.load(gzip.open(vt)); t = d['t']; o = d['o']; L = (166611.5 - OFF[0], 635818.8 - OFF[1]); r60 = [t[k + 3] / 10 for k in range(0, len(t), 5) if math.hypot(o[0] + t[k] / 10 - L[0], o[1] + t[k + 1] / 10 - L[1]) < 60]
        veg_stats = {'tile': rel(vt), 'plants_r60': len(r60), 'taller_than_4m_r60': sum(1 for h in r60 if h > 4), 'median_h_r60': round(float(np.median(r60)), 1) if r60 else None, 'source_codes': 'src=5 משוער (אין עצי OSM באשדוד)'}
    except Exception as e:
        veg_stats = {'error': str(e)}
    blocked = [e for e in ev if (e['mid_composition_render'] or {}).get('veg', 0) >= 0.7]   # רצועת האמצע ברינדור ≥70% עצים – העיר/הנמל לא נראים
    midveg = [(e['mid_composition_render'] or {}).get('veg', 0) for e in ev]
    fixes.append({'key': 'givat-yona-vegetation', 'what': 'עצים גבוהים ומשוערים בפסגת גבעת יונה חוסמים את התצפית: בתמונות – שיחייה נמוכה ועצים בודדים, ומעליהם העיר, הנמל והשמיים',
                  'where': 'רדיוס ~60 מ\' סביב המגדלור (ITM ‎166611,635819), אריח צמחייה 165_635 (מסגרת הדגימה)',
                  'how_much': f'ברינדור עצים הם {np.mean(midveg):.0%} מרצועת האמצע (ממוצע; {np.mean(vfr):.0%} מכל החלון); ב-{len(blocked)}/{len(ev)} תמונות רצועת האמצע ≥70% עצים, בעוד שבצילום שם העיר והנמל. באריח: {veg_stats.get("taller_than_4m_r60")} צמחים מעל 4 מ\' ברדיוס 60 מ\' מהמגדלור (חציון גובה {veg_stats.get("median_h_r60")} מ\').',
                  'evidence': ev, 'tile_stats': veg_stats,
                  'proposal': [{'file': rel(vt), 'param': 'רשומות t (E,N,מין,גובה,מקור) עם src=5 ברדיוס 60 מ\' מהמגדלור', 'from': f'{veg_stats.get("taller_than_4m_r60")} עצים > 4 מ\'', 'to': 'גובה ≤ 1.5 מ\' (מין RETA/ARTE – רותם/לענה) ועד 6 עצים בודדים ≤ 6 מ\' בשולי הרחבה',
                                'how': 'עדיף במחולל הצמחייה (swarm/vegetation): פוליגון החרגה "פסגת גבעת יונה – שיחייה נמוכה" כדי שלא יחזור בבנייה הבאה'}],
                  'verify': 'אחרי השינוי: veg_frac_render ב-088/090/095/096 < 0.25, וקו הרקיע של העיר מופיע ברינדור',
                  'severity': round(float(np.mean(midveg)), 3), 'consistency': round(len(blocked) / max(1, len(ev)), 3), 'confidence': round(float(np.mean(ws)), 3) if ws else 0,
                  'impact': round(float(np.mean(vfr)), 3)})

    # ------------------------------------------------------------ 3. גובהי מגדלים לפי frustum (רק תמונות עם כיוון מעוגן)
    segs = []
    for i in ids:
        c = g(i)['confidence']; P = J[i]['pose']
        if P['sigma']['heading_deg'] > 4 or 'מטושטשת' in (J[i].get('quality') or ''): continue
        fp = os.path.join(out, 'frustum', size, i + '.json'); mp = os.path.join(out, 'compare', size, i + '.masks.npz')
        if not (os.path.exists(fp) and os.path.exists(mp)): continue
        F = json.load(open(fp, encoding='utf-8')); Z = np.load(mp, allow_pickle=True); sp = Z['skyline_p']; rel_deg = Z['rel_deg']
        sl = F['skyline_by_buildings']; srel = np.array([s['rel_deg'] for s in sl]); eb = np.array([s['elev'] if s['elev'] is not None else np.nan for s in sl])
        eb_col = np.interp(rel_deg, srel, np.nan_to_num(eb, nan=-90.0)); eb_col[eb_col < -80] = np.nan
        dif = sp - eb_col; good = ~np.isnan(dif) & (dif >= 1.0)
        # רצפים של עמודות עם הפרש ≥ 1° ברוחב ≥ 1.5°
        x = 0; W = len(dif)
        while x < W:
            if not good[x]: x += 1; continue
            y = x
            while y + 1 < W and good[y + 1]: y += 1
            if rel_deg[y] - rel_deg[x] >= 1.5:
                e_p = float(np.nanmedian(sp[x:y + 1])); e_b = float(np.nanmedian(eb_col[x:y + 1]))
                # מועמדים: כל הבניינים במעלות האלה (לא רק "הגבוה בזווית" – מגבעה זה תמיד הרחוק ביותר). לכל אחד: איזה גובה צריך
                # כדי להגיע לקו הרקיע שבצילום. סבירות: 30–160 מ' (המגדלים הגבוהים באשדוד ~140 מ'), טביעה 200–3000 מ"ר, ונוסף ≥ 6 מ'.
                cand = {}
                for bn in F.get('candidates_by_degree', []):
                    if bn['rel_to'] < rel_deg[x] or bn['rel_from'] > rel_deg[y]: continue
                    for s in bn['buildings']:
                        need = F['cam']['eye_abs_m'] + s['dist'] * math.tan(math.radians(e_p)); hn = need - s['base']
                        sig = abs(s['dist'] * (math.tan(math.radians(e_p + P['sigma']['pitch_deg'])) - math.tan(math.radians(e_p)))) + 4
                        ok = 30 <= hn <= 150 and 200 <= s.get('area', 0) <= 3000 and hn - s['h'] >= 6 and s['dist'] >= MIN_DIST   # 150: הגבוה באשדוד K Tower 1 ‏142 מ'
                        if ok and s['id'] not in cand:
                            cand[s['id']] = {'id': s['id'], 'name': s['name'], 'dist_m': s['dist'], 'map_h_m': s['h'], 'base_m': s['base'], 'area_m2': s.get('area'), 'map_floors': s['floors'],
                                             'suggest_h_m': round(hn, 1), 'suggest_floors': int(round((hn - 1) / 3.0)), 'delta_h_m': round(hn - s['h'], 1), 'sigma_m': round(sig, 1)}
                cl = sorted(cand.values(), key=lambda d: d['dist_m'])   # הקרוב ביותר מבין הסבירים – המועמד הראשון לבדיקה
                tb = (J[i]['pose']['heading_true_deg'] + rel_deg[x], J[i]['pose']['heading_true_deg'] + rel_deg[y])
                mb = ((tb[0] + tb[1]) / 2) % 360; kind = 'port' if (mb >= 330 or mb < 45) else 'towers'   # הנמל צפונית/צפון-מערבית לגבעה; מזרחה – מגדלי מגורים
                segs.append({'photo': i, 'kind': kind, 'kind_he': 'מבני נמל/עגורני STS (לא בניינים)' if kind == 'port' else 'מגדלי מגורים (שורות חלונות בתמונה)', 'bearing_true_deg': [round(tb[0] % 360, 1), round(tb[1] % 360, 1)], 'photo_skyline_elev_deg': round(e_p, 2), 'world_building_skyline_elev_deg': round(e_b, 2),
                             'gap_deg': round(e_p - e_b, 2), 'n_plausible': len(cl), 'candidates_nearest_plausible': cl[:5], 'weight': c['weight_far'], 'side_by_side': g(i)['side_by_side']})
            x = y + 1
    hov = os.path.join(TWIN, 'data', 'height-overrides', 'ashdod-towers-v1.json')
    props = {}
    for s in segs:
        if s['kind'] != 'towers': continue
        for cc in s['candidates_nearest_plausible'][:2]:
            p = props.setdefault(cc['id'], {'id': cc['id'], 'name': cc['name'], 'h_now': cc['map_h_m'], 'suggest': [], 'photos': set(), 'dist_m': cc['dist_m']})
            p['suggest'].append((cc['suggest_h_m'], cc['sigma_m'], s['weight'])); p['photos'].add(s['photo'])
    entries = []
    for p in props.values():
        hs = np.array([x[0] for x in p['suggest']]); sg = np.array([x[1] for x in p['suggest']]); w = np.array([x[2] for x in p['suggest']]) / sg ** 2
        h = float((hs * w).sum() / w.sum()); s_ = float(max(1 / math.sqrt(w.sum() / max(np.mean([x[2] for x in p['suggest']]), 1e-3)), np.std(hs) if len(hs) > 1 else 0))
        warn = 'מעל 120 מ\' – כנראה המגדל האמיתי קרוב יותר או שאינו באריחים (מגדל חדש/בבנייה; בתמונות יש עגורנים)' if h > 120 else None
        entries.append({'id': p['id'], 'name': p['name'], 'warning': warn, 'h': round(h, 1), 's': round(max(s_, 8.0), 1), 'f': int(round((h - 1) / 3)), 'src': 'P', 'c': 2,
                        'sources': ['photomatch: קו רקיע בתמונות %s מול frustum (גבעת יונה 23.11.2026 17:09–17:10) – הערכה, לא מדידה' % ','.join(sorted(p['photos']))],
                        'before': {'h': p['h_now']}, 'dist_from_camera_m': p['dist_m'], 'identity': 'לא ודאי – הקרוב ביותר מבין המועמדים הסבירים בכיוון הזה; ייתכן שבמציאות מגדל אחר באותו קו ראייה. לאמת לפי שם/OSM/מודל ראייה לפני כניסה.'})
    entries.sort(key=lambda e: -(e['h'] - e['before']['h']))
    if segs:
        gap = wavg([s['gap_deg'] for s in segs], [s['weight'] for s in segs])
        fixes.append({'key': 'tower-heights-frustum', 'what': 'מגדלים נמוכים מדי או חסרים בעולם: קו הרקיע של העיר בתמונות גבוה יותר מגגות הבניינים באריחים (רוב העיר בגבהי כלל-אצבע 13/25 מ\'). חלק מהמגדלים בתמונות בבנייה (עגורנים) – ייתכן שאינם באריחים כלל',
                      'where': '; '.join(f"תמונה {s['photo']}: כיוון {s['bearing_true_deg'][0]}°–{s['bearing_true_deg'][1]}°" for s in segs[:8]),
                      'how_much': f'{len(segs)} מקטעי קו רקיע עם פער ≥1° (ממוצע {gap:.1f}°): {sum(1 for s in segs if s["kind"] == "towers")} לכיוון המגדלים במזרח, {sum(1 for s in segs if s["kind"] == "port")} לכיוון הנמל (שם כנראה עגורנים – לא גובה בניינים); {len(entries)} בניינים מועמדים להעלאת גובה',
                      'evidence': segs, 'proposal': [{'file': rel(hov), 'param': 'buildings[] (פורמט קיים: id,h,s,f,src,c,sources,before)', 'add_entries': entries[:12],
                                                     'how': 'להוסיף כקובץ חדש ashdod-photomatch-v1.json (לא לערבב עם מקור Q), ואז tools/apply_height_overrides.py; כל ערך = הערכה מתמונה (src=P) עם σ'},
                                                    {'param': 'עגורני נמל (STS) לכיוון 088/090', 'how': 'הפער בכיוון הנמל לא שייך לבניינים: להחזיר את משימת "עגורני נמל" של פס הייצור (נדחתה ב-23.11 בגלל מיקום כפול) עם מיקומים מ-OSM'}],
                      'verify': 'רינדור מחדש של 096/095/090: הפער החציוני בקו הרקיע של הבניינים (frustum) מול הצילום < 1°',
                      'severity': round(min(1.0, gap / 6.0), 3), 'consistency': round(len({s['photo'] for s in segs}) / max(1, len([i for i in ids if J[i]['pose']['sigma']['heading_deg'] <= 4])), 3),
                      'confidence': round(float(np.mean([s['weight'] for s in segs])) * 0.7, 3), 'impact': 0.08})

    # ------------------------------------------------------------ 4. אורות העיר בדמדומים
    ev, ws, ratios = [], [], []
    for i in ids:
        b = g(i)['metrics']['bands']['mid']
        if b.get('lights_photo') is None: continue
        lp, lr = b['lights_photo'], b['lights_render']; r = (lp + 0.5) / (lr + 0.5)
        ev.append({'photo': i, 'lights_per_10k_photo': lp, 'lights_per_10k_render': lr, 'ratio': round(r, 2), 'veg_in_mid_render': (g(i)['metrics'].get('render_classes') or {}).get('by_band', {}).get('mid', {}).get('veg'), 'side_by_side': g(i)['side_by_side']})
        ws.append(g(i)['confidence']['weight_far']); ratios.append(r)
    typ = os.path.join(WORLD, 'mods', 'plugins', 'buildings', 'dept', 'typology.js'); ln_lit = line_of(typ, 'const LIT = ')
    city = [e for e in ev if e['lights_per_10k_photo'] >= 5]
    fixes.append({'key': 'dusk-city-lights', 'what': 'אורות העיר והנמל בדמדומים: בתמונות מאות נקודות אור כתומות/לבנות (פנסי רחוב, נמל, חלונות); ברינדור מעט',
                  'where': 'מבט מגבעת יונה צפונה (נמל) ומזרחה (מגדלים); כנראה כל העיר בשעות 17:00–18:00',
                  'how_much': f'צפיפות אורות ברצועת המבנים: פי {np.median([e["ratio"] for e in city]) if city else float("nan"):.1f} (חציון) בצילום לעומת הרינדור, ב-{len(city)} תמונות עיר',
                  'evidence': ev,
                  'proposal': [{'file': rel(typ), 'line': ln_lit, 'param': 'LIT (שבר חלונות מוארים לפי שעה)', 'from': '[17, 0.25], [18, 0.45]', 'to': '[17, 0.40], [18, 0.55] (בחורף השקיעה ב-16:37) – לכייל מול סבב לילה'},
                               {'file': rel(os.path.join(WORLD, 'js', 'world.js')), 'param': 'פנסי רחוב (furn) בלילה', 'how': 'אין כרגע תאורת רחוב/נמל כתומה כמקור אור נראה; להוסיף ספרייט הילה כתום (≈ #ffb347) לכל עמוד תאורה, ומגדלי תאורה בנמל – במתאם אינטגרציה, לא בליבה'}],
                  'verify': 'יחס צפיפות האורות (צילום/רינדור) בתמונות 088/090/095/096 < 2 – לבדוק אחרי תיקון הצמחייה (העצים מסתירים את העיר ברינדור ומנפחים את היחס)',
                  'severity': round(min(1.0, (float(np.median(ratios)) - 1) / 8), 3) if ratios else 0, 'consistency': round(len([r for r in ratios if r > 2]) / max(1, len(ratios)), 3),
                  'confidence': round(float(np.mean(ws)) * 0.6, 3) if ws else 0, 'impact': 0.05})

    # ------------------------------------------------------------ 5. קרקע בדמדומים
    ev, ws, dls = [], [], []
    for i in ids:
        b = g(i)['metrics']['bands']['ground']
        if b.get('dL') is None: continue
        ev.append({'photo': i, 'ground_L_photo': b['L_photo'], 'ground_L_render': b['L_render'], 'dL': b['dL'], 'dE': b['dE_mean'], 'palette_photo': [p['hex'] for p in b['palette_photo'][:3]], 'palette_render': [p['hex'] for p in b['palette_render'][:3]], 'side_by_side': g(i)['side_by_side']})
        ws.append(g(i)['confidence']['weight_near']); dls.append(b['dL'])
    ln_hemi = line_of(game, 'hemi.intensity = 0.18')
    fixes.append({'key': 'dusk-ground', 'what': 'הקרקע בדמדומים בהירה וירקרקה מדי (דשא זית מואר) – בתמונות קרקע כמעט שחורה-חומה מול שמיים בהירים',
                  'where': 'קרקע קרובה (≤25 מ\') בכל התמונות; בעיקר מבטים מערבה (נגד הזוהר)',
                  'how_much': f'ΔL* קרקע (רינדור − צילום): חציון {np.median(dls):+.1f}, ממוצע משוקלל {wavg(dls, ws):+.1f}',
                  'evidence': ev,
                  'proposal': [{'file': rel(beauty), 'param': 'בתוך מונח הדמדומים החדש (תיקון 1)', 'how': 'world.hemi.intensity *= 1 − 0.45·Z.twi ; לא בליבה (game.js שורה %s: hemi = 0.18 בלילה)' % ln_hemi}],
                  'verify': 'ΔL* קרקע בטווח ±6 בכל המשימות, בלי להחשיך את רצועת המבנים',
                  'severity': round(min(1.0, abs(float(np.median(dls))) / 20), 3), 'consistency': round(len([d for d in dls if d > 4]) / max(1, len(dls)), 3), 'confidence': round(float(np.mean(ws)), 3) if ws else 0, 'impact': 0.33})

    # ------------------------------------------------------------ 6. פרטים/טקסטורה (צפיפות קצוות)
    ev, rs, ws = [], [], []
    for i in ids:
        b = g(i)['metrics']['bands']['mid']
        if b.get('edge_ratio') is None or 'מטושטשת' in (J[i].get('quality') or ''): continue
        ev.append({'photo': i, 'edge_photo': b['edge_photo'], 'edge_render': b['edge_render'], 'ratio_render_over_photo': b['edge_ratio']}); rs.append(b['edge_ratio']); ws.append(g(i)['confidence']['weight_near'])
    fixes.append({'key': 'mid-detail', 'what': 'פחות פרטים ברצועת המבנים/צמחייה: חופות עצים חלקות (low-poly) וחזיתות בלי פרטים, מול עלווה, חלונות ותאורה בתמונות',
                  'where': 'רצועת האמצע בכל התמונות', 'how_much': f'צפיפות קצוות ברינדור = {np.median(rs):.2f} מזו שבצילום (חציון, באותה רזולוציה)', 'evidence': ev,
                  'proposal': [{'file': rel(os.path.join(WORLD, 'mods', 'vegetation', 'vegetation.js')), 'param': 'חומר החופה', 'how': 'מפת אלפא של עלווה/נורמל על החופה, או כרטיסי עלים בקצה – אחרי תיקון 2 (פחות עצים בפסגה)'}],
                  'verify': 'יחס הקצוות > 0.6', 'severity': round(min(1.0, 1 - float(np.median(rs))), 3), 'consistency': round(len([r for r in rs if r < 0.7]) / max(1, len(rs)), 3), 'confidence': round(float(np.mean(ws)) * 0.5, 3), 'impact': 0.2})

    # ------------------------------------------------------------ 7. ציוני דרך חסרים/לא נכונים בפסגה (צריך מודל ראייה או אדם)
    miss = {}
    for i in ids:
        for x in J[i].get('missing_in_world_candidates', []): miss.setdefault(x, []).append(i)
    lab = [{'file': rel(os.path.join(WORLD, 'adapters', 'lab', f)), 'note': n} for f, n in [('70-lighthouse.js', 'H1=21 (בסיס בטון) – ב-092/093 החלק המשובץ מתחיל נמוך בהרבה מזה שברינדור; לאמת גבהים'), ('71-givat-yona-pergola.js', 'בתמונה 093/094 פרגולה מקושתת דרומית למצלמה ומדרגות רחבות; במעבדה ישרה ובמיקום ‎166560,635790 (~70 מ\' מערבה)'), ('77-givat-yona-graffiti-wall.js', 'בתמונות 084–087 הגרפיטי על מבנה גלילי גבוה (כנראה בריכת מים), לא על קיר ישר 2.2 מ\'')]]
    fixes.append({'key': 'summit-landmarks', 'what': 'ציוני דרך בפסגה חסרים או לא תואמים: בריכת מים עגולה עם כיפה, מבנה גלילי עם גרפיטי, פרגולה מקושתת, פרופורציות המגדלור',
                  'where': 'פסגת גבעת יונה (±60 מ\' מהמגדלור) – מיקומים לא ידועים בדיוק', 'how_much': '; '.join(f'{k}: {",".join(v)}' for k, v in miss.items()),
                  'evidence': [{'photo': i, 'side_by_side': g(i)['side_by_side']} for i in ['095', '096', '084', '093', '092'] if i in ids],
                  'proposal': lab + [{'how': 'להריץ את vlm_hook (Qwen2.5-VL) על הזוגות האלה כדי לקבל רשימת עצמים ומיקום יחסי; מיקום מדויק – מהסורק (GPS+מצפן) בביקור הבא'}],
                  'verify': 'אחרי הוספה: חלק ה-lab ברינדור תואם את מיקום העצם בצילום (בדיקת עין + vlm)',
                  'severity': 0.6, 'consistency': 0.6, 'confidence': 0.2, 'impact': 0.15})

    # ------------------------------------------------------------ דירוג
    for f in fixes:
        f['score'] = round(100 * f['severity'] * f['consistency'] * f['confidence'] * math.sqrt(max(f['impact'], 1e-4)), 2)
        f['confidence_label'] = 'גבוה' if f['confidence'] >= 0.5 else 'בינוני' if f['confidence'] >= 0.25 else 'נמוך'
    fixes.sort(key=lambda f: -f['score'])
    for k, f in enumerate(fixes, 1): f['rank'] = k
    # משוב לתנוחות (לא תיקון עולם)
    pose_fb = []
    for i in ids:
        al = g(i)['metrics']['align']
        pose_fb.append({'photo': i, 'heading_shift_deg': al['heading_shift_deg'], 'pitch_shift_deg': al['pitch_shift_deg'], 'iou0': al['iou0'], 'iou_best': al['iou_best'], 'reliable': al.get('reliable'), 'at_bound': al.get('at_bound')})
    res = {'v': 1, 'size': size, 'n_photos': len(ids), 'formula': 'score = 100 × severity × consistency × confidence × √impact', 'fixes': fixes, 'pose_feedback': pose_fb,
           'not_verified': ['שדה הראייה: כיול עצמי (22.4 מ"מ שקול) – אין EXIF', 'מיקומי המצלמה: אשכולות במפה ±25–50 מ\' (אין GPS בתמונות)', 'גבהים מוצעים = הערכה מתמונה (src=P) – לא מדידה',
                            'זיהוי שמיים בצילום – היוריסטיקה (נבדקה מול האמת של הרינדור, ראו sky_heuristic_check)', 'תבליט גבעת יונה בעולם – משוער (mapi-bridge)'],
           'how_to_apply': 'שום דבר לא הוחל. כל תיקון: ענף נפרד → רינדור מחדש של אותן משימות → השוואה (הציון צריך לרדת) → בדיקת עשן → אישור אריאל.'}
    fname = 'fixes.json' if size == '360x800' else f'fixes-{size}.json'
    json.dump(res, open(os.path.join(out, fname), 'w'), ensure_ascii=False, indent=1, default=lambda o: sorted(o) if isinstance(o, set) else float(o))
    for f in fixes: print(f"#{f['rank']} [{f['score']:6.2f}] {f['key']:24s} sev {f['severity']:.2f} cons {f['consistency']:.2f} conf {f['confidence']:.2f} imp {f['impact']:.2f} | {f['how_much'][:140]}")

if __name__ == '__main__':
    main()
