/* ESH27 twin — maritime / waves.js  (pure math, no THREE, runs in browser and Node)
 *
 * Frame of the twin: x = east, y = up, z = south (metres). Same as twin/game/js/world.js.
 *
 * Surface model: sum of Gerstner (trochoidal) waves — GPU Gems 1, ch.1 (Finch 2004, "Effective Water
 * Simulation from Physical Models"). A grid point p0 = (x0, z0) is moved to
 *   P = ( x0 + Σ Qi·Ai·a(p0)·Dix·cos θi ,  Σ Ai·a(p0)·sin θi ,  z0 + Σ Qi·Ai·a(p0)·Diz·cos θi )
 *   θi = ki·(Di·p0) + ψi(t),    ψi(t) = φi − ωi·t   (wrapped to [0,2π) in double precision on the CPU)
 * a(p0) = attenuation (shoaling / shelter / distance fade) from the maritime grid — the SAME bilinear
 * function is evaluated in GLSL (ocean.js) and here, so the boat sits on the rendered surface.
 *
 * Dispersion (linear wave theory, Airy):  ω² = g·k·tanh(k·h).  Deep water (h → ∞): ω² = g·k.
 * The rendered waves use the deep-water ω (a wave keeps one frequency everywhere; depth only scales the
 * amplitude — APPROXIMATION, no refraction / no wavelength shortening near the shore).
 */

export const G = 9.80665;
export const TAU = Math.PI * 2;

/** angular frequency for wavenumber k (rad/m) at depth h (m); h = Infinity → deep water */
export function omegaFromK(k, h = Infinity) {
  const t = Number.isFinite(h) ? Math.tanh(k * h) : 1;
  return Math.sqrt(G * k * t);
}

/** wavenumber for angular frequency ω at depth h — Newton iteration on ω² = g k tanh(kh) */
export function kFromOmega(w, h = Infinity) {
  const k0 = w * w / G;                       // deep-water solution
  if (!Number.isFinite(h)) return k0;
  let k = k0 / Math.sqrt(Math.tanh(k0 * h)) ;   // Eckart-like start
  for (let i = 0; i < 30; i++) {
    const th = Math.tanh(k * h), f = G * k * th - w * w;
    const df = G * th + G * k * h * (1 - th * th);
    const dk = f / df; k -= dk;
    if (Math.abs(dk) < 1e-12 * k) break;
  }
  return k;
}

export const wavelengthFromPeriod = (T, h = Infinity) => TAU / kFromOmega(TAU / T, h);
export const phaseSpeed = (k, h = Infinity) => omegaFromK(k, h) / k;
/** group speed cg = dω/dk = c/2·(1 + 2kh/sinh 2kh) */
export function groupSpeed(k, h = Infinity) {
  const c = phaseSpeed(k, h);
  if (!Number.isFinite(h) || k * h > 20) return c / 2;
  return c / 2 * (1 + 2 * k * h / Math.sinh(2 * k * h));
}

// ------------------------------------------------------------------ deterministic RNG
export function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

/**
 * Build a small wave set (phone-cheap: ≤ 8 components) from a sea state.
 * wind: {Hs, Tp, dirX, dirZ}   (dir = direction the waves TRAVEL, unit, twin frame)
 * swell: optional {Hs, Tp, dirX, dirZ}
 * Energy split is a fixed, labelled approximation of a JONSWAP-like spectrum (not a fit):
 *   wind sea: wavelength ratios 1, .72, .52, .37, .26 of the peak; energy .42 .26 .16 .10 .06; spread 0 +18 −24 +36 −42 deg
 *   swell:    ratios 1, .82; energy .7 .3; spread 0, +7 deg
 * Hs = 4·σ, σ² = Σ Ai²/2 (sum of independent sinusoids) → Ai = sqrt(2·m0·wi), m0 = (Hs/4)².
 */
export function buildWaveSet({ wind, swell = null, seed = 27, choppy = 0.62, maxWaves = 8, minLambda = 8 } = {}) {
  const R = rng(seed), waves = [];
  const add = (hs, tp, dx, dz, ratios, energy, spreadDeg, kind) => {
    if (!(hs > 0.005) || !(tp > 0.3)) return;
    const m0 = (hs / 4) ** 2, kp = kFromOmega(TAU / tp);
    const base = Math.atan2(dz, dx);
    for (let i = 0; i < ratios.length; i++) {
      // wavelength ≥ minLambda (8 m): resolvable by the 2.5 m mesh; shorter ripples live in the normal map
      const lam = Math.max(minLambda, TAU / kp * ratios[i]), k = TAU / lam, a = base + spreadDeg[i] * Math.PI / 180;
      waves.push({ kind, k, w: omegaFromK(k), A: Math.sqrt(2 * m0 * energy[i]), dx: Math.cos(a), dz: Math.sin(a), phi: R() * TAU, Q: 0 });
    }
  };
  if (swell) add(swell.Hs, swell.Tp, swell.dirX, swell.dirZ, [1, 0.82], [0.7, 0.3], [0, 7], 'swell');
  if (wind) add(wind.Hs, wind.Tp, wind.dirX, wind.dirZ, [1, 0.72, 0.52, 0.37, 0.26], [0.42, 0.26, 0.16, 0.10, 0.06], [0, 18, -24, 36, -42], 'wind');
  waves.splice(maxWaves);
  // steepness: Σ Qi·ki·Ai = choppy (< 1 keeps the surface free of loops; GPU Gems eq. 9 / Tessendorf)
  const n = waves.length || 1;
  for (const w of waves) w.Q = Math.min(1, choppy / (w.k * w.A * n + 1e-9));
  let s = 0; for (const w of waves) s += w.Q * w.k * w.A;
  if (s > choppy) for (const w of waves) w.Q *= choppy / s;
  const m0 = waves.reduce((a, w) => a + w.A * w.A / 2, 0);
  return { waves, Hs: 4 * Math.sqrt(m0), steep: waves.reduce((a, w) => a + w.Q * w.k * w.A, 0) };
}

/** phases ψi(t) = φi − ωi·t wrapped to [0, 2π) — computed in double precision, uploaded as uniforms */
export function phasesAt(set, t, out) {
  const ws = set.waves; out = out || new Float64Array(ws.length);
  for (let i = 0; i < ws.length; i++) { let p = (ws[i].phi - ws[i].w * t) % TAU; if (p < 0) p += TAU; out[i] = p; }
  return out;
}

/**
 * Surface sampler. atten(x0, z0) → [0..1] multiplies every amplitude (default 1).
 * All functions are deterministic given (x, z, t).
 */
export function createSurface(set, atten = null) {
  const ws = set.waves, n = ws.length;
  const ph = new Float64Array(n);
  let tCached = NaN;
  const phases = t => { if (t !== tCached) { phasesAt(set, t, ph); tCached = t; } return ph; };

  /** forward map: grid point (x0,z0) → displaced point; out = {x,y,z, jac} */
  function displace(x0, z0, t, out = {}) {
    const p = phases(t), a = atten ? atten(x0, z0) : 1;
    let dx = 0, dy = 0, dz = 0, j = 0;
    for (let i = 0; i < n; i++) {
      const w = ws[i], th = w.k * (w.dx * x0 + w.dz * z0) + p[i];
      const c = Math.cos(th), s = Math.sin(th), A = w.A * a;
      dx += w.Q * A * w.dx * c; dz += w.Q * A * w.dz * c; dy += A * s; j += w.Q * w.k * A * s;
    }
    out.x = x0 + dx; out.y = dy; out.z = z0 + dz; out.jac = 1 - j;   // jac < ~0.3 → crest (whitecap foam)
    return out;
  }

  /** inverse map by fixed-point iteration: find p0 with displace(p0).xz = (x,z); returns {x0,z0,y,err,iters} */
  const tmp = {};
  function solve(x, z, t, out = {}, maxIt = 12, tol = 1e-6) {
    let x0 = x, z0 = z, it = 0, err = Infinity;
    for (; it < maxIt; it++) {
      displace(x0, z0, t, tmp);
      const ex = tmp.x - x, ez = tmp.z - z; err = Math.hypot(ex, ez);
      if (err < tol) break;
      x0 -= ex; z0 -= ez;        // contraction while Σ Q k A < 1
    }
    displace(x0, z0, t, tmp);
    out.x0 = x0; out.z0 = z0; out.y = tmp.y; out.jac = tmp.jac; out.err = Math.hypot(tmp.x - x, tmp.z - z); out.iters = it;
    return out;
  }

  const sv = {};
  /** surface height at world (x, z) — what the GPU draws there (up to mesh interpolation) */
  function height(x, z, t) { return solve(x, z, t, sv).y; }

  /** surface normal at world (x,z) by central differences of height() (robust, includes attenuation) */
  function normal(x, z, t, e = 0.35, out = {}) {
    const hx = height(x + e, z, t) - height(x - e, z, t), hz = height(x, z + e, t) - height(x, z - e, t);
    const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
    out.x = nx / l; out.y = 1 / l; out.z = nz / l; return out;
  }

  /** orbital velocity of the water surface at (x,z) (for wakes / drift) — approx: time derivative of displacement */
  function surfaceVelocity(x, z, t, out = {}) {
    const s0 = solve(x, z, t, {}), p = phases(t), a = atten ? atten(s0.x0, s0.z0) : 1;
    let vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) {
      const w = ws[i], th = w.k * (w.dx * s0.x0 + w.dz * s0.z0) + p[i], A = w.A * a;
      // d/dt of cos θ = ω sin θ (θ decreases with t), d/dt sin θ = −ω cos θ
      vx += w.Q * A * w.dx * w.w * Math.sin(th); vz += w.Q * A * w.dz * w.w * Math.sin(th); vy += -A * w.w * Math.cos(th);
    }
    out.x = vx; out.y = vy; out.z = vz; return out;
  }

  return { set, displace, solve, height, normal, surfaceVelocity, phases };
}

/**
 * Pack a wave set for GPU uniforms (ocean.js): per wave vec4(dirX, dirZ, k, A) and vec2(Q, phase(t)).
 */
export function packUniforms(set, t, maxWaves = 8) {
  const ws = set.waves, A = new Float32Array(maxWaves * 4), B = new Float32Array(maxWaves * 2);
  const p = phasesAt(set, t);
  for (let i = 0; i < Math.min(ws.length, maxWaves); i++) {
    const w = ws[i];
    A.set([w.dx, w.dz, w.k, w.A], i * 4); B.set([w.Q, p[i]], i * 2);
  }
  return { A, B, n: Math.min(ws.length, maxWaves) };
}
