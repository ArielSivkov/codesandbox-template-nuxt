/* ESH27 twin physics — drone.js
 * Quadcopter rigid-body model (6-DoF) + cascaded controller for "arcade" stick input,
 * fixed-timestep integration that is independent of the render frame rate.
 *
 * FRAMES: world = twin frame (x east, y up, z south). Body frame: x = right, y = up (thrust axis),
 *   z = back, i.e. forward is −z — the same convention as a three.js Object3D, so
 *   mesh.quaternion.set(q.x, q.y, q.z, q.w) and mesh.position.copy(p) render it directly.
 *
 * PHYSICS:
 *   rotor thrust T_i = kT·Ω_i², reaction torque Q_i = ±kQ·Ω_i²  (standard quadrotor model, e.g.
 *     Mahony, Kumar & Corke 2012, IEEE RAM 19(3) "Multirotor Aerial Vehicles")
 *   m·dv/dt = R·(0, ΣT, 0) − m·g·ŷ + F_drag(v − wind)
 *   I·dω/dt = τ − ω × Iω − c_ω·ω
 *   F_drag = −½ρ|v_r|·diag(CdA_side, CdA_top, CdA_side)·v_r   in body axes (quadratic) [D1]
 *   Motor: first-order lag τ_m on Ω [D2]. Battery: energy integrator, voltage(SOC), Ω_max ∝ V [D3].
 *   Rotor power: momentum theory P = T^1.5/√(2ρA) / FM / η + drag power [D4].
 *
 * INTEGRATION: semi-implicit (symplectic) Euler, h = 1/250 s; rotation by exact quaternion exponential.
 *   Stepper counts steps from the accumulated sim time → the same step sequence at 30, 60 or 144 fps.
 *
 * PARAMETERS — "phantom4pro" preset, from DJI Phantom 4 Pro V2.0 specifications
 *   https://www.dji.com/support/product/phantom-4-pro-v2  (takeoff weight 1375 g, diagonal 350 mm,
 *   max speed 72 km/h S-mode, max ascent 6 m/s, descent 4 m/s, max tilt 42° S / 25° P,
 *   max angular speed 250°/s S, wind resistance 10 m/s, 5870 mAh 15.2 V 89.2 Wh, ~30 min).
 *   ESTIMATES (not published by DJI, labeled):
 *     [E1] thrust/weight 2.0 (a 42° bank in level flight needs ≥ 1/cos42° = 1.35; 2 is a common design value)
 *     [E2] Ω_max 1000 rad/s, so kT = T_max/Ω_max²; kQ = 0.016 m·kT (typical torque/thrust ratio for 9–10" props)
 *     [E3] inertia from a box body (1.135 kg, 0.20×0.10×0.20 m) + 4 point motors (60 g) at the arm ends
 *     [E4] CdA_top 0.06 m² assumed (plan area ~0.06 m² × Cd ~1); CdA_side 0.0495 m² then CALIBRATED so that
 *          steady level flight at the published max tilt 42° gives the published 20 m/s (assumes S-mode speed
 *          is drag-limited at max tilt). Steady state in body-axis drag:
 *          tanθ = q(a·cos²θ + b·sin²θ) / (m·g + q(b − a)·sinθ·cosθ),  q = ½ρv², a = CdA_side, b = CdA_top
 *     [E5] prop radius 0.119 m (9.4" 9450 props), figure of merit 0.6, motor+ESC efficiency 0.85
 *     [D2] τ_m 0.03 s; [D3] 4S LiPo V_oc = 14.0 + 2.8·SOC (linear — real curve is flatter mid-range)
 */

const G = 9.80665;

export const PRESETS = {
  phantom4pro: {
    name: 'DJI Phantom 4 Pro V2.0 class (1.375 kg)',
    mass: 1.375, arm: 0.175, rho: 1.225,
    thrustToWeight: 2.0, omegaMax: 1000, kQoverkT: 0.016, motorTau: 0.03,
    inertia: [0.0083, 0.0147, 0.0083], angDamp: 0.002,
    cdaSide: 0.0495, cdaTop: 0.06,
    propRadius: 0.119, figureOfMerit: 0.6, etaElec: 0.85,
    batteryWh: 89.2, vFull: 16.8, vEmpty: 14.0,
    // controller limits (S-mode values from DJI spec)
    maxTiltDeg: 42, maxSpeed: 20, maxUp: 6, maxDown: 4, maxRateDeg: 250, yawRateDeg: 150,
  },
};

// ------------------------------------------------------------------ small vector / quaternion helpers
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const scl = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const norm = (a) => { const l = len(a) || 1; return scl(a, 1 / l); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function qMul(a, b) {
  return { w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
           y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w };
}
export function qRotate(q, v) { // body → world
  const { w, x, y, z } = q;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return v3(v.x + w * tx + (y * tz - z * ty), v.y + w * ty + (z * tx - x * tz), v.z + w * tz + (x * ty - y * tx));
}
const qConj = (q) => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
const qRotateInv = (q, v) => qRotate(qConj(q), v);
function qNorm(q) { const l = Math.hypot(q.w, q.x, q.y, q.z); return { w: q.w / l, x: q.x / l, y: q.y / l, z: q.z / l }; }
export function qFromAxisAngle(ax, ang) { const s = Math.sin(ang / 2), a = norm(ax); return { w: Math.cos(ang / 2), x: a.x * s, y: a.y * s, z: a.z * s }; }
/** Rotation matrix columns (body axes in world) → quaternion. */
function qFromBasis(bx, by, bz) {
  const m00 = bx.x, m01 = by.x, m02 = bz.x, m10 = bx.y, m11 = by.y, m12 = bz.y, m20 = bx.z, m21 = by.z, m22 = bz.z;
  const tr = m00 + m11 + m22; let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s }; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s }; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s }; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s }; }
  return qNorm(q);
}

function invert4(M) {
  const n = 4, A = M.map((r, i) => [...r, ...[0, 0, 0, 0].map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((r) => r.slice(n));
}

// ------------------------------------------------------------------ model
export function createDrone(opts = {}) {
  const P = { ...PRESETS.phantom4pro, ...(opts.params || {}) };
  const tMaxRotor = (P.thrustToWeight * P.mass * G) / 4;
  P.kT = tMaxRotor / (P.omegaMax * P.omegaMax);
  P.kQ = P.kQoverkT * P.kT;
  P.diskArea = Math.PI * P.propRadius ** 2;
  const a = P.arm / Math.SQRT2;
  // rotors: front-right, front-left, rear-left, rear-right (forward = −z). yaw: +1 → +y body torque.
  const rotors = [
    { x: a, z: -a, yaw: -1 }, { x: -a, z: -a, yaw: +1 }, { x: -a, z: a, yaw: -1 }, { x: a, z: a, yaw: +1 },
  ];
  // [T, τx, τy, τz] = M · u,  u_i = Ω_i²   (τ from r × (0,T,0) = (−z·T, 0, x·T))
  const M = [rotors.map(() => P.kT), rotors.map((r) => -r.z * P.kT), rotors.map((r) => r.yaw * P.kQ), rotors.map((r) => r.x * P.kT)];
  const Minv = invert4(M);

  const s = {
    p: v3(...(opts.position || [0, 0, 0])), v: v3(), q: { w: 1, x: 0, y: 0, z: 0 }, w: v3(),
    omega: [0, 0, 0, 0], energyWh: 0, t: 0, landed: true, collided: 0,
    // controller memory
    iv: v3(), yawDes: opts.yaw || 0,
  };
  if (opts.yaw) s.q = qFromAxisAngle(v3(0, 1, 0), -opts.yaw); // opts.yaw = heading (rad, clockwise from north)
  const I = P.inertia;

  const D = {
    P, s, rotors, mode: opts.mode || 'gps', groundY: opts.groundY ?? 0, motorsEnabled: true,
    lastThrust: 0, lastPower: 0, lastWind: v3(), lastCmd: null,
  };

  D.soc = () => clamp(1 - s.energyWh / P.batteryWh, 0, 1);
  D.voltage = () => P.vEmpty + (P.vFull - P.vEmpty) * D.soc();       // [D3]
  D.omegaMaxNow = () => P.omegaMax * D.voltage() / P.vFull;          // [D3] BLDC speed ∝ voltage
  D.hoverOmega = () => Math.sqrt((P.mass * G) / (4 * P.kT));
  D.rotorPower = (T) => (T > 0 ? Math.pow(T, 1.5) / Math.sqrt(2 * P.rho * P.diskArea) / P.figureOfMerit / P.etaElec : 0); // [D4]

  /** Forward direction (horizontal, world) of the current heading. */
  D.heading = () => { const f = qRotate(s.q, v3(0, 0, -1)); return Math.atan2(f.x, -f.z); }; // 0 = north, + clockwise

  /** Cascaded controller: sticks → rotor speed commands Ω²_cmd. in = {throttle, pitch, roll, yaw} ∈ [−1,1]. */
  function control(inp, h, wind) {
    const tilt = (P.maxTiltDeg * Math.PI) / 180;
    // yawDes = desired heading ψ (0 = north, clockwise +). stick right → turn right.
    s.yawDes += (inp.yaw || 0) * (P.yawRateDeg * Math.PI / 180) * h;
    const fw = v3(Math.sin(s.yawDes), 0, -Math.cos(s.yawDes));
    const right = v3(-fw.z, 0, fw.x);                                   // fw × up
    let F; // desired force (world, N) excluding gravity compensation handled below
    const vyDes = (inp.throttle || 0) >= 0 ? (inp.throttle || 0) * P.maxUp : (inp.throttle || 0) * P.maxDown;
    // vertical: P + I + drag feed-forward on the commanded climb rate relative to the air
    const vry = vyDes - wind.y;
    const ay = 4.0 * (vyDes - s.v.y) + s.iv.y + 0.5 * P.rho * P.cdaTop * Math.abs(vry) * vry / P.mass;
    if (D.mode === 'atti') {
      // stick → tilt angle directly; altitude handled by vertical-speed loop; wind is NOT compensated
      const ax = G * Math.tan(tilt) * (inp.pitch || 0), ar = G * Math.tan(tilt) * (inp.roll || 0);
      F = add(scl(fw, ax * P.mass), scl(right, ar * P.mass));
      F.y = P.mass * (G + ay);
      s.iv.y = clamp(s.iv.y + 2.0 * (vyDes - s.v.y) * h, -3, 3);
    } else {
      let cx = inp.pitch || 0, cr = inp.roll || 0; const m = Math.hypot(cx, cr); if (m > 1) { cx /= m; cr /= m; }
      const vDes = add(scl(fw, cx * P.maxSpeed), scl(right, cr * P.maxSpeed));
      const ev = v3(vDes.x - s.v.x, 0, vDes.z - s.v.z);
      // velocity PI (+ integral handles wind & drag); gains chosen for ~1 s velocity response
      const kp = 1.8, ki = 0.6;
      s.iv.x = clamp(s.iv.x + ki * ev.x * h, -8, 8); s.iv.z = clamp(s.iv.z + ki * ev.z * h, -8, 8);
      s.iv.y = clamp(s.iv.y + 2.0 * (vyDes - s.v.y) * h, -3, 3);
      // drag feed-forward at the commanded velocity relative to the measured wind (GPS drones estimate wind)
      const vr = sub(vDes, wind); const vrh = Math.hypot(vr.x, vr.z);
      const ffx = 0.5 * P.rho * P.cdaSide * vrh * vr.x / P.mass, ffz = 0.5 * P.rho * P.cdaSide * vrh * vr.z / P.mass;
      const ax = kp * ev.x + s.iv.x + ffx * 0.8, az = kp * ev.z + s.iv.z + ffz * 0.8;
      F = v3(P.mass * ax, P.mass * (G + ay), P.mass * az);
    }
    // tilt limit: |F_h| ≤ F_y·tan(tilt)
    const fh = Math.hypot(F.x, F.z), fhMax = Math.max(0, F.y) * Math.tan(tilt);
    if (fh > fhMax) { F.x *= fhMax / fh; F.z *= fhMax / fh; }
    if (F.y < 0.1 * P.mass * G) F.y = 0.1 * P.mass * G;
    // desired attitude: body y ∥ F, heading yawDes
    const b3 = norm(F);
    const b1 = norm(cross(fw, b3));            // body x (right) = forward × up
    const bz = cross(b1, b3);                  // body z (back)
    const qd = qFromBasis(b1, b3, bz);
    // collective thrust = projection on the CURRENT body y axis
    const by = qRotate(s.q, v3(0, 1, 0));
    const Tc = Math.max(0, dot(F, by));
    // attitude error (body frame): qe = q⁻¹ ⊗ qd, ω_des = 2·Kq·sign(w)·vec(qe)
    let qe = qMul(qConj(s.q), qd); if (qe.w < 0) qe = { w: -qe.w, x: -qe.x, y: -qe.y, z: -qe.z };
    const kAtt = 8, rmax = (P.maxRateDeg * Math.PI) / 180;
    const yawFF = -(inp.yaw || 0) * (P.yawRateDeg * Math.PI / 180);   // heading ψ̇ = −ω_y
    const wDes = v3(clamp(2 * kAtt * qe.x, -rmax, rmax), clamp(yawFF + 2 * 4 * qe.y, -rmax, rmax), clamp(2 * kAtt * qe.z, -rmax, rmax));
    // rate loop (P + gyroscopic compensation)
    const kw = 25;
    const Iw = v3(I[0] * s.w.x, I[1] * s.w.y, I[2] * s.w.z);
    const gyro = cross(s.w, Iw);
    const tau = v3(I[0] * kw * (wDes.x - s.w.x) + gyro.x, I[1] * kw * 0.6 * (wDes.y - s.w.y) + gyro.y, I[2] * kw * (wDes.z - s.w.z) + gyro.z);
    return mix(Tc, tau);
  }

  /** Mixer with saturation: keep roll/pitch, sacrifice yaw first, then clamp. [approximation] */
  function mix(T, tau) {
    const om = D.omegaMaxNow(), uMax = om * om;
    const solve = (t, tx, ty, tz) => Minv.map((r) => r[0] * t + r[1] * tx + r[2] * ty + r[3] * tz);
    const u0 = solve(T, tau.x, 0, tau.z), uy = solve(0, 0, tau.y, 0);
    // largest fraction λ ∈ [0,1] of the yaw torque that keeps every rotor inside [0, uMax]
    let lam = 1;
    for (let i = 0; i < 4; i++) {
      if (uy[i] > 0) lam = Math.min(lam, Math.max(0, (uMax - u0[i]) / uy[i]));
      else if (uy[i] < 0) lam = Math.min(lam, Math.max(0, -u0[i] / uy[i]));
    }
    let u = u0.map((x, i) => x + lam * uy[i]);
    if (u.some((x) => x < 0 || x > uMax)) {
      // shift collective to fit the differential part into [0, uMax]
      const lo = Math.min(...u), hi = Math.max(...u);
      if (hi - lo <= uMax) { const sh = lo < 0 ? -lo : hi > uMax ? uMax - hi : 0; u = u.map((x) => x + sh); }
    }
    return u.map((x) => clamp(x, 0, uMax));
  }

  /** One fixed physics step of length h. wind: createWind() object or null. collide(p, r) optional. */
  D.step = function (h, inp = {}, wind = null, collide = null) {
    const wv = wind ? wind.at(s.p.x, s.p.y, s.p.z) : v3();
    D.lastWind = wv;
    // ---- controller → motor commands
    const armed = D.motorsEnabled && !(s.landed && (inp.throttle || 0) <= 0.05);
    let uCmd = armed ? control(inp, h, wv) : [0, 0, 0, 0];
    if (!armed) { s.iv = v3(); s.yawDes = D.heading(); }
    // ---- motors (first-order lag, exact discretisation) [D2]
    const am = 1 - Math.exp(-h / P.motorTau);
    let Tsum = 0, tauB = v3(), power = 0;
    for (let i = 0; i < 4; i++) {
      const target = Math.sqrt(uCmd[i]);
      s.omega[i] += (target - s.omega[i]) * am;
      const u = s.omega[i] * s.omega[i], Ti = P.kT * u, r = rotors[i];
      Tsum += Ti;
      tauB = add(tauB, v3(-r.z * Ti, r.yaw * P.kQ * u, r.x * Ti));
      power += D.rotorPower(Ti);
    }
    // ---- forces (world)
    const thrustW = qRotate(s.q, v3(0, Tsum, 0));
    const vr = sub(s.v, wv);
    const vrb = qRotateInv(s.q, vr), sp = len(vrb);
    const dragB = v3(-0.5 * P.rho * P.cdaSide * sp * vrb.x, -0.5 * P.rho * P.cdaTop * sp * vrb.y, -0.5 * P.rho * P.cdaSide * sp * vrb.z); // [D1]
    const dragW = qRotate(s.q, dragB);
    const acc = v3((thrustW.x + dragW.x) / P.mass, (thrustW.y + dragW.y) / P.mass - G, (thrustW.z + dragW.z) / P.mass);
    // ---- semi-implicit Euler: v first, then p with new v
    s.v = add(s.v, scl(acc, h));
    if (s.landed && acc.y <= 0) { s.v = v3(); }
    else s.landed = false;
    s.p = add(s.p, scl(s.v, h));
    // ---- rotation
    const Iw = v3(I[0] * s.w.x, I[1] * s.w.y, I[2] * s.w.z);
    const gy = cross(s.w, Iw);
    const wdot = v3((tauB.x - gy.x - P.angDamp * s.w.x) / I[0], (tauB.y - gy.y - P.angDamp * s.w.y) / I[1], (tauB.z - gy.z - P.angDamp * s.w.z) / I[2]);
    s.w = add(s.w, scl(wdot, h));
    const wl = len(s.w);
    if (wl > 1e-12) s.q = qNorm(qMul(s.q, qFromAxisAngle(s.w, wl * h)));
    // ---- ground contact (flat ground at groundY) — simple inelastic landing [approximation]
    if (s.p.y <= D.groundY) {
      s.p.y = D.groundY;
      if (s.v.y < -3) s.collided = Math.max(s.collided, -s.v.y);
      s.v = v3(0, 0, 0); s.w = v3();
      // level the body on the ground, keep heading
      const yaw = D.heading(); s.q = qFromAxisAngle(v3(0, 1, 0), -yaw);
      s.landed = true;
    }
    if (collide) { const c = collide(s.p, 0.3, s.v); if (c) { s.p = c.p; s.v = c.v; s.collided = Math.max(s.collided, c.impact || 0); } }
    // ---- battery
    D.lastPower = power; // [D4] hover-type induced power of each rotor at its current thrust (no forward-flight benefit)
    s.energyWh += (power * h) / 3600;
    D.lastThrust = Tsum;
    s.t += h;
    return s;
  };

  /** Mechanical energy (J): kinetic (translational + rotational) + potential. */
  D.mechanicalEnergy = () => 0.5 * P.mass * dot(s.v, s.v) + 0.5 * (I[0] * s.w.x ** 2 + I[1] * s.w.y ** 2 + I[2] * s.w.z ** 2) + P.mass * G * (s.p.y - D.groundY);
  /** Euler angles for UI (deg): pitch (+ nose up), roll (+ right wing down), yaw (heading from north, clockwise). */
  D.attitude = () => {
    const f = qRotate(s.q, v3(0, 0, -1)), r = qRotate(s.q, v3(1, 0, 0));
    return { pitch: Math.asin(clamp(f.y, -1, 1)) * 180 / Math.PI, roll: -Math.asin(clamp(r.y, -1, 1)) * 180 / Math.PI, yaw: ((D.heading() * 180 / Math.PI) + 360) % 360 };
  };
  return D;
}

/**
 * Fixed-timestep stepper (frame-rate independent). Steps are derived from total elapsed time, so the
 * physics step sequence is identical for any frame rate. maxFrame clamps long frames (tab in background)
 * — the ONLY case where determinism across frame rates is given up.
 */
export function createStepper(drone, { h = 1 / 250, wind = null, collide = null, maxFrame = 0.25, input = null } = {}) {
  let simTime = 0, steps = 0;
  const prev = { p: { ...drone.s.p }, q: { ...drone.s.q } };
  const S = {
    h, get time() { return steps * h; }, get steps() { return steps; },
    /** advance by a render frame; inp = sticks (held constant during the frame) or a function(t) → sticks */
    advance(frameDt, inp = {}) {
      simTime += Math.min(frameDt, maxFrame);
      const target = Math.floor(simTime / h + 1e-7);
      while (steps < target) {
        prev.p = { ...drone.s.p }; prev.q = { ...drone.s.q };
        const sticks = typeof (input || inp) === 'function' ? (input || inp)(steps * h) : inp;
        if (wind) wind.step(h, Math.max(drone.s.p.y - drone.groundY, 3));
        drone.step(h, sticks, wind, collide);
        steps++;
      }
      return (simTime - steps * h) / h; // interpolation alpha in [0,1)
    },
    /** interpolated pose for rendering */
    pose(alpha) {
      const a = clamp(alpha, 0, 1), p = drone.s.p, q = drone.s.q;
      let pq = prev.q; if (pq.w * q.w + pq.x * q.x + pq.y * q.y + pq.z * q.z < 0) pq = { w: -pq.w, x: -pq.x, y: -pq.y, z: -pq.z };
      const qi = qNorm({ w: pq.w + (q.w - pq.w) * a, x: pq.x + (q.x - pq.x) * a, y: pq.y + (q.y - pq.y) * a, z: pq.z + (q.z - pq.z) * a });
      return { p: v3(prev.p.x + (p.x - prev.p.x) * a, prev.p.y + (p.y - prev.p.y) * a, prev.p.z + (p.z - prev.p.z) * a), q: qi };
    },
  };
  return S;
}

/** Axis-aligned/rotated box collision for buildings [{x,z,sx,sz,h,rot}] (sphere radius r). Simple push-out
 *  + 30 % restitution [approximation, for demos]. */
export function boxCollider(buildings, groundY = 0) {
  return (p, r, v) => {
    for (const b of buildings) {
      const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
      const dx = p.x - b.x, dz = p.z - b.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c, ly = p.y - groundY;
      const qx = clamp(lx, -b.sx / 2, b.sx / 2), qz = clamp(lz, -b.sz / 2, b.sz / 2), qy = clamp(ly, 0, b.h);
      const ex = lx - qx, ey = ly - qy, ez = lz - qz, d = Math.hypot(ex, ey, ez);
      if (d < r) {
        let nx, ny, nz;
        if (d > 1e-9) { nx = ex / d; ny = ey / d; nz = ez / d; }
        else { // centre inside the box: push out through the nearest face
          const fx = b.sx / 2 - Math.abs(lx), fz = b.sz / 2 - Math.abs(lz), fy = b.h - ly;
          if (fy < fx && fy < fz) { nx = 0; ny = 1; nz = 0; } else if (fx < fz) { nx = Math.sign(lx) || 1; ny = 0; nz = 0; } else { nx = 0; ny = 0; nz = Math.sign(lz) || 1; }
        }
        const pen = r - d;
        const wx = nx * c - nz * s, wz = nx * s + nz * c;
        const np = v3(p.x + wx * pen, p.y + ny * pen, p.z + wz * pen);
        const vn = v.x * wx + v.y * ny + v.z * wz;
        const nv = vn < 0 ? v3(v.x - 1.3 * vn * wx, v.y - 1.3 * vn * ny, v.z - 1.3 * vn * wz) : v;
        return { p: np, v: nv, impact: vn < 0 ? -vn : 0 };
      }
    }
    return null;
  };
}
