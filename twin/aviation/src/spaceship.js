/* ESH27 aviation — spaceship.js : 6-DoF ship, pure JS (Node-testable).
 *
 * Two regimes in one model:
 *  ARCADE ("inertia dampers" ON, default): the ship holds the velocity you command relative to the ground
 *    (hover, strafe, stop) and the rotation you command; gravity is cancelled by the dampers. Speed cap grows with
 *    altitude (air → space). This is game feel, NOT physics.
 *  NEWTONIAN (dampers OFF): F = m·a with central gravity μ/r² (non-rotating spherical Earth, J2 ignored),
 *    thrust, and atmospheric drag ½ρV²·CdA (ISA + US76 tail). Rotation: torque → angular acceleration, no damping
 *    (angular momentum kept). Integrator: velocity-Verlet (kick-drift-kick) with fixed step 1/120 s — symplectic,
 *    so orbital energy is conserved (tested < 1e-6 per orbit).
 *  Re-entry heating indicator: Sutton–Graves stagnation heat flux q = 1.7415e-4·√(ρ/r_n)·V³ W/m² (r_n = 1 m).
 *  Orbit read-out (two-body): semi-major axis, eccentricity, apoapsis/periapsis altitude, period.
 * Frame: local twin frame (x east, y up, z south); body: forward −Z, up +Y, right +X (three.js object frame).
 */
import { isa } from './atmo.js';
import { quatFromBasis } from './jet.js';
export const MU = 3.986004418e14;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const SHIP = {
  name: 'חללית ניסיונית (בדיונית)', mass: 20000, accMain: 30, accBoost: 120, accRcs: 12, accRev: 15,
  angAcc: 1.6, rateMax: 1.4, tauRate: 0.25, CdA: 18, noseR: 1.0, gearH: 2.2,
  vmaxLow: 350, // m/s near the ground with dampers
};

function rot(q, x, y, z, o) {
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  o.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y; o.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z; o.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x; return o;
}
function integ(q, wx, wy, wz, h) {
  const a = Math.hypot(wx, wy, wz) * h; if (a < 1e-14) return; const s = Math.sin(a / 2) / (a / h), c = Math.cos(a / 2), bx = wx * s, by = wy * s, bz = wz * s;
  const x = q.w * bx + q.x * c + q.y * bz - q.z * by, y = q.w * by - q.x * bz + q.y * c + q.z * bx, z = q.w * bz + q.x * by - q.y * bx + q.z * c, w = q.w * c - q.x * bx - q.y * by - q.z * bz;
  const n = Math.hypot(x, y, z, w); q.x = x / n; q.y = y / n; q.z = z / n; q.w = w / n;
}

export class ShipSim {
  /** world: { center:{x,y,z}, R, mu?, surface(x,z) → {y,type} } */
  constructor(params = SHIP, world) {
    this.P = { ...params }; this.world = world; this.h = 1 / 120; this.acc = 0; this.t = 0;
    this.dampers = true; this.newtonian = false; this.aero = true; this.warp = 1;
    this.reset({});
  }
  reset(o) {
    this.pos = { x: o.x || 0, y: o.y || 0, z: o.z || 0 }; this.vel = { x: o.vx || 0, y: o.vy || 0, z: o.vz || 0 };
    if (o.q) this.q = { ...o.q }; else { const u = this.up(this.pos, {}); const hd = (o.heading || 0) * Math.PI / 180;
      let nx = u.x * u.z, ny = u.y * u.z, nz = -1 + u.z * u.z; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const ex = ny * u.z - nz * u.y, ey = nz * u.x - nx * u.z, ez = nx * u.y - ny * u.x;
      const f = { x: nx * Math.cos(hd) + ex * Math.sin(hd), y: ny * Math.cos(hd) + ey * Math.sin(hd), z: nz * Math.cos(hd) + ez * Math.sin(hd) };
      const pt = (o.pitch || 0) * Math.PI / 180, F = { x: f.x * Math.cos(pt) + u.x * Math.sin(pt), y: f.y * Math.cos(pt) + u.y * Math.sin(pt), z: f.z * Math.cos(pt) + u.z * Math.sin(pt) };
      const U = { x: u.x * Math.cos(pt) - f.x * Math.sin(pt), y: u.y * Math.cos(pt) - f.y * Math.sin(pt), z: u.z * Math.cos(pt) - f.z * Math.sin(pt) };
      this.q = quatFromBasis(F, U); }
    this.w = { x: 0, y: 0, z: 0 }; this.landed = !!o.landed; this.crashed = null; this.events = []; this.heat = 0; this.thrustOn = 0; this.maxHeat = 0;
    if (o.dampers != null) this.dampers = o.dampers; if (o.newtonian != null) { this.newtonian = o.newtonian; this.dampers = !o.newtonian; }
    this.prev = { pos: { ...this.pos }, q: { ...this.q } }; this.acc = 0; return this;
  }
  get mu() { return this.world.mu || MU; }
  up(p, o) { const c = this.world.center; const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, l = Math.hypot(dx, dy, dz); o.x = dx / l; o.y = dy / l; o.z = dz / l; return o; }
  r() { const c = this.world.center; return Math.hypot(this.pos.x - c.x, this.pos.y - c.y, this.pos.z - c.z); }
  altitude() { return this.r() - this.world.R; }
  energy() { const v = this.vel; return 0.5 * (v.x * v.x + v.y * v.y + v.z * v.z) - this.mu / this.r(); }   // specific orbital energy (J/kg)

  /** input: { pitch, roll, yaw (−1..1), thrust (−1..1 main engine fwd/reverse), strafeX, strafeY (−1..1), boost: bool,
   *          toggleDampers: bool (edge), toggleNewtonian: bool (edge) } */
  update(dt, inp = {}) {
    if (inp.toggleDampers) { this.dampers = !this.dampers; if (this.dampers) this.newtonian = false; this.events.push(this.dampers ? 'dampers-on' : 'dampers-off'); }
    if (inp.toggleNewtonian) { this.newtonian = !this.newtonian; this.dampers = !this.newtonian; this.events.push(this.newtonian ? 'newtonian-on' : 'newtonian-off'); }
    const warp = this.newtonian && !this.thrusting(inp) ? this.warp : 1;
    this.acc += Math.min(Math.max(dt, 0), 0.25) * warp;
    let n = 0; const cap = 120 * 0.25 * Math.max(1, warp);
    while (this.acc >= this.h - 1e-9 && n < cap) { const pv = this.prev; pv.pos.x = this.pos.x; pv.pos.y = this.pos.y; pv.pos.z = this.pos.z; pv.q.x = this.q.x; pv.q.y = this.q.y; pv.q.z = this.q.z; pv.q.w = this.q.w; this.step(this.h, inp); this.acc -= this.h; n++; }
    if (n >= cap) this.acc = 0; this.alpha_r = clamp(this.acc / this.h, 0, 1); return this;
  }
  thrusting(i) { return !!(i.thrust || i.strafeX || i.strafeY || i.boost); }
  _gravity(p, o) { const c = this.world.center, dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2), k = -this.mu / (r2 * r); o.x = dx * k; o.y = dy * k; o.z = dz * k; return o; }
  _accel(inp, a) { // non-gravity acceleration (thrust + drag)
    const P = this.P, v = this.vel, f = rot(this.q, 0, 0, -1, this._f || (this._f = {})), ub = rot(this.q, 0, 1, 0, this._ub || (this._ub = {})), rb = rot(this.q, 1, 0, 0, this._rb || (this._rb = {}));
    const th = clamp(inp.thrust || 0, -1, 1), main = th >= 0 ? th * (inp.boost ? P.accBoost : P.accMain) : th * P.accRev;
    a.x = f.x * main + (rb.x * (inp.strafeX || 0) + ub.x * (inp.strafeY || 0)) * P.accRcs; a.y = f.y * main + (rb.y * (inp.strafeX || 0) + ub.y * (inp.strafeY || 0)) * P.accRcs; a.z = f.z * main + (rb.z * (inp.strafeX || 0) + ub.z * (inp.strafeY || 0)) * P.accRcs;
    this.thrustOn = Math.abs(main) / P.accBoost;
    const alt = this.altitude(), rho = alt < 1.0e6 ? isa(alt, this._atm || (this._atm = {})).rho : 0, V = Math.hypot(v.x, v.y, v.z);
    this.rho = rho; this.heat = 1.7415e-4 * Math.sqrt(rho / P.noseR) * V * V * V; this.maxHeat = Math.max(this.maxHeat, this.heat);
    if (this.aero && rho > 0 && V > 0) { const k = -0.5 * rho * V * P.CdA / P.mass; a.x += v.x * k; a.y += v.y * k; a.z += v.z * k; }
    return a;
  }
  step(h, inp) {
    const P = this.P, p = this.pos, v = this.vel; this.t += h;
    if (this.crashed) return;
    // ---- rotation
    const cmd = { x: clamp(inp.pitch || 0, -1, 1), y: -clamp(inp.yaw || 0, -1, 1), z: -clamp(inp.roll || 0, -1, 1) }; // body three axes
    if (this.newtonian) { this.w.x += cmd.x * P.angAcc * h; this.w.y += cmd.y * P.angAcc * h; this.w.z += cmd.z * P.angAcc * h; }
    else { const k = 1 - Math.exp(-h / P.tauRate); this.w.x += (cmd.x * P.rateMax - this.w.x) * k; this.w.y += (cmd.y * P.rateMax * 0.7 - this.w.y) * k; this.w.z += (cmd.z * P.rateMax * 1.3 - this.w.z) * k; }
    if (this.landed) { this.w.x = this.w.y = this.w.z = 0; }
    integ(this.q, this.w.x, this.w.y, this.w.z, h);
    // ---- translation
    const g = this._gravity(p, this._g || (this._g = {}));
    if (this.newtonian) { // velocity-Verlet: kick(½) drift kick(½); non-conservative terms evaluated at the start (1st order)
      const a = this._accel(inp, this._a || (this._a = {}));
      v.x += (g.x + a.x) * h * 0.5; v.y += (g.y + a.y) * h * 0.5; v.z += (g.z + a.z) * h * 0.5;
      p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
      const g2 = this._gravity(p, g); v.x += (g2.x + a.x) * h * 0.5; v.y += (g2.y + a.y) * h * 0.5; v.z += (g2.z + a.z) * h * 0.5;
    } else { // arcade flight-assist: track a commanded velocity; dampers cancel gravity
      const f = rot(this.q, 0, 0, -1, {}), ub = rot(this.q, 0, 1, 0, {}), rb = rot(this.q, 1, 0, 0, {});
      const alt = Math.max(0, this.altitude()), vmax = P.vmaxLow + alt * 0.12 * (inp.boost ? 3 : 1) + (inp.boost ? 600 : 0);
      const th = clamp(inp.thrust || 0, -1, 1), sx = (inp.strafeX || 0) * 80, sy = (inp.strafeY || 0) * 80;
      const tx = f.x * th * vmax + rb.x * sx + ub.x * sy, ty = f.y * th * vmax + rb.y * sx + ub.y * sy, tz = f.z * th * vmax + rb.z * sx + ub.z * sy;
      const amax = inp.boost ? P.accBoost : P.accMain, ex = tx - v.x, ey = ty - v.y, ez = tz - v.z, el = Math.hypot(ex, ey, ez);
      const k = Math.min(el * 1.2, amax) / (el || 1); v.x += ex * k * h; v.y += ey * k * h; v.z += ez * k * h;
      p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
      this.thrustOn = Math.min(1, el * 1.2 / P.accBoost + Math.abs(th) * 0.3); const V = Math.hypot(v.x, v.y, v.z), alt2 = this.altitude(), rho = alt2 < 1e6 ? isa(alt2).rho : 0; this.rho = rho;
      this.heat = 1.7415e-4 * Math.sqrt(rho / P.noseR) * V ** 3; this.maxHeat = Math.max(this.maxHeat, this.heat);
    }
    // ---- ground
    const s = this.world.surface ? this.world.surface(p.x, p.z) : { y: -Infinity, type: 'ground' };
    const near = Math.hypot(p.x, p.z) < 300000 && p.y > -100000, gy = near ? s.y + P.gearH : -Infinity, u = this.up(p, {});
    const alt = this.altitude();
    if ((near && p.y < gy) || alt < (near ? -50 : P.gearH)) {
      const vn = v.x * u.x + v.y * u.y + v.z * u.z;
      if (vn < -8 && !this.landed) { this.crashed = `פגיעה בקרקע ${(-vn).toFixed(0)} מ'/ש'`; this.events.push('crash'); v.x = v.y = v.z = 0; return; }
      if (near) p.y = gy; if (vn < 0) { v.x -= vn * u.x; v.y -= vn * u.y; v.z -= vn * u.z; }
      if (!this.landed && Math.abs(inp.thrust || 0) < 0.05) { this.landed = true; this.events.push('landed'); }
      v.x *= 0.9; v.y *= 0.9; v.z *= 0.9;
    } else if (this.landed && (inp.strafeY > 0 || (inp.thrust || 0) > 0.05)) { this.landed = false; this.events.push('liftoff'); }
  }
  renderPose(out = { pos: {}, q: {} }) {
    const a = this.alpha_r || 0, P0 = this.prev.pos, P1 = this.pos; out.pos.x = P0.x + (P1.x - P0.x) * a; out.pos.y = P0.y + (P1.y - P0.y) * a; out.pos.z = P0.z + (P1.z - P0.z) * a;
    const q0 = this.prev.q, q1 = this.q, sg = q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w < 0 ? -1 : 1;
    out.q.x = q0.x + (sg * q1.x - q0.x) * a; out.q.y = q0.y + (sg * q1.y - q0.y) * a; out.q.z = q0.z + (sg * q1.z - q0.z) * a; out.q.w = q0.w + (sg * q1.w - q0.w) * a;
    const n = Math.hypot(out.q.x, out.q.y, out.q.z, out.q.w); out.q.x /= n; out.q.y /= n; out.q.z /= n; out.q.w /= n; return out;
  }
  /** Two-body orbit elements from the state vector. */
  orbit() {
    const c = this.world.center, rx = this.pos.x - c.x, ry = this.pos.y - c.y, rz = this.pos.z - c.z, v = this.vel, r = Math.hypot(rx, ry, rz), V2 = v.x * v.x + v.y * v.y + v.z * v.z, mu = this.mu;
    const a = 1 / (2 / r - V2 / mu), rv = rx * v.x + ry * v.y + rz * v.z;
    const ex = ((V2 - mu / r) * rx - rv * v.x) / mu, ey = ((V2 - mu / r) * ry - rv * v.y) / mu, ez = ((V2 - mu / r) * rz - rv * v.z) / mu, e = Math.hypot(ex, ey, ez);
    const R = this.world.R; return { a, e, apo: a > 0 ? a * (1 + e) - R : Infinity, peri: a * (1 - e) - R, period: a > 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity, vCirc: Math.sqrt(mu / r), vEsc: Math.sqrt(2 * mu / r) };
  }
  hud(gammaDeg = 0) {
    const u = this.up(this.pos, {}), v = this.vel, V = Math.hypot(v.x, v.y, v.z), vs = v.x * u.x + v.y * u.y + v.z * u.z, f = rot(this.q, 0, 0, -1, {});
    let nx = u.x * u.z, ny = u.y * u.z, nz = -1 + u.z * u.z; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const ex = ny * u.z - nz * u.y, ey = nz * u.x - nx * u.z, ez = nx * u.y - ny * u.x;
    let hdg = Math.atan2(f.x * ex + f.y * ey + f.z * ez, f.x * nx + f.y * ny + f.z * nz) * 180 / Math.PI + gammaDeg; hdg = (hdg % 360 + 360) % 360;
    const o = this.orbit(), alt = this.altitude();
    return { speed: V, kmh: V * 3.6, mach: V / isa(Math.min(alt, 86000)).a, alt, vs, heading: hdg, pitch: Math.asin(clamp(f.x * u.x + f.y * u.y + f.z * u.z, -1, 1)) * 180 / Math.PI,
      dampers: this.dampers, newtonian: this.newtonian, warp: this.warp, heat: this.heat, heatKW: this.heat / 1000, rho: this.rho || 0, thrust: this.thrustOn,
      orbit: o, inOrbit: o.peri > 100000, landed: this.landed, crashed: this.crashed, energy: this.energy() };
  }
}
