/* ESH27 twin — atmosphere — astro.js
 * Sun: re-uses the physics team's validated NOAA model (swarm/physics/src/sun.js) — not duplicated.
 * Moon: APPROXIMATE (labeled) — Meeus, "Astronomical Algorithms" 2nd ed., ch.47, truncated to the
 *   largest periodic terms (≈0.3° in longitude, ≈0.2° in latitude); first-order topocentric parallax
 *   in altitude. Checked against Ariel's field ephemeris (fieldref/celestial_20261123_0100.json): Δaz 0.0°, Δalt 0.1°. Good for lighting and for drawing the disc,
 *   NOT for eclipse or occultation work.
 * Stars: 24 real bright stars (J2000, precession ignored ≈0.35° by 2026) + a synthetic faint field
 *   (deterministic random, labeled synthetic) culled by the city's limiting magnitude.
 * Frame: x = east, y = up, z = south (three.js world, same as physics/sun.js).
 */
import { sunPosition, sunVector, sunTimes, localToUtc, tzOffsetMinutes, itmConvergence, solarCoordinates, julianDay, D2R, R2D } from '../../physics/src/sun.js';
export { sunPosition, sunVector, sunTimes, localToUtc, tzOffsetMinutes, itmConvergence, solarCoordinates, julianDay };

export const ASHDOD = { lat: 31.8014, lon: 34.6435, tz: 'Asia/Jerusalem' };
const mod = (a, n) => ((a % n) + n) % n;
const sinD = d => Math.sin(d * D2R), cosD = d => Math.cos(d * D2R);

/** Greenwich mean sidereal time, degrees (Meeus 12.4). */
export function gmstDeg(ms) {
  const jd = julianDay(ms), T = (jd - 2451545) / 36525;
  return mod(280.46061837 + 360.98564736629 * (jd - 2451545) + T * T * (0.000387933 - T / 38710000), 360);
}
/** Equatorial (RA, Dec in degrees) → horizontal {elevation, azimuth} (azimuth from true north, clockwise). */
export function equatorialToHorizontal(raDeg, decDeg, ms, lat, lon) {
  const H = mod(gmstDeg(ms) + lon - raDeg, 360);
  const sa = sinD(lat) * sinD(decDeg) + cosD(lat) * cosD(decDeg) * cosD(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sa))) * R2D;
  const az = mod(Math.atan2(-cosD(decDeg) * sinD(H), cosD(lat) * sinD(decDeg) - sinD(lat) * cosD(decDeg) * cosD(H)) * R2D, 360);
  return { elevation: el, azimuth: az, hourAngle: H };
}

/**
 * Moon position + phase — APPROXIMATE (see header).
 * @returns {{elevation, azimuth, ra, dec, lon, lat, distanceKm, elongation, phaseAngle, illumination, waxing, ageDays}}
 */
export function moonPosition(date, lat, lon) {
  const ms = typeof date === 'number' ? date : date.getTime();
  const jd = julianDay(ms), T = (jd - 2451545) / 36525;
  const Lp = mod(218.3164477 + 481267.88123421 * T, 360);        // mean longitude
  const D = mod(297.8501921 + 445267.1114034 * T, 360);          // mean elongation
  const M = mod(357.5291092 + 35999.0502909 * T, 360);           // sun mean anomaly
  const Mp = mod(134.9633964 + 477198.8675055 * T, 360);         // moon mean anomaly
  const F = mod(93.2720950 + 483202.0175233 * T, 360);           // argument of latitude
  // largest terms of Meeus table 47.A / 47.B (degrees, km)
  const lonM = Lp + 6.288774 * sinD(Mp) + 1.274027 * sinD(2 * D - Mp) + 0.658314 * sinD(2 * D) + 0.213618 * sinD(2 * Mp)
    - 0.185116 * sinD(M) - 0.114332 * sinD(2 * F) + 0.058793 * sinD(2 * D - 2 * Mp) + 0.057066 * sinD(2 * D - M - Mp)
    + 0.053322 * sinD(2 * D + Mp) + 0.045758 * sinD(2 * D - M) - 0.040923 * sinD(M - Mp) - 0.034720 * sinD(D) - 0.030383 * sinD(M + Mp);
  const latM = 5.128122 * sinD(F) + 0.280602 * sinD(Mp + F) + 0.277693 * sinD(Mp - F) + 0.173237 * sinD(2 * D - F)
    + 0.055413 * sinD(2 * D - Mp + F) + 0.046271 * sinD(2 * D - Mp - F) + 0.032573 * sinD(2 * D + F);
  const distanceKm = 385000.56 - 20905.355 * cosD(Mp) - 3699.111 * cosD(2 * D - Mp) - 2955.968 * cosD(2 * D) - 569.925 * cosD(2 * Mp);
  const eps = 23.4392911 - 0.0130042 * T;
  const ra = mod(Math.atan2(sinD(lonM) * cosD(eps) - Math.tan(latM * D2R) * sinD(eps), cosD(lonM)) * R2D, 360);
  const dec = Math.asin(sinD(latM) * cosD(eps) + cosD(latM) * sinD(eps) * sinD(lonM)) * R2D;
  const h = equatorialToHorizontal(ra, dec, ms, lat, lon);
  // topocentric parallax in altitude (first order): p = asin(R⊕/Δ)·cos(alt) ≈ 0.95°·cos(alt)
  const elevGeo = h.elevation;
  h.elevation = elevGeo - Math.asin(6378.14 / distanceKm) * R2D * Math.cos(elevGeo * D2R);
  // phase (Meeus ch.48): elongation ψ from the sun, phase angle i ≈ 180 − ψ (geocentric), k = (1 + cos i) / 2
  const sunLon = solarCoordinates(ms).apparentLongitude;
  const cpsi = cosD(latM) * cosD(lonM - sunLon);
  const elong = Math.acos(Math.max(-1, Math.min(1, cpsi))) * R2D;
  const phaseAngle = Math.atan2(149597870.7 * sinD(elong), distanceKm - 149597870.7 * cpsi) * R2D;
  const illumination = (1 + cosD(phaseAngle)) / 2;
  const waxing = mod(lonM - sunLon, 360) < 180;
  const ageDays = mod(lonM - sunLon, 360) / 360 * 29.530589;
  return { elevation: h.elevation, elevationGeocentric: elevGeo, azimuth: h.azimuth, ra, dec, lon: lonM, lat: latM, distanceKm, elongation: elong, phaseAngle, illumination, waxing, ageDays };
}

const PHASE_HE = ['מולד', 'סהר מתמלא', 'רבע ראשון', 'ירח מתמלא (גיבני)', 'ירח מלא', 'ירח מתמעט (גיבני)', 'רבע אחרון', 'סהר מתמעט'];
/** Hebrew phase name (8 classical phases). */
export function moonPhaseNameHe(m) { const i = Math.round(m.ageDays / 29.530589 * 8) % 8; return PHASE_HE[i]; }

/** Rotation equatorial-Cartesian → twin frame (x east, y up, z south). Row-major 3×3.
 *  Equatorial vector: (cosδcosα, cosδsinα, sinδ). Apply as v' = R·v. */
export function equatorialToTwinMatrix(ms, lat, lon) {
  const L = (gmstDeg(ms) + lon) * D2R, p = lat * D2R, cL = Math.cos(L), sL = Math.sin(L), cp = Math.cos(p), sp = Math.sin(p);
  // a = X cL + Y sL (cosδcosH), b = −X sL + Y cL (−cosδ sinH = east), c = Z (sinδ)
  // east = b; north = cp c − sp a; up = sp c + cp a → twin (east, up, −north)
  return [
    -sL, cL, 0,                  // x = east
    cp * cL, cp * sL, sp,        // y = up
    sp * cL, sp * sL, -cp,       // z = south = −north
  ];
}

// 24 bright stars, J2000 (RA h, Dec deg, V mag, B−V colour index). Values from the Yale Bright Star Catalogue (rounded).
export const BRIGHT_STARS = [
  ['Sirius', 6.7525, -16.716, -1.46, 0.00], ['Canopus', 6.3992, -52.696, -0.74, 0.15], ['Arcturus', 14.2610, 19.182, -0.05, 1.23],
  ['Vega', 18.6156, 38.784, 0.03, 0.00], ['Capella', 5.2782, 45.998, 0.08, 0.80], ['Rigel', 5.2423, -8.202, 0.13, -0.03],
  ['Procyon', 7.6550, 5.225, 0.34, 0.42], ['Betelgeuse', 5.9195, 7.407, 0.50, 1.85], ['Altair', 19.8464, 8.868, 0.76, 0.22],
  ['Aldebaran', 4.5987, 16.509, 0.85, 1.54], ['Antares', 16.4901, -26.432, 0.96, 1.83], ['Spica', 13.4199, -11.161, 0.97, -0.23],
  ['Pollux', 7.7553, 28.026, 1.14, 1.00], ['Fomalhaut', 22.9608, -29.622, 1.16, 0.09], ['Deneb', 20.6905, 45.280, 1.25, 0.09],
  ['Regulus', 10.1395, 11.967, 1.35, -0.11], ['Castor', 7.5767, 31.888, 1.58, 0.03], ['Alnilam', 5.6036, -1.202, 1.69, -0.18],
  ['Alnitak', 5.6793, -1.943, 1.77, -0.21], ['Dubhe', 11.0621, 61.751, 1.79, 1.07], ['Alkaid', 13.7923, 49.313, 1.86, -0.19],
  ['Polaris', 2.5303, 89.264, 1.98, 0.60], ['Mintaka', 5.5334, -0.299, 2.23, -0.22], ['Bellatrix', 5.4189, 6.350, 1.64, -0.22],
];
/** B−V → approximate linear RGB (Ballesteros 2012 temperature formula + blackbody tint, normalised). */
export function bvToRgb(bv) {
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  return kelvinToRgb(T);
}
/** Kelvin → linear-ish RGB, max channel = 1 (Tanner Helland fit, approximate). */
export function kelvinToRgb(K) {
  const t = K / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const c = [r, g, b].map(v => Math.min(255, Math.max(0, v)) / 255);
  const lin = c.map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const m = Math.max(...lin); return lin.map(v => v / m);
}

/** Star list for rendering: [x,y,z] equatorial unit vectors, mag, rgb. Real bright stars + synthetic field to mag 5. */
export function starField(nSynthetic = 1400, seed = 27) {
  const out = [];
  for (const [name, raH, dec, mag, bv] of BRIGHT_STARS) {
    const a = raH * 15 * D2R, d = dec * D2R;
    out.push({ name, v: [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)], mag, rgb: bvToRgb(bv), real: true });
  }
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < nSynthetic; i++) {   // SYNTHETIC: uniform on sphere; N(<m) ∝ 10^(0.6 m) style distribution between mag 2.3 and 5
    const z = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    const mag = 5 - Math.log10(1 + rnd() * (Math.pow(10, 0.6 * 2.7) - 1)) / 0.6;
    out.push({ v: [r * Math.cos(ph), r * Math.sin(ph), z], mag, rgb: bvToRgb(rnd() * 1.6 - 0.1), real: false });
  }
  return out;
}

/** Everything the rig needs for one instant. */
export function skyState(date, site = ASHDOD) {
  const ms = typeof date === 'number' ? date : date.getTime();
  const sp = sunPosition(ms, site.lat, site.lon);
  const mp = moonPosition(ms, site.lat, site.lon);
  const gamma = site.gammaDeg != null ? site.gammaDeg : itmConvergence(site.lat, site.lon);
  return {
    ms, sun: sp, moon: mp,
    sunDir: sunVector(sp.elevation, sp.azimuth, gamma),
    moonDir: sunVector(mp.elevation, mp.azimuth, gamma),
    starMatrix: equatorialToTwinMatrix(ms, site.lat, site.lon), gammaDeg: gamma,
  };
}
