/* ESH27 twin — maritime / seastate.js — wind → sea state (APPROXIMATE, labelled)
 *
 * Fetch-limited wave growth, U.S. Army Corps of Engineers, Coastal Engineering Manual (CEM) EM 1110-2-1100,
 * Part II, Chapter 2, eq. II-2-36 (with u* from C_D = 0.001·(1.1 + 0.035·U10)):
 *     g·Hm0 / u*² = 4.13e-2 · (g·X / u*²)^(1/2)
 *     g·Tp  / u*  = 0.651   · (g·X / u*²)^(1/3)
 * fully-developed caps (CEM II-2, same chapter):  g·Hm0/u*² ≤ 211.5,  g·Tp/u* ≤ 239.8
 * Source page: https://coastalengineeringmanual.tpub.com/Part-II-Chap2/Part-II-Chap20049.htm
 *
 * What is NOT modelled (labelled approximations):
 *   - duration limit (assumes the wind has blown long enough)          - depth-limited growth
 *   - real swell: default swell is an ASSUMPTION (0.4 m, 7 s, from 285°), replace with a wave model / buoy
 *   - fetch: open-sea fetch for onshore wind is a single assumed number (default 300 km); for offshore wind the
 *     fetch is the distance from the coast at the reference point (default 2 km).
 * Israel's coast near Ashdod runs NNE (≈ 24° east of grid north); the sea is to the WNW.
 */
import { G, TAU } from './waves.js';

export const SOURCE = 'CEM EM 1110-2-1100 Part II-2 eq. II-2-36 (fetch-limited), C_D = 0.001(1.1+0.035U10)';

export function frictionVelocity(U10) {
  const cd = 0.001 * (1.1 + 0.035 * U10);
  return { ustar: U10 * Math.sqrt(cd), cd };
}

/** {Hs (m), Tp (s), fullyDeveloped, ustar, cd} for wind speed U10 (m/s) and fetch X (m) */
export function fetchLimited(U10, X) {
  if (!(U10 > 0.05)) return { Hs: 0, Tp: 0, fullyDeveloped: false, ustar: 0, cd: 0.0011 };
  const { ustar, cd } = frictionVelocity(U10), u2 = ustar * ustar;
  const xi = G * Math.max(X, 1) / u2;
  let h = 4.13e-2 * Math.sqrt(xi), tp = 0.651 * Math.cbrt(xi), fd = false;
  if (h >= 211.5) { h = 211.5; fd = true; }
  if (tp >= 239.8) { tp = 239.8; fd = true; }
  return { Hs: h * u2 / G, Tp: tp * ustar / G, fullyDeveloped: fd, ustar, cd };
}

/** unit vector (twin frame) of the coast direction and the seaward normal. Default: Ashdod fit E = A + 0.45566·N */
export function coastFrame(B = 0.45566) {
  // along-coast (E,N) = (B,1) → twin (x=E, z=−N)
  const l = Math.hypot(B, 1), ax = B / l, az = -1 / l;
  // seaward = WNW: rotate along-coast by +90° in the EN plane → (−1, B)/l → twin (−1/l, −B/l)
  return { alongX: ax, alongZ: az, seaX: -1 / l, seaZ: -B / l };
}

/**
 * Sea state for a wind vector in the twin frame (weather.js wind_vec: where the AIR MOVES TO).
 * opts: { openFetchM = 300e3, offshoreRefM = 2000, swell = {Hs:0.4, Tp:7, fromDeg:285} | null, coastB }
 */
export function seaStateFromWind(windVec, opts = {}) {
  const { openFetchM = 300e3, offshoreRefM = 2000, coastB = 0.45566 } = opts;
  const swellOpt = opts.swell === undefined ? { Hs: 0.4, Tp: 7, fromDeg: 285 } : opts.swell;
  const U = Math.hypot(windVec.x || 0, windVec.z || 0);
  const cf = coastFrame(coastB);
  const dirX = U > 1e-6 ? windVec.x / U : -cf.seaX, dirZ = U > 1e-6 ? windVec.z / U : -cf.seaZ;
  // onshore if the air moves toward land (against the seaward normal)
  const onshore = -(dirX * cf.seaX + dirZ * cf.seaZ);
  const fetch = onshore > 0.05 ? openFetchM : offshoreRefM;
  const ws = fetchLimited(U, fetch);
  let swell = null;
  if (swellOpt && swellOpt.Hs > 0) {
    // meteorological "from" bearing → travel direction in twin frame: from 285° → travels toward 105°
    const to = (swellOpt.fromDeg + 180) * Math.PI / 180;
    swell = { Hs: swellOpt.Hs, Tp: swellOpt.Tp, dirX: Math.sin(to), dirZ: -Math.cos(to) };
  }
  return {
    U10: U, fetchM: fetch, onshore: onshore > 0.05,
    wind: { Hs: ws.Hs, Tp: ws.Tp, dirX, dirZ, fullyDeveloped: ws.fullyDeveloped },
    swell,
    HsTotal: Math.hypot(ws.Hs, swell ? swell.Hs : 0),
    whitecaps: Math.max(0, Math.min(1, (U - 5) / 8)),    // visual only: whitecaps start ≈ 5 m/s (Beaufort 3-4)
    source: SOURCE, approximate: true,
  };
}

/** Beaufort number from U10 (WMO table) — handy for the UI */
export function beaufort(U) {
  const lim = [0.5, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  let b = 0; while (b < lim.length && U >= lim[b]) b++; return b;
}

export const deepWavelength = T => G * T * T / TAU;
