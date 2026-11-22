"""Reference zmanim from python `zmanim` 0.3.1 (port of KosherJava, NOAA algorithm) + Hebrew-calendar refs
(convertdate 2.5.1, zmanim JewishDate molad). Output ref/zmanim_refs.json, ref/hebrew_refs.json."""
import json, random, os, datetime as dt
from dateutil import tz
from zmanim.zmanim_calendar import ZmanimCalendar
from zmanim.util.geo_location import GeoLocation
from zmanim.hebrew_calendar.jewish_date import JewishDate
from convertdate import hebrew as CH
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACES = {'ashdod': (31.7995, 34.647, 30.0), 'jerusalem': (31.7781, 35.2354, 740.0), 'sinai': (28.5394, 33.9750, 2285.0)}
Z = tz.gettz('Asia/Jerusalem'); random.seed(27)
def ts(x): return None if x is None else x.timestamp()
out = []
for i in range(40):
    day = dt.date(1950, 1, 1) + dt.timedelta(days=random.randint(0, 365 * 150))
    for pk, (lat, lon, el) in PLACES.items():
        for use_el in (False, True):
            zc = ZmanimCalendar(geo_location=GeoLocation(pk, lat, lon, Z, elevation=el), date=day); zc.use_elevation = use_el
            a161, t161 = zc.alos({'degrees': 16.1}), zc.tzais({'degrees': 16.1})
            r = {'date': day.isoformat(), 'place': pk, 'lat': lat, 'lon': lon, 'elev': el, 'useElevation': use_el,
                 'alos16_1': ts(a161), 'alos72': ts(zc.alos_72()), 'misheyakir11_5': ts(zc.alos({'degrees': 11.5})), 'misheyakir11': ts(zc.alos({'degrees': 11})),
                 'misheyakir10_2': ts(zc.alos({'degrees': 10.2})), 'sunrise': ts(zc.hanetz()), 'sunset': ts(zc.shkia()),
                 'sofZmanShmaGRA': ts(zc.sof_zman_shma_gra()), 'sofZmanShmaMGA72': ts(zc.sof_zman_shma_mga()),
                 'sofZmanTfilaGRA': ts(zc.sof_zman_tfila_gra()), 'sofZmanTfilaMGA72': ts(zc.sof_zman_tfila_mga()),
                 'sofZmanShmaMGA16_1': ts(zc.sof_zman_shma(a161, t161)), 'sofZmanTfilaMGA16_1': ts(zc.sof_zman_tfila(a161, t161)),
                 'chatzosHalfDay': ts(zc.chatzos()), 'minchaGedola': ts(zc.mincha_gedola()), 'minchaKetana': ts(zc.mincha_ketana()),
                 'plagHamincha': ts(zc.plag_hamincha()), 'tzeis8_5': ts(zc.tzais()), 'tzeis16_1': ts(t161), 'tzeisRT72': ts(zc.tzais_72())}
            out.append(r)
json.dump({'generated': 'tools/make_zmanim_refs.py, python zmanim 0.3.1 (KosherJava port)', 'rows': out}, open(os.path.join(ROOT, 'ref/zmanim_refs.json'), 'w'))
# Hebrew calendar
H = []
for i in range(400):
    jd = random.uniform(347998.5, 2816787.5)   # ~ AM 1 .. CE 3000
    jd = int(jd) + 0.5
    y, m, d = CH.from_jd(jd)
    H.append({'jd': jd, 'y': y, 'm': m, 'd': d})
M = []
for i in range(200):
    y = random.randint(3762, 6500); jdate = JewishDate(y, 7, 1)
    mo = random.choice(list(range(1, 13 + (1 if jdate.is_jewish_leap_year() else 0))))
    mol = jdate.molad(mo, y)
    M.append({'y': y, 'm': mo, 'greg': mol.gregorian_date.isoformat(), 'h': mol.molad_hours, 'min': mol.molad_minutes, 'ch': mol.molad_chalakim})
json.dump({'generated': 'convertdate %s hebrew.from_jd; zmanim JewishDate.molad' % '2.5.1', 'dates': H, 'molad': M}, open(os.path.join(ROOT, 'ref/hebrew_refs.json'), 'w'))
print(len(out), 'zmanim rows,', len(H), 'hebrew dates,', len(M), 'molads')
