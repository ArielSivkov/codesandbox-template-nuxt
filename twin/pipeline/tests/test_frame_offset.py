# -*- coding: utf-8 -*-
"""היסט אחד בין מסגרת הדגימה ל-ITM אמיתי (twin/pipeline/frame.py) – בכל הקוד ובכל הנתונים.

רקע (24.11.2026): בקומיט 35de539 מתאם הים בעולם עבר להיסט 1507.82/757.76, אבל קובץ הים עדיין נבנה עם
1524.6/753.6 → כל שוברי הגלים, הנמל, המרינה ונחל לכיש זזו 17.29 מ' מקו החוף שממנו שורטטו.
גם מצלמת השטח (procgen/capture.js) המירה GPS למסגרת עם ההיסט הישן – כל צילום חדש זז 17.29 מ'.
"""
import json, math, os, re, sys, importlib.util

TWIN = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(TWIN, 'pipeline'))
from frame import SAMPLE_TO_ITM, LEGACY_WRONG  # noqa: E402

DE, DN = SAMPLE_TO_ITM
NUM = r'(-?\d+(?:\.\d+)?)'


def rd(rel):
    return open(os.path.join(TWIN, rel), encoding='utf-8').read()


def pair(text, pat):
    m = re.search(pat, text)
    assert m, pat
    return float(m.group(1)), float(m.group(2))


def test_js_source_of_truth_matches_python():
    for rel in ('integration/world/js/itm.js', 'preview/world/js/itm.js', 'game/js/itm.js'):
        assert pair(rd(rel), r'SAMPLE_OFFSET:\s*\{\s*dE:\s*' + NUM + r',\s*dN:\s*' + NUM) == (DE, DN), rel


def test_every_consumer_uses_the_same_offset():
    checks = {
        'integration/world/adapters/45-maritime.js': r'SHIFT = \{ dE: ' + NUM + r', dN: ' + NUM,
        'preview/world/adapters/45-maritime.js': r'SHIFT = \{ dE: ' + NUM + r', dN: ' + NUM,
        'integration/adapters/45-maritime.js': r'SHIFT = \{ dE: ' + NUM + r', dN: ' + NUM,
        'maritime/demo.js': r'SAMPLE_SHIFT = \{ dE: ' + NUM + r', dN: ' + NUM,
        'procgen/js/capture.js': r'SAMPLE_TO_ITM = \[' + NUM + r', ' + NUM,
        'buildings/src/landmarks.js': r'GEOREF = \{ dx: ' + NUM + r', dy: ' + NUM,
        'integration/world/mods/buildings/src/landmarks.js': r'GEOREF = \{ dx: ' + NUM + r', dy: ' + NUM,
        'integration/host/host.js': r'SAMPLE_OFFSET : \{ dE: ' + NUM + r', dN: ' + NUM,
        'integration/world/host/host.js': r'SAMPLE_OFFSET : \{ dE: ' + NUM + r', dN: ' + NUM,
    }
    for rel, pat in checks.items():
        assert pair(rd(rel), pat) == (DE, DN), rel


def test_old_offset_appears_only_as_documented_legacy():
    """1524.6 מותר רק בשורה שמסומנת כישנה/שגויה – לא כערך פעיל."""
    markers = ('הישן', 'הקודם', 'השגוי', 'legacy', 'LEGACY', 'old', 'first value', 'Until')
    bad = []
    for root, dirs, files in os.walk(TWIN):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', '__pycache__', 'gen')]
        for f in files:
            if not f.endswith(('.py', '.js', '.mjs', '.json', '.geojson', '.html')): continue
            p = os.path.join(root, f)
            if os.path.abspath(p) == os.path.abspath(__file__) or os.path.getsize(p) > 5_000_000: continue
            try: txt = open(p, encoding='utf-8').read()
            except UnicodeDecodeError: continue
            if '1524.6' not in txt: continue
            for i, line in enumerate(txt.splitlines(), 1):
                if re.search(r'1524\.6(?!\d)', line) and not any(m in line for m in markers):
                    bad.append(f'{os.path.relpath(p, TWIN)}:{i}')
    assert not bad, bad


def _fixture_raw():
    spec = importlib.util.spec_from_file_location('mkfx', os.path.join(TWIN, 'maritime/tools/make_fixture.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m.RAW


def test_maritime_features_land_on_traced_coastline_in_world():
    """העולם מציב את מאפייני הים ב-(קובץ − SHIFT). זה חייב להחזיר את הקואורדינטות שצוירו במסגרת הדגימה."""
    raw = _fixture_raw()
    shift = pair(rd('integration/world/adapters/45-maritime.js'), r'SHIFT = \{ dE: ' + NUM + r', dN: ' + NUM)
    for rel in ('maritime/fixtures', 'integration/world/mods/maritime/fixtures', 'preview/world/mods/maritime/fixtures'):
        fx = json.loads(rd(rel + '/ashdod_maritime_fixture.json'))
        assert fx['sample_to_itm'] == [DE, DN], rel
        worst, n = 0.0, 0
        for f in fx['features']:
            pts = [f['coords']] if f['geom'] == 'point' else f['coords']
            for (e, nn), (sx, sy) in zip(pts, raw[f['id']]):
                worst = max(worst, math.hypot(e - shift[0] - sx, nn - shift[1] - sy)); n += 1
        assert n == 87 and worst < 0.01, (rel, n, worst)   # לפני התיקון: 17.29 מ'


def test_photo_positions_real_itm_consistent():
    """ITM אמיתי של כל צילום = מיקומו במסגרת + ההיסט (לפני: סטייה 17.29 מ' בכל 31 התצפיות)."""
    for rel in ('procgen/data/observations.json', 'procgen/data/camera_poses.json'):
        d = json.loads(rd(rel)); n = 0
        def walk(o):
            nonlocal n
            if isinstance(o, dict):
                if isinstance(o.get('x'), (int, float)) and o.get('itm'):
                    assert math.hypot(o['itm'][0] - o['x'] - DE, o['itm'][1] - o['y'] - DN) < 0.06, (rel, o.get('x'))
                    n += 1
                for v in o.values(): walk(v)
            elif isinstance(o, list):
                for v in o: walk(v)
        walk(d)
        assert n >= 30, (rel, n)


def test_legacy_error_magnitude_documented():
    assert abs(math.hypot(LEGACY_WRONG[0] - DE, LEGACY_WRONG[1] - DN) - 17.29) < 0.01
