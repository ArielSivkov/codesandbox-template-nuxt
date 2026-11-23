/* ESH27 twin physics — sun.js
 * Solar position, sunrise / sunset / solar noon, Israel time zone, ENU direction vector.
 *
 * Algorithm: NOAA Solar Calculator (equations from Jean Meeus, "Astronomical Algorithms"),
 *   https://gml.noaa.gov/grad/solcalc/calcdetails.html  (spreadsheet NOAA_Solar_Calculations_day.xls)
 *   NOAA states ~1 min accuracy for sunrise/sunset within +/-72 deg latitude; the angle accuracy of
 *   this low-precision theory is ~0.01 deg for 1800–2100 (validated here against USNO and NREL SPA,
 *   see test/sun.test.mjs + test/spa_reference.json: max 0.013°, median 0.0036°, rise/set ≤ 3 s).
 *
 * APPROXIMATIONS (labeled):
 *   [A1] ΔT (TT−UT ≈ 69 s) is ignored: shifts solar longitude by ~0.0008 deg — negligible.
 *   [A2] Refraction: NOAA piecewise formula (standard atmosphere 1010 hPa, 10 °C). Optional
 *        pressure/temperature scaling (P/1010)·(283/(273+T)) as in Meeus ch.16 (Saemundsson).
 *        Real refraction near the horizon varies by ±0.2 deg with weather — no formula fixes that.
 *   [A3] Optional topocentric parallax: elevation −= 8.794"·cos(elev) (Meeus ch.40, first order).
 *   [A4] Sunrise/sunset: sun's upper limb at the sea-level horizon, 0.833 deg below (34' refraction +
 *        16' semidiameter), as NOAA and USNO. Observer height / terrain horizon are NOT included.
 *
 * Frame convention of the twin (same as twin/game/js/sim.js):
 *   x = east, y = up, z = south (north = −z). Right-handed, so it IS three.js world space
 *   (three.js camera looks down −z = north by default).
 *   If ground coordinates come from ITM (EPSG:2039) as (E, N): three.x = E − E0, three.z = −(N − N0).
 *   ITM "grid north" differs from true north by the meridian convergence γ (≈ −0.29° at Ashdod);
 *   pass gammaDeg = itmConvergence(lat, lon) to sunVector() so that the light hits the grid correctly.
 */

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

const mod = (a, n) => ((a % n) + n) % n;

/** Julian Day from a JS Date / epoch milliseconds (UTC). */
export function julianDay(date) {
  const ms = typeof date === 'number' ? date : date.getTime();
  return ms / 86400000 + 2440587.5;
}

/** Low-level NOAA quantities for an instant. Returns degrees / minutes. */
export function solarCoordinates(date) {
  const jd = julianDay(date);
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * D2R;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
            Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const trueAnom = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnom * D2R)); // AU
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);         // apparent longitude
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const lr = lambda * D2R, er = eps * D2R;
  const ra = mod(Math.atan2(Math.cos(er) * Math.sin(lr), Math.cos(lr)) * R2D, 360);
  const decl = Math.asin(Math.sin(er) * Math.sin(lr)) * R2D;
  const y = Math.tan(er / 2) ** 2;
  const L0r = L0 * D2R;
  const eqTime = 4 * R2D * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) +
    4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) -
    1.25 * e * e * Math.sin(2 * Mr));                                            // minutes
  return { jd, T, declination: decl, rightAscension: ra, eqTime, distanceAU: R, apparentLongitude: lambda };
}

/** Atmospheric refraction (deg) to ADD to the geometric elevation (deg). NOAA formula [A2]. */
export function refractionNOAA(elevDeg, pressureHPa = 1010, tempC = 10) {
  const h = elevDeg;
  let r;
  if (h > 85) r = 0;
  else if (h > 5) { const t = Math.tan(h * D2R); r = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5; }
  else if (h > -0.575) r = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  else r = -20.774 / Math.tan(h * D2R);
  r /= 3600;
  return r * (pressureHPa / 1010) * (283 / (273 + tempC));
}

/**
 * Solar position.
 * @param {Date|number} date  instant (UTC epoch)
 * @param {number} lat  degrees north
 * @param {number} lon  degrees east
 * @param {object} [o] {refraction=true, pressure=1010 hPa, temperature=10 °C, parallax=false}
 * @returns {{elevation, azimuth, zenith, elevationGeometric, refraction, declination, eqTime, hourAngle}}
 *   azimuth: degrees from TRUE north, clockwise (east = 90).
 */
export function sunPosition(date, lat, lon, o = {}) {
  const ms = typeof date === 'number' ? date : date.getTime();
  const sc = solarCoordinates(ms);
  const utcMin = mod(ms / 60000, 1440);
  const tst = mod(utcMin + sc.eqTime + 4 * lon, 1440);
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;                          // hour angle, deg
  const latr = lat * D2R, dr = sc.declination * D2R, har = ha * D2R;
  const cz = Math.min(1, Math.max(-1, Math.sin(latr) * Math.sin(dr) + Math.cos(latr) * Math.cos(dr) * Math.cos(har)));
  let elevGeo = 90 - Math.acos(cz) * R2D;
  if (o.parallax) elevGeo -= (8.794 / 3600) * Math.cos(elevGeo * D2R) / sc.distanceAU;   // [A3]
  const refr = o.refraction === false ? 0 : refractionNOAA(elevGeo, o.pressure ?? 1010, o.temperature ?? 10);
  const elevation = elevGeo + refr;
  const az = mod(Math.atan2(Math.sin(har), Math.cos(har) * Math.sin(latr) - Math.tan(dr) * Math.cos(latr)) * R2D + 180, 360);
  return { elevation, azimuth: az, zenith: 90 - elevation, elevationGeometric: elevGeo, refraction: refr,
           declination: sc.declination, eqTime: sc.eqTime, hourAngle: ha };
}

/** Unit vector toward the sun in the twin frame (x east, y up, z south). gammaDeg: ITM convergence. */
export function sunVector(elevationDeg, azimuthDeg, gammaDeg = 0) {
  const a = (azimuthDeg - gammaDeg) * D2R, e = elevationDeg * D2R;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
}

/** Meridian convergence of ITM (EPSG:2039; TM, central meridian 35°12'16.261"E).
 *  First-order TM formula γ ≈ Δλ·sinφ (error < 0.001° inside Israel, checked vs pyproj in tests).
 *  grid azimuth = true azimuth − γ. */
export const ITM_LON0 = 35 + 12 / 60 + 16.261 / 3600;
export function itmConvergence(lat, lon) {
  const dl = (lon - ITM_LON0) * D2R, p = lat * D2R;
  // TM series (Snyder 1987, "Map Projections – A Working Manual", USGS PP 1395, §8):
  // γ = Δλ·sinφ·[1 + (Δλ·cosφ)²/3·(1 + 3η² + …)]; the η² (ellipsoid) part is ignored [approx, <1e-5 deg here]
  return R2D * dl * Math.sin(p) * (1 + (dl * Math.cos(p)) ** 2 / 3);
}

// ---------------------------------------------------------------- time zones
/** UTC offset (minutes) of an IANA zone at an instant, via Intl (full ICU in Node ≥13 and browsers). */
export function tzOffsetMinutes(date, timeZone = 'Asia/Jerusalem') {
  const ms = typeof date === 'number' ? date : date.getTime();
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(ms / 1000) * 1000) / 60000);
  } catch (e) {
    if (timeZone === 'Asia/Jerusalem') return israelOffsetRule(ms);
    throw e;
  }
}

/** Israel's statutory rule (Time Determination Law, amended 2013): DST from the Friday before the last
 *  Sunday of March, 02:00 local, until the last Sunday of October, 02:00 local. Fallback when Intl lacks ICU. */
export function israelOffsetRule(ms) {
  const y = new Date(ms).getUTCFullYear();
  const lastSunday = (month) => { const d = new Date(Date.UTC(y, month + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
  const start = Date.UTC(y, 2, lastSunday(2) - 2, 0, 0);       // Fri 02:00 IST = 00:00 UTC
  const end = Date.UTC(y, 9, lastSunday(9), -1, 0);           // Sun 02:00 IDT = 23:00 UTC Saturday
  return ms >= start && ms < end ? 180 : 120;
}

/** Convert a local wall-clock time in a zone to a UTC Date (handles DST; ambiguous hour → first). */
export function localToUtc(y, m, d, hh = 0, mm = 0, ss = 0, timeZone = 'Asia/Jerusalem') {
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss);
  let ms = naive - tzOffsetMinutes(naive, timeZone) * 60000;
  ms = naive - tzOffsetMinutes(ms, timeZone) * 60000;
  return new Date(ms);
}

/** Format a UTC instant as local "HH:MM:SS" in the zone. */
export function formatLocal(date, timeZone = 'Asia/Jerusalem') {
  const ms = typeof date === 'number' ? date : date.getTime();
  const t = new Date(ms + tzOffsetMinutes(ms, timeZone) * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

// ---------------------------------------------------------------- rise / set / noon
/**
 * Sunrise, sunset, solar noon for a LOCAL calendar date.
 * NOAA method, but iterated (3x) so declination / equation of time are evaluated at the event itself
 * (the NOAA spreadsheet evaluates them once at the input time; iteration removes ~10–20 s of error).
 * @returns {{sunrise: Date|null, sunset: Date|null, solarNoon: Date, dayLengthMin, local:{...}, utcOffsetMin}}
 *   null sunrise/sunset → polar day/night (not reachable in Israel).
 */
export function sunTimes(y, m, d, lat, lon, timeZone = 'Asia/Jerusalem', zenithDeg = 90.833) {
  const latr = lat * D2R;
  const event = (kind) => {
    // first guess: solar noon of that calendar date (≈ 12:00 UTC − lon/15 h). Valid while |UTC offset − lon/15| < 12 h.
    let t = Date.UTC(y, m - 1, d, 12) - (lon / 15) * 3600000;
    for (let i = 0; i < 4; i++) {
      const sc = solarCoordinates(t);
      const dr = sc.declination * D2R;
      let haDeg = 0;
      if (kind !== 0) {
        const c = Math.cos(zenithDeg * D2R) / (Math.cos(latr) * Math.cos(dr)) - Math.tan(latr) * Math.tan(dr);
        if (c > 1 || c < -1) return null;
        haDeg = Math.acos(c) * R2D * kind; // kind −1 rise, +1 set
      }
      // minutes after 00:00 UTC of the UTC day containing t
      const utcDay = Math.floor(t / 86400000) * 86400000;
      let minUTC = 720 - 4 * (lon - haDeg) - sc.eqTime;
      let tn = utcDay + minUTC * 60000;
      // keep the event within ±12 h of the previous estimate (day roll-over)
      while (tn - t > 43200000) tn -= 86400000;
      while (t - tn > 43200000) tn += 86400000;
      t = tn;
    }
    return new Date(Math.round(t));
  };
  const sunrise = event(-1), sunset = event(1), solarNoon = event(0);
  const off = tzOffsetMinutes(solarNoon, timeZone);
  return {
    sunrise, sunset, solarNoon,
    dayLengthMin: sunrise && sunset ? (sunset - sunrise) / 60000 : null,
    utcOffsetMin: off,
    local: {
      sunrise: sunrise && formatLocal(sunrise, timeZone),
      sunset: sunset && formatLocal(sunset, timeZone),
      solarNoon: formatLocal(solarNoon, timeZone),
    },
  };
}
