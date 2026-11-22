/* ESH27 twin — sky & time department — time.js
 * Time scales and calendars, pure JS, no dependencies.
 *   - Julian Day <-> civil calendar (Julian calendar before 1582-10-15, Gregorian after; or forced).
 *     Astronomical year numbering: year 0 = 1 BCE, year -762 = 763 BCE.
 *   - ΔT = TT − UT: Espenak & Meeus (2006, NASA "Five Millennium Canon of Solar Eclipses", polynomials based on
 *     Morrison & Stephenson 2004) for years < 2005; measured IERS values 2005–2026 (yearly table, ±0.1 s);
 *     beyond 2026 a parabola joined continuously to the long-term law (uncertainty grows: stated by deltaTSigma).
 *   - Uncertainty σ(ΔT): Morrison & Stephenson 2004 rule ≈ 0.8·t² s (t = centuries from 1820) before 1600,
 *     few seconds 1600–1900, < 0.1 s since 1955 (measured), and an extrapolation band for the future.
 *     Consequence (stated honestly): the VALUE of ΔT reaches hours before 500 BCE (≈ 4.8 h at 500 BCE,
 *     ≈ 7 h at 1000 BCE), its UNCERTAINTY is ≈ ±7 min at 500 BCE, ±11 min at 1000 BCE, ±30 min at 2000 BCE.
 *     A ±σ error of ΔT rotates the whole sky about the polar axis by 15"/s·σ (±1.8° at 500 BCE), i.e. rise/set
 *     times of everything shift by ±σ, while the shapes of the sky (Moon–star separations etc.) are unaffected.
 */
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const J2000 = 2451545.0;
const mod = (a, n) => ((a % n) + n) % n;

/** JD (UT) from a JS Date or epoch ms (proleptic Gregorian, as JS). */
export function jdFromDate(date) { const ms = typeof date === 'number' ? date : date.getTime(); return ms / 86400000 + 2440587.5; }
export function dateFromJd(jd) { return new Date(Math.round((jd - 2440587.5) * 86400000)); }

/** Is (y,m,d) before the Gregorian reform (1582-10-15)? */
export function isJulianDate(y, m, d) { return y < 1582 || (y === 1582 && (m < 10 || (m === 10 && d < 15))); }

/**
 * Calendar date → JD (Meeus ch.7). day may be fractional; hours etc. via the fraction.
 * @param {'auto'|'julian'|'gregorian'} cal  auto = Julian before 1582-10-15 (as historians date events)
 */
export function jdFromCalendar(y, m, d, cal = 'auto') {
  const julian = cal === 'julian' || (cal === 'auto' && isJulianDate(y, m, Math.floor(d)));
  let Y = y, M = m; if (M <= 2) { Y -= 1; M += 12; }
  const A = Math.floor(Y / 100), B = julian ? 0 : 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + d + B - 1524.5;
}
/** JD → {y, m, d, h, mi, s, cal} (Meeus ch.7). cal 'auto' = Julian for JD < 2299160.5. */
export function calendarFromJd(jd, cal = 'auto') {
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  const julian = cal === 'julian' || (cal === 'auto' && z < 2299161);
  let A = z; if (!julian) { const al = Math.floor((z - 1867216.25) / 36524.25); A = z + 1 + al - Math.floor(al / 4); }
  const B = A + 1524, C = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * C), E = Math.floor((B - D) / 30.6001);
  const dayF = B - D - Math.floor(30.6001 * E) + f, d = Math.floor(dayF);
  const m = E < 14 ? E - 1 : E - 13, y = m > 2 ? C - 4716 : C - 4715;
  let secs = Math.round((dayF - d) * 86400); let dd = d;
  if (secs >= 86400) { secs -= 86400; dd += 1; }   // rare rounding spill; caller formats, month overflow ignored (sub-second)
  return { y, m, d: dd, h: Math.floor(secs / 3600), mi: Math.floor(secs / 60) % 60, s: secs % 60, cal: julian ? 'julian' : 'gregorian', dow: mod(Math.floor(jd + 1.5), 7) };
}
/** Year label: astronomical year → "763 לפנה״ס" / "2026". */
export function yearLabelHe(y) { return y <= 0 ? `${1 - y} לפנה״ס` : String(y); }

// ---------------------------------------------------------------- ΔT
// IERS measured ΔT at the start of each year 2005..2026 (s). Source: IERS (checked against skyfield-data finals2000A: ≤ 0.02 s).
const DT_MEAS = [64.69, 64.85, 65.15, 65.46, 65.78, 66.07, 66.32, 66.60, 66.91, 67.28, 67.64, 68.10, 68.59, 68.97, 69.22, 69.36, 69.36, 69.29, 69.20, 69.18, 69.14, 69.11];
const DT_Y0 = 2005, DT_Y1 = DT_Y0 + DT_MEAS.length - 1;            // 2026
const longTerm = y => { const u = (y - 1820) / 100; return -20 + 32 * u * u; };
/**
 * ΔT = TT − UT in seconds for a decimal year (astronomical numbering).
 * @param {number} y decimal year (e.g. 2026.9). Use decimalYear(jd) to get it.
 */
export function deltaT(y) {
  let t, u;
  if (y < -500) return longTerm(y);
  if (y < 500) { u = y / 100; return 10583.6 + u * (-1014.41 + u * (33.78311 + u * (-5.952053 + u * (-0.1798452 + u * (0.022174192 + u * 0.0090316521))))); }
  if (y < 1600) { u = (y - 1000) / 100; return 1574.2 + u * (-556.01 + u * (71.23472 + u * (0.319781 + u * (-0.8503463 + u * (-0.005050998 + u * 0.0083572073))))); }
  if (y < 1700) { t = y - 1600; return 120 + t * (-0.9808 + t * (-0.01532 + t / 7129)); }
  if (y < 1800) { t = y - 1700; return 8.83 + t * (0.1603 + t * (-0.0059285 + t * (0.00013336 - t / 1174000))); }
  if (y < 1860) { t = y - 1800; return 13.72 + t * (-0.332447 + t * (0.0068612 + t * (0.0041116 + t * (-0.00037436 + t * (0.0000121272 + t * (-0.0000001699 + t * 0.000000000875)))))); }
  if (y < 1900) { t = y - 1860; return 7.62 + t * (0.5737 + t * (-0.251754 + t * (0.01680668 + t * (-0.0004473624 + t / 233174)))); }
  if (y < 1920) { t = y - 1900; return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - 0.000197 * t))); }
  if (y < 1941) { t = y - 1920; return 21.20 + t * (0.84493 + t * (-0.076100 + t * 0.0020936)); }
  if (y < 1961) { t = y - 1950; return 29.07 + t * (0.407 + t * (-1 / 233 + t / 2547)); }
  if (y < 1986) { t = y - 1975; return 45.45 + t * (1.067 + t * (-1 / 260 - t / 718)); }
  if (y < DT_Y0) { t = y - 2000; return 63.86 + t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599)))); }
  if (y <= DT_Y1) { const i = Math.min(DT_MEAS.length - 2, Math.floor(y - DT_Y0)), f = y - DT_Y0 - i; return DT_MEAS[i] + (DT_MEAS[i + 1] - DT_MEAS[i]) * f; }
  // future: from the last measured value (slope ≈ 0 in 2020–2026) a parabola that meets the long-term law at 2150
  if (y < 2150) { const d0 = DT_MEAS[DT_MEAS.length - 1], t = y - DT_Y1, q = (longTerm(2150) - d0) / ((2150 - DT_Y1) ** 2); return d0 + q * t * t; }
  return longTerm(y);
}
/** 1-σ uncertainty of ΔT (s) — see header. */
export function deltaTSigma(y) {
  if (y >= 1955 && y <= DT_Y1) return 0.1;
  if (y > DT_Y1) { const t = y - DT_Y1; return 0.1 + 0.008 * t * t; }        // extrapolation: ≈ ±5 s by 2050, ±44 s by 2100
  if (y >= 1900) return 0.5;
  if (y >= 1600) return 1 + (1900 - y) * 0.06;                               // ≈ ±1 s (1900) … ±19 s (1600)
  const t = (y - 1820) / 100; return Math.max(20, 0.8 * t * t);
}
export function decimalYear(jd) { const c = calendarFromJd(jd, 'gregorian'); const j0 = jdFromCalendar(c.y, 1, 1, 'gregorian'), j1 = jdFromCalendar(c.y + 1, 1, 1, 'gregorian'); return c.y + (jd - j0) / (j1 - j0); }
/** TT Julian Day from UT Julian Day. */
export function jdTT(jdUT) { return jdUT + deltaT(decimalYear(jdUT)) / 86400; }

// ---------------------------------------------------------------- sidereal time
/** Greenwich mean sidereal time (deg), IAU 1982 (Meeus 12.4), argument UT. */
export function gmst(jdUT) {
  const T = (jdUT - J2000) / 36525;
  return mod(280.46061837 + 360.98564736629 * (jdUT - J2000) + T * T * (0.000387933 - T / 38710000), 360);
}
