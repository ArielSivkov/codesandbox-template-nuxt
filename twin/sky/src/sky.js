/* ESH27 twin — sky & time department — sky.js
 * Pure-JS ephemeris, no network, no dependencies. Validated in test/ against python `ephem` (libastro),
 * JPL DE421 (via skyfield) and the installed reference data in ref/ (see README.txt for measured errors).
 *
 * Theories (all cited, all data embedded):
 *   Planets + Earth: VSOP87D (Bretagnon & Francou 1988), truncated (src/data/vsop87d.js, 2074 terms; truncation
 *     error ≤ 4.4" geocentric for −1000..2100). FK5 correction Meeus 32.3. Light-time iterated, annual
 *     aberration from the Earth's VSOP velocity (vector form, first order in v/c).
 *   Moon: Meeus "Astronomical Algorithms" 2nd ed. ch.47 (ELP-2000/82 truncated, 60+60 terms, ≈10" lon / 4" lat).
 *   Nutation: IAU 1980, 63 terms (Meeus table 22.A). Mean obliquity: Laskar 1986 (valid ±10 000 years).
 *   Precession (stars only; planets/Moon are already "of date"): IAU 2006 P03 (Capitaine et al. 2003),
 *     ζA, zA, θA polynomials. Proper motion: linear space-motion on the unit sphere (no radial velocity term).
 *   Sidereal time: GMST IAU 1982 (Meeus 12.4) + equation of the equinoxes. UT1 ≈ UTC (|DUT1| < 0.9 s → < 0.004°).
 *   Topocentric: WGS-84 observer (Meeus ch.11), vector subtraction (exact parallax; Moon up to ~1°).
 *   Refraction (optional, "apparent"): Saemundsson 1986 (Meeus 16.4) scaled by P/1010·283/(273+T).
 *   Stars: Yale Bright Star Catalogue 5th ed., 300 brightest (src/data/bsc300.js).
 * Frame of the twin: x = east, y = up, z = south (north = −z), as physics/src/sun.js. ITM grid north differs from
 *   true north by γ (≈ −0.29° at Ashdod): pass gammaDeg (grid azimuth = true azimuth − γ).
 * Not modelled (each < 0.01° unless stated): polar motion, diurnal aberration, relativistic deflection,
 *   annual parallax of stars, Saturn's ring in its magnitude (± 0.5 mag), weather-dependent refraction (±0.2° at horizon).
 */
import { VSOP } from './data/vsop87d.js';
import { MOON_LR, MOON_B, NUT80 } from './data/moon47.js';
import { STARS } from './data/bsc300.js';
import { D2R, R2D, J2000, jdFromDate, jdTT as toTT, gmst, decimalYear, deltaT, deltaTSigma } from './time.js';

export const AU_KM = 149597870.7;
const C_AU_D = 173.1446326846693;            // speed of light, AU/day
const EARTH_A = 6378.137, EARTH_F = 1 / 298.257223563;
const mod = (a, n) => ((a % n) + n) % n;
const sinD = d => Math.sin(d * D2R), cosD = d => Math.cos(d * D2R);
export const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
export const PLANET_HE = { Sun: 'שמש', Moon: 'ירח', Mercury: 'כוכב (חמה)', Venus: 'נוגה', Mars: 'מאדים', Jupiter: 'צדק', Saturn: 'שבתאי' };

// ---------------------------------------------------------------- time context
/**
 * Build a time context. input: Date | epoch ms (UTC) | {jdUT} | {jdTT}. o.deltaT (s) overrides the ΔT model.
 * @returns {{jdUT, jdTT, T, deltaT, deltaTSigma, year, eps0, eps, dpsi, deps, gast}}  angles in degrees
 */
export function time(input, o = {}) {
  if (input && input._ctx) return input;
  let jdUT, jdTT;
  if (input && typeof input === 'object' && !(input instanceof Date)) {
    if (input.jdUT != null) jdUT = input.jdUT;
    else if (input.jdTT != null) { jdTT = input.jdTT; jdUT = jdTT - (o.deltaT ?? deltaT(decimalYear(jdTT))) / 86400; }
  } else jdUT = jdFromDate(input == null ? Date.now() : input);
  const year = decimalYear(jdUT), dT = o.deltaT ?? deltaT(year);
  if (jdTT == null) jdTT = jdUT + dT / 86400;
  const T = (jdTT - J2000) / 36525;
  const n = nutationCached(jdTT), eps0 = meanObliquity(T), eps = eps0 + n.deps;
  const gast = mod(gmst(jdUT) + n.dpsi * cosD(eps), 360);
  return { _ctx: true, jdUT, jdTT, T, deltaT: dT, deltaTSigma: deltaTSigma(year), year, eps0, eps, dpsi: n.dpsi, deps: n.deps, gast };
}

// nutation is evaluated on a 1-hour grid and interpolated linearly (error < 0.0005": the fastest term,
// 0.2" with period 5.6 d, curves by < 1e-4" within an hour) — saves 63 sin+cos per call.
const NUTC = { k: NaN, a: null, b: null };
function nutationCached(jdTT) {
  const h = jdTT * 24, k = Math.floor(h), f = h - k;
  if (k !== NUTC.k) { NUTC.k = k; NUTC.a = nutation((k / 24 - J2000) / 36525); NUTC.b = nutation(((k + 1) / 24 - J2000) / 36525); }
  return { dpsi: NUTC.a.dpsi + (NUTC.b.dpsi - NUTC.a.dpsi) * f, deps: NUTC.a.deps + (NUTC.b.deps - NUTC.a.deps) * f };
}
/** IAU 1980 nutation (Meeus ch.22, table 22.A). Returns degrees. */
export function nutation(T) {
  const D = 297.85036 + T * (445267.111480 + T * (-0.0019142 + T / 189474));
  const M = 357.52772 + T * (35999.050340 + T * (-0.0001603 - T / 300000));
  const Mp = 134.96298 + T * (477198.867398 + T * (0.0086972 + T / 56250));
  const F = 93.27191 + T * (483202.017538 + T * (-0.0036825 + T / 327270));
  const Om = 125.04452 + T * (-1934.136261 + T * (0.0020708 + T / 450000));
  let ps = 0, ep = 0;
  for (let i = 0; i < NUT80.length; i++) {
    const r = NUT80[i], a = (r[0] * D + r[1] * M + r[2] * Mp + r[3] * F + r[4] * Om) * D2R;
    ps += (r[5] + r[6] * T) * Math.sin(a); ep += (r[7] + r[8] * T) * Math.cos(a);
  }
  return { dpsi: ps / 36e6, deps: ep / 36e6 };
}
/** Mean obliquity of the ecliptic, Laskar 1986 (Meeus 22.3), degrees. Valid ±10 000 years from J2000. */
export function meanObliquity(T) {
  const U = T / 100; const c = [-4680.93, -1.55, 1999.25, -51.38, -249.67, -39.05, 7.12, 27.87, 5.79, 2.45];
  let s = 0, p = U; for (const k of c) { s += k * p; p *= U; }
  return 23 + 26 / 60 + (21.448 + s) / 3600;
}

// ---------------------------------------------------------------- VSOP87D
function vsopSeries(ser, tau) {
  let s = 0, p = 1;
  for (let k = 0; k < ser.length; k++) {
    const a = ser[k]; let acc = 0;
    for (let i = 0; i < a.length; i += 3) acc += a[i] * Math.cos(a[i + 1] + a[i + 2] * tau);
    s += acc * p; p *= tau;
  }
  return s * 1e-8;
}
/** Heliocentric ecliptic (of date, VSOP87D dynamical frame) spherical L, B (rad), R (AU) at TT Julian day. */
export function vsopLBR(planet, jdTT) {
  const m = VSOP[planet], tau = (jdTT - J2000) / 365250;
  return [mod(vsopSeries(m.L, tau), 2 * Math.PI), vsopSeries(m.B, tau), vsopSeries(m.R, tau)];
}
function vsopXYZ(planet, jdTT) {
  const [L, B, R] = vsopLBR(planet, jdTT), cb = Math.cos(B);
  return [R * cb * Math.cos(L), R * cb * Math.sin(L), R * Math.sin(B)];
}
function vsopSeriesRate(ser, tau) {   // value and d/dτ in one pass
  let s = 0, ds = 0, p = 1, pm = 0;
  for (let k = 0; k < ser.length; k++) {
    const a = ser[k]; let acc = 0, dacc = 0;
    for (let i = 0; i < a.length; i += 3) { const arg = a[i + 1] + a[i + 2] * tau; acc += a[i] * Math.cos(arg); dacc -= a[i] * a[i + 2] * Math.sin(arg); }
    s += acc * p; ds += dacc * p + (k ? k * acc * pm : 0); pm = p; p *= tau;
  }
  return [s * 1e-8, ds * 1e-8];
}
const earthCache = { jd: NaN, p: null, v: null };
function earthState(jdTT) {
  if (earthCache.jd === jdTT) return earthCache;
  const m = VSOP.Earth, tau = (jdTT - J2000) / 365250;
  const [L, dL] = vsopSeriesRate(m.L, tau), [B, dB] = vsopSeriesRate(m.B, tau), [R, dR] = vsopSeriesRate(m.R, tau);
  const cL = Math.cos(L), sL = Math.sin(L), cB = Math.cos(B), sB = Math.sin(B), k = 1 / 365250;   // d/dτ → per day
  earthCache.jd = jdTT; earthCache.p = [R * cB * cL, R * cB * sL, R * sB];
  earthCache.v = [k * (dR * cB * cL - R * sB * dB * cL - R * cB * sL * dL), k * (dR * cB * sL - R * sB * dB * sL + R * cB * cL * dL), k * (dR * sB + R * cB * dB)];
  return earthCache;
}
function addAberration(u, v) {      // u unit vector, v velocity AU/day (same frame) → apparent direction (unit)
  const x = u[0] + v[0] / C_AU_D, y = u[1] + v[1] / C_AU_D, z = u[2] + v[2] / C_AU_D, n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}
function fk5Correction(lam, bet, T) {   // Meeus 32.3, degrees in/out
  const Lp = (lam - 1.397 * T - 0.00031 * T * T) * D2R;
  const dl = (-0.09033 + 0.03916 * (Math.cos(Lp) + Math.sin(Lp)) * Math.tan(bet * D2R)) / 3600;
  const db = (0.03916 * (Math.cos(Lp) - Math.sin(Lp))) / 3600;
  return [lam + dl, bet + db];
}
function eclToEq(lam, bet, eps) {   // degrees → RA, Dec degrees
  const l = lam * D2R, b = bet * D2R, e = eps * D2R;
  const ra = mod(Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) * R2D, 360);
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) * R2D;
  return [ra, dec];
}

/** Geocentric apparent ecliptic/equatorial position of the Sun or a planet. */
export function geocentric(name, t, o = {}) {
  const c = time(t), E = earthState(c.jdTT);
  let dx, dy, dz, dist, r = 0, tauLt = o.tauDays || 0;
  if (name === 'Sun') { dx = -E.p[0]; dy = -E.p[1]; dz = -E.p[2]; dist = Math.hypot(dx, dy, dz); }
  else {
    for (let it = 0, nIt = o.tauDays ? 1 : 2; it < nIt; it++) {   // 2 iterations: residual light-time error < 0.01"; 1 with a good guess
      const P = vsopXYZ(name, c.jdTT - tauLt);
      dx = P[0] - E.p[0]; dy = P[1] - E.p[1]; dz = P[2] - E.p[2]; dist = Math.hypot(dx, dy, dz);
      r = Math.hypot(P[0], P[1], P[2]); tauLt = dist / C_AU_D;
    }
  }
  const u = addAberration([dx / dist, dy / dist, dz / dist], E.v);
  let lam = mod(Math.atan2(u[1], u[0]) * R2D, 360), bet = Math.asin(u[2]) * R2D;
  [lam, bet] = fk5Correction(lam, bet, c.T);
  lam = mod(lam + c.dpsi, 360);
  const [ra, dec] = eclToEq(lam, bet, c.eps);
  const R = Math.hypot(E.p[0], E.p[1], E.p[2]);
  return { name, lam, bet, ra, dec, distAU: dist, distKm: dist * AU_KM, r: name === 'Sun' ? 0 : r, R };
}

/** Geocentric apparent Moon (Meeus ch.47). */
export function moonGeocentric(t) {
  const c = time(t), T = c.T;
  const Lp = 218.3164477 + T * (481267.88123421 + T * (-0.0015786 + T * (1 / 538841 - T / 65194000)));
  const D = 297.8501921 + T * (445267.1114034 + T * (-0.0018819 + T * (1 / 545868 - T / 113065000)));
  const M = 357.5291092 + T * (35999.0502909 + T * (-0.0001536 + T / 24490000));
  const Mp = 134.9633964 + T * (477198.8675055 + T * (0.0087414 + T * (1 / 69699 - T / 14712000)));
  const F = 93.2720950 + T * (483202.0175233 + T * (-0.0036539 + T * (-1 / 3526000 + T / 863310000)));
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  const Ec = 1 - T * (0.002516 + 0.0000074 * T), E2 = Ec * Ec;
  let sl = 0, sr = 0, sb = 0;
  for (let i = 0; i < MOON_LR.length; i++) {
    const r = MOON_LR[i], a = (r[0] * D + r[1] * M + r[2] * Mp + r[3] * F) * D2R, e = r[1] === 0 ? 1 : (Math.abs(r[1]) === 1 ? Ec : E2);
    sl += r[4] * e * Math.sin(a); sr += r[5] * e * Math.cos(a);
  }
  for (let i = 0; i < MOON_B.length; i++) {
    const r = MOON_B[i], a = (r[0] * D + r[1] * M + r[2] * Mp + r[3] * F) * D2R, e = r[1] === 0 ? 1 : (Math.abs(r[1]) === 1 ? Ec : E2);
    sb += r[4] * e * Math.sin(a);
  }
  sl += 3958 * sinD(A1) + 1962 * sinD(Lp - F) + 318 * sinD(A2);
  sb += -2235 * sinD(Lp) + 382 * sinD(A3) + 175 * sinD(A1 - F) + 175 * sinD(A1 + F) + 127 * sinD(Lp - Mp) - 115 * sinD(Lp + Mp);
  const lam = mod(Lp + sl / 1e6 + c.dpsi, 360), bet = sb / 1e6, distKm = 385000.56 + sr / 1000;
  const [ra, dec] = eclToEq(lam, bet, c.eps);
  return { name: 'Moon', lam, bet, ra, dec, distKm, distAU: distKm / AU_KM, meanElong: mod(D, 360) };
}

// ---------------------------------------------------------------- observer / topocentric
/** Observer on the WGS-84 ellipsoid. elev in metres above the ellipsoid (≈ above sea level, ±30 m geoid in Israel). */
export function observer(lat, lon, elev = 0) {
  const u = Math.atan((1 - EARTH_F) * Math.tan(lat * D2R)), h = elev / 1000 / EARTH_A;
  return { lat, lon, elev, rs: (1 - EARTH_F) * Math.sin(u) + h * Math.sin(lat * D2R), rc: Math.cos(u) + h * Math.cos(lat * D2R) };
}
/** Refraction (deg) to add to a true altitude (Saemundsson, Meeus 16.4). */
export function refraction(altDeg, pressure = 1010, tempC = 10) {
  if (altDeg < -5) return 0;                                   // far below the horizon: not observable, no refraction
  const h = Math.max(altDeg, -1.9);
  let R = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60;
  if (altDeg < -1.9) R *= (altDeg + 5) / 3.1;                  // taper to 0 between −1.9° and −5° (continuity only)
  return Math.max(0, R) * (pressure / 1010) * (283 / (273 + tempC));
}
/**
 * Geocentric apparent RA/Dec (+ distance km) → topocentric, horizontal and twin vector.
 * @returns {{ra, dec, alt, altApparent, az, hourAngle, east, north, up, vec:{x,y,z}}}
 */
export function topocentric(ra, dec, distKm, c, obs, o = {}) {
  const th = (c.gast + obs.lon) * D2R, a = ra * D2R, d = dec * D2R;
  let x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
  if (distKm && isFinite(distKm)) {
    const k = EARTH_A / distKm;
    x -= k * obs.rc * Math.cos(th); y -= k * obs.rc * Math.sin(th); z -= k * obs.rs;
    const n = Math.hypot(x, y, z); x /= n; y /= n; z /= n;
  }
  const rt = mod(Math.atan2(y, x) * R2D, 360), dt = Math.asin(Math.max(-1, Math.min(1, z))) * R2D;
  const H = th - rt * D2R, p = obs.lat * D2R, cd = Math.cos(dt * D2R), sd = Math.sin(dt * D2R);
  const east = -cd * Math.sin(H), north = sd * Math.cos(p) - cd * Math.cos(H) * Math.sin(p), up = sd * Math.sin(p) + cd * Math.cos(H) * Math.cos(p);
  const alt = Math.asin(Math.max(-1, Math.min(1, up))) * R2D, az = mod(Math.atan2(east, north) * R2D, 360);
  const altApparent = o.refraction === false ? alt : alt + refraction(alt, o.pressure ?? 1010, o.temperature ?? 10);
  return { ra: rt, dec: dt, alt, altApparent, az, hourAngle: mod(H * R2D + 180, 360) - 180, east, north, up,
    vec: twinVector(altApparent, az, o.gammaDeg || 0) };
}
/** ITM (EPSG:2039) meridian convergence γ in degrees — same formula as physics/src/sun.js itmConvergence (grid az = true az − γ). */
export function itmConvergenceDeg(lat, lon) {
  const dl = (lon - (35 + 12 / 60 + 16.261 / 3600)) * D2R, p = lat * D2R;
  return R2D * dl * Math.sin(p) * (1 + (dl * Math.cos(p)) ** 2 / 3);
}
/** Unit vector in the twin frame (x east, y up, z south) for altitude/azimuth (true north), γ = ITM convergence. */
export function twinVector(altDeg, azDeg, gammaDeg = 0) {
  const a = (azDeg - gammaDeg) * D2R, e = altDeg * D2R;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
}

// ---------------------------------------------------------------- bodies
const PLANET_MAG = {   // Meeus ch.41 (Müller / Astronomical Almanac 1984), phase angle i in degrees
  Mercury: i => -0.42 + i * (0.0380 + i * (-0.000273 + i * 0.000002)),
  Venus: i => -4.40 + i * (0.0009 + i * (0.000239 - i * 0.00000065)),
  Mars: i => -1.52 + 0.016 * i, Jupiter: i => -9.40 + 0.005 * i, Saturn: i => -8.88 + 0.044 * i,   // Saturn: ring term omitted (±0.5 mag)
};
/**
 * Full apparent topocentric position of 'Sun' | 'Moon' | planet.
 * @param {string} name
 * @param t Date | ms | time()-context
 * @param obs observer()
 * @param o {refraction=true, pressure, temperature, gammaDeg}
 */
export function body(name, t, obs, o = {}) {
  const c = time(t);
  if (name === 'Moon') return moon(c, obs, o);
  const g = geocentric(name, c), tp = topocentric(g.ra, g.dec, g.distKm, c, obs, o);
  const out = Object.assign({ name, nameHe: PLANET_HE[name], raGeo: g.ra, decGeo: g.dec, lam: g.lam, bet: g.bet, distAU: g.distAU }, tp);
  if (name === 'Sun') { out.semidiameter = 959.63 / g.distAU / 3600; out.mag = -26.74; return out; }
  const r = g.r, D = g.distAU, R = g.R, ci = (r * r + D * D - R * R) / (2 * r * D);
  const i = Math.acos(Math.max(-1, Math.min(1, ci))) * R2D;
  out.phaseAngle = i; out.phase = (1 + ci) / 2; out.mag = PLANET_MAG[name](i) + 5 * Math.log10(r * D);
  const sun = geocentric('Sun', c); out.elongation = angSep(g.ra, g.dec, sun.ra, sun.dec);
  return out;
}
/** Moon: position, phase (illuminated fraction), age, bright-limb angle, semidiameter. */
export function moon(t, obs, o = {}) {
  const c = time(t), m = moonGeocentric(c), s = geocentric('Sun', c);
  const tp = topocentric(m.ra, m.dec, m.distKm, c, obs, o);
  const psi = angSep(m.ra, m.dec, s.ra, s.dec) * D2R, Rkm = s.distAU * AU_KM;
  const i = Math.atan2(Rkm * Math.sin(psi), m.distKm - Rkm * Math.cos(psi));
  const a0 = s.ra * D2R, d0 = s.dec * D2R, a = m.ra * D2R, d = m.dec * D2R;
  const chi = mod(Math.atan2(Math.cos(d0) * Math.sin(a0 - a), Math.sin(d0) * Math.cos(d) - Math.cos(d0) * Math.sin(d) * Math.cos(a0 - a)) * R2D, 360);
  const elongEcl = mod(m.lam - s.lam, 360);
  const sdGeo = Math.asin(1737.4 / m.distKm) * R2D, topoDist = m.distKm * (1 - (EARTH_A / m.distKm) * (tp.up));   // ≈ topocentric distance
  const iDeg = i * R2D;
  return Object.assign({ name: 'Moon', nameHe: 'ירח', raGeo: m.ra, decGeo: m.dec, lam: m.lam, bet: m.bet, distKm: m.distKm }, tp, {
    phase: (1 + Math.cos(i)) / 2, phaseAngle: iDeg, elongation: psi * R2D, waxing: elongEcl < 180,
    ageDays: elongEcl / 360 * 29.530589, brightLimbAngle: chi, semidiameter: Math.asin(1737.4 / topoDist) * R2D, semidiameterGeo: sdGeo,
    horizontalParallax: Math.asin(EARTH_A / m.distKm) * R2D, mag: -12.73 + 0.026 * Math.abs(iDeg) + 4e-9 * iDeg ** 4,
    phaseNameHe: moonPhaseNameHe(elongEcl),
  });
}
const PHASE_HE = ['מולד (ירח חדש)', 'סהר מתמלא', 'רבע ראשון', 'ירח מתמלא', 'ירח מלא', 'ירח מתמעט', 'רבע אחרון', 'סהר מתמעט'];
export function moonPhaseNameHe(elongEclDeg) { return PHASE_HE[Math.round(mod(elongEclDeg, 360) / 45) % 8]; }
export function angSep(ra1, dec1, ra2, dec2) {
  const c = sinD(dec1) * sinD(dec2) + cosD(dec1) * cosD(dec2) * cosD(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
}

// ---------------------------------------------------------------- stars
// IAU 2006 (P03) equatorial precession, J2000 → mean equator/equinox of date. Rotation matrix (row-major 3x3).
export function precessionMatrix(T) {
  const as = D2R / 3600;
  const zeta = (2.650545 + T * (2306.083227 + T * (0.2988499 + T * (0.01801828 + T * (-0.000005971 - 0.0000003173 * T))))) * as;
  const z = (-2.650545 + T * (2306.077181 + T * (1.0927348 + T * (0.01826837 + T * (-0.000028596 - 0.0000002904 * T))))) * as;
  const th = (T * (2004.191903 + T * (-0.4294934 + T * (-0.04182264 + T * (-0.000007089 - 0.0000001274 * T))))) * as;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(z), sZ = Math.sin(z), ct = Math.cos(th), st = Math.sin(th);
  return [cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st,
          sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st,
          st * cz, -st * sz, ct];
}
function nutationMatrix(c) {
  const e0 = c.eps0 * D2R, e = c.eps * D2R, p = c.dpsi * D2R;
  const se0 = Math.sin(e0), ce0 = Math.cos(e0), se = Math.sin(e), ce = Math.cos(e), sp = Math.sin(p), cp = Math.cos(p);
  return [cp, -sp * ce0, -sp * se0,
          sp * ce, cp * ce * ce0 + se * se0, cp * ce * se0 - se * ce0,
          sp * se, cp * se * ce0 - ce * se0, cp * se * se0 + ce * ce0];
}
const mul3 = (A, B) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return o; };
const app3 = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

/** Earth's velocity (AU/day) in the true equator & equinox of date — for annual aberration of stars. */
function earthVelEq(c) {
  const E = earthState(c.jdTT), e = c.eps * D2R, v = E.v;
  return [v[0], v[1] * Math.cos(e) - v[2] * Math.sin(e), v[1] * Math.sin(e) + v[2] * Math.cos(e)];
}
/** Apparent geocentric RA/Dec (true of date) of a J2000 catalogue position with proper motion (mas/yr, μα* = μα·cosδ). */
export function starApparent(raJ2000, decJ2000, pmRA, pmDec, t) {
  const c = time(t), M = mul3(nutationMatrix(c), precessionMatrix(c.T));
  const v = starVecDate(raJ2000, decJ2000, pmRA, pmDec, c, M, earthVelEq(c));
  return { ra: mod(Math.atan2(v[1], v[0]) * R2D, 360), dec: Math.asin(v[2]) * R2D };
}
function starVecDate(ra, dec, pmRA, pmDec, c, M, vE) {
  const a = ra * D2R, d = dec * D2R, yrs = (c.jdTT - J2000) / 365.25, k = yrs / 3600000 * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
  let x = cd * ca + k * (-pmRA * sa - pmDec * sd * ca), y = cd * sa + k * (pmRA * ca - pmDec * sd * sa), z = sd + k * pmDec * cd;
  const n = Math.hypot(x, y, z); const p = app3(M, [x / n, y / n, z / n]);
  return addAberration(p, vE);
}
// J2000 unit vectors and proper-motion directions of the catalogue, computed once (no trig per refresh afterwards)
let STAR_BASE = null;
function starBase() {
  if (STAR_BASE) return STAR_BASE;
  const n = STARS.length, u = new Float64Array(n * 3), w = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = STARS[i], a = s[1] * D2R, d = s[2] * D2R, ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
    u[i * 3] = cd * ca; u[i * 3 + 1] = cd * sa; u[i * 3 + 2] = sd;
    w[i * 3] = -s[5] * sa - s[6] * sd * ca; w[i * 3 + 1] = s[5] * ca - s[6] * sd * sa; w[i * 3 + 2] = s[6] * cd;   // mas/yr
  }
  STAR_BASE = { n, u, w }; return STAR_BASE;
}
let STAR_CACHE = null;
/**
 * All catalogue stars, apparent of date, as equatorial unit vectors (Float32Array, 3 per star) — compute once per
 * (simulated) day; per frame, rotate with equatorialToTwinMatrix() (stars move < 1"/day against the frame).
 * @returns {{n, eq: Float32Array, mag: Float32Array, bv: Float32Array, names: string[], namesHe: string[], hr: Int32Array, jdTT}}
 */
export function starField(t) {
  const c = time(t);
  if (STAR_CACHE && Math.abs(STAR_CACHE.jdTT - c.jdTT) < 0.5) return STAR_CACHE;
  const M = mul3(nutationMatrix(c), precessionMatrix(c.T)), vE = earthVelEq(c), B = starBase(), n = B.n;
  const k = (c.jdTT - J2000) / 365.25 / 3600000 * D2R;
  const old = STAR_CACHE, eq = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = B.u[i * 3] + k * B.w[i * 3], y = B.u[i * 3 + 1] + k * B.w[i * 3 + 1], z = B.u[i * 3 + 2] + k * B.w[i * 3 + 2];
    const m = Math.hypot(x, y, z); x /= m; y /= m; z /= m;
    let X = M[0] * x + M[1] * y + M[2] * z + vE[0] / C_AU_D, Y = M[3] * x + M[4] * y + M[5] * z + vE[1] / C_AU_D, Z = M[6] * x + M[7] * y + M[8] * z + vE[2] / C_AU_D;
    const q = Math.hypot(X, Y, Z); eq[i * 3] = X / q; eq[i * 3 + 1] = Y / q; eq[i * 3 + 2] = Z / q;
  }
  if (old) { old.eq = eq; old.jdTT = c.jdTT; return old; }
  const mag = new Float32Array(n), bv = new Float32Array(n), hr = new Int32Array(n), names = [], namesHe = [];
  for (let i = 0; i < n; i++) { const s = STARS[i]; mag[i] = s[3]; bv[i] = s[4]; hr[i] = s[0]; names.push(s[7] || s[9]); namesHe.push(s[8] || s[7] || s[9]); }
  STAR_CACHE = { n, eq, mag, bv, hr, names, namesHe, jdTT: c.jdTT };
  return STAR_CACHE;
}
export { STARS };
/**
 * Rotation (row-major 3x3) apparent-equatorial-of-date unit vector → twin frame (x east, y up, z south), incl. γ.
 * Uses the geocentric direction (stellar parallax is nil). Apply: v_twin = R · v_eq.
 */
export function equatorialToTwinMatrix(t, lat, lon, gammaDeg = 0) {
  const c = time(t), th = (c.gast + lon) * D2R, p = lat * D2R, g = gammaDeg * D2R;
  const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(p), sp = Math.sin(p), cg = Math.cos(g), sg = Math.sin(g);
  const E = [-st, ct, 0], N = [-sp * ct, -sp * st, cp], U = [cp * ct, cp * st, sp];
  const X = [0, 1, 2].map(i => E[i] * cg - N[i] * sg), Z = [0, 1, 2].map(i => -(N[i] * cg + E[i] * sg));
  return [X[0], X[1], X[2], U[0], U[1], U[2], Z[0], Z[1], Z[2]];
}
/** Horizontal coordinates of one catalogue star (by HR number or IAU name). */
export function star(id, t, obs, o = {}) {
  const s = STARS.find(r => r[0] === id || r[7] === id); if (!s) return null;
  const c = time(t), ap = starApparent(s[1], s[2], s[5], s[6], c);
  return Object.assign({ name: s[7] || s[9], nameHe: s[8] || s[7], hr: s[0], mag: s[3] }, topocentric(ap.ra, ap.dec, Infinity, c, obs, o));
}

// ---------------------------------------------------------------- Milky Way (optional, visual)
// Galactic → equatorial J2000 (transpose of the Hipparcos matrix ESA 1997, vol.1 §1.5.3).
const GAL = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762];
export function galacticToEquatorialJ2000(l, b) {
  const x = cosD(b) * cosD(l), y = cosD(b) * sinD(l), z = sinD(b);
  return [GAL[0] * x + GAL[3] * y + GAL[6] * z, GAL[1] * x + GAL[4] * y + GAL[7] * z, GAL[2] * x + GAL[5] * y + GAL[8] * z];
}
/** Points along the galactic plane (VISUAL, not a photometric model): [{v:[x,y,z] equatorial of date, w}] */
export function milkyWay(t, n = 900, seed = 2711) {
  const c = time(t), M = mul3(nutationMatrix(c), precessionMatrix(c.T)); let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const l = rnd() * 360, gauss = (rnd() + rnd() + rnd() - 1.5) * 2, bulge = Math.exp(-(((mod(l + 180, 360) - 180) / 40) ** 2));
    const b = gauss * (4 + 6 * bulge), w = 0.35 + 0.65 * bulge;
    out.push({ v: app3(M, galacticToEquatorialJ2000(l, b)), w });
  }
  return out;
}

// ---------------------------------------------------------------- whole sky
/**
 * Everything at once for an instant and place.
 * @returns {{ctx, sun, moon, planets:[...], lst, deltaT, deltaTSigma}}
 */
export function skyAt(t, lat, lon, o = {}) {
  const c = time(t, o), obs = observer(lat, lon, o.elev || 0);
  const sun = body('Sun', c, obs, o), mn = moon(c, obs, o);
  const planets = PLANETS.map(p => body(p, c, obs, o));
  return { ctx: c, sun, moon: mn, planets, lst: mod(c.gast + lon, 360), deltaT: c.deltaT, deltaTSigma: c.deltaTSigma };
}

// ---------------------------------------------------------------- rise / set / transit
/**
 * Rise, set and upper transit of a body within [jdUT0, jdUT0 + 1) (e.g. local midnight → next midnight).
 * Standard altitude of the event: Sun −0.8333° (34' refraction + 16' semidiameter), Moon −34' − topocentric
 * semidiameter (centre altitude), planets/stars −34'. o.h0 overrides; o.dip adds a horizon dip (deg, elevated observer).
 * @returns {{rise: number|null, set: number|null, transit: number|null, transitAlt}}  JD (UT)
 */
export function riseSet(name, jdUT0, lat, lon, o = {}) {
  const obs = observer(lat, lon, o.elev || 0), opt = { refraction: false };
  const pos = jd => (name === 'Moon' ? moon({ jdUT: jd }, obs, opt) : body(name, { jdUT: jd }, obs, opt));
  const h0 = p => (o.h0 != null ? o.h0 : name === 'Sun' ? -0.8333 : name === 'Moon' ? -34 / 60 - p.semidiameter : -34 / 60) - (o.dip || 0);
  const f = jd => { const p = pos(jd); return p.alt - h0(p); };
  const step = 1 / 48, out = { rise: null, set: null, transit: null, transitAlt: null };
  let ja = jdUT0, fa = f(ja), pa = pos(ja).hourAngle;
  for (let k = 1; k <= 48; k++) {
    const jb = jdUT0 + k * step, pb = pos(jb), fb = pb.alt - h0(pb), hb = pb.hourAngle;
    if (fa < 0 && fb >= 0 && out.rise == null) out.rise = bisect(f, ja, jb);
    if (fa >= 0 && fb < 0 && out.set == null) out.set = bisect(f, ja, jb);
    if (pa < 0 && hb >= 0 && hb - pa < 90 && out.transit == null) { out.transit = bisect(jd => pos(jd).hourAngle, ja, jb); out.transitAlt = pos(out.transit).alt; }
    ja = jb; fa = fb; pa = hb;
  }
  return out;
}
function bisect(f, a, b) {
  let fa = f(a);
  for (let i = 0; i < 40 && b - a > 1e-6; i++) { const m = (a + b) / 2, fm = f(m); if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m; }
  return (a + b) / 2;
}
/** Instant (JD UT) of the next astronomical new moon (geocentric conjunction in ecliptic longitude) after jdUT. phase 0/90/180/270 → new/first/full/last. */
export function nextMoonPhase(jdUT, phaseDeg = 0) {
  const g = jd => { const c = time({ jdUT: jd }); return mod(moonGeocentric(c).lam - geocentric('Sun', c).lam - phaseDeg + 180, 360) - 180; };
  let a = jdUT, ga = g(a);
  for (let k = 1; k <= 64; k++) {
    const b = jdUT + k * 0.5, gb = g(b);
    if (ga < 0 && gb >= 0 && gb - ga < 90) return bisect(g, a, b);
    a = b; ga = gb;
  }
  return null;
}
export { deltaT, deltaTSigma };
