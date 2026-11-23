"""אי-התאמות מודל↔מציאות (תצפית + מקור ציבורי) → data/discrepancies.json. כל ערך: prov + conf + מקורות.
הרצה: python3 -I build_discrepancies.py <tiles_v_dir> <publicdata_dir> data/observations.json data/discrepancies.json"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import load_tile, dec

def bld(tdir, key, wid):
    t = load_tile(tdir, key); ox, oy = t['o']
    for b in t['b']:
        if b['i'] == wid:
            p = dec(b['r'][0]); cx = sum(q[0] for q in p) / len(p) + ox; cy = sum(q[1] for q in p) / len(p) + oy
            return {'id': wid, 'x': round(cx, 1), 'y': round(cy, 1), 'h_model': b['h'] / 10, 'floors_model': b['f'], 'src_model': b['src'], 'type': b['t']}

def main(tdir, pdir, obsp, outp):
    pub = {}
    try:
        for r in json.load(open(os.path.join(pdir, 'ashdod_public_facts.json'), encoding='utf-8'))['records']: pub[r['ref_id']] = r
    except Exception: pass
    p1 = pub.get('PUB-001', {})
    floors = p1.get('floors') or 29
    D = []
    for wid in ('w1280878706', 'w1013192689'):
        b = bld(tdir, '164_634', wid)
        lo, hi = round(floors * 3.1 + 2), round(floors * 3.3 + 6)
        D.append({'id': 'tower_height_' + wid, 'x': b['x'], 'y': b['y'], 'building': wid, 'severity': 'גבוהה',
                  'he': f'מגדל ב"מגדלי הדקל": במודל {b["h_model"]:.0f} מ\' ({b["floors_model"]} קומות, כלל אצבע) מול ~{floors} קומות בתצפית ובמקור ציבורי',
                  'model': {'h_m': b['h_model'], 'floors': b['floors_model'], 'prov': 'משוער', 'src': 'כלל אצבע (src=R)'},
                  'observed': {'floors': floors, 'h_m_range': [lo, hi], 'prov': 'משוער', 'conf': 0.7,
                               'src': f'תמונות 008, 010, 012–014 (~29–30 קומות, ספירה גסה) + {p1.get("ref_id", "PUB-001")} ({p1.get("where", "")[:60]}); גובה = קומות × 3.1–3.3 מ\' + גג – משוער'},
                  'ratio': round((lo + hi) / 2 / b['h_model'], 1), 'photos': ['006', '008', '010', '012', '013', '014'], 'action': 'לעדכן גובה ל-~95 מ\' (משוער) ולסמן מקור "ציבורי+תצפית"'})
    D.append({'id': 'dekel_missing_towers', 'x': 164545.0, 'y': 634160.0, 'severity': 'בינונית',
              'he': '5 מגדלים במתחם הדקל לפי מקור ציבורי – רק 2 טביעות במפה; ב-008 המגדל השני רחוק 8–9° מהמיקום הצפוי → כנראה מגדל שחסר',
              'model': {'count': 2, 'prov': 'נצפה', 'src': 'OSM בעריחים'}, 'observed': {'count': p1.get('n_buildings') or 5, 'prov': 'משוער', 'conf': 0.5, 'src': 'PUB-001 + תמונה 008 (כיוון)'}, 'photos': ['008'], 'action': 'לבדוק בתצלום אוויר עדכני ולשרטט טביעות'})
    D.append({'id': 'old_house_haoren_corner', 'x': 164661.0, 'y': 634191.0, 'building': 'w543568892', 'severity': 'נמוכה',
              'he': 'בפינת האורן: בתמונה בית ישן חד-קומתי עם גג רעפים; במודל הבניין הקרוב 6 מ\', 2 קומות, גג שטוח (זיהוי הבניין משוער)',
              'model': {'h_m': 6.0, 'floors': 2, 'roof': 'שטוח'}, 'observed': {'floors': 1, 'roof': 'רעפים', 'prov': 'נצפה', 'conf': 0.45, 'src': 'תמונות 015–017'}, 'photos': ['015', '016', '017'], 'action': 'roof:shape=gabled, קומה 1'})
    D.append({'id': 'match_seaview_tower', 'kind': 'התאמה', 'x': 164711.0, 'y': 633875.0, 'building': 'w238846044', 'severity': 'התאמה',
              'he': 'התאמה: Sea View Tower במודל 60 מ\' / 20 קומות (מתגית OSM) – בתמונות 020/021 ~20–22 קומות (ספירה גסה)',
              'model': {'h_m': 60.0, 'floors': 20}, 'observed': {'floors': '20–22', 'prov': 'משוער', 'conf': 0.5, 'src': '020, 021, 029'}, 'photos': ['020', '021', '029'], 'action': 'אין – לסמן כמאומת חלקית'})
    D.append({'id': 'infra_hv_pole', 'x': 164768.0, 'y': 634040.0, 'severity': 'בינונית',
              'he': 'חסרה תשתית: עמוד מתח גבוה מסבכי פלדה + ארון חשמל בחיפוי לבנים בצומת רוגוזין × יצחק הנשיא',
              'model': {'objects': 0}, 'observed': {'objects': 2, 'prov': 'נצפה', 'conf': 0.85, 'src': '033, 034'}, 'photos': ['033', '034'], 'action': 'להוסיף שכבת תשתית חשמל (OSM power=tower/line אם קיים)'})
    D.append({'id': 'future_dekel_render', 'kind': 'עתיד', 'x': 164560.0, 'y': 634150.0, 'severity': 'מידע',
              'he': 'שכבת "עתיד": בגדר האתר (032) הדמיה של 5 מגדלים מול הים – המצב המתוכנן של מתחם הדקל',
              'model': {}, 'observed': {'towers': 5, 'prov': 'נצפה', 'conf': 0.8, 'src': '032 (הדמיה על גדר)'}, 'photos': ['032'], 'action': 'שכבת 4D: 5 מגדלים × 29 קומות (PUB-001), 3 קיימים + 2 בבנייה'})
    D.append({'id': 'chess_club_unmapped', 'x': 164752.0, 'y': 634222.0, 'severity': 'נמוכה',
              'he': 'מבנה ציבור "מועדון שחמט אשדוד" (001–003) – לא מסומן בשם במפה; מיקומו משוער',
              'model': {'name': None}, 'observed': {'name': 'מועדון שחמט אשדוד', 'prov': 'נצפה', 'conf': 0.5, 'src': 'שלט גג בתמונה 002'}, 'photos': ['001', '002', '003'], 'action': 'לאתר במפה (אריאל יכול לסמן נקודה)'})
    D.append({'id': 'haerez_segment_end', 'x': 164765.1, 'y': 634196.2, 'severity': 'לבדיקה',
              'he': 'חישוב מיקום 008 (ירח + כיוון למגדל) נדחק לקצה הצפוני של קטע הארז במפה (70 מ\') – ייתכן שהרחוב ארוך יותר או שהמגדל זוהה לא נכון',
              'model': {'len_m': 70}, 'observed': {'prov': 'נגזר', 'conf': 0.25, 'src': 'resect008'}, 'photos': ['008'], 'action': 'צילום יום עם שלט בקצה הרחוב'})
    json.dump({'v': 1, 'items': D}, open(outp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(D), 'discrepancies')

if __name__ == '__main__':
    main(*sys.argv[1:5])
