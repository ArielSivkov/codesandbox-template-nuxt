"""בדיקות פייתון: סכמה, פרטיות, מקורות, כללים, ירח/כיוון, מסלול, אי-התאמות. הרצה: python3 -m pytest -q tests/"""
import json, os, sys, math, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, 'tools'))
from geo import pixel_dir, az, angdiff
J = lambda p: json.load(open(os.path.join(ROOT, p), encoding='utf-8'))

def test_schema_valid():
    import jsonschema; jsonschema.validate(J('data/observations.json'), J('schema/observation.schema.json'))

def test_every_field_has_provenance():
    for p in J('data/observations.json')['photos']:
        for k in ('pos', 'heading', 'pitch', 'fov_h', 'style_class'): assert p[k]['prov'] in ('נצפה', 'נגזר', 'משוער'), (p['id'], k)
        for f in p['findings']: assert f['prov'] in ('נצפה', 'נגזר', 'משוער') and 0 <= f['conf'] <= 1

def test_privacy_no_plates_no_private_names():
    txt = json.dumps(J('data/observations.json'), ensure_ascii=False)
    assert not re.search(r'\b\d{2,3}-\d{2,3}-\d{2,3}\b', txt)
    import hashlib   # שם המשפחה בשלט של 008 אסור לרשום – נבדק לפי גיבוב (sha256) כדי שהשם עצמו לא יופיע גם כאן
    toks = set(re.findall(r'[א-ת]+', txt)); assert 'b68ed2684e0885c12e2d50ce4bb49748a66e802635a321658e747cf8cd3d48b7' not in {hashlib.sha256(t.encode()).hexdigest() for t in toks}
    for p in J('data/observations.json')['photos']: assert p['privacy']['plates_recorded'] is False and p['privacy']['private_names_recorded'] is False

def test_moon_heading_crosscheck_032():
    p = {q['id']: q for q in J('data/observations.json')['photos']}['032']
    assert p['heading']['method'] == 'גרם שמיים' and abs(p['heading']['check']['residual_deg']) <= 5   # מגדל נצפה מול מפה

def test_moon_008_wsw():
    h = {q['id']: q for q in J('data/observations.json')['photos']}['008']['heading']['v']
    assert 240 <= h <= 270   # מערב-דרום-מערב, כמו שחושב מהירח

def test_pixel_dir_center_is_heading():
    a, e = pixel_dir(0.5, 0.5, True, 123.0, 10.0); assert abs(angdiff(a, 123.0)) < 1e-6 and abs(e - 10.0) < 1e-6

def test_rules_probabilities_sum_to_one():
    r = J('data/style_rules.json')
    for c, v in r['classes'].items():
        for g, pri in v['priors'].items(): assert abs(sum(x['p'] for k, x in pri.items() if not k.startswith('_')) - 1) < 0.01, (c, g)
    for c, d in r['p_style_given_road_class']['v'].items(): assert abs(sum(d.values()) - 1) < 0.01

def test_two_style_classes_and_two_sign_styles():
    r = J('data/style_rules.json'); assert 'רחוב מגורים חדש' in r['classes'] and 'שדרה עירונית ותיקה' in r['classes']
    assert {s['style'] for s in r['observed_signs']} == {'new_blue', 'old_white'}

def test_discrepancy_tower():
    d = {x['id']: x for x in J('data/discrepancies.json')['items']}['tower_height_w1280878706']
    assert d['model']['h_m'] == 25.0 and d['observed']['h_m_range'][0] >= 85 and d['observed']['prov'] == 'משוער'

def test_route_feasible_and_labeled():
    r = J('data/route_photos.json')
    assert all(l['v_max_needed'] <= 1.6 for l in r['legs'])
    for p in r['photos']: assert p['pos_prov'] in ('ודאי', 'נגזר', 'משוער') and p['pos_err_m'] > 0
    a = {p['id']: p for p in r['photos']}; assert a['032']['street_matched'] in ('רוגוזין', 'רוגזין', 'יצחק נשיא')

def test_camera_poses_export():
    c = J('data/camera_poses.json'); assert len(c['poses']) >= 25 and all('heading_deg' in p for p in c['poses'])
    assert sum(p['calibration_grade'] == 'A' for p in c['poses']) >= 2

def test_diff_report_finds_tower():
    rep = J('reports/diff_photo_model.json')
    bad = [r['id'] for r in rep['rows'] for c in r['checks'] if not c['ok'] and 'מגדל' in c['check']]
    assert '008' in bad
