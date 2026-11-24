"""Reference values for test/sky.test.mjs — PyEphem (libastro) as the independent judge.

    python3 -I style-kernel/tools/make_reference.py      →  style-kernel/test/reference.json

Deterministic: timestamps come from random.Random(5787). No network.
Conventions (match sky.js):
  positions  topocentric, geometric (pressure = 0) for alt/az; apparent alt with pressure 1010 hPa, 10 °C.
  sun times  centre of the sun, pressure 0, horizon −0:50 (−0.8333°) for sunrise/sunset; −6/−12/−18° for twilights.
  moon times upper limb, pressure 0, horizon −0:34.
  local day  Asia/Jerusalem (zoneinfo) for Ashdod; a fixed offset for the other places.
"""
import ephem, json, math, os, random, datetime as dt
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'reference.json')
UTC = dt.timezone.utc
IL = ZoneInfo('Asia/Jerusalem')
ASHDOD = dict(name='ashdod', lat=31.8014, lon=34.6435, elev=10, tz='Asia/Jerusalem')
OTHER = [
    dict(name='jerusalem', lat=31.7781, lon=35.2354, elev=754, tz='Asia/Jerusalem'),
    dict(name='eilat', lat=29.5577, lon=34.9519, elev=0, tz='Asia/Jerusalem'),
    dict(name='tromso', lat=69.6492, lon=18.9553, elev=0, tz='Europe/Oslo'),
    dict(name='sydney', lat=-33.8688, lon=151.2093, elev=0, tz='Australia/Sydney'),
    dict(name='quito', lat=-0.1807, lon=-78.4678, elev=0, tz='America/Guayaquil'),
]


def obs(pl, date, pressure=0.0, temp=10.0, horizon='0'):
    o = ephem.Observer()
    o.lat, o.lon, o.elevation = str(pl['lat']), str(pl['lon']), pl['elev']
    o.pressure, o.temp, o.horizon = pressure, temp, horizon
    o.date = date
    return o


def iso(d):
    if d is None:
        return None
    return ephem.Date(d).datetime().replace(tzinfo=UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def edate(when):  # aware datetime → ephem.Date (UTC)
    return ephem.Date(when.astimezone(UTC).replace(tzinfo=None))


def position(pl, when):
    out = {}
    for key, cls in (('sun', ephem.Sun), ('moon', ephem.Moon)):
        b = cls(); b.compute(obs(pl, edate(when)))
        a = cls(); a.compute(obs(pl, edate(when), pressure=1010.0, temp=10.0))
        out[key] = {'alt': math.degrees(b.alt), 'az': math.degrees(b.az), 'altApparent': math.degrees(a.alt)}
        if key == 'moon':
            g = cls(); g.compute(edate(when))   # geocentric (no observer) for the distance
            out[key]['illumination'] = b.moon_phase
            out[key]['distanceKm'] = g.earth_distance * ephem.meters_per_au / 1000
    return out


def local_bounds(pl, y, m, d):
    tz = ZoneInfo(pl['tz'])
    start = dt.datetime(y, m, d, tzinfo=tz)
    end = start + dt.timedelta(days=1)
    end = dt.datetime(end.year, end.month, end.day, tzinfo=tz)
    return start, end


def event(pl, start, end, body, horizon, kind, use_center):
    o = obs(pl, edate(start), horizon=horizon)
    try:
        if kind == 'rise':
            t = o.next_rising(body, use_center=use_center)
        elif kind == 'set':
            t = o.next_setting(body, use_center=use_center)
        else:
            t = o.next_transit(body)
    except (ephem.AlwaysUpError, ephem.NeverUpError):
        return None
    return t if t < edate(end) else None


def sun_times(pl, y, m, d):
    start, end = local_bounds(pl, y, m, d)
    s = ephem.Sun()
    ev = {
        'sunrise': ('-0:50', 'rise'), 'sunset': ('-0:50', 'set'),
        'civilDawn': ('-6', 'rise'), 'civilDusk': ('-6', 'set'),
        'nauticalDawn': ('-12', 'rise'), 'nauticalDusk': ('-12', 'set'),
        'astronomicalDawn': ('-18', 'rise'), 'astronomicalDusk': ('-18', 'set'),
    }
    r = {k: iso(event(pl, start, end, s, h, kind, True)) for k, (h, kind) in ev.items()}
    r['solarNoon'] = iso(event(pl, start, end, s, '0', 'transit', True))
    noon = dt.datetime(y, m, d, 12, tzinfo=ZoneInfo(pl['tz']))
    return {'place': pl['name'], 'lat': pl['lat'], 'lon': pl['lon'], 'elev': pl['elev'], 'date': f'{y:04d}-{m:02d}-{d:02d}',
            'tzOffsetMinutes': int(noon.utcoffset().total_seconds() // 60), 'tz': pl['tz'], 'ref': r}


def moon_times(pl, y, m, d):
    start, end = local_bounds(pl, y, m, d)
    mo = ephem.Moon()
    r = {'rise': iso(event(pl, start, end, mo, '-0:34', 'rise', False)),
         'set': iso(event(pl, start, end, mo, '-0:34', 'set', False)),
         'transit': iso(event(pl, start, end, mo, '0', 'transit', False))}
    return {'place': pl['name'], 'lat': pl['lat'], 'lon': pl['lon'], 'elev': pl['elev'], 'date': f'{y:04d}-{m:02d}-{d:02d}', 'ref': r}


rnd = random.Random(5787)
y0 = dt.datetime(2026, 1, 1, tzinfo=UTC)
positions = []
# the artwork's moment: 23.11.2026 22:30 Israel time
art = dt.datetime(2026, 11, 23, 22, 30, tzinfo=IL)
positions.append({'id': 'art-2026-11-23T22:30+02', 'place': 'ashdod', 'iso': art.astimezone(UTC).isoformat().replace('+00:00', 'Z'), **position(ASHDOD, art)})
# seasons and a few low-sun moments (where refraction and parallax matter most)
special = [dt.datetime(2026, 3, 20, 10, 0, tzinfo=UTC), dt.datetime(2026, 6, 21, 9, 30, tzinfo=UTC), dt.datetime(2026, 9, 23, 3, 40, tzinfo=UTC),
           dt.datetime(2026, 12, 21, 14, 35, tzinfo=UTC), dt.datetime(2026, 11, 24, 4, 17, tzinfo=UTC), dt.datetime(2026, 11, 24, 14, 38, tzinfo=UTC),
           dt.datetime(2026, 11, 24, 14, 53, tzinfo=UTC), dt.datetime(2026, 1, 3, 23, 0, tzinfo=UTC)]
for w in special:
    positions.append({'id': 'special-' + w.strftime('%Y%m%dT%H%M'), 'place': 'ashdod', 'iso': w.isoformat().replace('+00:00', 'Z'), **position(ASHDOD, w)})
for i in range(44):
    w = y0 + dt.timedelta(seconds=int(rnd.uniform(0, 365 * 86400)))
    positions.append({'id': f'year-{i:02d}', 'place': 'ashdod', 'iso': w.isoformat().replace('+00:00', 'Z'), **position(ASHDOD, w)})
for pl in OTHER:
    for j in range(3):
        w = y0 + dt.timedelta(seconds=int(rnd.uniform(0, 365 * 86400)))
        positions.append({'id': f'{pl["name"]}-{j}', 'place': pl['name'], 'lat': pl['lat'], 'lon': pl['lon'], 'elev': pl['elev'],
                          'iso': w.isoformat().replace('+00:00', 'Z'), **position(pl, w)})

sun = []
for mth in range(1, 13):
    for day in (6, 21):
        sun.append(sun_times(ASHDOD, 2026, mth, day))
sun.append(sun_times(ASHDOD, 2026, 11, 23))
sun.append(sun_times(ASHDOD, 2026, 11, 24))
sun.append(sun_times(ASHDOD, 2026, 3, 27))   # DST starts (Friday)
sun.append(sun_times(ASHDOD, 2026, 10, 25))  # DST ends (Sunday)
for pl in OTHER:
    for (mth, day) in ((1, 15), (6, 21), (9, 23), (12, 21)):
        sun.append(sun_times(pl, 2026, mth, day))

moon = []
for (mth, day) in ((1, 10), (2, 14), (3, 3), (4, 18), (5, 27), (6, 9), (7, 22), (8, 5), (9, 30), (10, 12), (11, 23), (11, 24), (12, 15)):
    moon.append(moon_times(ASHDOD, 2026, mth, day))

phases = []
for start in ('2026/01/01', '2026/04/10', '2026/07/19', '2026/11/20', '2026/12/25'):
    d = ephem.Date(start)
    phases.append({'from': iso(d), 'newMoon': iso(ephem.next_new_moon(d)), 'firstQuarter': iso(ephem.next_first_quarter_moon(d)),
                   'fullMoon': iso(ephem.next_full_moon(d)), 'lastQuarter': iso(ephem.next_last_quarter_moon(d))})

tz = []
for w in (dt.datetime(2026, 3, 26, 23, 59, tzinfo=UTC), dt.datetime(2026, 3, 27, 0, 1, tzinfo=UTC), dt.datetime(2026, 10, 24, 22, 59, tzinfo=UTC),
          dt.datetime(2026, 10, 24, 23, 1, tzinfo=UTC), dt.datetime(2026, 11, 23, 20, 30, tzinfo=UTC), dt.datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
          dt.datetime(2027, 3, 26, 0, 1, tzinfo=UTC), dt.datetime(2027, 3, 25, 23, 59, tzinfo=UTC), dt.datetime(2027, 10, 30, 23, 1, tzinfo=UTC),
          dt.datetime(2025, 3, 28, 0, 1, tzinfo=UTC), dt.datetime(2025, 10, 25, 22, 59, tzinfo=UTC), dt.datetime(2030, 3, 29, 0, 1, tzinfo=UTC)):
    tz.append({'iso': w.isoformat().replace('+00:00', 'Z'), 'offsetMinutes': int(w.astimezone(IL).utcoffset().total_seconds() // 60)})

doc = {
    'generator': 'style-kernel/tools/make_reference.py', 'ephem': ephem.__version__, 'seed': 5787,
    'conventions': {
        'positions': 'topocentric; alt/az geometric (pressure 0); altApparent with pressure 1010 hPa, 10 °C; az from true north, eastward',
        'sunTimes': 'sun centre; pressure 0; sunrise/sunset horizon −0:50; twilights −6/−12/−18; local calendar day; null when not in that day',
        'moonTimes': 'upper limb; pressure 0; horizon −0:34; local calendar day (Asia/Jerusalem)',
        'phases': 'ephem.next_*_moon (geocentric)',
    },
    'positions': positions, 'sunTimes': sun, 'moonTimes': moon, 'moonPhases': phases, 'israelOffset': tz,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
print('wrote', OUT, len(positions), 'positions,', len(sun), 'sun days,', len(moon), 'moon days,', len(phases), 'phase sets')
