// sky.js — גרעין הסגנון של אשדוד החיה, v0 · "שמיים אמיתיים"
// ESM, dependency-free; runs in browsers, Cloudflare Workers and Node (no DOM, no fetch, no Intl requirement).
//
// What it gives an agent:
//   sunPosition(date, place)   → alt/az (geometric + apparent), ra/dec, distance
//   moonPosition(date, place)  → topocentric alt/az, distance, semidiameter, illumination, phase angle, waxing, phase name (he/en)
//   moonPhase(date)            → illumination + names + approximate age
//   moonPhases(date)           → next new / first quarter / full / last quarter (searched, ±~2 min)
//   sunTimes(date, opts)       → sunrise/sunset, solar noon, civil/nautical/astronomical twilight, golden/blue hour, for the LOCAL day
//   moonTimes(date, opts)      → moonrise / moonset / transit for the local day
//   skyColors(date, opts)      → sky gradient stops + ambient + shadow tint + window-light probability, from the style kernel light model
//   israelOffsetMinutes(date), localTime(date, tz), seededRandom(key), colour helpers (hexToRgb, mixHex, luminance, contrastRatio)
//
// Algorithms (standard low-precision, documented so anyone can check them):
//   Sun:   NOAA solar calculator = Meeus, Astronomical Algorithms 2nd ed., ch. 25 (low precision), ~0.01°.
//   Moon:  Meeus ch. 47 (ELP-2000/82 truncated to its largest terms, ≥ 0.001°), + topocentric parallax (Meeus ch. 40,
//          ellipsoid ρ·sinφ′, ρ·cosφ′ from ch. 11). Illuminated fraction from the geocentric phase angle (Meeus ch. 48).
//   Time:  Julian day; ΔT from the Espenak–Meeus polynomials (NASA, 2006); sidereal time Meeus 12.4;
//          nutation low-precision Meeus ch. 22 (Δψ ±0.5″, Δε ±0.1″).
//   Refraction (apparent altitude only): Sæmundsson (1986), scaled for pressure/temperature.
//   Rise/set: sampled every 10 min, refined by bisection. Sun: geometric centre at −0.8333° (34′ refraction + 16′ radius),
//          the NOAA/USNO convention. Twilights: centre at −6°, −12°, −18°. Moon: upper limb at −34′ (topocentric).
// Verified against PyEphem 4.2.1 in test/sky.test.mjs (tolerances: sun 0.2°, moon 0.7°, illumination 1.5%, rise/set 2 min).
// Accuracy is "low precision" by design: good for art, light and shadow direction; not for navigation or halachic rulings.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const sin = d => Math.sin(d * D2R), cos = d => Math.cos(d * D2R), tan = d => Math.tan(d * D2R);
const asin = x => R2D * Math.asin(Math.max(-1, Math.min(1, x)));
const atan2 = (y, x) => R2D * Math.atan2(y, x);
const wrap360 = d => ((d % 360) + 360) % 360;
const wrap180 = d => { const w = wrap360(d); return w > 180 ? w - 360 : w; };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const MIN = 60000, DAY = 86400000;
const AU_KM = 149597870.7, EARTH_EQ_KM = 6378.14;

export const VERSION = '0.1.0';

/** Default place: Ashdod port (the artwork's viewpoint). Elevation in metres above the ellipsoid (approximate). */
export const ASHDOD = Object.freeze({ lat: 31.8014, lon: 34.6435, elevation: 10, name_he: 'אשדוד', name_en: 'Ashdod', tz: 'Asia/Jerusalem' });

// ───────────────────────────── time ─────────────────────────────
function toMs(d) {
  if (d == null) return Date.now();
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number') return d;
  if (typeof d === 'string') { const t = Date.parse(d); if (Number.isFinite(t)) return t; }
  throw new TypeError('sky.js: expected Date, epoch ms or ISO string');
}
/** Julian day (UT) of a Date / epoch-ms / ISO string. */
export function julianDay(date) { return toMs(date) / DAY + 2440587.5; }
/** ΔT = TT − UT in seconds (Espenak–Meeus polynomials). For 2026 it gives ~75 s; IERS measured ~69 s — irrelevant at this precision. */
export function deltaT(year) {
  const y = year;
  if (y >= 2050 && y < 2150) return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
  if (y >= 2005 && y < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  if (y >= 1986 && y < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y >= 1961 && y < 1986) { const t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
  if (y >= 1941 && y < 1961) { const t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
  if (y >= 1920 && y < 1941) { const t = y - 1920; return 21.20 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t ** 3; }
  if (y >= 1900 && y < 1920) { const t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  const u = (y - 1820) / 100; return -20 + 32 * u * u;
}
function jdParts(ms) {
  const jdUT = ms / DAY + 2440587.5;
  const year = 2000 + (jdUT - 2451545.0) / 365.25;
  const jdTT = jdUT + deltaT(year) / 86400;
  return { jdUT, jdTT, T: (jdTT - 2451545.0) / 36525, Tu: (jdUT - 2451545.0) / 36525 };
}
function nutation(T) {   // Meeus ch. 22, low precision. Returns degrees.
  const Om = 125.04452 - 1934.136261 * T, L = 280.4665 + 36000.7698 * T, Lp = 218.3165 + 481267.8813 * T;
  const dpsi = (-17.20 * sin(Om) - 1.32 * sin(2 * L) - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * Om)) / 3600;
  const deps = (9.20 * cos(Om) + 0.57 * cos(2 * L) + 0.10 * cos(2 * Lp) - 0.09 * cos(2 * Om)) / 3600;
  const eps0 = 23 + 26 / 60 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 3600;
  return { dpsi, deps, eps: eps0 + deps };
}
function gast(jp, nut) {  // Greenwich apparent sidereal time, degrees (Meeus 12.4 + equation of the equinoxes)
  const { jdUT, Tu } = jp;
  const gmst = 280.46061837 + 360.98564736629 * (jdUT - 2451545.0) + 0.000387933 * Tu * Tu - Tu * Tu * Tu / 38710000;
  return wrap360(gmst + nut.dpsi * cos(nut.eps));
}

// ───────────────────────────── places / horizon ─────────────────────────────
function placeOf(p) {
  const o = p || {};
  return { lat: o.lat ?? ASHDOD.lat, lon: o.lon ?? ASHDOD.lon, elevation: o.elevation ?? (o.lat == null && o.lon == null ? ASHDOD.elevation : 0) };
}
function equToHorizontal(ha, dec, lat) {   // → alt, az (az from true north, clockwise/eastward)
  const alt = asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(ha));
  const az = wrap360(atan2(-cos(dec) * sin(ha), sin(dec) * cos(lat) - cos(dec) * cos(ha) * sin(lat)));
  return { alt, az };
}
/** Atmospheric refraction (degrees) for a TRUE (geometric) altitude h in degrees. Sæmundsson; P in hPa, T in °C. */
export function refraction(h, pressure = 1010, tempC = 10) {
  if (h < -1.9) return 0;
  const R = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60;   // arc-minutes → degrees
  return Math.max(0, R) * (pressure / 1010) * (283 / (273 + tempC));
}
function eclToEqu(lon, lat, eps) {
  const ra = wrap360(atan2(sin(lon) * cos(eps) - tan(lat) * sin(eps), cos(lon)));
  const dec = asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon));
  return { ra, dec };
}

// ───────────────────────────── Sun (NOAA / Meeus 25) ─────────────────────────────
function sunGeo(T, nut) {
  const L0 = wrap360(280.46646 + T * (36000.76983 + 0.0003032 * T));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const trueLon = L0 + C, nu = M + C;
  const R = 1.000001018 * (1 - e * e) / (1 + e * cos(nu));             // AU
  const lon = wrap360(trueLon + nut.dpsi - 20.4898 / 3600 / R);          // apparent: + nutation − aberration
  return { lon, lat: 0, R };
}

/** Sun position for a moment and place. alt/az are geometric (airless) topocentric ≈ geocentric (parallax 0.0024° ignored);
 *  altApparent adds standard refraction. */
export function sunPosition(date, place) {
  const p = placeOf(place), jp = jdParts(toMs(date)), nut = nutation(jp.T);
  const s = sunGeo(jp.T, nut), q = eclToEqu(s.lon, 0, nut.eps);
  const ha = wrap180(gast(jp, nut) + p.lon - q.ra);
  const h = equToHorizontal(ha, q.dec, p.lat);
  return { alt: h.alt, altApparent: h.alt + refraction(h.alt), az: h.az, ra: q.ra, dec: q.dec, hourAngle: ha,
    eclipticLon: s.lon, distanceAU: s.R, semidiameter: 0.2666 / s.R };
}

// ───────────────────────────── Moon (Meeus 47, truncated) ─────────────────────────────
// rows: [D, M, M′, F, Σl (1e-6 deg), Σr (1e-3 km)] — the largest terms of Meeus table 47.A (|Σl| ≥ 0.001° or |Σr| ≥ 3 km)
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149], [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210], [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056], [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [0, 0, 2, -2, -381, -4421],
  [2, 0, -1, -2, 0, 8752],
];
// rows: [D, M, M′, F, Σb (1e-6 deg)] — the largest terms of Meeus table 47.B (|Σb| ≥ 0.001°)
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324], [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475], [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021],
];
function moonGeo(T, nut) {
  const Lp = wrap360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000);
  const D = wrap360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000);
  const M = wrap360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000);
  const Mp = wrap360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000);
  const F = wrap360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000);
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T, E2 = E * E;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F, k = m === 0 ? 1 : (m === 1 || m === -1) ? E : E2;
    sl += l * k * sin(arg); sr += r * k * cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const k = m === 0 ? 1 : (m === 1 || m === -1) ? E : E2;
    sb += b * k * sin(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
  return { lon: wrap360(Lp + sl / 1e6 + nut.dpsi), lat: sb / 1e6, dist: 385000.56 + sr / 1000 };   // apparent λ (nutation), β, Δ km
}
function topocentric(ra, dec, distKm, ha, p) {   // Meeus ch. 40 (+ ch. 11 for the observer on the ellipsoid)
  const u = R2D * Math.atan(0.99664719 * tan(p.lat));
  const rs = 0.99664719 * sin(u) + (p.elevation / 6378140) * sin(p.lat);
  const rc = cos(u) + (p.elevation / 6378140) * cos(p.lat);
  const sp = EARTH_EQ_KM / distKm;                                  // sin(π)
  const dA = atan2(-rc * sp * sin(ha), cos(dec) - rc * sp * cos(ha));
  const decT = atan2((sin(dec) - rs * sp) * cos(dA), cos(dec) - rc * sp * cos(ha));
  return { ra: wrap360(ra + dA), dec: decT, ha: ha - dA, parallax: asin(sp) };
}
const PHASE_NAMES = [
  { max: 0.03, he: 'מולד (ירח חדש)', en: 'new moon' },
  { max: 0.44, he: 'סהר', en: 'crescent' },
  { max: 0.56, he: 'רבע', en: 'quarter' },
  { max: 0.97, he: 'גיבני', en: 'gibbous' },
  { max: 1.01, he: 'ירח מלא', en: 'full moon' },
];
function phaseName(k, waxing) {
  const n = PHASE_NAMES.find(x => k < x.max) || PHASE_NAMES[4];
  if (n.en === 'new moon' || n.en === 'full moon') return { he: n.he, en: n.en };
  if (n.en === 'quarter') return waxing ? { he: 'רבע ראשון', en: 'first quarter' } : { he: 'רבע אחרון', en: 'last quarter' };
  return { he: n.he + (waxing ? ' מתמלא' : ' מתמעט'), en: (waxing ? 'waxing ' : 'waning ') + n.en };
}
const SYNODIC = 29.530588853;
function moonCore(ms, p) {
  const jp = jdParts(ms), nut = nutation(jp.T);
  const m = moonGeo(jp.T, nut), s = sunGeo(jp.T, nut);
  const q = eclToEqu(m.lon, m.lat, nut.eps);
  const ha0 = wrap180(gast(jp, nut) + p.lon - q.ra);
  const t = topocentric(q.ra, q.dec, m.dist, ha0, p);
  const h = equToHorizontal(t.ha, t.dec, p.lat);
  // illuminated fraction (geocentric phase angle, Meeus 48.2–48.3)
  const cpsi = cos(m.lat) * cos(m.lon - s.lon), psi = R2D * Math.acos(clamp(cpsi, -1, 1));
  const Rkm = s.R * AU_KM, i = atan2(Rkm * sin(psi), m.dist - Rkm * cos(psi));
  const k = (1 + cos(i)) / 2, elong = wrap360(m.lon - s.lon), waxing = elong < 180;
  return { m, s, q, t, h, k, i, psi, elong, waxing };
}

/** Moon position (topocentric) + illumination. alt/az geometric; altApparent with refraction.
 *  ageDays is approximate (from the elongation and the mean synodic month) — label it 'משוער'. */
export function moonPosition(date, place) {
  const p = placeOf(place), c = moonCore(toMs(date), p);
  const sd = asin(1737.4 / c.m.dist) * (1 + sin(c.h.alt) * EARTH_EQ_KM / c.m.dist);   // topocentric semidiameter (augmented)
  return {
    alt: c.h.alt, altApparent: c.h.alt + refraction(c.h.alt), az: c.h.az, ra: c.t.ra, dec: c.t.dec, hourAngle: c.t.ha,
    distanceKm: c.m.dist, parallax: c.t.parallax, semidiameter: sd, eclipticLon: c.m.lon, eclipticLat: c.m.lat,
    illumination: c.k, phaseAngle: c.i, elongation: c.psi, waxing: c.waxing, ageDays: c.elong / 360 * SYNODIC,
    phase: phaseName(c.k, c.waxing),
  };
}
/** Illumination and names only (geocentric). */
export function moonPhase(date) {
  const c = moonCore(toMs(date), placeOf(null));
  return { illumination: c.k, phaseAngle: c.i, waxing: c.waxing, ageDays: c.elong / 360 * SYNODIC, ageLabel_he: 'משוער (חודש סינודי ממוצע)', phase: phaseName(c.k, c.waxing) };
}
function elongationAt(ms) { const jp = jdParts(ms), nut = nutation(jp.T); return wrap360(moonGeo(jp.T, nut).lon - sunGeo(jp.T, nut).lon); }
function findElongation(target, fromMs, spanDays) {
  let a = fromMs, fa = wrap180(elongationAt(a) - target);
  for (let t = fromMs + DAY / 4; t <= fromMs + spanDays * DAY; t += DAY / 4) {
    const ft = wrap180(elongationAt(t) - target);
    if (fa < 0 && ft >= 0 && ft - fa < 90) {          // real crossing (not the ±180 wrap)
      let lo = a, hi = t;
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (wrap180(elongationAt(mid) - target) < 0) lo = mid; else hi = mid; }
      return new Date(Math.round((lo + hi) / 2));
    }
    a = t; fa = ft;
  }
  return null;
}
/** Next principal phases after `date` (geocentric apparent longitudes; ±~2 min vs PyEphem). */
export function moonPhases(date) {
  const ms = toMs(date);
  return { newMoon: findElongation(0, ms, 31), firstQuarter: findElongation(90, ms, 31), fullMoon: findElongation(180, ms, 31), lastQuarter: findElongation(270, ms, 31) };
}

// ───────────────────────────── time zones ─────────────────────────────
function lastSundayUTC(year, month0) {   // date (UTC midnight ms) of the last Sunday of month0
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  return Date.UTC(year, month0, last.getUTCDate() - last.getUTCDay());
}
/** Israel civil offset from UTC in minutes (+120 winter / +180 summer).
 *  Rule of the 2013 law: DST from the Friday before the last Sunday of March, 02:00, to the last Sunday of October, 02:00.
 *  Years before 2013 had other rules: there the Intl database is used when available, otherwise this rule (approximated). */
export function israelOffsetMinutes(date) {
  const ms = toMs(date), y = new Date(ms).getUTCFullYear();
  if (y < 2013) { const o = intlOffsetMinutes(ms, 'Asia/Jerusalem'); if (o != null) return o; }
  const start = lastSundayUTC(y, 2) - 2 * DAY + 0 * 3600000;      // Friday 02:00 IST = 00:00 UTC
  const end = lastSundayUTC(y, 9) - 1 * 3600000;                  // Sunday 02:00 IDT = Saturday 23:00 UTC
  return ms >= start && ms < end ? 180 : 120;
}
function intlOffsetMinutes(ms, timeZone) {
  try {
    if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return null;
    const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUTC - Math.floor(ms / 1000) * 1000) / MIN);
  } catch (e) { return null; }
}
function tzFunction(tz) {
  if (tz == null || tz === 'Asia/Jerusalem' || tz === 'Israel') return israelOffsetMinutes;
  if (typeof tz === 'number') return () => tz;
  if (typeof tz === 'function') return ms => tz(ms);
  if (tz === 'UTC' || tz === 'Etc/UTC') return () => 0;
  return ms => { const o = intlOffsetMinutes(ms, tz); if (o == null) throw new Error('sky.js: time zone ' + tz + ' needs Intl; pass tz as minutes instead'); return o; };
}
const p2 = n => String(n).padStart(2, '0');
/** Local wall-clock parts for a moment. tz: 'Asia/Jerusalem' (default) | minutes east of UTC | fn(ms)→minutes | IANA name (Intl). */
export function localTime(date, tz) {
  const ms = toMs(date), off = tzFunction(tz)(ms), d = new Date(ms + off * MIN);
  const parts = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds(), offsetMinutes: off };
  parts.hhmm = p2(parts.h) + ':' + p2(parts.min);
  parts.date_he = p2(parts.d) + '.' + p2(parts.m) + '.' + parts.y;   // DD.MM.YYYY (kernel typography rule)
  parts.hourFloat = parts.h + parts.min / 60 + parts.s / 3600;
  return parts;
}
function localDayBounds(ms, tzf) {
  const off = tzf(ms), l = new Date(ms + off * MIN);
  const Y = l.getUTCFullYear(), M = l.getUTCMonth(), D = l.getUTCDate();
  const midnight = (y, m, d) => { const u = Date.UTC(y, m, d), g = u - tzf(u - off * MIN) * MIN; return u - tzf(g) * MIN; };
  return { start: midnight(Y, M, D), end: midnight(Y, M, D + 1), ymd: Y + '-' + p2(M + 1) + '-' + p2(D) };
}

// ───────────────────────────── rise / set search ─────────────────────────────
function crossings(f, t0, t1, h, stepMs = 10 * MIN) {   // f(ms) → altitude; returns first rising and first setting crossing of h
  let a = t0, fa = f(a) - h, rise = null, set = null, above = fa >= 0, allAbove = fa >= 0, allBelow = fa < 0;
  for (let t = Math.min(t0 + stepMs, t1); ; t = Math.min(t + stepMs, t1)) {
    const ft = f(t) - h;
    if (ft >= 0) allBelow = false; else allAbove = false;
    if ((fa < 0) !== (ft < 0)) {
      let lo = a, hi = t, flo = fa;
      for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2, fm = f(mid) - h; if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid; }
      const when = new Date(Math.round((lo + hi) / 2));
      if (fa < 0 && !rise) rise = when; else if (fa >= 0 && !set) set = when;
    }
    a = t; fa = ft;
    if (t >= t1) break;
  }
  return { rise, set, allAbove, allBelow, startAbove: above };
}
function hourAngleZero(fHA, t0, t1, stepMs = 30 * MIN) {   // upper transit: HA goes − → +
  let a = t0, fa = fHA(a);
  for (let t = t0 + stepMs; t <= t1 + 1; t += stepMs) {
    const ft = fHA(t);
    if (fa < 0 && ft >= 0 && ft - fa < 90) {
      let lo = a, hi = t;
      for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (fHA(mid) < 0) lo = mid; else hi = mid; }
      return new Date(Math.round((lo + hi) / 2));
    }
    a = t; fa = ft;
  }
  return null;
}
const SUN_EVENTS = [
  // key, Hebrew label, altitude of the sun's centre (geometric), which crossing
  ['astronomicalDawn', 'תחילת דמדומים אסטרונומיים (שחר)', -18, 'rise'],
  ['nauticalDawn', 'תחילת דמדומים ימיים', -12, 'rise'],
  ['civilDawn', 'תחילת דמדומים אזרחיים', -6, 'rise'],
  ['blueHourMorningStart', 'שעה כחולה – בוקר (−8°)', -8, 'rise'],
  ['blueHourMorningEnd', 'סוף השעה הכחולה – בוקר (−4°)', -4, 'rise'],
  ['sunrise', 'זריחה', -0.8333, 'rise'],
  ['goldenHourMorningEnd', 'סוף שעת הזהב – בוקר (6°)', 6, 'rise'],
  ['goldenHourEveningStart', 'תחילת שעת הזהב – ערב (6°)', 6, 'set'],
  ['sunset', 'שקיעה', -0.8333, 'set'],
  ['blueHourEveningStart', 'שעה כחולה – ערב (−4°)', -4, 'set'],
  ['blueHourEveningEnd', 'סוף השעה הכחולה – ערב (−8°)', -8, 'set'],
  ['civilDusk', 'סוף דמדומים אזרחיים', -6, 'set'],
  ['nauticalDusk', 'סוף דמדומים ימיים', -12, 'set'],
  ['astronomicalDusk', 'סוף דמדומים אסטרונומיים (לילה)', -18, 'set'],
];
/** Sun events for the LOCAL calendar day that contains `date`.
 *  opts: { lat, lon, elevation, tz } — tz defaults to Israel time ('Asia/Jerusalem' rule, no Intl needed).
 *  Returns Date objects (null when the event does not happen that day), plus `local` 'HH:MM' strings and a Hebrew list. */
export function sunTimes(date, opts = {}) {
  const p = placeOf(opts), tzf = tzFunction(opts.tz), b = localDayBounds(toMs(date), tzf);
  const alt = ms => sunPosition(ms, p).alt;
  const cache = new Map(), f = ms => { let v = cache.get(ms); if (v === undefined) { v = alt(ms); cache.set(ms, v); } return v; };
  const out = { date: b.ymd, lat: p.lat, lon: p.lon, dayStart: new Date(b.start), dayEnd: new Date(b.end) };
  const byH = new Map();
  for (const [key, , h, kind] of SUN_EVENTS) {
    if (!byH.has(h)) byH.set(h, crossings(f, b.start, b.end, h));
    out[key] = byH.get(h)[kind];
  }
  out.solarNoon = hourAngleZero(ms => sunPosition(ms, p).hourAngle, b.start, b.end);
  const c0 = byH.get(-0.8333);
  out.polar = c0.allAbove ? 'midnight-sun' : c0.allBelow ? 'polar-night' : null;
  out.dayLengthMinutes = out.sunrise && out.sunset ? (out.sunset - out.sunrise) / MIN : c0.allAbove ? 1440 : c0.allBelow ? 0 : null;
  out.local = {}; out.list = [];
  for (const [key, he] of [...SUN_EVENTS.map(e => [e[0], e[1]]), ['solarNoon', 'חצות היום (שמש במרידיאן)']]) {
    const t = out[key]; out.local[key] = t ? localTime(t, opts.tz).hhmm : null;
    if (t) out.list.push({ key, he, time: t, local: out.local[key] });
  }
  out.list.sort((a, c) => a.time - c.time);
  out.note_he = 'חישוב בדיוק נמוך (NOAA/Meeus), ±1 דק׳ בערך. זריחה/שקיעה: מרכז השמש ב-‎−0.833°‎ בלי תיקון גובה הצופה. לא פסק הלכה.';
  return out;
}
/** Moonrise / moonset (upper limb at −34′, topocentric) and upper transit for the LOCAL day containing `date`. */
export function moonTimes(date, opts = {}) {
  const p = placeOf(opts), tzf = tzFunction(opts.tz), b = localDayBounds(toMs(date), tzf);
  const f = ms => { const m = moonPosition(ms, p); return m.alt + m.semidiameter; };
  const c = crossings(f, b.start, b.end, -34 / 60);
  const transit = hourAngleZero(ms => moonPosition(ms, p).hourAngle, b.start, b.end);
  const L = t => (t ? localTime(t, opts.tz).hhmm : null);
  return { date: b.ymd, rise: c.rise, set: c.set, transit, alwaysUp: c.allAbove, alwaysDown: c.allBelow, local: { rise: L(c.rise), set: L(c.set), transit: L(transit) } };
}

// ───────────────────────────── colour helpers ─────────────────────────────
export function hexToRgb(hex) { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
export function rgbToHex(c) { return '#' + c.map(v => p2(Math.round(clamp(v, 0, 255)).toString(16)).toUpperCase()).join(''); }
const toLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** Mix two hex colours in linear light (physically sensible blending of light). t=0 → a, t=1 → b. */
export function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A.map((v, i) => toSrgb(toLin(v) + (toLin(B[i]) - toLin(v)) * clamp(t, 0, 1)))); }
/** WCAG relative luminance (0..1) of a hex colour. */
export function luminance(hex) { const [r, g, b] = hexToRgb(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrastRatio(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
/** Light a base (albedo) colour with a skyColors() result: direct sun (unless inShadow) + ambient, tinted; optionally a street lamp
 *  ({ lamp: 'sodium' | 'ledWarm' | 'ledCool', lampIntensity }) when sky.streetLight.on. Inspiration, not photometry. */
export function shade(baseHex, sky, { inShadow = false, facing = 1, lamp = null, lampIntensity } = {}) {
  const base = hexToRgb(baseHex).map(toLin), amb = hexToRgb(sky.ambient.hex).map(toLin), sun = hexToRgb(sky.sunLight.hex).map(toLin);
  const ai = sky.ambient.intensity, si = inShadow ? 0 : sky.sunLight.intensity * clamp(facing, 0, 1);
  const sl = sky.streetLight, li = lamp && sl && sl.on ? (lampIntensity ?? sl.intensity) : 0, lc = li ? hexToRgb(sl[lamp] || sl.sodium).map(toLin) : [0, 0, 0];
  const lit = base.map((v, i) => v * (amb[i] * ai + sun[i] * si * 1.1 + lc[i] * li));
  let hex = rgbToHex(lit.map(toSrgb));
  if (inShadow) hex = mixHex(hex, sky.shadowTint.hex, sky.shadowTint.alpha * 0.5);
  return hex;
}

/** Kernel brightness budget on rendered pixels (test it on the 1080-px-wide downscale).
 *  img: { data: RGBA bytes, width, height }; isFocal(x, y) → true inside the focal mask; opts.exempt(x, y) → true for the
 *  true-size moon disc / bright stars. Passes when P99(Y outside the mask) ≤ fraction × Y(focus core).
 *  opts.focusY defaults to the brightest Y inside the mask; opts.fraction defaults to 0.35; opts.background (hex) switches
 *  to the day test (contrast |Y − Y(background)| instead of Y). */
export function brightnessBudget(img, isFocal, opts = {}) {
  const { data, width, height } = img, frac = opts.fraction ?? 0.35, exempt = opts.exempt || (() => false);
  const lut = new Float64Array(256); for (let v = 0; v < 256; v++) lut[v] = toLin(v);
  const bgY = opts.background ? luminance(opts.background) : null, BINS = 4096, hist = new Uint32Array(BINS);
  let n = 0, focusMax = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4;
    let Y = 0.2126 * lut[data[o]] + 0.7152 * lut[data[o + 1]] + 0.0722 * lut[data[o + 2]];
    if (bgY != null) Y = Math.abs(Y - bgY);
    if (isFocal(x, y)) { if (Y > focusMax) focusMax = Y; continue; }
    if (exempt(x, y)) continue;
    hist[Math.min(BINS - 1, Math.floor(Y * (BINS - 1)))]++; n++;
  }
  let acc = 0, p99 = 0; const target = 0.99 * n;
  for (let i = 0; i < BINS; i++) { acc += hist[i]; if (acc >= target) { p99 = i / (BINS - 1); break; } }
  const focusY = opts.focusY ?? focusMax, limit = frac * focusY;
  return { p99Outside: p99, focusY, limit, ratio: focusY > 0 ? p99 / focusY : Infinity, pass: n === 0 || p99 <= limit, pixelsOutside: n };
}

// ───────────────────────────── seeded randomness (kernel rule: deterministic) ─────────────────────────────
export function hashString(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Deterministic PRNG for a key, e.g. seededRandom('parcel:12345|2026-11-24'). Base seed 5787 (the Hebrew year תשפ״ז). */
export function seededRandom(key, base = 5787) { return mulberry32((base ^ hashString(key)) >>> 0); }

// ───────────────────────────── light model (mirror of style.json → "light"; test asserts they are equal) ─────────────────────────────
export const LIGHT = {
  "label_he": "מודל אור לפי גובה השמש — סגנון מכויל, לא פוטומטריה. עננים/אובך שנמדדו גוברים עליו.",
  "altitudeOf": "geometric altitude of the sun's centre, degrees (sky.js sunPosition().alt)",
  "stopsAt": [0, 0.45, 0.8, 1],
  "stopsNote": "0 = zenith, 1 = the horizon. 'sunward' is the horizon colour in the sun's azimuth (±60°), 'antisun' the opposite horizon.",
  "phases": [
    { "id": "night", "he": "לילה", "sunAltMax": -18 },
    { "id": "astronomical", "he": "דמדומים אסטרונומיים", "sunAltMax": -12 },
    { "id": "nautical", "he": "דמדומים ימיים", "sunAltMax": -6 },
    { "id": "civil", "he": "דמדומים אזרחיים", "sunAltMax": -0.8333 },
    { "id": "golden", "he": "שעת זהב", "sunAltMax": 6 },
    { "id": "day", "he": "יום", "sunAltMax": 90 }
  ],
  "night": {
    "moonless": { "stops": ["#05091A", "#070D22", "#0A122B", "#0E1734"], "ambient": { "hex": "#141B38", "intensity": 0.03 }, "shadowTint": { "hex": "#03050B", "alpha": 0.7 }, "stars": 1 },
    "moonlit": { "stops": ["#08102A", "#0C1636", "#111C40", "#16224A"], "ambient": { "hex": "#3A4A78", "intensity": 0.08 }, "shadowTint": { "hex": "#05080F", "alpha": 0.6 }, "stars": 0.55 },
    "moonFactor": "illumination × smoothstep(−1°, 40°, moon altitude)",
    "source_he": "צבעי הלילה של היצירה 23.11.2026 (ירח 99% בגובה 80°) = 'moonlit'; 'moonless' כהה יותר באותו גוון."
  },
  "keyframes": {
    "dusk": [
      { "alt": -18, "stops": ["#05091A", "#070D22", "#0A122B", "#0E1734"], "sunward": "#111A38", "antisun": "#0E1734", "ambient": { "hex": "#141B38", "intensity": 0.03 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#03050B", "alpha": 0.7 }, "stars": 1 },
      { "alt": -12, "stops": ["#0A1434", "#101D42", "#1A2850", "#2A3258"], "sunward": "#3A3858", "antisun": "#1E2A52", "ambient": { "hex": "#1E2850", "intensity": 0.05 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#070B18", "alpha": 0.62 }, "stars": 0.8 },
      { "alt": -6, "stops": ["#13234E", "#1F3566", "#3A4C7E", "#6A6388"], "sunward": "#B0705A", "antisun": "#2C3A66", "ambient": { "hex": "#3A4A7E", "intensity": 0.12 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#141E3E", "alpha": 0.5 }, "stars": 0.1 },
      { "alt": -3, "stops": ["#1C3263", "#2F4C84", "#6577A6", "#B0848A"], "sunward": "#E0703A", "antisun": "#8E7A9E", "ambient": { "hex": "#5A5F8E", "intensity": 0.2 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#26305A", "alpha": 0.48 }, "stars": 0 },
      { "alt": 0, "stops": ["#27467F", "#4A6EA6", "#9AAACB", "#E8B48A"], "sunward": "#F0A050", "antisun": "#A99AB8", "ambient": { "hex": "#7B86AE", "intensity": 0.32 }, "sunLight": { "hex": "#FF9A55", "intensity": 0.35 }, "shadowTint": { "hex": "#3A4A7A", "alpha": 0.45 }, "stars": 0 },
      { "alt": 3, "stops": ["#2E5592", "#577DB4", "#AFC0D8", "#E9CFAE"], "sunward": "#F4BE7E", "antisun": "#B9C4D8", "ambient": { "hex": "#95A3C4", "intensity": 0.45 }, "sunLight": { "hex": "#FFB676", "intensity": 0.55 }, "shadowTint": { "hex": "#43548A", "alpha": 0.42 }, "stars": 0 },
      { "alt": 6, "stops": ["#2D5FA6", "#5C86BE", "#AFC6DE", "#D8D9D6"], "sunward": "#F0D6A8", "antisun": "#BCCFE2", "ambient": { "hex": "#A9B9D6", "intensity": 0.55 }, "sunLight": { "hex": "#FFD0A0", "intensity": 0.7 }, "shadowTint": { "hex": "#4B5D8C", "alpha": 0.4 }, "stars": 0 },
      { "alt": 15, "stops": ["#2C66B8", "#5D8FCB", "#9FC2E6", "#B8D2EC"], "sunward": "#E8E4D8", "antisun": "#B6D0EA", "ambient": { "hex": "#B2C4E0", "intensity": 0.75 }, "sunLight": { "hex": "#FFE6CC", "intensity": 0.88 }, "shadowTint": { "hex": "#52648F", "alpha": 0.38 }, "stars": 0 },
      { "alt": 30, "stops": ["#2C6CC4", "#5A92D4", "#8FBCE8", "#9EC6EE"], "sunward": "#DCE6EE", "antisun": "#9EC6EE", "ambient": { "hex": "#B8CCE6", "intensity": 0.92 }, "sunLight": { "hex": "#FFF3E6", "intensity": 1 }, "shadowTint": { "hex": "#55688F", "alpha": 0.36 }, "stars": 0 },
      { "alt": 60, "stops": ["#3570C0", "#6A9AD0", "#A6C6E4", "#C4D8EA"], "sunward": "#E6ECF0", "antisun": "#BCD3EA", "ambient": { "hex": "#C0D2EA", "intensity": 1 }, "sunLight": { "hex": "#FFF8F0", "intensity": 1 }, "shadowTint": { "hex": "#5A6C92", "alpha": 0.34 }, "stars": 0 }
    ],
    "dawn": [
      { "alt": -18, "stops": ["#05091A", "#070D22", "#0A122B", "#0E1734"], "sunward": "#101936", "antisun": "#0E1734", "ambient": { "hex": "#141B38", "intensity": 0.03 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#03050B", "alpha": 0.7 }, "stars": 1 },
      { "alt": -12, "stops": ["#0A1532", "#101E42", "#1A2A52", "#263358"], "sunward": "#34385A", "antisun": "#1C2850", "ambient": { "hex": "#1E2850", "intensity": 0.05 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#070B18", "alpha": 0.62 }, "stars": 0.8 },
      { "alt": -6, "stops": ["#142650", "#22396A", "#3F5384", "#7A7090"], "sunward": "#A9787A", "antisun": "#33416E", "ambient": { "hex": "#3E4E82", "intensity": 0.12 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#151F40", "alpha": 0.5 }, "stars": 0.1 },
      { "alt": -3, "stops": ["#1E3666", "#34528A", "#6F82AE", "#BB98A0"], "sunward": "#E3A07A", "antisun": "#8A7EA4", "ambient": { "hex": "#606896", "intensity": 0.2 }, "sunLight": { "hex": "#000000", "intensity": 0 }, "shadowTint": { "hex": "#28325C", "alpha": 0.48 }, "stars": 0 },
      { "alt": 0, "stops": ["#2A4C84", "#5074AA", "#A3B3CF", "#E6C2A6"], "sunward": "#F2B27A", "antisun": "#B2A6C0", "ambient": { "hex": "#828DB2", "intensity": 0.32 }, "sunLight": { "hex": "#FFAE7A", "intensity": 0.35 }, "shadowTint": { "hex": "#3C4C7C", "alpha": 0.45 }, "stars": 0 },
      { "alt": 3, "stops": ["#2F5794", "#5A80B6", "#B2C3DA", "#E3D6C2"], "sunward": "#F0C89A", "antisun": "#BAC6DA", "ambient": { "hex": "#98A6C6", "intensity": 0.45 }, "sunLight": { "hex": "#FFC08E", "intensity": 0.55 }, "shadowTint": { "hex": "#44558A", "alpha": 0.42 }, "stars": 0 },
      { "alt": 6, "stops": ["#2D5FA6", "#5C86BE", "#B0C7DF", "#D3DBE0"], "sunward": "#EFDDBA", "antisun": "#BCCFE2", "ambient": { "hex": "#AABAD7", "intensity": 0.55 }, "sunLight": { "hex": "#FFD6AC", "intensity": 0.7 }, "shadowTint": { "hex": "#4B5D8C", "alpha": 0.4 }, "stars": 0 },
      { "alt": 15, "stops": ["#2C66B8", "#5D8FCB", "#9FC2E6", "#B8D2EC"], "sunward": "#E8E6DC", "antisun": "#B6D0EA", "ambient": { "hex": "#B2C4E0", "intensity": 0.75 }, "sunLight": { "hex": "#FFE8D0", "intensity": 0.88 }, "shadowTint": { "hex": "#52648F", "alpha": 0.38 }, "stars": 0 },
      { "alt": 30, "stops": ["#2C6CC4", "#5A92D4", "#8FBCE8", "#9EC6EE"], "sunward": "#DCE6EE", "antisun": "#9EC6EE", "ambient": { "hex": "#B8CCE6", "intensity": 0.92 }, "sunLight": { "hex": "#FFF3E6", "intensity": 1 }, "shadowTint": { "hex": "#55688F", "alpha": 0.36 }, "stars": 0 },
      { "alt": 60, "stops": ["#3570C0", "#6A9AD0", "#A6C6E4", "#C4D8EA"], "sunward": "#E6ECF0", "antisun": "#BCD3EA", "ambient": { "hex": "#C0D2EA", "intensity": 1 }, "sunLight": { "hex": "#FFF8F0", "intensity": 1 }, "shadowTint": { "hex": "#5A6C92", "alpha": 0.34 }, "stars": 0 }
    ],
    "source_he": "יום (30°): כיול העולם התאום מול 12 תמונות שטח ביום, 23.11.2026 13:30 (שמיים #2C6CC4, אופק #9EC6EE). דמדומים: סגנון. בשקיעה השמש יורדת לים (מערב) — חם ורווי יותר; בזריחה היא עולה מעל העיר (מזרח) — פנינה וורוד."
  },
  "cityGlow": { "hex": "#B89A6A", "alphaNight": 0.1, "fadeSunAlt": [-12, -4], "azimuthDeg": [25, 205], "label_he": "זוהר נתרן מעל העיר (יבשה: אזימוט 25°–205° דרך מזרח, משוער ±10°). השראה, לא מדידה." },
  "streetLight": {
    "label_he": "השראה, לא מדידה — בתמונות הרחוב בלילה האור חם (Lab b* +2…+9)",
    "onBelowSunAlt": 0,
    "sodium": "#FFB070", "ledWarm": "#FFD8AA", "ledCool": "#E6EEFF",
    "intensity": 0.35,
    "rule_he": "פנסים דולקים כשהשמש מתחת לאופק. מיקום פנס — רק מנתונים (OSM/עירייה) או מסומן 'משוער'."
  },
  "windowLight": {
    "label_he": "השראה, לא מדידה",
    "byHourLocal": [0.10, 0.06, 0.04, 0.03, 0.04, 0.10, 0.18, 0.15, 0.06, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.08, 0.30, 0.50, 0.62, 0.66, 0.62, 0.48, 0.25],
    "visibility": "smoothstep(+6°, −6°, sun altitude) — by day a lit window does not read",
    "colours": [{ "hex": "#FFD696", "w": 0.45 }, { "hex": "#FFECC8", "w": 0.3 }, { "hex": "#FFBE78", "w": 0.15 }, { "hex": "#C8DCFF", "w": 0.1 }],
    "rule_he": "החלטה לכל חלון: seededRandom(מזהה חלון + תאריך + שעה) < הסתברות. שבת וחג אינם ממודלים ב-v0.",
    "source_he": "גווני החלונות מהעולם התאום (30-atmo-lite); עקומת השעות – השראה כללית, לא נתון של אשדוד."
  }
};

// ───────────────────────────── skyColors ─────────────────────────────
function lerpFrame(A, B, t) {
  const m = (a, b) => mixHex(a, b, t), n = (a, b) => a + (b - a) * t;
  return {
    stops: A.stops.map((c, i) => m(c, B.stops[i])), sunward: m(A.sunward, B.sunward), antisun: m(A.antisun, B.antisun),
    ambient: { hex: m(A.ambient.hex, B.ambient.hex), intensity: n(A.ambient.intensity, B.ambient.intensity) },
    sunLight: { hex: m(A.sunLight.hex, B.sunLight.hex), intensity: n(A.sunLight.intensity, B.sunLight.intensity) },
    shadowTint: { hex: m(A.shadowTint.hex, B.shadowTint.hex), alpha: n(A.shadowTint.alpha, B.shadowTint.alpha) },
    stars: n(A.stars, B.stars),
  };
}
function frameAt(frames, alt) {
  if (alt <= frames[0].alt) return lerpFrame(frames[0], frames[0], 0);
  for (let i = 0; i < frames.length - 1; i++) {
    const A = frames[i], B = frames[i + 1];
    if (alt <= B.alt) return lerpFrame(A, B, (alt - A.alt) / (B.alt - A.alt));
  }
  const L = frames[frames.length - 1]; return lerpFrame(L, L, 0);
}
/** Sky colours for a moment and place from the kernel's light model.
 *  opts: { lat, lon, elevation, tz, light (a style.json "light" object; defaults to the embedded copy) }.
 *  Returns { phase, variant, sun, moon, stops:[{at,hex}], sunward, antisun, ambient, sunLight, shadowTint, stars, moonFactor,
 *            cityGlow, windowLightProbability, focus, label_he }. */
export function skyColors(date, opts = {}) {
  const L = opts.light || LIGHT, ms = toMs(date), p = placeOf(opts);
  const sun = sunPosition(ms, p), moon = moonPosition(ms, p);
  const variant = sun.hourAngle < 0 ? 'dawn' : 'dusk';      // sun east of the meridian → morning
  let f = frameAt(L.keyframes[variant], sun.alt);
  // the moon lifts the night (and the deep twilight) toward the artwork's moonlit indigo
  const mf = clamp(moon.illumination * smoothstep(-1, 40, moon.alt), 0, 1);
  const nightW = smoothstep(-10, -18, sun.alt);              // 1 in full night, 0 from nautical twilight up
  if (nightW > 0 && mf > 0) {
    const lit = L.night.moonlit, w = mf * nightW;
    f = { ...f,
      stops: f.stops.map((c, i) => mixHex(c, lit.stops[i], w)),
      sunward: mixHex(f.sunward, lit.stops[3], w), antisun: mixHex(f.antisun, lit.stops[3], w),
      ambient: { hex: mixHex(f.ambient.hex, lit.ambient.hex, w), intensity: f.ambient.intensity + (lit.ambient.intensity - f.ambient.intensity) * w },
      shadowTint: { hex: mixHex(f.shadowTint.hex, lit.shadowTint.hex, w), alpha: f.shadowTint.alpha + (lit.shadowTint.alpha - f.shadowTint.alpha) * w },
      stars: f.stars * (1 - (1 - lit.stars) * w) };
  }
  const phase = (L.phases.find(ph => sun.alt <= ph.sunAltMax) || L.phases[L.phases.length - 1]);
  const lt = localTime(ms, opts.tz), H = L.windowLight.byHourLocal;
  const hp = H[lt.h % 24] + (H[(lt.h + 1) % 24] - H[lt.h % 24]) * (lt.min / 60);
  const windowP = hp * smoothstep(6, -6, sun.alt);
  const cg = L.cityGlow, cityA = cg.alphaNight * smoothstep(cg.fadeSunAlt[1], cg.fadeSunAlt[0], sun.alt);
  // smooth weights of the palette variants (night / dawn / day / dusk) — use with roleColor(); they always sum to 1
  const wN = smoothstep(-4, -10, sun.alt), wD = smoothstep(4, 10, sun.alt), wT = Math.max(0, 1 - wN - wD);
  const weights = { night: wN, dawn: variant === 'dawn' ? wT : 0, day: wD, dusk: variant === 'dusk' ? wT : 0 };
  const SL = L.streetLight;
  return {
    version: VERSION, at: new Date(ms).toISOString(), local: lt.date_he + ' ' + lt.hhmm,
    phase: { id: phase.id, he: phase.he }, variant,
    sun: { alt: sun.alt, az: sun.az, visible: sun.alt > -0.8333 },
    moon: { alt: moon.alt, az: moon.az, illumination: moon.illumination, waxing: moon.waxing, phase_he: moon.phase.he, visible: moon.alt > -0.5 },
    stops: L.stopsAt.map((at, i) => ({ at, hex: f.stops[i] })),
    sunward: { hex: f.sunward, azimuth: sun.az }, antisun: { hex: f.antisun, azimuth: wrap360(sun.az + 180) },
    ambient: f.ambient, sunLight: sun.alt > -0.8333 ? f.sunLight : { hex: '#000000', intensity: 0 }, shadowTint: f.shadowTint,
    stars: clamp(f.stars, 0, 1), moonFactor: mf,
    cityGlow: { hex: cg.hex, alpha: cityA, azimuthDeg: cg.azimuthDeg },
    windowLightProbability: Math.round(windowP * 1000) / 1000,
    streetLight: { on: sun.alt < SL.onBelowSunAlt, sodium: SL.sodium, ledWarm: SL.ledWarm, ledCool: SL.ledCool, intensity: SL.intensity },
    weights,
    focus: sun.alt < -3 ? { mode: 'emissive', core: '#FFF6E0', glow: '#FFC86B' } : { mode: 'ink', fill: '#E3A33A', edge: '#1A1408' },
    label_he: 'צבעי שמיים בסגנון הגרעין לפי מיקום שמש וירח אמיתי. הצבעים: השראה מכוילת, לא מדידה.',
  };
}
/** A palette role from style.json (palette.roles.<role> = {night, dawn, day, dusk} hex) at the moment of a skyColors() result,
 *  blended smoothly in linear light with sky.weights (no jumps at phase boundaries). Variants that are null are skipped. */
export function roleColor(role, sky) {
  if (role.all) return role.all;
  let acc = [0, 0, 0], w = 0;
  for (const v of ['night', 'dawn', 'day', 'dusk']) {
    const k = sky.weights[v]; if (!k || !role[v]) continue;
    const c = hexToRgb(role[v]).map(toLin); acc = acc.map((a, i) => a + c[i] * k); w += k;
  }
  if (w === 0) return null;
  return rgbToHex(acc.map(a => toSrgb(a / w)));
}
/** CSS linear-gradient string (top = zenith) for quick use in a page. */
export function skyGradientCSS(sky, angle = 180) { return `linear-gradient(${angle}deg, ${sky.stops.map(s => `${s.hex} ${Math.round(s.at * 100)}%`).join(', ')})`; }

export default { VERSION, ASHDOD, LIGHT, julianDay, deltaT, refraction, sunPosition, moonPosition, moonPhase, moonPhases, sunTimes, moonTimes, israelOffsetMinutes, localTime, skyColors, skyGradientCSS, roleColor, hexToRgb, rgbToHex, mixHex, luminance, contrastRatio, shade, brightnessBudget, hashString, mulberry32, seededRandom };
