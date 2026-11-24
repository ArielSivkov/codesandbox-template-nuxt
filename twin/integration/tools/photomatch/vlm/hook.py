#!/usr/bin/env python3
"""vlm/hook.py – נקודת חיבור למודל ראייה (שיפוט ויזואלי). כאן: ממשק + מימוש דמה. המודל עצמו (Qwen2.5-VL) רץ ב-Kaggle – ראו README.md.

ממשק:
    judge(pair: Pair, prompt: str) -> dict   (JSON תקין לפי SCHEMA)
    Pair = { id, photo_png, render_png, context: {time_il, heading_true_deg, window_fov_deg, render_classes, metrics} }
פלט (SCHEMA):
    { "id", "model", "overall_similarity": 0..1,
      "differences": [ { "category": one of CATEGORIES, "what_en", "what_he", "box": [x0,y0,x1,y1] (0..1, בחלון הצילום) | null,
                         "severity": 1..5, "confidence": 0..1, "suggested_fix_en", "suggested_fix_he" } ],
      "notes" }
מימושים:
    DummyJudge  – בלי מודל: מתרגם את המדדים המספריים של compare.py להבדלים בפורמט הזה (לבדיקת הצנרת והפורמט).
    (Kaggle) kaggle_qwen25vl.py – אותו ממשק, Qwen2.5-VL. לא מורץ כאן.
CLI:
    python3 -I vlm/hook.py --out DIR [--size 360x800] [--judge dummy]   → <out>/vlm/<size>/<id>.json + <out>/vlm/tasks-<size>.jsonl (קלט ל-Kaggle)
    python3 -I vlm/hook.py --validate FILE.jsonl                         → בודק תוצאות שחזרו מ-Kaggle מול הסכמה
"""
import json, os, sys

CATEGORIES = ['missing_object', 'extra_object', 'wrong_height', 'wrong_shape', 'wrong_color', 'vegetation', 'lighting', 'sky', 'ground', 'other']
PROMPT = """You compare two images of the SAME place, same camera position and direction, same time of day (dusk, sun about 7 degrees below the horizon).
IMAGE 1 is a real phone photo (cropped to the shared field of view). IMAGE 2 is a render of a 3D game world that should look like the photo.
List the most important differences that a 3D artist must fix in the WORLD so that IMAGE 2 looks like IMAGE 1. Ignore people, cars and noise.
Context (measured, trust it): {context}
Answer with JSON only, no prose, exactly this shape:
{{"overall_similarity": <0..1>, "differences": [{{"category": "<one of {cats}>", "what_en": "<short>", "what_he": "<short, Hebrew>",
"box": [x0, y0, x1, y1] (fractions of IMAGE 1, or null), "severity": <1..5>, "confidence": <0..1>, "suggested_fix_en": "<concrete change>", "suggested_fix_he": "<Hebrew>"}}], "notes": "<short>"}}
At most 8 differences, most important first."""

def validate(d):
    """מחזיר רשימת שגיאות (ריקה = תקין)."""
    err = []
    if not isinstance(d, dict): return ['not an object']
    for k in ('overall_similarity', 'differences'):
        if k not in d: err.append('missing ' + k)
    s = d.get('overall_similarity')
    if s is not None and not (isinstance(s, (int, float)) and 0 <= s <= 1): err.append('overall_similarity out of range')
    for i, x in enumerate(d.get('differences') or []):
        if x.get('category') not in CATEGORIES: err.append(f'diff {i}: bad category {x.get("category")!r}')
        if not isinstance(x.get('severity'), (int, float)) or not 1 <= x['severity'] <= 5: err.append(f'diff {i}: severity')
        if not isinstance(x.get('confidence'), (int, float)) or not 0 <= x['confidence'] <= 1: err.append(f'diff {i}: confidence')
        b = x.get('box')
        if b is not None and not (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in b) and b[0] < b[2] and b[1] < b[3]): err.append(f'diff {i}: box')
        if not (x.get('what_en') or x.get('what_he')): err.append(f'diff {i}: empty what')
    return err

class DummyJudge:
    """בלי מודל: הבדלים מתוך המדדים (compare.py) – אותו פורמט כמו המודל, כדי שהצנרת תעבוד מקצה לקצה."""
    name = 'dummy-from-metrics-v1'
    def judge(self, pair, prompt=PROMPT):
        m = pair['context']['metrics']; b = m['bands']; out = []
        rc = (m.get('render_classes') or {}).get('by_band', {}).get('mid', {})
        if rc.get('veg', 0) >= 0.7:
            out.append({'category': 'vegetation', 'what_en': f"render mid band is {rc['veg']:.0%} trees; photo shows city/port beyond low scrub", 'what_he': f"ברינדור {rc['veg']:.0%} מרצועת האמצע עצים; בצילום העיר והנמל מעל שיחייה נמוכה",
                        'box': [0.0, 0.35, 1.0, 0.65], 'severity': 4, 'confidence': 0.6, 'suggested_fix_en': 'lower/remove trees on the summit', 'suggested_fix_he': 'להנמיך/להסיר עצים בפסגה'})
        s = b['sky']
        if s.get('dL') is not None and (s['dL'] < -8 or s['dE_mean'] > 15):
            out.append({'category': 'sky', 'what_en': f"sky too dark/off-color at dusk (dL*={s['dL']:+.1f}, dE={s['dE_mean']:.1f})", 'what_he': f"שמיים כהים/בגוון אחר בדמדומים (ΔL*={s['dL']:+.1f}, ΔE={s['dE_mean']:.1f})",
                        'box': [0.0, 0.0, 1.0, 0.4], 'severity': 4, 'confidence': 0.7, 'suggested_fix_en': 'twilight sky term (night only below -14 deg)', 'suggested_fix_he': 'מונח דמדומים בשמיים (לילה מלא רק מתחת ל-‎−14°)'})
        md = b['mid']
        if md.get('lights_photo') is not None and md['lights_photo'] > 2 * (md['lights_render'] + 0.5):
            out.append({'category': 'lighting', 'what_en': f"far fewer city lights ({md['lights_render']:.1f} vs {md['lights_photo']:.1f} per 10k px)", 'what_he': f"הרבה פחות אורות עיר ({md['lights_render']:.1f} מול {md['lights_photo']:.1f} ל-10 אלף פיקסלים)",
                        'box': None, 'severity': 3, 'confidence': 0.5, 'suggested_fix_en': 'street/port light glow, more lit windows at 17-18h', 'suggested_fix_he': 'הילת פנסי רחוב/נמל, יותר חלונות מוארים ב-17–18'})
        sk = m['skyline']
        if sk.get('median_diff_deg') is not None and sk['median_diff_deg'] == sk['median_diff_deg'] and abs(sk['median_diff_deg']) >= 1.5:
            out.append({'category': 'wrong_height', 'what_en': f"skyline differs by {sk['median_diff_deg']:+.1f} deg (median)", 'what_he': f"קו הרקיע שונה ב-{sk['median_diff_deg']:+.1f}° (חציון)", 'box': None, 'severity': 3, 'confidence': 0.4,
                        'suggested_fix_en': 'check building heights in this direction (frustum)', 'suggested_fix_he': 'לבדוק גובהי בניינים בכיוון הזה (frustum)'})
        g = b['ground']
        if g.get('dL') is not None and abs(g['dL']) > 6:
            out.append({'category': 'ground', 'what_en': f"ground brightness off by {g['dL']:+.1f} L*", 'what_he': f"בהירות הקרקע שונה ב-{g['dL']:+.1f}", 'box': [0.0, 0.7, 1.0, 1.0], 'severity': 2, 'confidence': 0.5,
                        'suggested_fix_en': 'darken ground at dusk', 'suggested_fix_he': 'להחשיך את הקרקע בדמדומים'})
        sim = max(0.0, 1.0 - (s.get('dE_mean') or 30) / 60 - 0.3 * rc.get('veg', 0))
        return {'id': pair['id'], 'model': self.name, 'overall_similarity': round(min(1.0, sim), 2), 'differences': out[:8], 'notes': 'מימוש דמה – נגזר מהמדדים, לא ממודל ראייה'}

def make_pair(cmp_json, out, size):
    d = json.load(open(cmp_json, encoding='utf-8'))
    ctx = {'date': d.get('date'), 'time_il': d.get('time_il'), 'heading_true_deg': d['pose']['heading_true_deg'], 'window_fov_deg': [d['window']['fov_h_deg'], d['window']['fov_v_deg']],
           'render_classes': (d['metrics'].get('render_classes') or {}).get('window'), 'metrics': d['metrics']}
    base = os.path.join(out, 'vlm', size, 'pairs'); os.makedirs(base, exist_ok=True)
    # חיתוך שני הפאנלים הראשונים מתמונת צד-מול-צד (צילום | רינדור) – קבצים נפרדים למודל
    from PIL import Image
    im = Image.open(d['side_by_side']); W, H = im.size; pw = (W - 3 * 6) // 4; head, foot = 74, 150
    ph = os.path.join(base, d['id'] + '.photo.png'); rd = os.path.join(base, d['id'] + '.render.png')
    im.crop((0, head, pw, H - foot)).save(ph); im.crop((pw + 6, head, 2 * pw + 6, H - foot)).save(rd)
    return {'id': d['id'], 'photo_png': ph, 'render_png': rd, 'context': ctx}

def main():
    a = sys.argv
    if '--validate' in a:
        bad = 0
        for ln in open(a[a.index('--validate') + 1], encoding='utf-8'):
            if not ln.strip(): continue
            r = json.loads(ln); e = validate(r.get('result', r))
            if e: bad += 1; print(r.get('id'), e)
        print('invalid', bad); sys.exit(1 if bad else 0)
    out = a[a.index('--out') + 1] if '--out' in a else '/home/claude/swarm/photomatch-out'; size = a[a.index('--size') + 1] if '--size' in a else '360x800'
    judge = DummyJudge()
    cdir = os.path.join(out, 'compare', size); vdir = os.path.join(out, 'vlm', size); os.makedirs(vdir, exist_ok=True)
    tasks = open(os.path.join(out, 'vlm', f'tasks-{size}.jsonl'), 'w', encoding='utf-8'); n = 0
    for f in sorted(os.listdir(cdir)):
        if not f.endswith('.json'): continue
        sb = json.load(open(os.path.join(cdir, f), encoding='utf-8')).get('side_by_side')
        if not sb or not os.path.exists(sb): print(f[:-5], 'אין תמונת צד-מול-צד (למשל ב-CI ציבורי) – דילוג'); continue
        pair = make_pair(os.path.join(cdir, f), out, size)
        ctx_small = {k: v for k, v in pair['context'].items() if k != 'metrics'}
        prompt = PROMPT.format(context=json.dumps(ctx_small, ensure_ascii=False), cats='|'.join(CATEGORIES))
        tasks.write(json.dumps({'id': pair['id'], 'photo': os.path.relpath(pair['photo_png'], out), 'render': os.path.relpath(pair['render_png'], out), 'prompt': prompt}, ensure_ascii=False) + '\n')
        r = judge.judge(pair, prompt); e = validate(r); r['schema_errors'] = e
        json.dump(r, open(os.path.join(vdir, pair['id'] + '.json'), 'w'), ensure_ascii=False, indent=1); n += 1
        print(pair['id'], judge.name, 'diffs', len(r['differences']), 'sim', r['overall_similarity'], 'schema', 'ok' if not e else e)
    tasks.close(); print('pairs', n, '→', os.path.join(out, 'vlm'))

if __name__ == '__main__':
    main()
