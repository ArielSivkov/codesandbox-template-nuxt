"""Reference values for test/sky.test.mjs.  python3 tools/make_refs.py
ephem 4.2.1 (libastro, Elwood Downey / Brandon Rhodes) and skyfield + JPL DE421 (skyfield-data package; 1900–2050).
Geometric (no refraction: ephem pressure=0, skyfield altaz() without temperature)."""
import ephem, json, math, random, os, warnings
warnings.filterwarnings('ignore')
from skyfield.api import Loader, wgs84, Star
from skyfield_data import get_skyfield_data_path
L = Loader(get_skyfield_data_path()); ts = L.timescale(builtin=True); eph = L('de421.bsp')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACES = {'ashdod': (31.7995, 34.647, 0.0), 'jerusalem': (31.7781, 35.2354, 0.0)}
BODIES = [('Moon', ephem.Moon, 'moon'), ('Sun', ephem.Sun, 'sun'), ('Mercury', ephem.Mercury, 'mercury'), ('Venus', ephem.Venus, 'venus'),
          ('Mars', ephem.Mars, 'mars'), ('Jupiter', ephem.Jupiter, 'jupiter barycenter'), ('Saturn', ephem.Saturn, 'saturn barycenter')]
STARS = [line for line in open(os.path.join(ROOT, 'src/data/bsc300.js')) if line.startswith('[')]
STARS = [json.loads(l.strip().rstrip(',')) for l in STARS]
STAR_SEL = [s for s in STARS if s[0] in (2491, 5340, 7001, 424, 1708, 2943, 5056, 6134, 8728, 7557, 4534, 1790)]
random.seed(20261123)
def ephem_case(iso_ephem, lat, lon, elev):
    o = ephem.Observer(); o.lat = str(lat); o.lon = str(lon); o.elevation = elev; o.pressure = 0; o.date = iso_ephem
    out = {}
    for nm, cls, _ in BODIES:
        b = cls(); b.compute(o)
        out[nm] = {'az': math.degrees(b.az), 'alt': math.degrees(b.alt), 'ra': math.degrees(b.ra), 'dec': math.degrees(b.dec),
                   'phase': b.phase / 100.0, 'gra': math.degrees(b.g_ra), 'gdec': math.degrees(b.g_dec)}
    return out, ephem.delta_t(o.date)
cases = []
for i in range(60):
    for pk, (lat, lon, elev) in PLACES.items():
        jd_off = random.uniform(0, 1) * (ephem.Date('2100/12/31') - ephem.Date('1900/1/1'))
        d = ephem.Date(ephem.Date('1900/1/1') + jd_off)
        y, mo, dd, hh, mi, ss = d.tuple(); ss = int(ss)
        d = ephem.Date((y, mo, dd, hh, mi, ss))
        iso = '%04d-%02d-%02dT%02d:%02d:%02dZ' % (y, mo, dd, hh, mi, ss)
        e, dt_e = ephem_case(d, lat, lon, elev)
        case = {'iso': iso, 'place': pk, 'lat': lat, 'lon': lon, 'ephem': e, 'ephemDeltaT': dt_e}
        if y <= 2049:
            t = ts.ut1(y, mo, dd, hh, mi, ss); topo = eph['earth'] + wgs84.latlon(lat, lon, elevation_m=elev)
            sk = {}
            for nm, _, key in BODIES:
                a = topo.at(t).observe(eph[key]).apparent(); alt, az, _d = a.altaz(); ra, dec, _ = a.radec(epoch='date')
                sk[nm] = {'az': az.degrees, 'alt': alt.degrees, 'ra': ra._degrees, 'dec': dec.degrees}
            st = {}
            for s in STAR_SEL:
                S = Star(ra_hours=s[1] / 15, dec_degrees=s[2], ra_mas_per_year=s[5], dec_mas_per_year=s[6])
                a = topo.at(t).observe(S).apparent(); alt, az, _d = a.altaz(); st[str(s[0])] = {'az': az.degrees, 'alt': alt.degrees}
            case['de421'] = sk; case['de421Stars'] = st; case['skyfieldDeltaT'] = float(t.delta_t)
        cases.append(case)
# the check case given in the task
e, dt_e = ephem_case(ephem.Date('2026/11/22 23:00:00'), 31.7995, 34.647, 0)
check = {'iso': '2026-11-22T23:00:00Z', 'lat': 31.7995, 'lon': 34.647, 'ephem': e, 'ephemDeltaT': dt_e}
# ancient dates (ephem only; Julian calendar dates as ephem interprets them before 1582)
anc = []
for y in (-1500, -1000, -763, -586, -500, -200, 0, 33, 500, 1000, 1400):
    for (mo, dd, hh) in ((3, 21, 18), (9, 1, 2)):
        d = ephem.Date((y, mo, dd, hh, 0, 0)); e, dt_e = ephem_case(d, 31.7781, 35.2354, 0)
        anc.append({'y': y, 'm': mo, 'd': dd, 'h': hh, 'jdUT': float(d) + 2415020.0, 'ephem': e, 'ephemDeltaT': dt_e})
# moon rise/set (ephem, upper limb, horizon -34', no refraction model) for 20 dates, Ashdod
rs = []
o = ephem.Observer(); o.lat = '31.7995'; o.lon = '34.647'; o.elevation = 0; o.pressure = 0; o.horizon = '-0:34'
for i in range(20):
    d0 = ephem.Date(ephem.Date('1990/1/1') + random.uniform(0, 365.25 * 60)); d0 = ephem.Date(math.floor(d0 - 0.5) + 0.5 - 2/24.)  # 00:00 IST(UTC+2) ~ 22:00 UTC prev day
    o.date = d0
    rec = {'jd0': float(d0) + 2415020.0}
    for nm, cls in (('Moon', ephem.Moon), ('Sun', ephem.Sun)):
        b = cls()
        try: r = o.next_rising(b, start=d0); rec[nm + 'Rise'] = float(r) + 2415020.0 if r - d0 < 1 else None
        except Exception: rec[nm + 'Rise'] = None
        try: s = o.next_setting(b, start=d0); rec[nm + 'Set'] = float(s) + 2415020.0 if s - d0 < 1 else None
        except Exception: rec[nm + 'Set'] = None
        try: tr = o.next_transit(b, start=d0); rec[nm + 'Transit'] = float(tr) + 2415020.0 if tr - d0 < 1 else None
        except Exception: rec[nm + 'Transit'] = None
    rs.append(rec)
json.dump({'generated': 'tools/make_refs.py, ephem %s, skyfield DE421' % ephem.__version__, 'cases': cases, 'check': check, 'ancient': anc, 'riseSet': rs},
          open(os.path.join(ROOT, 'ref/sky_refs.json'), 'w'), indent=0)
print(len(cases), 'cases;', sum(1 for c in cases if 'de421' in c), 'with DE421;', len(anc), 'ancient;', len(rs), 'rise/set days')
