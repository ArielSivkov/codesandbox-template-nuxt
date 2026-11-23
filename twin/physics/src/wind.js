/* ESH27 twin physics — wind.js
 * Wind field for drone/flight tests in a city.  *** NOT CFD. *** Mean profile + turbulence are standard
 * engineering models; the building effects are labeled HEURISTICS that only reproduce the qualitative
 * features of real urban flow (shelter, roof separation/speed-up, channelling). Use for training, demos and
 * first-order checks — never to certify a flight or a structure.
 *
 * MEAN PROFILE (neutral stability):
 *   u(z) = u* /κ · ln((z − d)/z0)                                     log law, κ = 0.4
 *   z0 (roughness length) from the WMO/Davenport classes  https://codes.wmo.int/wmdr/SurfaceRoughnessDavenport
 *     open 0.03 m, "closed" (homogeneous city) 1.0 m, "chaotic" (centre with high-rise) ≥ 2 m.
 *   If building heights are known: d ≈ 0.7·H, z0 ≈ 0.1·H (Grimmond & Oke 1999 rule of thumb,
 *     J. Appl. Meteor. 38:1262 "Aerodynamic properties of urban areas derived from analysis of surface form").
 *   Input wind = a met-station value at 10 m over OPEN terrain (z0 = 0.03 m, e.g. Open-Meteo wind_speed_10m).
 *   It is carried to the city through a blending height zb = 60 m where both profiles meet [W1]
 *   (Wieringa 1986, QJRMS 112:867 — roughness-dependent interpolation of wind).
 *   [W2] Below roof level (z < d + z0 … H) the log law is invalid: an exponential canopy profile
 *        u(z) = u(H)·exp(a(z/H − 1)), a = 2 is used (Macdonald 2000, BLM 97:25; a is an assumed value).
 *
 * TURBULENCE (gusts): Dryden low-altitude model, MIL-F-8785C / MIL-HDBK-1797, as documented in
 *   https://www.mathworks.com/help/aeroblks/drydenwindturbulencemodelcontinuous.html
 *   h in feet:  σw = 0.1·W20,  σu = σv = σw/(0.177 + 0.000823h)^0.4,  Lw = h,  Lu = Lv = h/(0.177+0.000823h)^1.2
 *   W20 = mean wind at 20 ft (6.1 m).
 *   [W3] Each component is generated as a first-order Gauss–Markov process with time constant L/V
 *        (exact discretisation). This is exactly Dryden's u-spectrum; for v, w Dryden uses a 2nd-order
 *        filter — the first-order version has the same variance and correlation time (approximation).
 *   [W4] Taylor frozen turbulence with V = max(local mean wind, 1 m/s) (the drone may hover).
 *   [W5] Turbulence is spatially uniform (one random state per field). No eddies shed by buildings.
 *   [W6] Dryden was derived for open terrain / aircraft; real urban turbulence intensity near roofs is
 *        typically higher. `turbulenceScale` lets a user raise it; default 1 (no invented factor).
 *
 * BUILDING HEURISTICS (labeled H1–H5), boxes {x, z, sx, sz, h, rot}:
 *   Scale length R = Bs^0.67·BL^0.33 (Bs/BL = smaller/larger of height and cross-wind width), and the roof
 *   recirculation Hc = 0.22R, Lc = 0.9R, downwind cavity Lr = R — ASHRAE Handbook Fundamentals ch.
 *   "Airflow around buildings" (Wilson 1979); ASHRAE says these are approximate and that upwind
 *   turbulence may halve the coefficients.
 *   H1 inside a building: 0.
 *   H2 lee cavity (0 < s < Lr, below roof): speed × 0.15; then linear recovery to × 1 at s = Lr + 4R.
 *   H3 windward face (upwind, s < 0.5R): speed reduced to × 0.5 at the face, upwash above 0.6h,
 *      downwash below (the "standing vortex" that brings roof-level wind to the street).
 *   H4 roof: within Hc of the roof near the upwind edge → × 0.3 (separation bubble); above that
 *      a speed-up layer × (1 + 0.25·exp(−Δz/0.3R)).
 *   H5 street canyon: if walls exist on BOTH sides across the wind within 60 m and the canyon axis is
 *      aligned with the wind (|cos| > 0.7), speed × (1 + 0.3·k·min(1, H/W)) and the direction is steered
 *      along the canyon ("channelling", Oke 1988, Energy & Buildings 11:103). Perpendicular canyons
 *      are covered by H2 (Oke's skimming / wake-interference regimes, qualitatively).
 *   The numeric factors 0.15, 0.5, 0.3, 0.25, 0.3 are ASSUMED round numbers, not fitted to data.
 */

const D2R = Math.PI / 180;
const KAPPA = 0.4;
const FT = 0.3048;

/** Deterministic PRNG (mulberry32) + Box–Muller normal. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let spare = null;
  const n = () => { if (spare !== null) { const s = spare; spare = null; return s; }
    let x = 0, y = 0; while (x === 0) x = u(); y = u();
    const r = Math.sqrt(-2 * Math.log(x)); spare = r * Math.sin(2 * Math.PI * y); return r * Math.cos(2 * Math.PI * y); };
  return { uniform: u, normal: n };
}

/** Log-law speed at height z (above ground) for friction velocity uStar. */
export function logLaw(z, uStar, z0, d = 0) {
  const zz = z - d;
  if (zz <= z0) return 0;
  return (uStar / KAPPA) * Math.log(zz / z0);
}

/** Dryden low-altitude intensities and scales (SI in, SI out). h in metres (clamped ≥ 3 m). */
export function drydenParams(hMeters, W20) {
  const hf = Math.max(10, Math.min(1000, hMeters / FT));            // MIL spec low-alt formulas, ft
  const sw = 0.1 * W20;
  const k = 0.177 + 0.000823 * hf;
  const su = sw / Math.pow(k, 0.4);
  const Lw = hf * FT, Lu = (hf / Math.pow(k, 1.2)) * FT;
  return { sigmaU: su, sigmaV: su, sigmaW: sw, Lu, Lv: Lu, Lw };
}

/** ASHRAE / Wilson scaling length R for an upwind face of height h and cross-wind width w. */
export function ashraeR(h, w) {
  const bs = Math.min(h, w), bl = Math.max(h, w);
  return Math.pow(bs, 0.67) * Math.pow(bl, 0.33);
}

/**
 * Create a wind field.
 * @param {object} o
 *   speed10   m/s at 10 m over open terrain (met-station / forecast value)
 *   fromDeg   meteorological direction the wind blows FROM, degrees from true north (270 = westerly)
 *   gammaDeg  ITM convergence (sun.itmConvergence) if the twin is laid out on the ITM grid
 *   z0, d     urban roughness length and displacement (default from buildings: 0.1H / 0.7H, else 1.0 / 0)
 *   buildings [{x, z, sx, sz, h, rot}]  boxes in the twin frame (x east, z south), rot (rad) about +y with
 *             local x axis = (cos rot, sin rot) in (x,z)  → three.js mesh.rotation.y = −rot
 *   gusts     true/false, seed, turbulenceScale (default 1)
 *   groundY   ground elevation (flat) [assumption: flat ground]
 */
export function createWind(o = {}) {
  const W = {
    speed10: o.speed10 ?? 5, fromDeg: o.fromDeg ?? 270, gammaDeg: o.gammaDeg ?? 0,
    buildings: o.buildings || [], gusts: o.gusts ?? true, turbulenceScale: o.turbulenceScale ?? 1,
    groundY: o.groundY ?? 0, zb: 60, z0open: 0.03, canopyA: 2, urbanEffects: o.urbanEffects ?? true,
  };
  const hs = W.buildings.map((b) => b.h);
  const Hm = o.meanHeight ?? (hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 0);
  W.Hm = Hm;
  W.z0 = o.z0 ?? (Hm > 0 ? Math.max(0.1 * Hm, 0.03) : 1.0);
  W.d = o.d ?? (Hm > 0 ? 0.7 * Hm : 0);
  const rng = makeRng(o.seed ?? 12345);
  const gs = { u: 0, v: 0, w: 0, t: 0 };

  const flow = () => { const a = ((W.fromDeg + 180) - W.gammaDeg) * D2R; return { x: Math.sin(a), z: -Math.cos(a) }; };

  /** Mean (no gust, no buildings) horizontal speed at height above ground z. */
  function meanSpeed(z) {
    const uStarOpen = (W.speed10 * KAPPA) / Math.log(10 / W.z0open);
    const ub = logLaw(W.zb, uStarOpen, W.z0open);                   // [W1] speed at blending height
    const uStar = (ub * KAPPA) / Math.log((W.zb - W.d) / W.z0);
    const Hc = Math.max(W.Hm, W.d + W.z0 * 1.5);
    if (z >= Hc || W.d === 0) return logLaw(Math.max(z, W.d + W.z0 * 1.0001), uStar, W.z0, W.d);
    const uH = logLaw(Hc, uStar, W.z0, W.d);
    return uH * Math.exp(W.canopyA * (Math.max(z, 0) / Hc - 1)); // [W2]
  }
  W.meanSpeed = meanSpeed;
  W.W20 = () => {                                                  // 20 ft wind over open terrain
    const uStarOpen = (W.speed10 * KAPPA) / Math.log(10 / W.z0open);
    return logLaw(6.096, uStarOpen, W.z0open);
  };

  /** Advance turbulence by dt at reference height h (call once per physics step). [W3][W4][W5] */
  W.step = function (dt, h = 10) {
    gs.t += dt;
    if (!W.gusts || W.speed10 <= 0) { gs.u = gs.v = gs.w = 0; return; }
    const V = Math.max(1, meanSpeed(h));
    const p = drydenParams(Math.max(h, 3), W.W20());
    for (const [k, L] of [['u', p.Lu], ['v', p.Lv], ['w', p.Lw]]) {
      const a = Math.exp(-(V * dt) / L);
      gs[k] = a * gs[k] + Math.sqrt(1 - a * a) * rng.normal();      // unit-variance process
    }
  };
  W.gustState = () => ({ ...gs });

  /** Local building modification (H1–H5). Returns {fx, fz (direction), f (speed factor), vy (vertical, × U), zone}. */
  function urban(x, y, z, fl) {
    let f = 1, vy = 0, zone = 'free', dirX = fl.x, dirZ = fl.z;
    const yy = y - W.groundY;
    const px = -fl.z, pz = fl.x; // cross-wind unit vector
    for (const b of W.buildings) {
      const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      const inFoot = Math.abs(lx) <= b.sx / 2 && Math.abs(lz) <= b.sz / 2;
      if (inFoot && yy <= b.h) return { f: 0, vy: 0, fx: dirX, fz: dirZ, zone: 'inside' };          // H1
      // projections of the box on along-wind (hl) and cross-wind (hw) axes (bounding approx for rotated boxes)
      const exw = c * fl.x + s * fl.z, ezw = -s * fl.x + c * fl.z;
      const hl = Math.abs(b.sx / 2 * exw) + Math.abs(b.sz / 2 * ezw);
      const hw = Math.abs(b.sx / 2 * (c * px + s * pz)) + Math.abs(b.sz / 2 * (-s * px + c * pz));
      const along = dx * fl.x + dz * fl.z, cross = dx * px + dz * pz;
      const R = ashraeR(b.h, 2 * hw);
      const latFade = Math.max(0, Math.min(1, (hw + 0.25 * R - Math.abs(cross)) / (0.5 * R)));  // soft lateral edge
      if (inFoot) { // H4 roof
        const dzRoof = yy - b.h, fromUpwind = along + hl;
        if (dzRoof < 0.22 * R && fromUpwind < 0.9 * R) { f = Math.min(f, 0.3); zone = 'roof-separation'; }
        else if (dzRoof < 3 * R) { const k = 1 + 0.25 * Math.exp(-dzRoof / (0.3 * R)); if (zone === 'free' || k > f) { f = Math.max(f, k); zone = 'roof-speedup'; } }
        continue;
      }
      if (latFade <= 0) continue;
      const sLee = along - hl;     // distance behind leeward face
      const sUp = -along - hl;     // distance in front of windward face
      if (sLee > 0 && yy < b.h) {  // H2
        const Lr = R, Lrec = R + 4 * R;
        let k;
        if (sLee < Lr) k = 0.15; else if (sLee < Lrec) k = 0.15 + 0.85 * (sLee - Lr) / (Lrec - Lr); else k = 1;
        k = 1 - (1 - k) * latFade * Math.min(1, (b.h - yy) / (0.2 * b.h) + 0.0);
        if (k < f) { f = k; zone = sLee < Lr ? 'lee-cavity' : 'lee-wake'; }
      } else if (sUp > 0 && sUp < 0.5 * R && yy < b.h) {           // H3
        const prox = (1 - sUp / (0.5 * R)) * latFade;
        const k = 1 - 0.5 * prox;
        if (k < f) { f = k; zone = 'windward'; }
        vy += (yy > 0.6 * b.h ? 0.3 : -0.15) * prox;
      }
    }
    // H5 street canyon / channelling
    if (zone === 'free' || zone === 'lee-wake') {
      const hitL = ray(x, z, yy, px, pz), hitR = ray(x, z, yy, -px, -pz);
      if (hitL && hitR) {
        const Wd = hitL.t + hitR.t, H = Math.min(hitL.h, hitR.h);
        const tx = -hitL.nz, tz = hitL.nx;                          // wall tangent = canyon axis
        const al = tx * fl.x + tz * fl.z, a = Math.abs(al);
        if (a > 0.7) {
          const k = (a - 0.7) / 0.3;
          f *= 1 + 0.3 * k * Math.min(1, H / Wd);
          const sg = al >= 0 ? 1 : -1;
          dirX = fl.x * (1 - k) + tx * sg * k; dirZ = fl.z * (1 - k) + tz * sg * k;
          const n = Math.hypot(dirX, dirZ) || 1; dirX /= n; dirZ /= n;
          zone = 'canyon-channel';
        }
      }
    }
    return { f, vy, fx: dirX, fz: dirZ, zone };
  }

  /** 2D ray vs building boxes taller than yy (max 60 m). Returns nearest {t, h, nx, nz}. */
  function ray(x, z, yy, dx, dz) {
    let best = null;
    for (const b of W.buildings) {
      if (b.h <= yy) continue;
      const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
      const ox = (x - b.x) * c + (z - b.z) * s, oz = -(x - b.x) * s + (z - b.z) * c;
      const vx = dx * c + dz * s, vz = -dx * s + dz * c;
      let t0 = 0, t1 = 60, nAxis = -1, nSign = 0;
      for (const [o, v, half, ax] of [[ox, vx, b.sx / 2, 0], [oz, vz, b.sz / 2, 1]]) {
        if (Math.abs(v) < 1e-12) { if (Math.abs(o) > half) { t0 = 1e9; break; } continue; }
        let ta = (-half - o) / v, tb = (half - o) / v, sg = -1;
        if (ta > tb) { const q = ta; ta = tb; tb = q; sg = 1; }
        if (ta > t0) { t0 = ta; nAxis = ax; nSign = sg; }
        if (tb < t1) t1 = tb;
      }
      if (t0 <= t1 && t0 > 0 && t0 < 60 && (!best || t0 < best.t)) {
        const lnx = nAxis === 0 ? nSign : 0, lnz = nAxis === 1 ? nSign : 0;
        best = { t: t0, h: b.h, nx: lnx * c - lnz * s, nz: lnx * s + lnz * c };
      }
    }
    return best;
  }

  /**
   * Wind vector (m/s) at a point in the twin frame. out = {x,y,z, speed, mean, zone, gust:{u,v,w}}
   */
  W.at = function (x, y, z, out = {}) {
    const fl = flow();
    const zz = Math.max(0, y - W.groundY);
    let U = meanSpeed(zz);
    let u = W.urbanEffects && W.buildings.length ? urban(x, y, z, fl) : { f: 1, vy: 0, fx: fl.x, fz: fl.z, zone: 'free' };
    U *= u.f;
    let gx = 0, gy = 0, gz = 0;
    if (W.gusts && u.zone !== 'inside') {
      const p = drydenParams(Math.max(zz, 3), W.W20());
      const s = W.turbulenceScale;
      const gu = gs.u * p.sigmaU * s, gv = gs.v * p.sigmaV * s, gw = gs.w * p.sigmaW * s;
      const px = -u.fz, pz = u.fx;
      gx = u.fx * gu + px * gv; gz = u.fz * gu + pz * gv; gy = gw;
      // near the ground the vertical gust must vanish (no flow through the ground)
      gy *= Math.min(1, zz / 3);
    }
    out.x = u.fx * U + gx; out.z = u.fz * U + gz; out.y = u.vy * U + gy;
    out.speed = Math.hypot(out.x, out.y, out.z); out.mean = U; out.zone = u.zone;
    return out;
  };
  return W;
}
