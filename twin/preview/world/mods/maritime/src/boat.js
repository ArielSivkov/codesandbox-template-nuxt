/* ESH27 twin — maritime / boat.js — playable speedboat (pure, no THREE)
 *
 * Frame: x = east, y = up, z = south. Heading h: forward = (sin h, cos h) — same as the game's car.
 * Fixed-step integrator (120 Hz ticks counted from total time) → identical trajectories at 30 / 60 fps.
 *
 * MODEL (APPROXIMATE — a game-grade model with physically sized numbers, not a validated hull model):
 *   surge:  m·du/dt = T(u) − R(u)
 *     T = min(T_static, η·P / |u|)  (propeller: constant power above the static-thrust limit), η = 0.55
 *     R = W · r(Fv),  Fv = u / sqrt(g·∇^(1/3))  volumetric Froude number, r(Fv) a planing-hull resistance-to-
 *         weight curve shaped after Savitsky-type planing data (hump ≈ 0.14 at Fv ≈ 1.6) — shape, not fit.
 *   planing: lift fraction = smoothstep(1.4, 3.0, Fv) → hull rises up to 0.18 m; dynamic trim peaks ≈ 6°
 *            at the hump and settles ≈ 3° on the plane.
 *   yaw:    first-order lag to a speed-dependent target rate (outboard steering) — game approximation.
 *   sway:   strong lateral hull damping + drift in turns.
 *   heave:  buoyancy of a wall-sided hull: a = −g + max(0, ω²·(y_wave + d0 − y)) − 2ζω·ẏ (only when wet)
 *           ω² = ρ·g·A_wp / (m·(1+added mass)), d0 = g/ω²  → floats at y = y_wave, can leave the water.
 *   pitch / roll: spring-damper toward the plane fitted through 4 hull points on the wave surface,
 *           plus planing trim and bank into turns. Periods / damping ratios are assumptions.
 */
export const HZ = 120;
const G = 9.80665, RHO = 1025;

export const SPEEDBOAT = {
  name: 'סירת מנוע 6.5 מ\' (150 כ"ס) – פרמטרים משוערים',
  m: 1400, L: 6.5, B: 2.4, Cwp: 0.75, addedMass: 0.4,
  P: 112e3, eta: 0.55, Tstatic: 5200, boostP: 1.15, reverseFrac: 0.35,
  zetaHeave: 0.35, pitchW: 6.5, zetaPitch: 0.4, rollW: 3.4, zetaRoll: 0.18,
  yawMax: 0.75, yawLag: 3.0, swayDamp: 2.2,
};

// resistance / weight vs volumetric Froude number — shape only (labelled)
const RW = [[0, 0], [0.5, 0.012], [1.0, 0.05], [1.6, 0.14], [2.2, 0.13], [3.0, 0.11], [4.0, 0.12], [5.0, 0.155], [6.0, 0.2], [7.0, 0.26], [9, 0.4]];
export function resistanceRatio(Fv) {
  Fv = Math.abs(Fv);
  for (let i = 1; i < RW.length; i++) if (Fv <= RW[i][0]) { const [a, ra] = RW[i - 1], [b, rb] = RW[i]; return ra + (rb - ra) * (Fv - a) / (b - a); }
  return RW[RW.length - 1][1];
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * createBoat({ heightAt(x,z,t), solid?(x,z) → bool, depthAt?(x,z) → m, params, x, z, h, t })
 * heightAt must be the SAME function the ocean draws (maritime.seaHeight).
 */
export function createBoat(o) {
  const p = Object.assign({}, SPEEDBOAT, o.params || {});
  const vol = p.m / RHO, Lv = Math.cbrt(vol), Awp = p.Cwp * p.L * p.B;
  const w2 = RHO * G * Awp / (p.m * (1 + p.addedMass)), wH = Math.sqrt(w2), d0 = G / w2;
  const s = {
    x: o.x || 0, z: o.z || 0, y: 0, vy: 0, h: o.h || 0, u: 0, v: 0, r: 0,
    pitch: 0, pr: 0, roll: 0, rr: 0, time: o.t || 0, ticks: 0, t0: o.t || 0,
    Fv: 0, planing: 0, wet: 1, thrust: 0, resist: 0, airborne: false, bumped: 0, grounded: false,
  };
  s.ticks = Math.floor(s.time * HZ + 1e-6);
  s.y = o.heightAt(s.x, s.z, s.time);
  const inp = { throttle: 0, steer: 0, boost: false };
  const pts = [[p.L * 0.38, 0], [-p.L * 0.38, 0], [0, p.B * 0.42], [0, -p.B * 0.42]];   // bow, stern, port(left), starboard

  function hullSample(t) {
    const fx = Math.sin(s.h), fz = Math.cos(s.h), lx = fz, lz = -fx;    // left = forward rotated +90° (seen from above)
    const hs = pts.map(([a, b]) => o.heightAt(s.x + fx * a + lx * b, s.z + fz * a + lz * b, t));
    return { bow: hs[0], stern: hs[1], port: hs[2], stbd: hs[3], mean: (hs[0] + hs[1] + hs[2] + hs[3]) / 4 };
  }

  function tick(dt, t) {
    const W = p.m * G;
    s.Fv = s.u / Math.sqrt(G * Lv);
    s.planing = sstep(1.4, 3.0, Math.abs(s.Fv));
    // ---- surge
    const P = p.P * (inp.boost ? p.boostP : 1);
    let thr = inp.throttle;
    if (thr < 0) thr *= p.reverseFrac;
    const T = Math.sign(thr) * Math.min(p.Tstatic * Math.abs(thr), p.eta * P * Math.abs(thr) / Math.max(Math.abs(s.u), 1));
    let R = W * resistanceRatio(s.Fv) * Math.sign(s.u);
    if (s.airborne) R *= 0.05;                         // only air drag while jumping (approx)
    if (s.grounded) R += 0.5 * W * Math.sign(s.u);     // sand: strong drag
    s.thrust = T; s.resist = R;
    let du = (T - R) / p.m;
    s.u += du * dt;
    if (Math.abs(s.u) < 0.02 && Math.abs(thr) < 0.02) s.u = 0;
    // ---- yaw (target rate grows with speed, outboard steering; right stick → right turn = h decreases)
    const sp = Math.abs(s.u), auth = Math.min(1, (sp + 0.6 * Math.abs(thr)) / 4) / (1 + sp / 22);
    const rT = -inp.steer * p.yawMax * auth * (s.u < -0.1 ? -1 : 1) * (s.airborne ? 0.1 : 1);
    s.r += (rT - s.r) * Math.min(1, p.yawLag * dt);
    s.h = wrap(s.h + s.r * dt);
    // ---- sway: centrifugal drift in turns, damped by the hull
    s.v += (-s.u * s.r * 0.18 - p.swayDamp * s.v) * dt;
    // ---- horizontal motion
    const fx = Math.sin(s.h), fz = Math.cos(s.h), lx = fz, lz = -fx;
    const nx = s.x + (fx * s.u + lx * s.v) * dt, nz = s.z + (fz * s.u + lz * s.v) * dt;
    const bowX = nx + fx * p.L * 0.45 * Math.sign(s.u || 1), bowZ = nz + fz * p.L * 0.45 * Math.sign(s.u || 1);
    if (o.solid && (o.solid(nx, nz) || o.solid(bowX, bowZ))) {
      s.u *= -0.25; s.v *= 0.3; s.bumped = 0.5;      // bounce off quay / breakwater / beach
    } else { s.x = nx; s.z = nz; }
    if (s.bumped > 0) s.bumped -= dt;
    s.grounded = o.depthAt ? o.depthAt(s.x, s.z) < 0.35 : false;
    // ---- heave: buoyancy (only when wet) + gravity
    const hull = hullSample(t);
    const rise = 0.18 * s.planing;
    const yW = hull.mean + rise;
    const sub = yW + d0 - s.y;                          // >0: hull in water
    s.wet = sub > 0 ? 1 : 0;
    let ay = -G + Math.max(0, w2 * sub);
    if (sub > 0) ay -= 2 * p.zetaHeave * wH * s.vy;
    s.vy += ay * dt; s.y += s.vy * dt;
    s.airborne = s.y > yW + 0.12;
    // ---- pitch / roll toward the wave plane (+ planing trim, + bank into the turn)
    const trim = (6 * Math.exp(-((Math.abs(s.Fv) - 1.8) ** 2) / 0.8) + 3 * s.planing) * Math.PI / 180 * Math.sign(s.u || 0);
    const pT = Math.atan2(hull.bow - hull.stern, p.L * 0.76) + trim;     // + = bow up
    const bank = Math.max(-0.35, Math.min(0.35, s.r * s.u * 0.035));     // + = roll to port (left side down)
    const rT2 = Math.atan2(hull.port - hull.stbd, p.B * 0.84) * 0.8 - bank;
    const kp = s.wet ? 1 : 0.15;
    s.pr += (p.pitchW ** 2 * (pT - s.pitch) * kp - 2 * p.zetaPitch * p.pitchW * s.pr) * dt; s.pitch += s.pr * dt;
    s.rr += (p.rollW ** 2 * (rT2 - s.roll) * kp - 2 * p.zetaRoll * p.rollW * s.rr) * dt; s.roll += s.rr * dt;
  }

  /** advance to the frame time; dt clamped at 0.1 s (tab switch) */
  function step(dt, input) {
    if (input) Object.assign(inp, input);
    s.time += Math.min(Math.max(dt, 0), 0.1);
    const target = Math.floor(s.time * HZ + 1e-6);
    let n = 0;
    while (s.ticks < target && n < 24) { s.ticks++; tick(1 / HZ, s.ticks / HZ); n++; }
    if (s.ticks < target) s.ticks = target;           // drop time instead of spiralling
    return s;
  }

  function place(x, z, h, t) { s.x = x; s.z = z; s.h = h || 0; s.u = s.v = s.r = s.vy = s.pr = s.rr = s.pitch = s.roll = 0; if (t != null) { s.time = t; s.ticks = Math.floor(t * HZ + 1e-6); } s.y = o.heightAt(x, z, s.time); }

  return { state: s, params: p, step, place, input: inp, derived: { omegaHeave: wH, periodHeave: 2 * Math.PI / wH, d0, Awp, Lv }, hullSample };
}

export const knots = ms => ms * 1.943844;
