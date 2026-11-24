# -*- coding: utf-8 -*-
"""Build ashdod_public_facts.{csv,json}, images_catalog.csv and ashdod_reference_public_additions.json.

Every number below was read from the cited public page on 2026-11-23 (WebFetch summaries).
Nothing is derived: if a source did not state it, the field is None.
Run:  python3 -I build_public_facts.py
"""
import csv, json, math, os, gzip, glob

OUT = os.path.dirname(os.path.abspath(__file__))
TILES = "/home/claude/codesandbox-template-nuxt/twin/pipeline/sample-out-ashdod/tiles/v"
import sys
sys.path.insert(0, os.path.join(OUT, "..", "pipeline"))
from frame import SAMPLE_TO_ITM  # noqa: E402
DX, DY = SAMPLE_TO_ITM          # sample -> real ITM (twin/pipeline/frame.py)
HAEREZ_SAMPLE = (164751.4, 634164.4)   # centroid of OSM street 'הארז' in the sample tiles
HAEREZ_ITM = (round(HAEREZ_SAMPLE[0] + DX, 1), round(HAEREZ_SAMPLE[1] + DY, 1))

try:
    from pyproj import Transformer
    _T = Transformer.from_crs("EPSG:2039", "EPSG:4326", always_xy=True)
    def itm2ll(x, y):
        lon, lat = _T.transform(x, y); return round(lat, 6), round(lon, 6)
except Exception:  # pragma: no cover
    def itm2ll(x, y): return None, None

# ---- road geometry from the sample tiles (for the distance-from-HaErez column) ----
ROADS = {}
for f in glob.glob(os.path.join(TILES, "*.json.gz")):
    d = json.load(gzip.open(f)); ox, oy = d["o"]
    for r in d.get("rd", []):
        n = r.get("n")
        if not n: continue
        px, py = ox, oy; pts = []
        rr = r["r"]
        for i in range(0, len(rr), 2):
            px += rr[i] / 10; py += rr[i + 1] / 10; pts.append((px + DX, py + DY))
        ROADS.setdefault(n, []).extend(pts)

def street_dist(name):
    pts = ROADS.get(name)
    if not pts: return None
    return round(min(math.hypot(x - HAEREZ_ITM[0], y - HAEREZ_ITM[1]) for x, y in pts))

NC = "https://www.nadlancenter.co.il/article/"
LAND = "https://apps.land.gov.il/IturTabotData/takanonim/jerus/"
Y2 = "https://www.yad2.co.il/realestate/item/"

# fields: street(OSM name for matching), address, quarter, n_buildings, floors, floors_max(range), units,
# height_m, era, year_built, pillars, materials, status, use, itm, url, url2, stype, where, rel, notes
R = []
def add(**k): R.append(k)

# ======================= HaErez area (Rova Alef, <~600 m) =======================
add(name="מגדלי הדקל (5 מגדלים, נחמיאס)", street="הדקל", address="הדקל 7, 9, 11, 13, 15", quarter="רובע א'",
    n_buildings=5, floors=29, units=846, status="3 occupied, 2 under construction (yad2 project page)",
    use="residential", url="https://www.mako.co.il/news-business/realestate/Article-082962017640a81027.htm",
    url2="https://www.yad2.co.il/yad1/project/18100", stype="news+developer_listing",
    where="mako 20.8.2023 list 'מתחם הדקל': 5 towers of 29 floors, 846 units; yad2 project 18100: addresses הדקל 7-15, רובע א'",
    rel="medium", notes="yad2 listing 4dga32ey (רובע א', הדקל) shows 'קומה 16 מתוך 29' - agrees. Replaced 9 old buildings (150 units per mako, 180 per nadlancenter/7731). Which address is which tower: unknown. OSM footprints along הדקל in the sample are small (~130-690 m2, rule floors=4) - may be stale pre-demolition blocks; verify with fresh imagery.")
add(name="9 בנייני שיכון ישנים במתחם הדקל (נהרסו)", street="הדקל", address="מתחם הדקל, ציר יצחק הנשיא", quarter="רובע א'",
    n_buildings=9, units=150, status="demolished", use="residential",
    url="https://www.mako.co.il/news-business/realestate/Article-082962017640a81027.htm", url2=NC + "7731",
    stype="news", where="mako: 150 apts in 9 buildings evacuated; nadlancenter 7731 table: 9 buildings, 180 units",
    rel="low", notes="units conflict 150 vs 180; floors not stated. Historical only - do NOT use as current height truth.")
add(name="מתחם הנשיא / הרצל-סיני (אביסרור) - מבנים קיימים", street="יצחק נשיא", address="לאורך יצחק הנשיא ושד' הרצל, בין סיני לקדש", quarter="רובע א'",
    n_buildings=14, floors=2, floors_max=4, units=258, status="built, approved for demolition (Jan 2026)", use="residential",
    url=NC + "13711", url2=NC + "10360", stype="news",
    where="13711 (15.1.2026): 14 buildings of 2-4 floors, 258 units; 10360 (4.8.2024): 11 'linear and square' buildings, 186 units between Sinai and Kadesh",
    rel="medium", notes="floor range applies to the group of 14, not to a specific building. 186 (11 bldgs, 10360) + 72 (3 bldgs Herzl 22-26, mako) = 258 / 14 - consistent (our inference). Proposed: 14 buildings of 7-32 floors, ~1,140 units.")
add(name="3 מבני רכבת, שד' הרצל 22, 24, 26", street="שדרות הרצל", address="שדרות הרצל 22, 24, 26", quarter="רובע א'",
    n_buildings=3, units=72, status="built (planning stage for renewal in 2023)", use="residential",
    url="https://www.mako.co.il/news-business/realestate/Article-082962017640a81027.htm", url2=NC + "13711",
    stype="news", where="mako 'מתחם הרצל': 72 apts in 3 railway buildings at Herzl 22, 24, 26",
    rel="medium", notes="floors not stated in mako; if these are part of the 14-building Avisror compound (our inference) they are 2-4 floors -> floors left null, see notes. Proposed: 2 towers of 30 fl + 7-fl midrise.")
add(name="מרכז רובע א' - 2 מבני רכבת (מרכז א')", street="רוגוזין", address="בין הראשונים, רוגוזין ושבי ציון (דרום התוכנית)", quarter="רובע א'",
    n_buildings=2, units=30, status="built, plan for renewal (Raviv)", use="residential+12 shops",
    url="https://www.calcalist.co.il/real-estate/article/bkqluskwyg", url2=NC + "6054", stype="news",
    where="calcalist 30.10.2024: two railway-type buildings in the south of the plan, 30 apts + 12 shops; nadlancenter 6054: 30 units in two blocks",
    rel="medium", notes="floors not stated. Proposed 2 towers (20/30 fl conflict) + 4 buildings 7-31 fl (mako).")
add(name="מרכז הקניות רובע א' - חנויות חד-קומתיות", street="רוגוזין", address="כיכר הפועלים / רוגוזין, מרכז רובע א'", quarter="רובע א'",
    n_buildings=None, floors=1, units=None, status="built", use="commercial (~250 shops)",
    url="https://www.calcalist.co.il/real-estate/article/bkqluskwyg", url2="https://download.osmand.net/wiki/Category:Rova_Alef_commercial_center",
    stype="news+commons_category", where="calcalist: commercial centre of ~250 single-storey shops; Commons category: planned by Ram Karmi, Dov Karmi, Zvi Meltzer",
    rel="medium", notes="height_m not stated; floors=1 for the shop wings only.")
add(name="מרכז רובע א' - בניין משרדים + בניין מגורים לשימור", street="רוגוזין", address="מרכז רובע א' (צפון תוכנית מרכז א')", quarter="רובע א'",
    n_buildings=2, floors=3, status="built, designated for preservation", use="office + residential",
    url="https://www.calcalist.co.il/real-estate/article/bkqluskwyg", stype="news",
    where="calcalist: office and residential buildings in the centre are three storeys, slated for preservation",
    rel="medium", notes="exact footprints unknown - match only with imagery/OSM name.")
add(name="האצ\"ל 11 - מבנה מסוכן", street="האצ\"ל", address="האצ\"ל 11", quarter="רובע א'", n_buildings=1, floors=7, units=28,
    status="built, declared dangerous; renewal deposited Sep 2026", use="residential", url=NC + "15393", stype="news",
    where="nadlancenter 15.9.2026: existing 7 floors, 28 apts (proposed 21 fl + ground + roof, 121 apts)", rel="high",
    notes="single building, exact address - good eval row.")
add(name="האצ\"ל 3", street="האצ\"ל", address="האצ\"ל 3", quarter="רובע א'", n_buildings=1, floors=7,
    status="built; TAMA renovation completed 2022 (per listing)", use="residential", url=Y2 + "rnx7teln", stype="real_estate_listing",
    where="listing: 'קומה 7 מתוך 7', penthouse, elevator", rel="medium", notes="floor count after TAMA additions.")
add(name="רוגוזין 17", street="רוגוזין", address="רוגוזין 17", quarter="רובע א'", n_buildings=1, floors=8,
    status="built", use="residential", url=Y2 + "5zz3269h", stype="real_estate_listing",
    where="listing: 'קומה 3 מתוך 8', elevator", rel="medium", notes="")
add(name="הטיילת 5", street="הטיילת", address="הטיילת 5", quarter="רובע א'", n_buildings=1, floors=13, status="built",
    use="residential", url=Y2 + "s394njs8", stype="real_estate_listing", where="listing: 'קומה 8 מתוך 13', elevator", rel="medium", notes="")
add(name="בניין ברח' קדושי בלזן (מספר לא צוין)", street="קדושי בלזן", address="קדושי בלזן (ללא מספר)", quarter="רובע א'", n_buildings=1, floors=7,
    status="built", use="residential", url=Y2 + "xxwvb34j", stype="real_estate_listing", where="listing: 'קומה 3 מתוך 7'", rel="low",
    notes="no house number - street-level hint only.")
add(name="בניין ברח' חיבת ציון (מספר לא צוין)", street="חיבת ציון", address="חיבת ציון (ללא מספר)", quarter="רובע א'", n_buildings=1, floors=9,
    status="built", use="residential", url=Y2 + "kwqud99z", stype="real_estate_listing", where="listing: 'קומה 3 מתוך 9', 2 elevators", rel="low",
    notes="no house number.")
add(name="בניין ברח' שבי ציון (מספר לא צוין)", street="שבי ציון", address="שבי ציון (ללא מספר)", quarter="רובע א'", n_buildings=1, floors=6,
    status="built", use="residential", url=Y2 + "hm6us2rr", stype="real_estate_listing", where="listing: ground floor of 6, elevator", rel="low",
    notes="no house number.")
add(name="בניין באזור האשכול (מספר לא צוין)", street="האשכול", address="האשכול (ללא מספר)", quarter="רובע א'", n_buildings=1, floors=7,
    status="built", use="residential", url=Y2 + "5Uwhcb", stype="real_estate_listing", where="listing: ground of 7 floors, elevator", rel="low",
    notes="listing gives neighbourhood 'האשכול' - may be the sub-area name, not the street.")
add(name="שב\"צ הראשונים 37 (בית כנסת)", street="הראשונים", address="הראשונים 37-39", quarter="רובע א'", n_buildings=None,
    status="built (synagogue on site)", use="public/religious", itm=(166495, 634845), url=LAND + "1052944.pdf", stype="plan_takanon",
    where="plan 603-0817338 §1 (location, ITM X166495 Y634845; synagogue)", rel="low",
    notes="floors/height table unreadable in extraction -> null. Useful as a georeferenced point 230 m from הארז.")
add(name="מתחם צפון האצטדיון (7 בניינים)", street="ז'בוטינסקי", address="ז'בוטינסקי 18-30, ההסתדרות 4-10, הראשונים 3-7", quarter="רובע א'",
    n_buildings=7, units=124, status="built, detailed planning (2023)", use="residential", itm=(166798, 635432),
    url="https://www.mako.co.il/news-business/realestate/Article-082962017640a81027.htm", url2=LAND + "1051427.pdf",
    stype="news+plan_takanon", where="mako: 124 apts in 7 buildings; plan 603-0346031 §1.5 addresses + ITM X166798 Y635432 (plan centre)",
    rel="medium", notes="~730 m from הארז. Floors not stated. Plan 603-0346031 also preserves 'first labour bureau' building (parcel 6). Proposed 4 towers, 661 units.")
add(name="קדושי בלזן 21", street="קדושי בלזן", address="קדושי בלזן 21 (פינת אבא הלל סילבר)", quarter="רובע א'", n_buildings=1,
    status="existing building marked for demolition", use="residential", itm=(166425, 635634), url=LAND + "1053057.pdf", stype="plan_takanon",
    where="plan 603-0394320 §1 (address, ITM); existing building floors not stated", rel="low",
    notes="proposed 10-12 fl (conflict). Only the coordinate is solid.")
add(name="מתחם אח\"י אילת", street="אח\"י אילת", address="אח\"י אילת", quarter=None, n_buildings=None, units=123,
    status="built, renewal approved by municipality", use="residential", url=NC + "7731", stype="news",
    where="nadlancenter 7731 table: 123 existing units (Y.H. Dimri)", rel="low", notes="floors not stated; quarter not stated.")

# ======================= Rest of Ashdod (low-rise priority) =======================
add(name="5 בנייני מגורים בני 4 קומות, בין הרב שאולי לשד' הרצל", street="הרב שאולי", address="בין הרב שאולי לשד' הרצל", quarter="רובע ד'",
    n_buildings=5, floors=4, units=40, status="built, plan approved Oct 2025", use="residential", url=NC + "13115", stype="news",
    where="nadlancenter 27.10.2025: five residential buildings of four floors, 40 units", rel="high",
    notes="exact house numbers not given; proposed 35-fl tower + 6-fl buildings.")
add(name="מתחם הרב שאולי 19-29 (6 בניינים, נהרסו 2020)", street="הרב שאולי", address="הרב שאולי 19-29", quarter="רובע ד'",
    n_buildings=6, units=152, era="1970s", status="demolished Oct 2020; replaced by 4x5-fl + 4x33-fl (Dimri)", use="residential",
    url=NC + "3090", stype="news", where="nadlancenter 27.10.2020: six buildings, 152 units, built in the 1970s; works began",
    rel="medium", notes="historical. New: four 5-storey buildings and four 33-storey towers (684 units) - use for new-build heights once complete.")
add(name="מתחם אבן עזרא - בניינים קיימים", street="אבן עזרא", address="אבן עזרא 27,29,31,33,35; אליאשוילי 2,4א,4ב,6; ביאליק 43", quarter="רובע ה'",
    n_buildings=None, floors=4, units=144, year_built=1972, era="permits 1972-1973", status="built; permit for renewal April 2022",
    use="residential", itm=(166650, 633700), url=LAND + "1015251.pdf", url2=NC + "7731", stype="plan_takanon+news",
    where="plan 603-0271296 §1.5.4 addresses, 144 approved units, permits 1972-73; nadlancenter 7731: 'several 4-storey buildings'",
    rel="medium", notes="overlaps ASH-017 in ashdod_reference (same group). Per-building floors from news only. Proposed 3 towers.")
add(name="מתחם נאות ספיר - 9 בנייני שיכון", street="שדרות הרצל", address="בין הרצל, שמואל הנגיד, נאות ספיר, הרב שלום שבזי", quarter="רובע ה'",
    n_buildings=9, floors=4, units=200, status="built, deposited June 2024", use="residential", url=NC + "10056", stype="news",
    where="nadlancenter 13.6.2024: 9 old shikun buildings of 4 floors, 200 apts", rel="high", notes="near Avraham Tzigel park")
add(name="מתחם הרב מימון-בורוכוב - 18 בניינים", street="הרב מימון", address="בין הרב מימון, בורוכוב, שד' הנשיא ויצמן, יצחק הנשיא", quarter="רובע ב'",
    n_buildings=18, floors=4, units=298, era="completed late 1960s", status="built, plan approved Dec 2025", use="residential",
    url=NC + "13396", url2=NC + "12178", stype="news",
    where="13396 (4.12.2025): 18 buildings, each 4 floors, built in city's early years, completed late 1960s; 12178: 18 shikun buildings, 298 units",
    rel="high", notes="9269 describes the same area as 'row buildings and 3-4 storey buildings' (318 units) - slight conflict, keep 4 as primary.")
add(name="מתחם תמ\"ל/2022 הרצל-המעפילים - 18 בניינים", street="המעפילים", address="בין המעפילים, יצחק הנשיא, שד' הרצל, ז'בוטינסקי", quarter="רובע ב'",
    n_buildings=18, units=488, status="built, approved Jul 2025", use="residential", url=NC + "11397", url2=NC + "12566", stype="news",
    where="11397: 18 residential buildings, 488 units; 12566: 18 old shikun blocks, 487 units", rel="medium", notes="floors not stated.")
add(name="מתחם הרותם-פלדות - 6 בניינים על עמודים", street="הרותם", address="הרותם/הנורית/מבוא השרביטן/שד' הפרחים", quarter="רובע ח'",
    n_buildings=6, floors=4, units=224, pillars="yes (על עמודים)", status="built, approved Mar 2023", use="residential",
    url=NC + "5542", url2="https://www.ynet.co.il/economy/article/s1noelxe2", stype="news",
    where="nadlancenter 19.4.2022: 224 units in 4-storey buildings on pillars (4 pairs + 3 triplets); ynet: six 4-storey buildings",
    rel="medium", notes="'4 pairs and 3 triplets' vs 'six buildings' - count depends on how joined blocks are counted.")
add(name="מתחם פלדות - בניין/ים 7 קומות (אסבסט)", street="הרותם", address="תת-מתחם פלדות, רובע ח'", quarter="רובע ח'",
    n_buildings=None, floors=7, units=84, pillars="yes (על עמודים)", materials="asbestos (per ynet)", status="built", use="residential",
    url="https://www.ynet.co.il/economy/article/s1noelxe2", url2=NC + "5542", stype="news",
    where="ynet 16.3.2023: one 7-storey asbestos building, 84 apts; nadlancenter: 3 buildings of 7 stories on pillars, 84 units",
    rel="medium", notes="building count conflict 1 vs 3 -> n_buildings null.")
add(name="מתחם בני ברית-ציזלינג - מבנים טוריים", street="שדרות בני ברית", address="צומת יצחק הנשיא/בני ברית", quarter="רובע ו'",
    n_buildings=None, units=192, era="1950s (article) - quarter built mid-1960s-1970s", status="built, deposit hearing Dec 2025", use="residential",
    url=NC + "13404", stype="news", where="nadlancenter 7.12.2025: 192 units in several row buildings built in the 1950s", rel="low",
    notes="floors not stated; era conflicts with the article's own quarter history.")
add(name="מתחם גאפונוב - 6 בניינים", street="דב גאפונוב", address="דב גאפונוב (בין יהודה הלוי, הרצל, ביאליק)", quarter="רובע ה'",
    n_buildings=6, units=168, status="built, deposit hearing Nov 2025", use="residential", url=NC + "13180", stype="news",
    where="nadlancenter 4.11.2025: six buildings, 168 units", rel="low", notes="floors not stated (headline quarter 'ה', body 'H').")
add(name="מתחם אחד העם - 2 בנייני שיכון", street="אחד העם", address="בין הרצל, שמואל הנגיד, אחד העם", quarter="רובע ה'",
    n_buildings=2, units=110, status="built, approved Jul 2025", use="residential", url=NC + "12399", url2=NC + "10803", stype="news",
    where="12399 / 10803: two old shikun buildings, 110 units", rel="low", notes="floors not stated; 55 units/building suggests long multi-entrance blocks.")
add(name="הרב אבן דנן 3, 7, 9", street="אבן דנן הרב א.", address="הרב אבן דנן 3, 7, 9", quarter="רובע ג'", n_buildings=3, floors=4,
    pillars="yes - 4 floors on pillars (above pillar level)", era="1970s", status="built", use="residential", itm=(167925, 633950),
    url=LAND + "1053623.pdf", stype="plan_takanon", where="plan 603-0774653 explanatory note: 3 buildings, 1970s, 4 residential floors on pillars, rail-type",
    rel="high", notes="exact addresses, one building per number - good eval rows (expand to 3 when matching). Units unreadable.")
add(name="רבי עקיבא 3,5,7 / האדמו\"ר מפיטסבורג 37,39 / חנה סנש 16", street="רבי עקיבא", address="רבי עקיבא 3,5,7; האדמו\"ר מפיטסבורג 37,39; חנה סנש 16",
    quarter="רובע ג'", n_buildings=None, floors=4, units=185, pillars="rights refer to 4 floors on pillars", status="built", use="residential",
    itm=(167926, 634120), url=LAND + "1053242.pdf", stype="plan_takanon",
    where="plan 603-1133461 rights: 4 floors on pillars; 168 units (plan 20/103) + 17 ground-floor units", rel="low",
    notes="4 floors is a plan-wide right, not confirmed per building -> low.")
add(name="שבט שמעון 6 - 3 בניינים", street="שבט שמעון", address="שבט שמעון 6 (מגרש 56)", quarter="רובע י\"ב", n_buildings=3, floors=9, units=108,
    status="built", use="residential", itm=(165460, 631982), url=LAND + "1052266.pdf", stype="plan_takanon",
    where="plan 603-0530170: 3 residential buildings, 9 floors each, 4 units/floor, 36 per building", rel="medium",
    notes="a garbled clause also says '3 floors' - 9 is consistent with 4 units x 9 = 36.")
add(name="צפת 1 פינת גבעת עדה", street="גבעת עדה", address="צפת 1 / גבעת עדה", quarter="רובע ט'", n_buildings=None, floors=11,
    status="built (11 floors above entrance as built; plan legalises)", use="residential + ground-floor clinics", itm=(167795, 632428),
    url=LAND + "1052869.pdf", stype="plan_takanon", where="plan 603-0451054: approved 9 floors, built 11 above entrance", rel="medium",
    notes="17.5 m in table may be the office row only -> height_m left null.")
add(name="הר ציון 19 - 2 בתים צמודי קרקע", street="הר ציון", address="הר ציון 19", quarter="רובע י\"א", n_buildings=None, floors=1, height_m=6.5,
    units=2, status="built", use="residential (detached)", itm=(164775, 632625), url=LAND + "1053730.pdf", stype="plan_takanon",
    where="plan 603-0933408: existing 1 full floor + partial floor, height 6.5 m, 2 detached units", rel="medium",
    notes="floors=1 means 1 full floor + partial; 6.5 m is the approved height (מצב מאושר), as-built may differ.")
add(name="הר ציון 36 - בית צמוד קרקע", street="הר ציון", address="הר ציון 36", quarter="רובע י\"א", n_buildings=1, floors=1, units=1,
    status="built (marked for demolition in plan)", use="residential (detached)", itm=(164725, 632400), url=LAND + "1053479.pdf"
    .replace("takanonim/", "takanonim-h/"), stype="plan_takanon",
    where="plan 603-0732271: one full floor + partial floor, 1 unit; surroundings mostly 2-storey detached/semi-detached", rel="medium",
    notes="approved height 6.5 m before change (from plan's change summary) - not stored as as-built.")
add(name="אופל 31 - בית ארבע-משפחתי", street="אופל", address="אופל 31", quarter="רובע י\"ז", n_buildings=1, units=4, status="built",
    use="residential", itm=(164539, 630817), url=LAND + "1051790.pdf", stype="plan_takanon",
    where="plan 603-0560102: four-family building, plan allows up to 3 floors", rel="low", notes="actual floors not stated -> null.")
add(name="אופל, מגרש 40 - בית קיים", street="אופל", address="אופל (מגרש 40)", quarter="רובע י\"ז", n_buildings=1, floors=2, units=1,
    status="built", use="residential", itm=(164602, 630797), url="https://apps.land.gov.il/IturTabotData/takanonim-h/jerus/1051846.pdf",
    stype="plan_takanon", where="plan 603-0538140: 1 existing unit; one building of 2 floors (sentence partly garbled)", rel="low", notes="")
add(name="הרקפת 16 - בית צמוד קרקע", street="הרקפת", address="הרקפת 16", quarter="רובע ח'", n_buildings=1, units=1, era="1990s",
    status="built", use="residential (detached, ~400 m2)", itm=(167400, 632675), url=LAND + "1052763.pdf", stype="plan_takanon",
    where="plan 603-0555276 explanatory note: single house built ~1990s, ~400 m2", rel="low", notes="floors not stated.")
add(name="מעון סטודנטים - מרכזיית בזק לשעבר", street="נתן אלתרמן", address="נתן אלבז 38 פינת מיכשווילי (כך בתוכנית)", quarter="רובע ו'",
    n_buildings=1, floors=3, status="built", use="former telephone exchange", itm=(167067, 633395), url=LAND + "1053242.pdf"
    .replace("1053242", "1053242"), stype="plan_takanon",
    where="plan 603-0593087: existing 3 floors above basement", rel="medium",
    notes="DUPLICATE of ASH-016 (they wrote 'נתן אלתרמן 38'); the takanon summary says 'נתן אלבז 38' - check street name. URL: see notes2.",
    url_fix=LAND + "1053242.pdf")
add(name="מגורים ממזרח למגרש 18 רובע ט\"ו", street="שדרות מונטיפיורי", address="ממזרח למגרש 18 (מונטיפיורי/משה דיין/תל חי)", quarter="רובע ט\"ו",
    n_buildings=None, floors=9, status="built", use="residential", itm=(164425, 631125), url=LAND + "1053297.pdf", stype="plan_takanon",
    where="plan 603-0262121 explanatory note: residential buildings of 9 floors east of the plot", rel="low", notes="neighbour description, no address.")
add(name="מגורים מדרום לשד' תל חי (מול מגרש 18 רובע ט\"ו)", street="שדרות תל חי", address="מדרום לשד' תל חי, מול מגרש 18", quarter="רובע ט\"ו",
    n_buildings=None, floors=13, status="built", use="residential", itm=(164425, 631125), url=LAND + "1053297.pdf", stype="plan_takanon",
    where="plan 603-0262121 explanatory note: 13-floor residential buildings south across Tel Hai", rel="low", notes="neighbour description, no address.")
add(name="מגורים נמוכים ממזרח למתחם הקאנטרי רובע י\"ג", street="יצחק רבין", address="ממזרח למתחם הקאנטרי (יצחק רבין/המלך שלמה/בני ברית)", quarter="רובע י\"ג",
    n_buildings=None, floors=2, floors_max=3, status="built", use="residential", itm=(165875, 631372), url=LAND + "1052709.pdf", stype="plan_takanon",
    where="plan 603-0704098 explanatory note: low-rise 2-3 floors to the east; 5-8 floors to the west", rel="low", notes="")
add(name="מגורים ממערב למתחם הקאנטרי רובע י\"ג", street="שדרות בני ברית", address="ממערב למתחם הקאנטרי", quarter="רובע י\"ג",
    n_buildings=None, floors=5, floors_max=8, status="built", use="residential", itm=(165875, 631372), url=LAND + "1052709.pdf", stype="plan_takanon",
    where="plan 603-0704098 explanatory note: 5-8 floors to the west", rel="low", notes="")
add(name="אריה בן אליעזר 29", street="אריה בן אליעזר", address="אריה בן אליעזר 29", quarter="רובע ד'", n_buildings=1, floors=7, status="built",
    use="residential", url="https://www.yad2.co.il/realestate/item/south/18yh7rkt", stype="real_estate_listing",
    where="listing: ground floor of 7, elevator", rel="medium", notes="~460 m from הארז per street geometry (street is long).")
add(name="בניין ברובע ד' (מספר לא צוין)", street=None, address="רובע ד' (ללא רחוב)", quarter="רובע ד'", n_buildings=1, floors=5, status="built",
    use="residential", url=Y2 + "w2b207ve", stype="real_estate_listing", where="listing: 'קומה 4 מתוך 5'", rel="low", notes="no address - quarter-level stat only, use_in_eval 0.")
add(name="בניין ברובע י\"א (מספר לא צוין)", street=None, address="רובע י\"א (ללא רחוב)", quarter="רובע י\"א", n_buildings=1, floors=10, status="built",
    use="residential", url=Y2 + "eyrg49cd", stype="real_estate_listing", where="listing: 'קומה 2 מתוך 10'", rel="low", notes="no address.")
add(name="בניין בשכונת אפרסמון רובע ט\"ז", street="אפרסמון", address="אפרסמון (ללא מספר)", quarter="רובע ט\"ז", n_buildings=1, floors=17, status="built",
    use="residential", url="https://www.yad2.co.il/realestate/item/south/dc9c73gg", stype="real_estate_listing", where="listing: 'קומה 2 מתוך 17'", rel="low", notes="")
add(name="בניין ברח' שבט נפתלי רובע י\"ב", street="שבט נפתלי", address="שבט נפתלי (ללא מספר)", quarter="רובע י\"ב", n_buildings=1, floors=8, status="built",
    use="residential", url=Y2 + "jn7ei30s", stype="real_estate_listing", where="listing: 'קומה 1 מתוך 8'", rel="low", notes="")
add(name="בלפור 7 - בניין מגורים", street="בלפור", address="בלפור 7", quarter="רובע ה'", n_buildings=1, units=90, status="built", use="residential",
    itm=(166750, 634050), url=LAND + "1055486.pdf", stype="plan_takanon",
    where="plan 603-1179456: existing building 90 units; proposal adds a floor to reach 20 incl. technical", rel="low",
    notes="existing floors NOT stated (19 is only implied) -> null. Also part of 'לב אשדוד' plan 603-0236315.")

# ---- fix one url typo-guard, compute derived columns ----
for i, r in enumerate(R, 1):
    if r.get("url_fix"): r["url"] = r.pop("url_fix")
    if "1053242" in r["url"] and "אלבז" in (r.get("address") or ""):
        r["url"] = LAND + "1053242.pdf"
    r["ref_id"] = "PUB-%03d" % i
    r["street_min_dist_from_haerez_m"] = street_dist(r["street"]) if r.get("street") else None
    itm = r.get("itm")
    r["itm_x"], r["itm_y"] = (itm if itm else (None, None))
    r["lat"], r["lon"] = itm2ll(*itm) if itm else (None, None)
    f = r.get("floors")
    cls = lambda v: "1-2" if v <= 2 else "3-4" if v <= 4 else "5-9" if v <= 9 else "10-19" if v <= 19 else "20+"
    r["floor_class"] = None if f is None else (cls(f) if not r.get("floors_max") or cls(f) == cls(r["floors_max"]) else cls(f) + ".." + cls(r["floors_max"]))
    r["is_group"] = 1 if (r.get("n_buildings") or 1) > 1 or r.get("n_buildings") is None else 0
    r["haerez_area"] = 1 if (r["street_min_dist_from_haerez_m"] is not None and r["street_min_dist_from_haerez_m"] <= 600 and r.get("quarter") == "רובע א'") else 0
    r["license"] = "facts only (no text/images copied)"

# Plan 603-0593087 is file 1053242? -> no: the Bezeq plan was fetched as 1053242.pdf; Rabbi Akiva plan as 1055553.pdf. Fix:
for r in R:
    if r["name"].startswith("רבי עקיבא"): r["url"] = LAND + "1055553.pdf"
    if r["name"].startswith("מעון סטודנטים"): r["url"] = LAND + "1053242.pdf"; r["notes"] = r["notes"].replace(" URL: see notes2.", "")
    if r["name"].startswith("הר ציון 36"): r["url"] = "https://apps.land.gov.il/IturTabotData/takanonim-h/jerus/1053479.pdf"

COLS = ["ref_id", "name", "address", "street", "quarter", "haerez_area", "street_min_dist_from_haerez_m", "n_buildings", "is_group", "floors", "floors_max",
        "floor_class", "units", "height_m", "year_built", "era", "materials", "pillars", "status", "use", "itm_x", "itm_y", "lat", "lon",
        "url", "url2", "stype", "where", "license", "rel", "notes"]
with open(os.path.join(OUT, "ashdod_public_facts.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh); w.writerow(COLS)
    for r in R: w.writerow([r.get(c) for c in COLS])
json.dump({"version": 1, "built": "2026-11-23", "city": "ashdod",
           "haerez_itm_centroid": HAEREZ_ITM, "haerez_quarter": "רובע א' (see README for evidence)",
           "columns": COLS, "records": [{c: r.get(c) for c in COLS} for r in R]},
          open(os.path.join(OUT, "ashdod_public_facts.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---- merge-compatible additions for twin/groundtruth/ashdod_reference.json (separate file) ----
ref_cols = ["ref_id", "name", "name_alt", "address", "osm_way_id", "id_match_method", "match_note", "floors", "floors_alt", "height_m",
            "height_alt_m", "year_built", "status", "use", "lat", "lon", "source_url", "source_url_2", "reliability", "use_in_eval", "notes"]
add_recs = []
for r in R:
    if r.get("floors") is None and r.get("height_m") is None: continue
    if not r.get("street"): continue
    if r["status"] and ("demolished" in r["status"]): continue
    if r["name"].startswith("מעון סטודנטים"): continue  # duplicate of ASH-016
    if r["name"].startswith("מתחם אבן עזרא"): continue   # overlaps ASH-017
    add_recs.append({
        "ref_id": r["ref_id"], "name": r["name"], "name_alt": None, "address": r["address"] + (", " + r["quarter"] if r.get("quarter") else ""),
        "osm_way_id": None, "id_match_method": "none",
        "match_note": "match by addr:street=%s%s; group of %s" % (r.get("street"), "" if not r["is_group"] else " (group - apply to each named building only)", r.get("n_buildings")),
        "floors": r.get("floors"), "floors_alt": r.get("floors_max"), "height_m": r.get("height_m"), "height_alt_m": None,
        "year_built": r.get("year_built"), "status": "built", "use": r.get("use"), "lat": r["lat"], "lon": r["lon"],
        "source_url": r["url"], "source_url_2": r.get("url2"), "reliability": r["rel"], "use_in_eval": 0,
        "notes": "floors_alt here = upper bound of a stated range. " + (r.get("where") or "") + ". " + (r.get("notes") or "")})
json.dump({"version": 1, "built": "2026-11-23", "city": "ashdod", "note": "ADDITIONS ONLY - same columns as ashdod_reference.json; use_in_eval=0 until matched to osm_way_id",
           "columns": ref_cols, "records": add_recs},
          open(os.path.join(OUT, "ashdod_reference_public_additions.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print(len(R), "rows;", len(add_recs), "reference additions")
