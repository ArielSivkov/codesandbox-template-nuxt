/* ESH27 twin — sky & time — state.js
 * Frame-budgeted sky state for the renderer (plugin + demo). Pure JS, no THREE.
 *   Per frame (cheap): time context, equatorial→twin rotation for the star sphere, horizontal coordinates of the
 *     7 bodies from their CACHED geocentric RA/Dec, extrapolated with a cached quadratic (topocentric parallax
 *     is applied every frame, so the Moon's ~1° parallax is exact).
 *   Heavy work (VSOP / ELP series) is time-sliced: at most `maxRefreshPerFrame` bodies per frame, only when the
 *     simulated time left a body's validity window: Moon ±2 h, Mercury ±12 h, Sun/Venus/Mars ±1 d, Jupiter/Saturn ±4 d
 *     (quadratic model from 3 samples; error inside the window measured in test/state.test.mjs).
 *   A time JUMP beyond the window → the body is recomputed (Moon and Sun first), others within the next frames;
 *     until then they are drawn at their extrapolated position (flagged stale).
 */
import { time, geocentric, moonGeocentric, observer, topocentric, equatorialToTwinMatrix, starField, PLANETS, angSep, AU_KM } from './sky.js';
const BODIES = ['Moon', 'Sun', ...PLANETS];
const WINDOW_D = { Moon: 2 / 24, Sun: 1, Mercury: 0.5, Venus: 1, Mars: 1, Jupiter: 4, Saturn: 4 };
const mod = (a, n) => ((a % n) + n) % n;

/**
 * @param {object} o {lat, lon, elev=0, gammaDeg=0, refraction=true, pressure, temperature, maxRefreshPerFrame=1}
 */
export function createSkyState(o) {
  const obs = observer(o.lat, o.lon, o.elev || 0);
  const opt = { refraction: o.refraction !== false, pressure: o.pressure, temperature: o.temperature, gammaDeg: o.gammaDeg || 0 };
  const cache = {};   // name → {jd, ra, dec, dist(km), dra, ddec, ddist (per day), tau, lam, extra}
  const S = { obs, opt, bodies: {}, matrix: null, stars: null, ctx: null, refreshed: 0, stale: 0 };
  function sample(name, c) {
    if (name === 'Moon') { const m = moonGeocentric(c); return { ra: m.ra, dec: m.dec, dist: m.distKm, lam: m.lam }; }
    const g = geocentric(name, c, cache[name] && Math.abs(cache[name].jd - c.jdTT) < 2 ? { tauDays: cache[name].tau } : {});
    return { ra: g.ra, dec: g.dec, dist: g.distKm, lam: g.lam, r: g.r, R: g.R, tau: g.distAU / 173.1446326846693 };
  }
  // quadratic model from 3 samples (t − h, t, t + h), h = half the validity window
  function refresh(name, c) {
    const h = WINDOW_D[name] * 0.5, a = sample(name, c), b = sample(name, time({ jdTT: c.jdTT + h })), m = sample(name, time({ jdTT: c.jdTT - h }));
    const wrap = x => mod(x + 180, 360) - 180;
    const q = (x0, xp, xm, ang) => { const dp = ang ? wrap(xp - x0) : xp - x0, dm = ang ? wrap(xm - x0) : xm - x0; return [(dp - dm) / (2 * h), (dp + dm) / (h * h)]; };
    const [dra, ara] = q(a.ra, b.ra, m.ra, true), [ddec, adec] = q(a.dec, b.dec, m.dec), [ddist, adist] = q(a.dist, b.dist, m.dist), [dlam, alam] = q(a.lam, b.lam, m.lam, true);
    cache[name] = { jd: c.jdTT, ra: a.ra, dec: a.dec, dist: a.dist, lam: a.lam, r: a.r, R: a.R, tau: a.tau, dra, ara, ddec, adec, ddist, adist, dlam, alam };
    S.refreshed++;
  }
  /** Advance to an instant (Date | ms | {jdUT}). Returns S (positions in S.bodies[name]). */
  S.update = function (t, maxRefresh = o.maxRefreshPerFrame ?? 1) {
    const c = time(t); S.ctx = c; let budget = maxRefresh; S.stale = 0;
    for (const n of BODIES) {
      const k = cache[n];
      const need = !k || Math.abs(c.jdTT - k.jd) > WINDOW_D[n];
      if (need && (budget > 0 || !k)) { refresh(n, c); budget--; } else if (need) S.stale++;
    }
    for (const n of BODIES) {
      const k = cache[n], dt = c.jdTT - k.jd, d2 = dt * dt / 2;
      const ra = mod(k.ra + k.dra * dt + k.ara * d2, 360), dec = k.dec + k.ddec * dt + k.adec * d2, dist = k.dist + k.ddist * dt + k.adist * d2;
      const tp = topocentric(ra, dec, dist, c, obs, opt);
      const b = S.bodies[n] || (S.bodies[n] = { name: n });
      b.ra = tp.ra; b.dec = tp.dec; b.alt = tp.alt; b.altApparent = tp.altApparent; b.az = tp.az; b.vec = tp.vec; b.distKm = dist;
      b.raGeo = ra; b.decGeo = dec; b.lam = k.lam + k.dlam * dt + k.alam * d2;
    }
    // phase & magnitudes (cheap, from cached values)
    const sun = S.bodies.Sun, mn = S.bodies.Moon, Rkm = sun.distKm;
    const psi = angSep(mn.raGeo, mn.decGeo, sun.raGeo, sun.decGeo) * Math.PI / 180;
    const i = Math.atan2(Rkm * Math.sin(psi), mn.distKm - Rkm * Math.cos(psi));
    mn.phase = (1 + Math.cos(i)) / 2; mn.phaseAngle = i * 180 / Math.PI; mn.elongEcl = mod(mn.lam - sun.lam, 360); mn.waxing = mn.elongEcl < 180;
    mn.semidiameter = Math.asin(1737.4 / mn.distKm) * 180 / Math.PI;
    for (const p of PLANETS) { const b = S.bodies[p], k = cache[p], r = k.r, D = b.distKm / AU_KM, R = k.R;
      const ci = (r * r + D * D - R * R) / (2 * r * D); b.phase = (1 + ci) / 2; b.phaseAngle = Math.acos(Math.max(-1, Math.min(1, ci))) * 180 / Math.PI; }
    S.matrix = equatorialToTwinMatrix(c, o.lat, o.lon, o.gammaDeg || 0);
    if (!S.stars || Math.abs(S.stars.jdTT - c.jdTT) > 0.5) S.stars = starField(c);
    return S;
  };
  return S;
}
