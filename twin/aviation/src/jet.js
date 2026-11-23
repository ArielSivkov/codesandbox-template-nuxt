/* ESH27 aviation — jet.js : fixed-wing flight model (pure JS, no three.js, runs in Node).
 *
 * WHAT IS PHYSICAL (forces, F = m·a, fixed step 1/120 s):
 *   lift      L = q̄·S·CL(α, M)      CL: linear region + smooth stall at α_crit + post-stall flat-plate blend
 *   drag      D = q̄·S·(CD0(M) + k·CL² + high-α + gear/speedbrake)     k = 1/(π·e·AR)
 *   side force Y = q̄·S·CYβ·β
 *   thrust    T = throttle · T_mil (or AB) · σ^0.8 · Mach factor  (spool-up lag)  — fuel burn by TSFC, mass decreases
 *   weight    m·g(h) toward the Earth centre (round, NON-rotating Earth – approx.)
 *   atmosphere ISA (atmo.js); wind optional from the world.
 *   pitch     moment Cm = Cmα(α−α0) + Cmδ·δe + Cmq·q̂  with the published inertia Iyy
 *   yaw       moment Cn = Cnβ·β + Cnr·r̂ + Cnδr·δr  with Izz
 *   ground    wheels: rolling / brake friction, no side-slip, nose-wheel steering, rotation about the main gear,
 *             touchdown sink-rate limit.
 * WHAT IS ARCADE / APPROXIMATED (labelled):
 *   roll      rate-command (stick → roll rate, authority ∝ q̄) — like a fly-by-wire roll loop, not aileron aero.
 *   FBW       "assisted" pitch = G-command with α-limiter (25°) and 9 g limit, neutral stick holds the flight path
 *             (F-16-like idea, gains invented). Direct mode = stick → elevator, you can stall.
 *   SAS       extra pitch/yaw damping terms.
 *   No Mach tuck, no ground effect, no engine gyroscopics, no structural failure, coefficients are generic.
 *
 * PARAMETERS — "generic fighter-class (F-16-like)", approximate public data:
 *   S = 27.87 m², b = 9.45 m, c̄ = 3.45 m, Ixx/Iyy/Izz = 12 875 / 75 674 / 85 552 kg·m²
 *       — B.L. Stevens & F.L. Lewis, "Aircraft Control and Simulation", 2nd ed. (2003), F-16 model
 *         (from NASA TP-1538, Nguyen et al. 1979).
 *   empty 8 936 kg, internal fuel 3 175 kg, max take-off 16 875 kg — USAF F-16 Fighting Falcon fact sheet.
 *   thrust ≈ 76 kN dry / 129 kN afterburner (F110-GE-129 class, GE published ~17 000 / 29 000 lbf).
 *   TSFC ≈ 0.76 (dry) / 1.9 (AB) lb/(lbf·h) — typical low-bypass turbofan values (approx.).
 *   CLα from the Helmbold/DATCOM low-aspect-ratio formula (A = 3.2, Λ½ ≈ 25°) ≈ 3.2 /rad at M 0;
 *   CD0 = 0.020, e = 0.75 (Raymer, "Aircraft Design: A Conceptual Approach", typical fighter values);
 *   α_crit = 27°, CLmax ≈ 1.30 (generic; the real F-16 uses LEX vortex lift and a 25° FLCS α-limit).
 *   Stability derivatives (Cmα, Cmq, Cnβ, Cnr, …) are GENERIC stable-aircraft values, not F-16 data
 *   (the real F-16 is statically unstable in pitch and needs its FBW).
 *
 * Frame: the twin's local frame (x east, y up, z south, metres). Body frame = three.js object frame:
 *   forward = −Z, up = +Y, right = +X.  Rates p (roll, right wing down +), q (pitch up +), r (yaw nose right +).
 */
import { isa, G0, RHO0 } from './atmo.js';

export const D2R = Math.PI / 180, R2D = 180 / Math.PI, KT = 1.943844, KMH = 3.6, FT = 3.28084;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const FIGHTER = {
  name: 'מטוס קרב גנרי (בסגנון F-16, פרמטרים מקורבים)',
  S: 27.87, b: 9.45, c: 3.45, Ixx: 12875, Iyy: 75674, Izz: 85552,
  massEmpty: 8936 + 100, fuelMax: 3175,                       // +100 kg pilot & gear (approx.)
  Tmil: 76000, Tab: 129000, tsfcMil: 2.15e-5, tsfcAb: 5.4e-5,  // N, N, kg/(N·s)
  idle: 0.06, spool: 1.6, abLight: 0.6,                         // idle fraction of T_mil, engine time constants (s)
  CD0: 0.020, e: 0.75, aLin: 18 * D2R, aCrit: 27 * D2R, aNegCrit: -14 * D2R, alpha0: 0.0,
  CYb: -0.9, Cma: -0.5, Cmq: -8, Cnb: 0.10, Cnr: -0.35, Cndr: 0.02,
  deMax: 30 * D2R, deMin: -12 * D2R, drMax: 30 * D2R,
  pMax: 240 * D2R, tauRoll: 0.22, qRef: 12000,
  gLimit: 9, gNeg: -3, aLimit: 25 * D2R,
  gearH: 1.55, wheelBase: 4.0, mainArm: 0.3, sinkLimit: 4.5, tailStrike: 13 * D2R,
  CDgear: 0.018, CDbrake: 0.06, muRoll: 0.025, muBrake: 0.55,
};

/** Helmbold/DATCOM lift-curve slope (per rad) of a low-aspect-ratio swept wing, with compressibility. */
export function liftSlope(P, M) {
  const A = (P.b * P.b) / P.S, tl = Math.tan(25 * D2R), eta = 0.95;
  if (M < 0.95) { const B2 = 1 - Math.min(M, 0.9) ** 2; return (2 * Math.PI * A) / (2 + Math.sqrt(4 + (A * A * B2) / (eta * eta) * (1 + (tl * tl) / B2))); }
  const sub = liftSlope(P, 0.94), sup = 4 / Math.sqrt(Math.max(1.44, M * M) - 1) * 0.55; // supersonic thin-wing (Ackeret, ×0.55 for low AR, approx.)
  return M < 1.2 ? sub + (Math.min(sub, sup) - sub) * sstep(0.95, 1.2, M) : Math.min(sub, sup);
}
/** CL(α): linear, then quadratic round-off to CLmax at α_crit (zero slope there), then post-stall decay
 *  blending to a flat plate 1.15·sin2α. Negative side mirrored with an earlier stall. */
export function liftCoef(P, alpha, M = 0) {
  const a = liftSlope(P, M), s = Math.sign(alpha) || 1, x = Math.abs(alpha);
  const a1 = s > 0 ? P.aLin : P.aLin * (P.aNegCrit / -P.aCrit), a2 = s > 0 ? P.aCrit : -P.aNegCrit;
  const d = a2 - a1, clMax = a * a1 + (a * d) / 2;
  let cl;
  if (x <= a1) cl = a * x;
  else if (x <= a2) cl = clMax - (a / (2 * d)) * (a2 - x) ** 2;
  else { const fp = 1.15 * Math.sin(2 * Math.min(x, Math.PI / 2)), drop = clMax - 0.32 * (1 - Math.exp(-(x - a2) / (6 * D2R))); cl = drop + (fp - drop) * sstep(a2 + 8 * D2R, 50 * D2R, x); }
  return s * cl;
}
export const clMaxOf = (P, M = 0) => liftCoef(P, P.aCrit, M);
/** Zero-lift drag with a generic transonic wave-drag rise (approx. shape after Raymer ch.12). */
export function cd0(P, M) { const rise = 1.25 * sstep(0.82, 1.08, M) - 0.30 * sstep(1.2, 2.2, M); return P.CD0 * (1 + rise); }
export function dragCoef(P, alpha, cl, M) {
  const AR = (P.b * P.b) / P.S, k = 1 / (Math.PI * P.e * AR), x = Math.abs(alpha);
  const clA = Math.min(Math.abs(cl), clMaxOf(P, M));
  return cd0(P, M) + k * clA * clA + 1.2 * Math.sin(x) ** 2 * sstep(P.aCrit - 4 * D2R, P.aCrit + 10 * D2R, x);
}
/** Available thrust (N) for throttle t ∈ [0, 1] (military) and ab ∈ [0, 1] (afterburner stage), approx. lapse. */
export function thrustAvail(P, t, ab, rho, M) {
  const sig = Math.pow(rho / RHO0, 0.8), inlet = 1 - 0.6 * sstep(1.9, 2.4, M);
  const mil = P.Tmil * sig * (1 + 0.05 * M) * (P.idle + (1 - P.idle) * t);
  const aug = (P.Tab * sig * (1 + 0.45 * M) - P.Tmil * sig * (1 + 0.05 * M)) * ab;
  return (mil + Math.max(0, aug)) * inlet;
}

// ---------------------------------------------------------------- small vector / quaternion helpers (no allocation in the loop)
function qRot(q, x, y, z, o) { // rotate (x,y,z) by unit quaternion q = {x,y,z,w}
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  o.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y; o.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z; o.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x; return o;
}
function qIntegrate(q, wx, wy, wz, h) { // q ← q ⊗ exp(ω_body·h/2)
  const a = Math.hypot(wx, wy, wz) * h; if (a < 1e-12) return;
  const s = Math.sin(a / 2) / (a / h), c = Math.cos(a / 2), bx = wx * s, by = wy * s, bz = wz * s;
  const x = q.w * bx + q.x * c + q.y * bz - q.z * by, y = q.w * by - q.x * bz + q.y * c + q.z * bx, z = q.w * bz + q.x * by - q.y * bx + q.z * c, w = q.w * c - q.x * bx - q.y * by - q.z * bz;
  const n = Math.hypot(x, y, z, w); q.x = x / n; q.y = y / n; q.z = z / n; q.w = w / n;
}
export function quatFromBasis(f, u) { // body −Z = f, +Y = u (both unit, orthogonal) → quaternion
  const zx = -f.x, zy = -f.y, zz = -f.z, xx = u.y * zz - u.z * zy, xy = u.z * zx - u.x * zz, xz = u.x * zy - u.y * zx;
  const m00 = xx, m01 = u.x, m02 = zx, m10 = xy, m11 = u.y, m12 = zy, m20 = xz, m21 = u.z, m22 = zz, tr = m00 + m11 + m22; let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const n = Math.hypot(x, y, z, w); return { x: x / n, y: y / n, z: z / n, w: w / n };
}

/** Default world: flat ground at y = 0 (no curvature), no wind. The game passes a richer one:
 *  { center:{x,y,z}, R, surface(x,z) → {y, type:'runway'|'ground'|'water'}, wind?(x,y,z,t,out), collide?(x,y,z) → bool } */
export const FLAT_WORLD = { center: null, R: 6371000, surface: () => ({ y: 0, type: 'runway' }) };

export class JetSim {
  constructor(params = FIGHTER, world = FLAT_WORLD) {
    this.P = { ...params }; this.world = world; this.h = 1 / 120; this.acc = 0; this.t = 0;
    this.fbw = true; this.infiniteFuel = false;
    this.reset({});
  }
  /** Place the aircraft. o: {x, y, z, heading (deg, grid: 0 = −z), speed (m/s, along nose), pitch (deg), onGround, fuel (kg), throttle} */
  reset(o) {
    const P = this.P, hd = (o.heading || 0) * D2R, pt = (o.pitch || 0) * D2R;
    this.pos = { x: o.x || 0, y: o.y || 0, z: o.z || 0 };
    const up = this._up(this.pos, {});
    // grid-north tangent at the position (approx. −z projected on the horizon)
    let nx = 0 - up.x * -up.z, ny = 0 - up.y * -up.z, nz = -1 - up.z * -up.z; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const ex = ny * up.z - nz * up.y, ey = nz * up.x - nx * up.z, ez = nx * up.y - ny * up.x; // east = north × up
    const hf = { x: nx * Math.cos(hd) + ex * Math.sin(hd), y: ny * Math.cos(hd) + ey * Math.sin(hd), z: nz * Math.cos(hd) + ez * Math.sin(hd) };
    const f = { x: hf.x * Math.cos(pt) + up.x * Math.sin(pt), y: hf.y * Math.cos(pt) + up.y * Math.sin(pt), z: hf.z * Math.cos(pt) + up.z * Math.sin(pt) };
    const u = { x: up.x * Math.cos(pt) - hf.x * Math.sin(pt), y: up.y * Math.cos(pt) - hf.y * Math.sin(pt), z: up.z * Math.cos(pt) - hf.z * Math.sin(pt) };
    this.q = quatFromBasis(f, u);
    const sp = o.speed || 0; this.vel = { x: f.x * sp, y: f.y * sp, z: f.z * sp };
    if (o.onGround) { const s = this.world.surface(this.pos.x, this.pos.z); this.pos.y = s.y + P.gearH; this.vel = { x: hf.x * sp, y: hf.y * sp, z: hf.z * sp }; }
    this.p = 0; this.qr = 0; this.r = 0;                     // body rates (rad/s)
    this.fuel = o.fuel != null ? o.fuel : P.fuelMax; this.thr = o.throttle != null ? o.throttle : (o.onGround ? 0 : 0.8);
    this.eng = this.thr; this.ab = 0; this.abCmd = 0; this.gear = o.gear != null ? o.gear : !!o.onGround || (o.y || 0) < 300; this.onGround = !!o.onGround;
    this.crashed = null; this.events = []; this.maxG = 1; this.nz = 1; this.de = 0; this.dr = 0; this.tailStrike = false;
    this.prev = { pos: { ...this.pos }, q: { ...this.q } }; this.acc = 0;
    this._diag(); return this;
  }
  get mass() { return this.P.massEmpty + this.fuel; }
  _up(p, o) { const c = this.world.center; if (!c) { o.x = 0; o.y = 1; o.z = 0; return o; } const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, l = Math.hypot(dx, dy, dz); o.x = dx / l; o.y = dy / l; o.z = dz / l; return o; }
  altitude() { const c = this.world.center; if (!c) return this.pos.y; return Math.hypot(this.pos.x - c.x, this.pos.y - c.y, this.pos.z - c.z) - this.world.R; }

  /** Advance by a frame of dt seconds with input:
   *  { pitch: −1..1 (stick back = +1 = nose up), roll: −1..1 (right +), yaw: −1..1 (right rudder +),
   *    throttle: 0..1.1 absolute lever (>1 = afterburner)  OR  throttleRate: −1..1 (lever speed),
   *    brake: bool (wheel brakes / speed-brake in the air), gearToggle: bool (edge) }
   *  Fixed internal step 1/120 s ⇒ frame-rate independent. Returns this. */
  update(dt, inp = {}) {
    this.acc += Math.min(Math.max(dt, 0), 0.25);
    if (inp.gearToggle && !this.onGround) { this.gear = !this.gear; this.events.push(this.gear ? 'gear-down' : 'gear-up'); }
    let n = 0; while (this.acc >= this.h - 1e-9 && n < 40) { this.prev.pos.x = this.pos.x; this.prev.pos.y = this.pos.y; this.prev.pos.z = this.pos.z; this.prev.q.x = this.q.x; this.prev.q.y = this.q.y; this.prev.q.z = this.q.z; this.prev.q.w = this.q.w; this.step(this.h, inp); this.acc -= this.h; n++; }
    if (n === 40) this.acc = 0;
    this.alpha_r = clamp(this.acc / this.h, 0, 1);
    return this;
  }

  step(h, inp) {
    const P = this.P, W = this.world, pos = this.pos, v = this.vel;
    if (this.crashed) { this.t += h; return; }
    this.t += h;
    // --- controls
    if (inp.throttle != null) this.thr = clamp(inp.throttle, 0, 1.1); else if (inp.throttleRate) this.thr = clamp(this.thr + inp.throttleRate * 0.5 * h, 0, 1.1);
    const tm = Math.min(this.thr, 1); this.abCmd = this.thr > 1.0001 ? clamp((this.thr - 1) / 0.1, 0, 1) : 0;
    if (this.fuel <= 0 && !this.infiniteFuel) { this.abCmd = 0; }
    this.eng += ((this.fuel > 0 || this.infiniteFuel ? tm : 0) - this.eng) * (1 - Math.exp(-h / P.spool));
    this.ab += (this.abCmd - this.ab) * (1 - Math.exp(-h / P.abLight));
    // --- environment
    const up = this._up(pos, this._u || (this._u = {})), alt = this.altitude();
    const atm = isa(alt, this._atm || (this._atm = {})), rho = atm.rho;
    const c = W.center, gR = c ? G0 * (W.R / (W.R + alt)) ** 2 : G0;
    const wind = W.wind ? W.wind(pos.x, pos.y, pos.z, this.t, this._w || (this._w = { x: 0, y: 0, z: 0 })) : null;
    const ax = v.x - (wind ? wind.x : 0), ay = v.y - (wind ? wind.y : 0), az = v.z - (wind ? wind.z : 0), V = Math.hypot(ax, ay, az);
    const f = qRot(this.q, 0, 0, -1, this._f || (this._f = {})), ub = qRot(this.q, 0, 1, 0, this._ub || (this._ub = {})), rb = qRot(this.q, 1, 0, 0, this._rb || (this._rb = {}));
    const vf = ax * f.x + ay * f.y + az * f.z, vu = ax * ub.x + ay * ub.y + az * ub.z, vr = ax * rb.x + ay * rb.y + az * rb.z;
    const alpha = V > 1 ? Math.atan2(-vu, vf) : 0, beta = V > 1 ? Math.asin(clamp(vr / V, -1, 1)) : 0;
    const M = V / atm.a, qbar = 0.5 * rho * V * V, m = this.mass;
    // --- flight control laws
    const stickP = clamp(inp.pitch || 0, -1, 1), stickR = clamp(inp.roll || 0, -1, 1), ped = clamp(inp.yaw || 0, -1, 1);
    const cla = liftSlope(P, M);
    if (this.fbw && !this.onGround && qbar > 200) {
      const gam = Math.asin(clamp(V > 1 ? (ax * up.x + ay * up.y + az * up.z) / V : 0, -1, 1));
      const bank = Math.atan2(-(rb.x * up.x + rb.y * up.y + rb.z * up.z), ub.x * up.x + ub.y * up.y + ub.z * up.z);
      const nNeutral = Math.abs(bank) < 75 * D2R ? Math.cos(gam) / Math.max(Math.cos(bank), 0.35) : 0;
      const nCmd = stickP >= 0 ? nNeutral + stickP * (P.gLimit - nNeutral) : nNeutral + -stickP * (P.gNeg - nNeutral);
      const clReq = (nCmd * m * gR) / Math.max(qbar * P.S, 1);
      let aReq = clReq / cla; aReq = clamp(aReq, -10 * D2R, P.aLimit);
      this.de = clamp(aReq - P.alpha0 + 0.6 * (aReq - alpha), P.deMin, P.deMax);   // + proportional α feedback
    } else this.de = stickP >= 0 ? stickP * P.deMax : -stickP * -P.deMin;
    this.dr = ped * P.drMax;
    // --- aerodynamic coefficients
    const CL = liftCoef(P, alpha, M), CD = dragCoef(P, alpha, CL, M) + (this.gear ? P.CDgear : 0) + (inp.brake && !this.onGround ? P.CDbrake : 0);
    const L = qbar * P.S * CL, D = qbar * P.S * CD, Y = qbar * P.S * P.CYb * beta;
    const T = thrustAvail(P, this.eng, this.ab, rho, M);
    if (!this.infiniteFuel) this.fuel = Math.max(0, this.fuel - T * (this.ab > 0.05 ? P.tsfcAb * this.ab + P.tsfcMil * (1 - this.ab) : P.tsfcMil) * h);
    this.lastT = T;
    // directions: drag −v̂, lift ⟂ v̂ in the body symmetry plane (r_b × v̂), side force along r_b
    let Fx = 0, Fy = 0, Fz = 0;
    if (V > 1) {
      const vx = ax / V, vy = ay / V, vz = az / V; let lx = rb.y * vz - rb.z * vy, ly = rb.z * vx - rb.x * vz, lz = rb.x * vy - rb.y * vx; const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
      Fx += L * lx - D * vx + Y * rb.x; Fy += L * ly - D * vy + Y * rb.y; Fz += L * lz - D * vz + Y * rb.z;
    }
    Fx += T * f.x; Fy += T * f.y; Fz += T * f.z;
    const aeroUp = Fx * ub.x + Fy * ub.y + Fz * ub.z;          // for the G-meter (specific force along body up)
    Fx -= m * gR * up.x; Fy -= m * gR * up.y; Fz -= m * gR * up.z;
    // --- moments → body rates
    const Vd = Math.max(V, 20), qh = (this.qr * P.c) / (2 * Vd), rh = (this.r * P.b) / (2 * Vd);
    const Cm = P.Cma * (alpha - P.alpha0) + -P.Cma * this.de + P.Cmq * qh;
    const Cn = P.Cnb * beta + P.Cnr * rh + P.Cndr * this.dr;
    let Mq = qbar * P.S * P.c * Cm, Nr = qbar * P.S * P.b * Cn;
    const sas = this.onGround ? 0 : 1;
    let qdot = Mq / P.Iyy - sas * 2.5 * this.qr * Math.min(1, qbar / 3000), rdot = Nr / P.Izz - sas * 1.5 * this.r * Math.min(1, qbar / 3000);
    const auth = clamp(qbar / P.qRef, 0.08, 1), pCmd = stickR * P.pMax * auth;
    let pdot = (pCmd - this.p) / P.tauRoll;
    // --- ground contact (wheels)
    const s = W.surface(pos.x, pos.z), hAG = pos.y - s.y - P.gearH;     // surface y is in the local frame (≈ vertical = y near the city)
    let Nn = 0;
    if (hAG <= 0.02 && this.gear) {
      const vn = v.x * up.x + v.y * up.y + v.z * up.z;
      if (!this.onGround) { // touchdown
        const bank = Math.atan2(-(rb.x * up.x + rb.y * up.y + rb.z * up.z), ub.x * up.x + ub.y * up.y + ub.z * up.z), pitch = Math.asin(clamp(f.x * up.x + f.y * up.y + f.z * up.z, -1, 1));
        if (s.type === 'water') return this._crash('נחיתה במים');
        if (vn < -P.sinkLimit) return this._crash(`נחיתה קשה: ${(-vn).toFixed(1)} מ'/ש'`);
        if (Math.abs(bank) > 25 * D2R) return this._crash('נגיעת כנף בקרקע');
        if (pitch < -4 * D2R && -vn > 1.5) return this._crash('נחיתה על גלגל האף');
        this.onGround = true; this.events.push(s.type === 'runway' ? 'touchdown' : 'touchdown-offrunway');
      }
      const Fn = Fx * up.x + Fy * up.y + Fz * up.z;
      if (Fn < 0) { Nn = -Fn; Fx += Nn * up.x; Fy += Nn * up.y; Fz += Nn * up.z; }
      if (vn < 0) { v.x -= vn * up.x; v.y -= vn * up.y; v.z -= vn * up.z; }
      pos.y = Math.max(pos.y, s.y + P.gearH);
      // wheel frame: heading direction on the ground plane
      let hx = f.x - (f.x * up.x + f.y * up.y + f.z * up.z) * up.x, hy = f.y - (f.x * up.x + f.y * up.y + f.z * up.z) * up.y, hz = f.z - (f.x * up.x + f.y * up.y + f.z * up.z) * up.z; const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
      const sx = hy * up.z - hz * up.y, sy = hz * up.x - hx * up.z, sz = hx * up.y - hy * up.x; // right (h × up)
      const vF = v.x * hx + v.y * hy + v.z * hz, vS = v.x * sx + v.y * sy + v.z * sz;
      const mu = P.muRoll + (inp.brake ? P.muBrake : 0), fr = Math.min(mu * Nn, Math.abs(vF) * m / h) * Math.sign(vF);
      Fx -= fr * hx; Fy -= fr * hy; Fz -= fr * hz;
      const lat = Math.min(0.8 * Math.max(Nn, m * gR * 0.3), Math.abs(vS) * m / h) * Math.sign(vS); Fx -= lat * sx; Fy -= lat * sy; Fz -= lat * sz;
      // nose-wheel steering (kinematic yaw rate) + no roll on wheels + rotation about the main gear
      const steer = ped * (Math.abs(vF) < 30 ? 35 : 8) * D2R; this.r = (vF * Math.tan(steer)) / P.wheelBase * (Nn > 0 ? 1 : 0) + this.r * (Nn > 0 ? 0 : 1); rdot = Nn > 0 ? 0 : rdot;
      this.p = 0; pdot = 0;
      const bankNow = Math.atan2(-(rb.x * up.x + rb.y * up.y + rb.z * up.z), ub.x * up.x + ub.y * up.y + ub.z * up.z); this.p = -bankNow * 4; // wheels level the wings
      const pitch = Math.asin(clamp(f.x * up.x + f.y * up.y + f.z * up.z, -1, 1));
      if (Nn > 0) qdot += (-Nn * P.mainArm * Math.cos(pitch)) / P.Iyy - 3 * this.qr;   // weight on the nose about the main gear + strut damping
      if (pitch <= 0 && this.qr + qdot * h < 0) { this.qr = 0; qdot = 0; const k = -pitch; if (k > 1e-5) qIntegrate(this.q, k / h * 0.5, 0, 0, h); }
      this.tailStrike = pitch > P.tailStrike; if (this.tailStrike && this.qr > 0) { this.qr = 0; qdot = Math.min(qdot, 0); }
    } else if (hAG <= 0.02 && !this.gear) {
      return this._crash(s.type === 'water' ? 'פגיעה במים' : 'נחיתת גחון / פגיעה בקרקע');
    } else if (this.onGround) { this.onGround = false; this.events.push('liftoff'); }
    if (W.collide && W.collide(pos.x, pos.y, pos.z)) return this._crash('פגיעה במבנה');
    // --- integrate (semi-implicit Euler)
    this.p += pdot * h; this.qr += qdot * h; this.r += rdot * h;
    v.x += (Fx / m) * h; v.y += (Fy / m) * h; v.z += (Fz / m) * h;
    pos.x += v.x * h; pos.y += v.y * h; pos.z += v.z * h;
    qIntegrate(this.q, this.qr, -this.r, -this.p, h);
    // --- diagnostics
    this.alpha = alpha; this.beta = beta; this.V = V; this.M = M; this.qbar = qbar; this.CL = CL; this.CD = CD; this.rho = rho; this.Lift = L; this.Drag = D;
    this.nz = (aeroUp + Nn * (up.x * ub.x + up.y * ub.y + up.z * ub.z)) / (m * G0); this.maxG = Math.max(this.maxG, this.nz);
    this.stall = !this.onGround && V > 15 && alpha > P.aCrit - 3 * D2R;
    this.stalled = !this.onGround && V > 15 && alpha > P.aCrit;
  }
  _crash(why) { this.crashed = why; this.events.push('crash'); this.vel = { x: 0, y: 0, z: 0 }; this.p = this.qr = this.r = 0; return; }
  _diag() { this.alpha = 0; this.beta = 0; this.V = Math.hypot(this.vel.x, this.vel.y, this.vel.z); this.M = 0; this.stall = false; this.stalled = false; this.CL = 0; this.lastT = 0; }

  /** Interpolated render pose (smooth at any frame rate). */
  renderPose(out = { pos: {}, q: {} }) {
    const a = this.alpha_r || 0, P0 = this.prev.pos, P1 = this.pos; out.pos.x = P0.x + (P1.x - P0.x) * a; out.pos.y = P0.y + (P1.y - P0.y) * a; out.pos.z = P0.z + (P1.z - P0.z) * a;
    const q0 = this.prev.q, q1 = this.q; let d = q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w, sg = d < 0 ? -1 : 1;
    out.q.x = q0.x + (sg * q1.x - q0.x) * a; out.q.y = q0.y + (sg * q1.y - q0.y) * a; out.q.z = q0.z + (sg * q1.z - q0.z) * a; out.q.w = q0.w + (sg * q1.w - q0.w) * a;
    const n = Math.hypot(out.q.x, out.q.y, out.q.z, out.q.w); out.q.x /= n; out.q.y /= n; out.q.z /= n; out.q.w /= n; return out;
  }
  /** Everything the HUD needs (SI + display units). gammaDeg: ITM convergence to turn grid heading into true heading. */
  hud(gammaDeg = 0) {
    const up = this._up(this.pos, {}), f = qRot(this.q, 0, 0, -1, {}), ub = qRot(this.q, 0, 1, 0, {}), rb = qRot(this.q, 1, 0, 0, {});
    const v = this.vel, V = Math.hypot(v.x, v.y, v.z), vs = v.x * up.x + v.y * up.y + v.z * up.z;
    // heading: grid north = −z projected on the horizon at the aircraft
    let nx = up.x * up.z, ny = up.y * up.z, nz = -1 + up.z * up.z; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const ex = ny * up.z - nz * up.y, ey = nz * up.x - nx * up.z, ez = nx * up.y - ny * up.x;
    let hdg = Math.atan2(f.x * ex + f.y * ey + f.z * ez, f.x * nx + f.y * ny + f.z * nz) * R2D + gammaDeg; hdg = (hdg % 360 + 360) % 360;
    const alt = this.altitude(), ias = V * Math.sqrt((this.rho || RHO0) / RHO0), s = this.world.surface(this.pos.x, this.pos.z);
    return {
      tas: V, ias, kt: ias * KT, kmh: ias * KMH, tasKt: V * KT, mach: this.M || 0, alt, altFt: alt * FT, agl: this.pos.y - s.y - this.P.gearH, vs, vsFpm: vs * FT * 60,
      heading: hdg, pitch: Math.asin(clamp(f.x * up.x + f.y * up.y + f.z * up.z, -1, 1)) * R2D,
      bank: Math.atan2(-(rb.x * up.x + rb.y * up.y + rb.z * up.z), ub.x * up.x + ub.y * up.y + ub.z * up.z) * R2D,
      aoa: (this.alpha || 0) * R2D, slip: (this.beta || 0) * R2D, g: this.nz, maxG: this.maxG, throttle: this.thr, engine: this.eng, ab: this.ab > 0.05, thrust: this.lastT || 0,
      fuel: this.fuel, fuelFrac: this.fuel / this.P.fuelMax, mass: this.mass, stallWarn: this.stall, stalled: this.stalled, gear: this.gear, onGround: this.onGround, surface: s.type,
      crashed: this.crashed, fbw: this.fbw, tailStrike: this.tailStrike, cl: this.CL, clmax: clMaxOf(this.P, this.M || 0),
    };
  }
}

/** Steady level-flight trim speed (m/s TAS) for mass m at altitude h, solving L = W with CL ≤ CL_lin (analytic, M≈0 slope). */
export function levelTrimSpeed(P, m, h, alphaDeg) {
  const rho = isa(h).rho, cl = liftCoef(P, alphaDeg * D2R, 0); return Math.sqrt((2 * m * G0) / (rho * P.S * cl));
}
export function stallSpeed(P, m, h) { const rho = isa(h).rho; return Math.sqrt((2 * m * G0) / (rho * P.S * clMaxOf(P, 0))); }
