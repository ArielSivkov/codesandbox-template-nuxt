"""לומד "כללי סגנון" שכונתיים מתצפיות → data/style_rules.json.
כל הסתברות = (n + α) / (N + α·K), α=0.5 (החלקת דיריכלה), עם ספירות גלויות וביטחון = N/(N+3) × ממוצע ביטחון התצפיות.
הרצה: python3 -I learn_rules.py data/observations.json <tiles_v_dir> data/style_rules.json"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import load_tile, dec

ALPHA = 0.5
GROUPS = {
 'lamp': {'lamp_curved_led': 'פנס LED על עמוד מעוקל', 'lamp_led_white': 'פנס LED על עמוד ישר', 'lamp_ornate_red_double': 'עמוד אדום מעוטר, ראש כפול'},
 'paving': {'pavers_red_rect': 'משתלבת אדומה מלבנית', 'pavers_red_square': 'משתלבת אדמדמה מרובעת', 'pavers_beige_square': 'אבן בהירה מרובעת', 'slabs_light_grey': 'לוחות בהירים'},
 'curb': {'curb_grey_plain': 'אפורה לא צבועה', 'curb_red_white': 'אדום-לבן', 'curb_white_painted': 'לבנה', 'curb_black_white': 'שחור-לבן'},
 'fence': {'rail_white_metal': 'מעקה מתכת לבן', 'fence_white_picket': 'כלונסאות עץ לבנה', 'wall_stone_clad': 'חומת אבן מסותתת', 'fence_dark_slats': 'רפפות כהות', 'fence_metal_bars': 'מוטות מתכת', 'rail_red_median': 'מעקה אדום מעוטר (אי תנועה)', 'fence_blue_rail': 'מעקה כחול נמוך', 'rail_grey_metal': 'מעקה אפור'},
 'tree': {'palm_date': 'דקל תמר', 'tree_broadleaf_large': 'עץ רחב-נוף (פיקוס?)', 'tree_ficus': 'פיקוס', 'palm_small_pots': 'דקלונים בעציצים', 'street_trees_young': 'עצי רחוב צעירים', 'cypress_row': 'ברושים', 'hedge': 'גדר חיה', 'climber_on_fence': 'מטפס על גדר', 'planters': 'אדניות'},
 'building': {'villa_stone_clad': 'וילה חדשה בחיפוי אבן', 'old_house_tile_roof': 'בית ישן עם גג רעפים', 'block_mid_rise': 'בלוק 8–10 קומות', 'block_mid_rise_commercial': 'בלוק עם חזית מסחרית', 'tower_highrise': 'מגדל 20+ קומות', 'public_low_raised': 'מבנה ציבור נמוך', 'commercial_round_pavilion': 'ביתן מסחרי עגול'},
 'sign': {'tactile_paving': 'מסלול מנחה מישושי', 'street_name_sign': 'שלט רחוב חדש (כחול, מסגרת לבנה)', 'street_name_sign_old': 'שלט רחוב ישן (לבן, מסגרת אפורה)', 'sign_yield': 'תן זכות קדימה', 'sign_parking_blue': 'תמרור חניה', 'crosswalk_zebra': 'מעבר חצייה', 'traffic_light': 'רמזור', 'road_arrows': 'חיצי נתיב'},
}
KIND2G = {k: g for g, d in GROUPS.items() for k in d}

def junctions(roads):
    cnt = {}
    for r in roads:
        pts = r['pts']
        for i, (x, y) in enumerate(pts):
            k = (round(x * 2), round(y * 2)); end = i in (0, len(pts) - 1)
            c = cnt.setdefault(k, [0, 0]); c[0] += 1; c[1] += end
    return [(k[0] / 2, k[1] / 2) for k, c in cnt.items() if c[0] >= 2 or (c[0] >= 1 and c[1] and False)]

def load_roads(tdir, keys):
    out = []
    for key in keys:
        try: t = load_tile(tdir, key)
        except FileNotFoundError: continue
        ox, oy = t['o']
        for r in t['rd']: out.append({'n': r['n'], 'c': r['c'], 'pts': [(ox + x, oy + y) for x, y in dec(r['r'])]})
    return out

def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)

def nearest_road(p, roads):
    best = None
    for r in roads:
        for a, b in zip(r['pts'], r['pts'][1:]):
            d = seg_dist(p, a, b)
            if best is None or d < best[0]: best = (d, r)
    return best

def learn(obs, tdir):
    photos = [p for p in obs['photos'] if p.get('status') == 'analyzed' and p['style_class']['v'] and p['style_class']['v'] not in ('קרוב למגדל', 'כניסה לחנות', 'פנים – לא בשימוש')]
    keys = sorted({f"{int(p['pos']['x'] // 1000)}_{int(p['pos']['y'] // 1000)}" for p in photos if p['pos']['x'] is not None})
    keys = sorted({f'{int(k.split("_")[0]) + dx}_{int(k.split("_")[1]) + dy}' for k in keys for dx in (-1, 0, 1) for dy in (-1, 0, 1)})
    roads = load_roads(tdir, keys); J = junctions(roads)
    classes = {}
    for p in photos:
        cls = p['style_class']['v']; C = classes.setdefault(cls, {'photos': [], 'road_c': {}, 'feat': {g: {} for g in GROUPS}, 'confs': []})
        C['photos'].append(p['id']); C['confs'].append(p['style_class']['conf'])
        if p['pos']['x'] is not None and p['pos']['conf'] >= 0.3:
            d, r = nearest_road((p['pos']['x'], p['pos']['y']), roads)
            C.setdefault('streets', {})[r['n'] or '?'] = r['c']
        seen = {}
        for f in p['findings']:
            g = KIND2G.get(f['kind'])
            if g: seen[(g, f['kind'])] = max(seen.get((g, f['kind']), 0), f['conf'])
        for (g, k), w in seen.items(): C['feat'][g][k] = C['feat'][g].get(k, 0) + w   # ספירה משוקללת בביטחון
    out = {'v': 1, 'alpha': ALPHA, 'method': 'Dirichlet-smoothed presence counts (weighted by finding conf) per style class', 'labels': GROUPS, 'classes': {}, 'rules': []}
    for cls, C in classes.items():
        n = len(C['photos']); mc = sum(C['confs']) / n
        for nm, c in C.get('streets', {}).items(): C['road_c'][str(c)] = C['road_c'].get(str(c), 0) + 1   # רחובות שונים, לא תמונות (מונע הטיה מרחוב אחד)
        cc = {'n_photos': n, 'photos': C['photos'], 'streets': sorted(C.get('streets', {})), 'road_class_counts': C['road_c'], 'conf': round(n / (n + 3) * mc, 2), 'priors': {}}
        for g, kinds in GROUPS.items():
            obs_k = C['feat'][g]; K = len(kinds); tot = sum(obs_k.values())
            cc['priors'][g] = {k: {'n': round(obs_k.get(k, 0), 2), 'p': round((obs_k.get(k, 0) + ALPHA) / (tot + ALPHA * K), 3)} for k in kinds}
            cc['priors'][g]['_n_total'] = round(tot, 2)
        out['classes'][cls] = cc
    # כלל: שפה אדום-לבן ליד צומת (≤20 מ' מצומת) מול רחוק מצומת
    near = {'yes': 0, 'no': 0}; far = {'yes': 0, 'no': 0}
    for p in photos:
        if p['pos']['x'] is None or p['pos']['conf'] < 0.3: continue
        has_curb = [f for f in p['findings'] if KIND2G.get(f['kind']) == 'curb']
        if not has_curb: continue
        rw = any(f['kind'] in ('curb_red_white', 'curb_white_painted') for f in has_curb)
        dj = min(math.hypot(p['pos']['x'] - j[0], p['pos']['y'] - j[1]) for j in J) if J else 1e9
        (near if dj <= 20 else far)['yes' if rw else 'no'] += 1
    pn = (near['yes'] + ALPHA) / (near['yes'] + near['no'] + 2 * ALPHA); pf = (far['yes'] + ALPHA) / (far['yes'] + far['no'] + 2 * ALPHA)
    out['rules'].append({'id': 'curb_rw_near_junction', 'he': 'שפה צבועה (אדום-לבן/לבן) עד 20 מ\' מצומת', 'near_counts': near, 'far_counts': far,
                         'p_near': round(pn, 3), 'p_far': round(pf, 3), 'prov': 'נגזר', 'conf': round(min(0.9, (sum(near.values()) + sum(far.values())) / 10), 2),
                         'gen_param': {'paint_within_m': 12, 'src': 'משוער: מקובל בישראל לסמן אדום-לבן ליד צמתים; 12 מ\' – הנחה'}})
    # פרמטרים מספריים (רובם משוערים – מסומן)
    out['params'] = {
        'רחוב מגורים חדש': {'lamp_kind': 'lamp_curved_led', 'lamp_spacing_m': {'v': 27, 'prov': 'משוער', 'conf': 0.4, 'src': '015–017: שורת פנסים, הערכה 25–30 מ\''}, 'lamp_side': {'v': 'one', 'prov': 'נצפה', 'conf': 0.6, 'src': '011, 015'}, 'lamp_h_m': {'v': 8, 'prov': 'משוער', 'conf': 0.4},
                            'tree_spacing_m': {'v': 14, 'prov': 'משוער', 'conf': 0.3}, 'fence_setback_m': {'v': 4.5, 'prov': 'משוער', 'conf': 0.3}},
        'רחוב מגורים ותיק': {'lamp_kind': 'lamp_led_white', 'lamp_spacing_m': {'v': 30, 'prov': 'משוער', 'conf': 0.3, 'src': '009'}, 'lamp_side': {'v': 'one', 'prov': 'משוער', 'conf': 0.4}, 'lamp_h_m': {'v': 7, 'prov': 'משוער', 'conf': 0.3},
                             'tree_spacing_m': {'v': 12, 'prov': 'משוער', 'conf': 0.3}, 'fence_setback_m': {'v': 4.0, 'prov': 'משוער', 'conf': 0.3}},
        'שדרה עירונית ותיקה': {'lamp_kind': 'lamp_ornate_red_double', 'lamp_spacing_m': {'v': 22, 'prov': 'משוער', 'conf': 0.35, 'src': '018–019'}, 'lamp_side': {'v': 'median', 'prov': 'נצפה', 'conf': 0.7, 'src': '018, 019'}, 'lamp_h_m': {'v': 9, 'prov': 'משוער', 'conf': 0.3},
                               'tree_spacing_m': {'v': 16, 'prov': 'משוער', 'conf': 0.3}, 'fence_setback_m': {'v': 0.0, 'prov': 'נצפה', 'conf': 0.6, 'src': 'מעקה אדום על אי התנועה'}},
        'רחוב ראשי חדש עם מגדל': {'lamp_kind': 'lamp_led_white', 'lamp_spacing_m': {'v': 25, 'prov': 'משוער', 'conf': 0.3, 'src': '020'}, 'lamp_side': {'v': 'both', 'prov': 'משוער', 'conf': 0.3}, 'lamp_h_m': {'v': 10, 'prov': 'משוער', 'conf': 0.3},
                                  'tree_spacing_m': {'v': 15, 'prov': 'משוער', 'conf': 0.3}, 'fence_setback_m': {'v': 3.0, 'prov': 'משוער', 'conf': 0.3}},
    }
    # P(סגנון | סוג דרך) – ספירות מהתצפיות + הנחת מוצא (מסומנת) לסוגים שלא נצפו
    prior = {'1': {'רחוב מגורים ותיק': 2, 'רחוב מגורים חדש': 1}, '2': {'רחוב מגורים ותיק': 3, 'רחוב מגורים חדש': 1}, '3': {'שדרה עירונית ותיקה': 1, 'רחוב ראשי חדש עם מגדל': 1}, '4': {'שדרה עירונית ותיקה': 1, 'רחוב ראשי חדש עם מגדל': 1}, '5': {'שדרה עירונית ותיקה': 1}}
    cg = {}
    for c, pr in prior.items():
        cnt = dict(pr)
        for cls, C in out['classes'].items():
            if cls in out['params']: cnt[cls] = cnt.get(cls, 0) + C['road_class_counts'].get(c, 0)
        s = sum(cnt.values()); cg[c] = {k: round(v / s, 3) for k, v in cnt.items()}
    out['p_style_given_road_class'] = {'v': cg, 'prov': 'נגזר', 'conf': 0.3, 'src': 'מוצא משוער (רובע א\' = הרובע הוותיק → עדיפות לותיק) + ספירת רחובות שונים שנצפו; המדגם מוטה (סביב פרויקט מגדלים חדש)'}
    out['sign_style_by_class'] = {'v': {'רחוב מגורים חדש': 'new_blue', 'רחוב ראשי חדש עם מגדל': 'new_blue', 'רחוב מגורים ותיק': 'old_white', 'שדרה עירונית ותיקה': 'old_white'},
        'prov': 'נגזר', 'conf': 0.45, 'src': 'כחול חדש: האורן (015–016, רחוב מחודש); לבן ישן: רוגוזין, יצחק הנשיא (032–033, רחובות ותיקים). 2 רחובות לכל סגנון – מדגם קטן'}
    out['observed_signs'] = [{'id': p['id'], 'x': p['pos']['x'], 'y': p['pos']['y'], 'style': 'old_white' if any(f['kind'] == 'street_name_sign_old' for f in p['findings']) else 'new_blue'}
                             for p in photos if p['pos']['x'] is not None and p['pos']['conf'] >= 0.45 and any(f['kind'] in ('street_name_sign', 'street_name_sign_old') and f['prov'] != 'משוער' for f in p['findings'])]
    out['sign_style_by_class']['src'] += '. 035: שלטים כחולים בצומת הדקל×רוגוזין, לבנים בצומת רוגוזין×יצחק הנשיא (032) → הסגנון לפי קטע: שלט שנצפה עד 120 מ\' קובע; אחרת לפי הסגנון'
    out['observed_points'] = [{'id': p['id'], 'x': p['pos']['x'], 'y': p['pos']['y'], 'cls': p['style_class']['v']} for p in photos if p['pos']['x'] is not None and p['pos']['conf'] >= 0.3]
    out['proximity_m'] = {'v': 120, 'prov': 'משוער', 'conf': 0.3, 'src': 'השפעת תצפית דועכת exp(-d/120)'}
    return out

if __name__ == '__main__':
    obs = json.load(open(sys.argv[1], encoding='utf-8'))
    r = learn(obs, sys.argv[2])
    json.dump(r, open(sys.argv[3], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for c, v in r['classes'].items(): print(c, v['n_photos'], 'conf', v['conf'], 'road_c', v['road_class_counts'])
    print(r['rules'][0]); print(r['p_style_given_road_class']['v'])
