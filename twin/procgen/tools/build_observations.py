"""בונה data/observations.json מ: (1) טבלת ממצאים ידנית (צפייה בכל תמונה, 23.11.2026), (2) מדידות פיקסל (photo_measure.py),
(3) גאומטריית האריחים. כל שדה נושא prov ∈ {נצפה, נגזר, משוער} ו-conf.
הרצה: python3 -I build_observations.py <fieldphotos> <tiles_v_dir> <out.json>"""
import sys, os, json, hashlib, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import pixel_dir, az, angdiff, to_itm, to_wgs84, SAMPLE_TO_ITM

N, O, E = 'נצפה', 'נגזר', 'משוער'

def F(dept, kind, he, prov=N, conf=0.7, count=None, **attrs):
    d = {'dept': dept, 'kind': kind, 'he': he, 'prov': prov, 'conf': conf}
    if count is not None: d['count'] = count
    if attrs: d['attrs'] = attrs
    return d

# ---- נקודות ידועות (מסגרת הדגימה של האריחים) ----
HAEREZ_S, HAEREZ_N = (164737.0, 634132.0), (164765.1, 634196.2)
HAOREN_S = (164637.9, 634181.1)
TOWER_A = (164574.4, 634149.8)        # w1280878706
HANASI_W = (164600.0, 634093.0)      # על שד' יצחק הנשיא מערבית לרוגוזין (018–019) – לאורך הרחוב משוער
JCT_ROG_HAN = (164765.0, 634043.0)   # צומת רוגוזין × יצחק הנשיא (צומת דרכים באריח 164_634) – עוגן מדויק לפי שלטים 032/033
KIKAR_POALIM = (164718.0, 633948.0)  # כיכר על רוגזין ~100 מ' דרומית לצומת (טבעת דרכים באריח 164_633); ליד Sea View Tower (w238846044, 20 קומות) + ביתן מסחר w238846041
SEAVIEW = (164713.0, 633888.0)
JCT_DEKEL_ROG = (164794.0, 634104.0)  # קצה הדקל על רוגוזין באריח 164_634
CHESS_GUESS = (164752.0, 634222.0)    # ליד מתחם בית הספר גאולים (w101969909) – לא מאומת

def along(a, b, t):
    L = math.hypot(b[0] - a[0], b[1] - a[1]); return (a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L)

# ---- ממצאים ידניים לכל תמונה (מה שנראה בעין; בלי לוחיות, בלי שמות פרטיים) ----
CUR = {
 '001': dict(style=('רחוב מגורים ותיק', E, 0.5), q='בינונית – חשוך, רעש', pos=(CHESS_GUESS, 60, E, 0.25, 'ליד מבנה ציבור "מועדון שחמט אשדוד" – מיקום המבנה לא מאומת במפה', None),
   head=None, find=[
   F('בניינים', 'public_low_raised', 'מבנה ציבור קומה אחת על בסיס מוגבה ~1 מ\', טיח לבן, חלונות עם סורגים, שלט גג', conf=0.8),
   F('תחבורה', 'crosswalk_zebra', 'מעבר חצייה זברה לבן', count=1, conf=0.85),
   F('תחבורה', 'parking_perpendicular', 'חניה ניצבת לאורך המבנה', conf=0.7),
   F('ריצוף', 'pavers_red_rect', 'מדרכה מאבנים משתלבות אדומות מלבניות', conf=0.8, color='#9a4a3a'),
   F('אבני שפה', 'curb_grey_plain', 'אבן שפה אפורה לא צבועה', conf=0.7),
   F('גדרות', 'rail_white_metal', 'מעקה/גדר מתכת לבנה (מוטות אנכיים)', conf=0.8),
   F('צמחייה', 'tree_broadleaf_large', 'עץ רחב-נוף בוגר – כנראה פיקוס (לאימות ביום)', prov=E, conf=0.4, species_guess='Ficus'),
   F('רכב', 'parked_car', 'רכבים חונים: האצ\'בק, סדאן, רכב שטח קטן', count=3, conf=0.9),
   F('שמיים', 'clouds_partial', 'עננות חלקית, ירח מאיר את העננים', conf=0.8)]),
 '002': dict(style=('רחוב מגורים ותיק', E, 0.5), q='טובה לשלט, רעש בקיר', pos=(CHESS_GUESS, 60, E, 0.25, 'אותו מבנה כמו 001', None), head=None, find=[
   F('בניינים', 'roof_sign', 'שלט גג כחול-לבן: "מועדון שחמט אשדוד" (שם מוסד ציבורי, לא אדם פרטי)', conf=0.95),
   F('בניינים', 'window_bars', 'שלושה חלונות עם סורגים בחזית', count=3, conf=0.85),
   F('גדרות', 'rail_white_metal', 'גדר מוטות לבנה בתחתית', conf=0.7)]),
 '003': dict(style=('רחוב מגורים ותיק', E, 0.5), q='בינונית', pos=(CHESS_GUESS, 60, E, 0.25, 'אותו מבנה כמו 001', None), head=None, find=[
   F('בניינים', 'public_low_raised', 'מבנה הציבור + מדרגות ומעקה לבן, סמל על הקיר; ברקע מבנה 2 קומות עם דגלים', conf=0.8),
   F('רכב', 'parked_car', 'האצ\'בק, סדאן, רכב שטח קטן 4×4 (סוג בלבד)', count=3, conf=0.9),
   F('ריהוט רחוב', 'bins_green', 'פחי אשפה ירוקים', count=2, conf=0.6),
   F('צמחייה', 'cypress_row', 'שורת ברושים/עצים צרים ברקע', prov=E, conf=0.4)]),
 '004': dict(style=('רחוב מגורים חדש', N, 0.7), q='בינונית – בוהק חזק מפנס', pos=(along(HAEREZ_S, HAEREZ_N, 45), 25, E, 0.45, 'הארז: אותה דלת מוסך כהה עם מדבקה כתומה כמו ב-006', 'הארז'),
   head=dict(v=204.0, prov=E, conf=0.3, pm=30, method='כיוון רחוב', src='לאורך ציר הארז דרומה (204°); חלופה 24° – לא הוכרע'), find=[
   F('בניינים', 'villa_stone_clad', 'וילות חדשות 2–3 קומות, חיפוי אבן בהירה, דלת מוסך כהה גדולה', conf=0.85),
   F('ריצוף', 'pavers_red_rect', 'מדרכה אדומה מאבנים משתלבות, מתעקלת', conf=0.8, color='#9a4a3a'),
   F('אבני שפה', 'curb_grey_plain', 'אבן שפה אפורה', conf=0.7),
   F('תאורה', 'lamp_led_white', 'פנס רחוב לבן חזק (LED) – בוהק', conf=0.6, cct_K_est='4000–5000'),
   F('צמחייה', 'palm_date', 'דקלים מאחורי חומות', prov=E, conf=0.5),
   F('רכב', 'parked_car', 'רכב שטח ושני רכבים נוספים חונים בצד שמאל', count=3, conf=0.85)]),
 '005': dict(style=('רחוב מגורים ותיק', E, 0.5), q='בינונית – מטושטש', pos=(CHESS_GUESS, 60, E, 0.25, 'אותו רכב לבן כמו ב-001 נראה – ליד מבנה הציבור', None), head=None, find=[
   F('ריצוף', 'pavers_red_rect', 'פינת מדרכה אדומה עם קצה מעוגל', conf=0.85, color='#9a4a3a'),
   F('אבני שפה', 'curb_white_painted', 'אבן שפה צבועה לבן בפינה', conf=0.6),
   F('ריהוט רחוב', 'manhole', 'מכסה שוחה עגול במדרכה', count=1, conf=0.9),
   F('ריהוט רחוב', 'pole_wood_utility', 'עמוד עץ (חשמל/תקשורת) עם שלט קטן', count=1, conf=0.75),
   F('גדרות', 'fence_metal_bars', 'גדר מוטות מתכת לבנה', conf=0.6),
   F('בניינים', 'garage_door_dark', 'דלת מוסך/תריס כהה', conf=0.7)]),
 '006': dict(style=('רחוב מגורים חדש', N, 0.75), q='בינונית – מטושטש', pos=(along(HAEREZ_S, HAEREZ_N, 62), 20, E, 0.4, 'ליד הארז 3 (כמו 008)', 'הארז'),
   head='moon', find=[
   F('שמיים', 'moon', 'ירח בשמיים – משמש מצפן', conf=0.95),
   F('זמני', 'crane_tower', 'עגורן צריח אדום עם תאורה', count=1, conf=0.9),
   F('בניינים', 'tower_highrise', 'מגדל מגורים גבוה ברקע (מ"מגדלי הדקל")', conf=0.75),
   F('בניינים', 'villa_stone_clad', 'וילה חדשה עם חיפוי אבן, מספר בית "3" על הקיר', conf=0.85),
   F('צמחייה', 'palm_small_pots', 'דקלונים בעציצים גבוהים שחורים', count=2, conf=0.7),
   F('ריהוט רחוב', 'overhead_cable', 'כבל עילי חוצה', conf=0.8)]),
 '007': dict(style=('רחוב מגורים חדש', E, 0.5), q='בינונית – מטושטש', pos=(along(HAEREZ_S, HAEREZ_N, 30), 35, E, 0.3, 'הארז או סמוך – לפי רצף הצילום', 'הארז'),
   head=dict(v=235.0, prov=E, conf=0.25, pm=25, method='ציון דרך', src='העגורן (אתר מגדלי הדקל) בצד ימין למעלה'), find=[
   F('צמחייה', 'palm_date', 'דקל תמר בוגר', count=1, conf=0.85),
   F('תאורה', 'lamp_led_white', 'פנס רחוב לבן על עמוד ישר', count=1, conf=0.7, cct_K_est='4000–5000'),
   F('גדרות', 'fence_dark_slats', 'גדר/שער רפפות כהה על חומה בנויה', conf=0.75),
   F('צמחייה', 'hedge', 'גדר חיה/שיחים כהים', conf=0.6),
   F('זמני', 'crane_tower', 'עגורן עם פסי תאורה כחולים', count=1, conf=0.85),
   F('רכב', 'parked_car', 'סדאן ורכב שטח חונים', count=3, conf=0.85)]),
 '008': dict(style=('רחוב מגורים חדש', N, 0.75), q='טובה יחסית לשמיים, חזית כהה', pos='resect008',
   head='moon', find=[
   F('תחבורה', 'house_number_sign', 'שלט מספר בית שחור: "הארז 3" (שם המשפחה בשלט לא נרשם)', conf=0.9),
   F('שמיים', 'moon', 'ירח מעל המגדל – מצפן', conf=0.95),
   F('בניינים', 'tower_highrise', 'שני מגדלים ~30 קומות ב-WSW (מגדלי הדקל)', count=2, conf=0.8, floors_est='~29'),
   F('זמני', 'crane_tower', 'עגורן צריח אדום', count=1, conf=0.9),
   F('בניינים', 'villa_stone_clad', 'חומת/וילה בחיפוי לוחות אבן גדולים בהירים; גג רעפים קטן מימין', conf=0.85),
   F('גדרות', 'fence_dark_slats', 'שער רפפות כהה', conf=0.7),
   F('ריהוט רחוב', 'overhead_cable', 'כבל עילי', conf=0.8)]),
 '009': dict(style=('רחוב מגורים ותיק', N, 0.6), q='טובה', pos=(HAEREZ_S, 25, E, 0.35, 'צומת הארז/הדקל, מבט לאורך הדקל מערבה – לפי העגורן ושלט תן זכות קדימה', 'הדקל'),
   head=dict(v=285.0, prov=E, conf=0.35, pm=20, method='כיוון רחוב', src='ציר הדקל ~296°, העגורן ממש לפנים'), find=[
   F('תחבורה', 'sign_yield', 'תמרור "תן זכות קדימה" (משולש אדום) בצומת הבא', count=1, conf=0.8),
   F('תאורה', 'lamp_led_white', 'שורת פנסים לבנים', count=3, conf=0.7, cct_K_est='4000–5000'),
   F('ריצוף', 'pavers_red_rect', 'מדרכה אדומה אבנים משתלבות מימין', conf=0.85, color='#9a4a3a'),
   F('אבני שפה', 'curb_grey_plain', 'אבן שפה אפורה', conf=0.7),
   F('בניינים', 'old_house_tile_roof', 'בתים ישנים חד-קומתיים עם גג רעפים', conf=0.8),
   F('בניינים', 'block_mid_rise', 'בלוקים 8–10 קומות ברקע', conf=0.6),
   F('גדרות', 'fence_blue_rail', 'מעקה כחול נמוך על קיר', conf=0.6),
   F('צמחייה', 'tree_broadleaf_large', 'עצים רחבי נוף (פיקוס?)', prov=E, conf=0.45),
   F('רכב', 'parked_car', 'האצ\'בק וסדאנים חונים בחניה אלכסונית/ניצבת', count=3, conf=0.85),
   F('זמני', 'crane_tower', 'עגורן עם תאורה כחולה', count=1, conf=0.9)]),
 '010': dict(style=('רחוב מגורים חדש', E, 0.5), q='טובה – בוהק מפנס', pos=((164650.0, 634178.0), 30, E, 0.35, 'לאורך הדקל, מול המגדל עם העגורן', 'הדקל'),
   head=dict(v=245.0, prov=E, conf=0.3, pm=20, method='ציון דרך', src='המגדל w1280878706 במרכז התמונה'), find=[
   F('בניינים', 'tower_highrise', 'מגדל מגורים ~29 קומות בבנייה, עגורן צמוד', conf=0.85, floors_est='~29'),
   F('תחבורה', 'sign_parking_blue', 'תמרור חניה כחול (P)', count=1, conf=0.8),
   F('זמני', 'crane_tower', 'עגורן צריח צמוד למגדל', count=1, conf=0.95),
   F('זמני', 'construction_fence', 'גדר אתר בנייה ופסולת', conf=0.7)]),
 '011': dict(style=('רחוב מגורים חדש', N, 0.8), q='טובה', pos=((164650.0, 634178.0), 30, E, 0.35, 'אותו תמרור חניה כמו 010', 'הדקל'),
   head=dict(v=290.0, prov=E, conf=0.4, pm=20, method='כיוון רחוב', src='לאורך הדקל; המגדל משמאל'), find=[
   F('תאורה', 'lamp_curved_led', 'פנס LED לבן על עמוד מעוקל יחיד (זרוע אחת), אפור-לבן', count=4, conf=0.9, cct_K_est='4000–5000', pole_h_m_est=8),
   F('תחבורה', 'sign_parking_blue', 'תמרור חניה כחול', count=1, conf=0.85),
   F('תחבורה', 'parking_bay', 'מפרץ חניה מרוצף', conf=0.8),
   F('ריצוף', 'pavers_beige_square', 'מדרכה אבנים בהירות (בז\'-אפור), שוליים צהבהבים', conf=0.8, color='#c9b9a0'),
   F('גדרות', 'wall_stone_clad', 'חומת אבן מסותתת בהירה (סגנון אבן ירושלמית) ~1.5 מ\'', conf=0.85),
   F('בניינים', 'old_house_tile_roof', 'בית ישן עם גג רעפים מעבר לחומה', conf=0.75),
   F('צמחייה', 'street_trees_young', 'עצי רחוב צעירים בהמשך', prov=E, conf=0.5),
   F('רכב', 'parked_car', 'האצ\'בק ומסחרית קלה', count=2, conf=0.9)]),
 '012': dict(style=('קרוב למגדל', N, 0.8), q='טובה', pos=((164600.0, 634170.0), 30, E, 0.3, 'בסיס מגדלי הדקל', 'הדקל'),
   head=dict(v=230.0, prov=E, conf=0.25, pm=30, method='ציון דרך', src='מבט אל המגדל, זווית חדה כלפי מעלה'), find=[
   F('בניינים', 'tower_highrise', 'מגדל ~29–30 קומות, חיפוי אבן בהירה, מרפסות מעוגלות, פסי חלונות כהים; מגדל שני מימין', count=2, conf=0.85, floors_est='~29 (ספירה גסה; מקור ציבורי: 29)')]),
 '013': dict(style=('קרוב למגדל', N, 0.8), q='טובה', pos=((164600.0, 634170.0), 30, E, 0.3, 'בסיס מגדלי הדקל', 'הדקל'),
   head=dict(v=230.0, prov=E, conf=0.25, pm=30, method='ציון דרך', src='כמו 012'), find=[
   F('בניינים', 'tower_highrise', 'אותו מגדל – תאורת חזית חמה מלמטה, תריסים בחלונות', count=2, conf=0.85, floors_est='~29')]),
 '014': dict(style=('קרוב למגדל', N, 0.8), q='טובה', pos=((164600.0, 634170.0), 30, E, 0.3, 'בסיס מגדלי הדקל', 'הדקל'),
   head=dict(v=230.0, prov=E, conf=0.25, pm=30, method='ציון דרך', src='כמו 012'), find=[
   F('בניינים', 'tower_highrise', 'אותו מגדל, זווית מעט שונה (לסדרת שחזור)', count=2, conf=0.85, floors_est='~29'),
   F('צמחייה', 'tree_broadleaf_large', 'עץ רחב-נוף בפינה', prov=E, conf=0.5)]),
 '015': dict(style=('רחוב מגורים חדש', N, 0.8), q='טובה', pos=((164655.0, 634174.0), 15, E, 0.5, 'פינת הדקל/האורן – שלט "רח\' האורן"', 'האורן'),
   head=dict(v=278.0, prov=E, conf=0.45, pm=15, method='כיוון רחוב', src='לאורך הדקל מערבה; שלט האורן מימין, מגדלים בקצה השמאלי'), find=[
   F('תחבורה', 'street_name_sign', 'שלט שם רחוב כחול, מסגרת לבנה, עברית למעלה ("רח\' האורן") ואנגלית למטה (HA\'OREN St.), עמוד לבן מעוטר', count=1, conf=0.95, color='#1f4fa0'),
   F('תאורה', 'lamp_curved_led', 'שורת פנסי LED לבנים על עמודים מעוקלים לאורך הרחוב', count=6, conf=0.9, cct_K_est='4000–5000', spacing_m_est='25–30'),
   F('אבני שפה', 'curb_red_white', 'אבן שפה אדום-לבן בפינה (איסור חניה ליד צומת)', conf=0.9),
   F('ריצוף', 'pavers_red_square', 'מדרכה אבנים מרובעות אדמדמות בפינה', conf=0.7, color='#a0564a'),
   F('גדרות', 'fence_white_picket', 'גדר כלונסאות עץ לבנה', conf=0.9),
   F('צמחייה', 'climber_on_fence', 'מטפס ירוק על הגדר', conf=0.8),
   F('בניינים', 'old_house_tile_roof', 'בית ישן חד-קומתי, טיח בהיר, גג רעפים', conf=0.9),
   F('ריהוט רחוב', 'bollards_red_white', 'עמודונים אדום-לבן לאורך המדרכה הרחוקה', prov=E, conf=0.5),
   F('ריהוט רחוב', 'bench', 'ספסל ליד גדר הגן', prov=E, conf=0.4),
   F('זמני', 'crane_tower', 'עגורן ברקע', count=1, conf=0.85),
   F('רכב', 'parked_car', 'האצ\'בק, סדאן, רכבי שטח', count=4, conf=0.9)]),
 '016': dict(style=('רחוב מגורים חדש', N, 0.8), q='טובה', pos=((164655.0, 634174.0), 15, E, 0.5, 'כמו 015', 'האורן'),
   head=dict(v=280.0, prov=E, conf=0.45, pm=15, method='כיוון רחוב', src='כמו 015'), find=[
   F('תחבורה', 'street_name_sign', 'אותו שלט "רח\' האורן" – עמוד לבן מעוטר, כחול עם מסגרת לבנה', count=1, conf=0.95, color='#1f4fa0'),
   F('תאורה', 'lamp_curved_led', 'פנסים מעוקלים לבנים', count=6, conf=0.9),
   F('גדרות', 'fence_white_picket', 'גדר כלונסאות לבנה', conf=0.9),
   F('גדרות', 'rail_grey_metal', 'מעקה מתכת אפור בגן משמאל', prov=E, conf=0.5)]),
 '017': dict(style=('רחוב מגורים חדש', N, 0.8), q='טובה', pos=((164652.0, 634176.0), 15, E, 0.5, 'כמו 015, צעד אחד', 'האורן'),
   head=dict(v=272.0, prov=E, conf=0.4, pm=15, method='כיוון רחוב', src='כמו 015'), find=[
   F('תאורה', 'lamp_curved_led', 'פנסים מעוקלים', count=5, conf=0.9),
   F('אבני שפה', 'curb_red_white', 'שפה אדום-לבן באי התנועה/פינה', conf=0.7),
   F('בניינים', 'old_house_tile_roof', 'בית רעפים ישן', conf=0.9),
   F('צמחייה', 'climber_on_fence', 'מטפס על גדר', conf=0.8)]),
 '018': dict(style=('שדרה עירונית ותיקה', N, 0.85), q='בינונית – מטושטש, בוהק', pos=(HANASI_W, 150, O, 0.4, 'שד\' יצחק הנשיא – נגזר: אותו סגנון (פנסים אדומים כפולים + מעקה אדום עם אדניות) צולם ב-034 ליד שלט "שד\' יצחק הנשיא" (033); 4 דק\' אחרי 017; מיקום לאורך הרחוב משוער', 'יצחק נשיא'),
   head=None, find=[
   F('תאורה', 'lamp_ornate_red_double', 'עמודי תאורה אדומים מעוטרים, ראש LED לבן (כפול)', count=5, conf=0.85, cct_K_est='4000–5000'),
   F('גדרות', 'rail_red_median', 'מעקה הולכי רגל אדום מעוטר על אי התנועה', conf=0.9),
   F('אבני שפה', 'curb_black_white', 'שפת אי תנועה שחור-לבן', conf=0.8),
   F('אבני שפה', 'curb_red_white', 'שפת מדרכה אדום-לבן', conf=0.8),
   F('ריצוף', 'slabs_light_grey', 'מדרכה לוחות בהירים', conf=0.6, color='#cfc8bd'),
   F('תחבורה', 'traffic_light', 'רמזור', count=2, conf=0.8),
   F('בניינים', 'block_mid_rise', 'בלוקים 8–10 קומות', conf=0.75),
   F('צמחייה', 'tree_broadleaf_large', 'עץ רחב-נוף על אי התנועה', prov=E, conf=0.5)]),
 '019': dict(style=('שדרה עירונית ותיקה', N, 0.85), q='טובה', pos=(HANASI_W, 150, O, 0.4, 'כמו 018', 'יצחק נשיא'),
   head=None, find=[
   F('תאורה', 'lamp_ornate_red_double', 'עמודי תאורה אדומים מעוטרים', count=4, conf=0.85),
   F('גדרות', 'rail_red_median', 'מעקה אדום מעוטר + אדניות', conf=0.9),
   F('אבני שפה', 'curb_black_white', 'שפה שחור-לבן', conf=0.85),
   F('תחבורה', 'road_arrows', 'חיצי נתיב לבנים צבועים', count=2, conf=0.85),
   F('תחבורה', 'traffic_light', 'רמזור', count=2, conf=0.8),
   F('תחבורה', 'sign_parking_blue', 'תמרור חניה כחול', count=1, conf=0.7),
   F('בניינים', 'block_mid_rise_commercial', 'בלוקים 8–10 קומות עם חזית מסחרית וקולונדה; תריסי חנויות (שמות עסקים לא נרשמו)', conf=0.85),
   F('צמחייה', 'tree_ficus', 'פיקוס בוגר באדנית', count=2, prov=E, conf=0.55),
   F('צמחייה', 'palm_date', 'דקלים באדניות', count=2, conf=0.7)]),
 '020': dict(style=('רחוב ראשי חדש עם מגדל', N, 0.6), q='בינונית – בוהק', pos=((164722.0, 633915.0), 30, O, 0.45, 'בין הכיכר (029) ל-Sea View Tower (w238846044, 60 מ\', 20 קומות) וביתן המסחר w238846041 – תואם מגדל ~20 קומות עם בסיס מסחרי', 'רוגזין'), head=None, find=[
   F('בניינים', 'tower_highrise', 'מגדל מגורים ~20–22 קומות (ספירה גסה) עם מבנה מסחרי עגול בבסיס', conf=0.75, floors_est='~20–22'),
   F('ריהוט רחוב', 'bike_rack_blue', 'מתקני אופניים/מחסום כחולים מתפתלים', count=4, conf=0.8),
   F('ריהוט רחוב', 'bin_street', 'פח אשפה רחובי', count=1, conf=0.85),
   F('תאורה', 'lamp_led_white', 'פנסי LED לבנים על עמודים ישרים גבוהים', count=5, conf=0.8, cct_K_est='4000–5000'),
   F('תחבורה', 'crosswalk_zebra', 'מעבר חצייה', count=1, conf=0.8),
   F('ריצוף', 'pavers_red_rect', 'מדרכה אדומה', conf=0.7, color='#9a4a3a'),
   F('צמחייה', 'planters', 'אדניות עם שיחים לפני המבנה', conf=0.7)]),
 '021': dict(style=('רחוב ראשי חדש עם מגדל', N, 0.6), q='טובה', pos=((164720.0, 633905.0), 25, O, 0.45, 'מול הביתן העגול w238846041', 'רוגזין'), head=None, find=[
   F('בניינים', 'commercial_round_pavilion', 'מבנה מסחרי עגול חד-קומתי עם חזית זכוכית ושלט (שם העסק לא נרשם)', conf=0.85),
   F('בניינים', 'tower_highrise', 'אותו מגדל, מרפסות בפינה', conf=0.8)]),
 '026': dict(style=('כניסה לחנות', N, 0.9), q='טובה', pos=((164717.0, 633900.0), 25, O, 0.45, 'כניסת מכולת 24/7 בבסיס המגדל של 020 (רצף 020→026)', 'רוגזין'), head=None, find=[
   F('בניינים', 'shop_entrance_glass', 'כניסת חנות: דלת זכוכית הזזה, מדפי תצוגה חיצוניים, שלט מואר (שם העסק לא נרשם)', conf=0.85, template='חנות נכנסת: חוץ→מעבר→מקרר→קופה', seq='021,026,022,023,024,025'),
   F('ריצוף', 'tiles_terrazzo', 'ריצוף כניסה בהיר מנוקד (טרצו)', conf=0.6)]),
 '027': dict(style=('שדרה עירונית ותיקה', N, 0.8), q='טובה – בוהק', pos=(KIKAR_POALIM, 40, O, 0.45, 'אבן "כיכר הפועלים" (נקרא אצלנו) + שלט רוגוזין (נקרא ע"י המטה). נבחרה הכיכר על רוגזין דרומית ליצחק הנשיא: רצף זמנים 01:14→01:18→01:21 (032 בצומת) + Sea View Tower (20 קומות) תואם 020/029. חלופה: מרכז רובע א\' (PUB-006, ~480 מ\' צפונה)', 'רוגזין'),
   head=None, find=[
   F('תחבורה', 'roundabout', 'כיכר תנועה עם דשא, סלעים, עצים בוגרים ואבן שם "כיכר הפועלים"', conf=0.9),
   F('תחבורה', 'sign_roundabout', 'תמרור כיכר (עיגול כחול)', count=1, conf=0.8),
   F('תחבורה', 'street_name_sign', 'שלט שם רחוב כחול על עמוד (רוגוזין – לפי המטה)', count=1, prov=E, conf=0.5),
   F('ריהוט רחוב', 'ped_barrier_blue_white', 'מחסומי הולכי רגל מתפתלים כחול-לבן', count=6, conf=0.9),
   F('צמחייה', 'tree_ficus', 'פיקוסים בוגרים עם גזע עבה בכיכר', count=3, prov=E, conf=0.6),
   F('תאורה', 'lamp_led_white', 'פנסי LED לבנים', count=3, conf=0.7),
   F('בניינים', 'block_mid_rise_commercial', 'בלוק 8–10 קומות עם חנויות בקומת הקרקע', conf=0.8),
   F('בניינים', 'tower_highrise', 'מגדל ~20 קומות ברקע', conf=0.7),
   F('ריהוט רחוב', 'taxi_sign', 'שלט תחנת מוניות צהוב', count=1, conf=0.8),
   F('זמני', 'crane_tower', 'עגורן עם תאורה כחולה ברקע', count=1, conf=0.8)]),
 '028': dict(style=('שדרה עירונית ותיקה', E, 0.4), q='טובה לטקסטורה', pos=(KIKAR_POALIM, 60, E, 0.3, 'מעבר חצייה ליד הכיכר (01:18, כמו 027)', 'רוגזין'), head=None, find=[
   F('תחבורה', 'crosswalk_zebra_worn', 'מעבר חצייה שחוק: פסים לבנים סדוקים על אספלט, רוחב פס ~50 ס"מ (לפי כף רגל כסרגל)', conf=0.75, stripe_w_m_est=0.5, use='טקסטורה')]),
 '029': dict(style=('שדרה עירונית ותיקה', N, 0.6), q='בינונית – בוהק', pos=(KIKAR_POALIM, 50, O, 0.4, 'אותה כיכר כמו 027, מבט אל המגדל והביתן העגול של 020', 'רוגזין'), head=None, find=[
   F('תחבורה', 'roundabout', 'כיכר עם דשא, סלעים, עץ זית/פיקוס', conf=0.85),
   F('אבני שפה', 'curb_red_white', 'שפת כיכר אדום-לבן', conf=0.75),
   F('בניינים', 'tower_highrise', 'המגדל של 020 + ביתן מסחרי עגול', conf=0.85),
   F('תאורה', 'lamp_led_white', 'פנס LED לבן', count=2, conf=0.7),
   F('ריהוט רחוב', 'overhead_cable', 'כבלים עיליים', conf=0.8)]),
 '030': dict(style=('רחוב מגורים חדש', N, 0.7), q='בינונית – מטושטש', pos=((164690.0, 634068.0), 80, E, 0.3, 'שד\' יצחק הנשיא סמוך לרוגוזין (01:20) – מבט אל מתחם המגדלים', 'יצחק נשיא'),
   head=dict(v=300.0, prov=E, conf=0.3, pm=20, method='ציון דרך', src='מגדלי הדקל במרכז התמונה'), find=[
   F('תחבורה', 'bike_lane_blue', 'שביל אופניים צבוע כחול עם סימון לבן', conf=0.85),
   F('צמחייה', 'cypress_row', 'ברושים', count=2, conf=0.85),
   F('גדרות', 'wall_stone_clad', 'קיר אבן טבעית נמוך + גדר לבנה', conf=0.8),
   F('ריצוף', 'pavers_beige_square', 'מדרכה אבן משתלבת בהירה', conf=0.8, color='#c9b9a0'),
   F('תאורה', 'lamp_led_white', 'פנסי LED לבנים גבוהים', count=3, conf=0.75),
   F('בניינים', 'tower_highrise', 'מתחם מגדלי הדקל – 3 מגדלים נראים', count=3, conf=0.85, floors_est='~29')]),
 '031': dict(style=('קרוב למגדל', N, 0.7), q='בינונית', pos=(JCT_ROG_HAN, 30, E, 0.35, 'סמוך לצומת רוגוזין × יצחק הנשיא (01:21, כמו 032)', 'רוגוזין'),
   head='moon', find=[
   F('שמיים', 'moon', 'ירח בין העננים – מצפן', conf=0.95),
   F('זמני', 'crane_tower', 'זרוע עגורן ומגדל בבנייה בזווית חדה כלפי מעלה', count=1, conf=0.9)]),
 '032': dict(style=('רחוב מגורים חדש', N, 0.6), q='טובה', pos=(JCT_ROG_HAN, 15, O, 0.6, 'שלט "רח\' רוגוזין" בצומת עם יצחק הנשיא (033) – עוגן', 'רוגוזין'),
   head='moon', find=[
   F('תחבורה', 'street_name_sign_old', 'שלט רחוב בסגנון ישן: לבן עם מסגרת אפורה, "רח\' רוגוזין" / ROGOZIN ST', count=1, conf=0.95, color='#f4f4f0'),
   F('שמיים', 'moon', 'ירח – מצפן', conf=0.95),
   F('זמני', 'construction_hoarding_render', 'גדר אתר עם הדמיה של 5 מגדלים מול הים – מצב עתידי (שכבת "עתיד" ב-4D)', conf=0.85),
   F('זמני', 'crane_tower', 'עגורן צריח כתום', count=1, conf=0.95),
   F('בניינים', 'tower_highrise', 'מגדלי הדקל ברקע ימין', count=2, conf=0.85),
   F('צמחייה', 'hedge', 'גדר חיה נמוכה', conf=0.8),
   F('ריצוף', 'slabs_light_grey', 'מדרכה לוחות בהירים', conf=0.7, color='#cfc8bd'),
   F('תאורה', 'lamp_curved_led', 'פנסים מעוקלים לבנים בהמשך', count=3, conf=0.7)]),
 '033': dict(style=('שדרה עירונית ותיקה', N, 0.6), q='טובה', pos=(JCT_ROG_HAN, 15, O, 0.6, 'שלט "שד\' יצחק הנשיא" בצומת עם רוגוזין', 'יצחק נשיא'), head=None, find=[
   F('תחבורה', 'street_name_sign_old', 'שלט רחוב ישן לבן: "שד\' יצחק הנשיא" / YIZHAK HANASI SED', count=1, conf=0.95, color='#f4f4f0'),
   F('ריהוט רחוב', 'hv_lattice_pole', 'עמוד מתח גבוה מסבכי פלדה עם מבדדים – תשתית שחסרה בעולם', count=1, conf=0.9),
   F('ריהוט רחוב', 'electrical_cabinet', 'ארון חשמל מתכת על בסיס/מעטפת לבנים', count=1, conf=0.85),
   F('ריצוף', 'slabs_light_grey', 'מדרכה לוחות בהירים', conf=0.7, color='#cfc8bd')]),
 '034': dict(style=('שדרה עירונית ותיקה', N, 0.85), q='טובה', pos=(JCT_ROG_HAN, 20, O, 0.55, 'ליד 033, מבט לאורך יצחק הנשיא', 'יצחק נשיא'),
   head=dict(v=110.0, prov=E, conf=0.3, pm=25, method='כיוון רחוב', src='לאורך יצחק הנשיא מזרחה (~113°) או מערבה – לא הוכרע; לפי צל וחזיתות משוער מזרחה'), find=[
   F('תאורה', 'lamp_ornate_red_double', 'עמודי תאורה אדומים, ראש כפול – כמו 018/019', count=5, conf=0.85),
   F('גדרות', 'rail_red_median', 'מעקה אדום על אי התנועה', conf=0.85),
   F('צמחייה', 'tree_pine', 'עץ מחטני (אורן?) גבוה במדרכה', count=1, prov=E, conf=0.5),
   F('ריהוט רחוב', 'ped_barrier_blue_white', 'מחסום הולכי רגל כחול מתפתל', count=1, conf=0.85),
   F('ריהוט רחוב', 'hv_lattice_pole', 'עמוד מתח גבוה (אותו מ-033)', count=1, conf=0.85),
   F('ריהוט רחוב', 'electrical_cabinet', 'ארון חשמל', count=1, conf=0.8),
   F('ריהוט רחוב', 'manhole', 'מכסה שוחה', count=2, conf=0.85),
   F('בניינים', 'block_mid_rise_commercial', 'בלוקים 4–8 קומות עם חנויות', conf=0.8)]),
 '035': dict(style=('שדרה עירונית ותיקה', N, 0.6), q='טובה – בוהק', pos=(JCT_DEKEL_ROG, 15, O, 0.6, 'שני שלטים כחולים בצומת הדקל × רוגוזין', 'רוגוזין'), head=None, find=[
   F('תחבורה', 'street_name_sign', 'שני שלטי רחוב בסגנון חדש (כחול, מסגרת לבנה) – הדקל ורוגוזין: סגנון השלט משתנה לפי קטע, לא לפי רחוב', count=2, conf=0.9, color='#1f4fa0'),
   F('תחבורה', 'tactile_paving', 'מסלול מנחה מישושי (אריחים מחורצים) אל מעבר החצייה', conf=0.85),
   F('תחבורה', 'crosswalk_zebra', 'מעבר חצייה', count=2, conf=0.9),
   F('אבני שפה', 'curb_red_white', 'שפה מעוגלת אדום-לבן בפינה', conf=0.9),
   F('צמחייה', 'tree_ficus', 'פיקוס בוגר בתוך המדרכה', count=2, prov=E, conf=0.6),
   F('תאורה', 'lamp_ornate_red_double', 'עמודי תאורה אדומים כפולים', count=3, conf=0.8),
   F('גדרות', 'rail_red_median', 'מעקה אדום', conf=0.75),
   F('ריהוט רחוב', 'fire_hydrant_red', 'ברז כיבוי אדום', count=1, conf=0.85),
   F('ריהוט רחוב', 'bin_street', 'פח רחוב', count=1, conf=0.85),
   F('ריהוט רחוב', 'pole_wood_utility', 'עמוד עץ לכבלים', count=1, conf=0.8),
   F('בניינים', 'block_mid_rise_commercial', 'בלוק 8 קומות, חזית מסחרית מוארת', conf=0.8)]),
}


INDOOR = {'022', '023', '024', '025'}   # פנים חנות (תבנית "חנות נכנסת": 022 מעבר, 023–024 מקרר, 025 קופה) – לא לכללי הרחוב; אנשים חלקית (בלי פנים)
NON_STREET = {'כניסה לחנות', 'קרוב למגדל', 'פנים – לא בשימוש'}

def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

def build(photos_dir, tiles_dir, measure):
    out = {'v': 1, 'frame': {'sample_to_itm': list(SAMPLE_TO_ITM), 'crs': 'EPSG:2039 (מסגרת דגימה + היסט)'}, 'generated': '2026-11-23', 'photos': []}
    from PIL import Image
    moon = measure['moon']
    for f in sorted(x for x in os.listdir(photos_dir) if x.endswith('.jpg')):
        pid = f[:3]; c = CUR.get(pid)
        W, H = Image.open(os.path.join(photos_dir, f)).size; portrait = H > W
        hh, mm = f[13:15], f[15:17]
        ph = {'id': pid, 'file': f, 'sha256': sha(os.path.join(photos_dir, f)), 'time_local': f'2026-11-23T{hh}:{mm}+02:00',
              'orientation': 'לאורך' if portrait else 'לרוחב',
              'fov_h': {'v': FOV(portrait), 'prov': E, 'conf': 0.5, 'src': 'אין EXIF; מצלמה ראשית ~26 מ"מ שקול'},
              'privacy': {'plates_visible': pid in ('001', '003', '005', '007', '011', '015', '016', '017'), 'plates_recorded': False, 'private_names_recorded': False, 'faces': False}}
        if pid in INDOOR:
            ph.update({'pos': {'x': None, 'y': None, 'r_m': 0, 'prov': E, 'conf': 0, 'src': 'צילום פנים (מכולת 24/7 בבסיס המגדל של 020) – לא ממוקם; תבנית חנות: ' + {'022': 'מעבר', '023': 'מקרר', '024': 'מקרר', '025': 'קופה'}[pid], 'street': None, 'itm': None, 'wgs84': None},
                       'heading': {'v': None, 'prov': E, 'conf': 0, 'method': 'לא ידוע'}, 'pitch': {'v': None, 'prov': E, 'conf': 0},
                       'style_class': {'v': 'פנים – לא בשימוש', 'prov': N, 'conf': 0.95}, 'quality': {'he': 'טובה, פנים'}, 'findings': [], 'status': 'excluded_indoor'})
            ph['privacy']['persons_partial'] = True
            out['photos'].append(ph); continue
        if c is None:   # תמונה חדשה בלי צפייה ידנית → שלד (stub)
            ph.update({'pos': {'x': None, 'y': None, 'r_m': 0, 'prov': E, 'conf': 0, 'src': 'ממתין לניתוח', 'street': None, 'itm': None, 'wgs84': None},
                       'heading': {'v': None, 'prov': E, 'conf': 0, 'method': 'לא ידוע'}, 'pitch': {'v': None, 'prov': E, 'conf': 0},
                       'style_class': {'v': None, 'prov': E, 'conf': 0}, 'quality': {'he': 'ממתין'}, 'findings': [], 'status': 'stub'})
            out['photos'].append(ph); continue
        # מיקום
        p = None
        if c['pos'] == 'resect008':
            p, r_m, pv, cf, src, st = resect008(measure)
        else:
            (p, r_m, pv, cf, src, st) = c['pos']
        if p is None:
            ph['pos'] = {'x': None, 'y': None, 'r_m': 0, 'prov': pv, 'conf': cf, 'src': src, 'street': st, 'itm': None, 'wgs84': None}
        else:
          ph['pos'] = {'x': round(p[0], 1), 'y': round(p[1], 1), 'r_m': r_m, 'prov': pv, 'conf': cf, 'src': src, 'street': st, 'itm': to_itm(*p), 'wgs84': to_wgs84(*p)}
        # כיוון
        hd = c['head']
        if hd == 'moon':
            m = moon[pid]; ref = m['ref']
            ph['heading'] = {'v': m['heading_deg'], 'prov': O, 'conf': 0.8, 'pm': 4.0, 'method': 'גרם שמיים',
                             'src': f"ירח az {ref['az']}° alt {ref['alt']}° ({ref['utc']}, sky.js) בפיקסל u={m['u']}, v={m['v']}; ±4° מהנחת שדה ראייה וגלגול"}
            ph['pitch'] = {'v': m['pitch_deg'], 'prov': O, 'conf': 0.7, 'pm': 3.0, 'src': 'מגובה הירח בתמונה'}
        elif hd is None:
            ph['heading'] = {'v': None, 'prov': E, 'conf': 0.0, 'method': 'לא ידוע', 'src': 'אין שלט/גרם שמיים/ציר רחוב מזוהה'}
            ph['pitch'] = {'v': None, 'prov': E, 'conf': 0.0}
        else:
            ph['heading'] = dict(hd); ph['pitch'] = {'v': None, 'prov': E, 'conf': 0.0}
        if pid == '032' and ph['heading']['v'] is not None:   # בדיקה צולבת: כיוון המגדל בתמונה מול המפה
            obs_b = pixel_dir(0.85, 0.45, True, ph['heading']['v'], ph['pitch']['v'])[0]; pred = az(p, TOWER_A)
            ph['heading']['check'] = {'he': 'מגדל w1280878706: נצפה מול צפוי מהמפה', 'observed_deg': round(obs_b, 1), 'predicted_deg': round(pred, 1), 'residual_deg': round(angdiff(obs_b, pred), 1)}
        s = c['style']; ph['style_class'] = {'v': s[0], 'prov': s[1], 'conf': s[2]}
        ph['quality'] = {'he': c['q']}; ph['findings'] = c['find']; ph['status'] = 'analyzed'
        out['photos'].append(ph)
    return out

def FOV(portrait):
    from geo import FOV_LONG, FOV_SHORT
    return FOV_SHORT if portrait else FOV_LONG

def resect008(measure):
    """008: כיוון מהירח; מיקום לאורך הארז מכיוון המגדל A (u≈0.46 בתמונה). המגדל השני לא מתאים (8–9°) → כנראה מגדל שחסר במפה."""
    m = measure['moon']['008']
    bA = pixel_dir(0.46, 0.50, True, m['heading_deg'], m['pitch_deg'])[0]
    L = math.hypot(HAEREZ_N[0] - HAEREZ_S[0], HAEREZ_N[1] - HAEREZ_S[1])
    best = min(((abs(angdiff(az(along(HAEREZ_S, HAEREZ_N, t), TOWER_A), bA)), t) for t in range(0, int(L) + 1)))
    p = along(HAEREZ_S, HAEREZ_N, best[1])
    clamp = ' – נחתך בקצה הקטע במפה: ייתכן שהרחוב ארוך יותר מהקטע ב-OSM' if best[1] >= int(L) else ''
    return p, 20, O, 0.4, f'שלט "הארז 3" + כיוון למגדל w1280878706 ({bA:.1f}°) → {best[1]} מ\' מקצה הדרומי של הארז (שארית {best[0]:.1f}°)' + clamp, 'הארז'

if __name__ == '__main__':
    pd, td, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    meas = json.load(open(os.path.join(os.path.dirname(outp), '..', 'data_measure.json') if len(sys.argv) < 5 else sys.argv[4], encoding='utf-8'))
    o = build(pd, td, meas)
    json.dump(o, open(outp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(o['photos']), 'photos;', sum(1 for p in o['photos'] if p.get('status') == 'stub'), 'stubs;', sum(len(p['findings']) for p in o['photos']), 'findings')
