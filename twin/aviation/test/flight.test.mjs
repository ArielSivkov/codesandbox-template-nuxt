import test from 'node:test'; import assert from 'node:assert/strict';
import { JetSim, FIGHTER, liftCoef, clMaxOf, dragCoef, levelTrimSpeed, stallSpeed, liftSlope } from '../src/jet.js';
import { isa, G0 } from '../src/atmo.js';
const D = Math.PI / 180, P = FIGHTER, M0 = P.massEmpty + P.fuelMax;   // ≈ 12 211 kg (clean, full internal fuel)
test('lift-curve slope and CLmax are in the published range for low-AR fighters', () => {
  const a = liftSlope(P, 0); assert.ok(a > 3.0 && a < 3.6, `CLα ${a}/rad`);
  const cm = clMaxOf(P); assert.ok(cm > 1.1 && cm < 1.6, `CLmax ${cm}`);
  const AR = P.b ** 2 / P.S, k = 1 / (Math.PI * P.e * AR), LDmax = 1 / (2 * Math.sqrt(k * P.CD0)); assert.ok(LDmax > 8 && LDmax < 12, `L/Dmax ${LDmax}`);
});
test('level-flight trim speed at 12.2 t, sea level: stall 130–160 kt, α = 8° → 220–280 kt', () => {
  const vs = stallSpeed(P, M0, 0) * 1.943844; assert.ok(vs > 130 && vs < 160, `Vs ${vs} kt`);
  const v8 = levelTrimSpeed(P, M0, 0, 8) * 1.943844; assert.ok(v8 > 220 && v8 < 280, `V(α=8°) ${v8} kt`);
});
test('simulated steady level flight at 3 000 m (altitude-hold): lift = weight within 3 %, altitude held, sane speed', () => {
  const s = new JetSim(); s.reset({ y: 3000, speed: 200, heading: 90, throttle: 0.7 }); s.gear = false;
  // simple altitude-hold autopilot on the stick (the trim itself comes from the physics)
  for (let i = 0; i < 120 * 150; i++) { const h = s.hud(); s.step(1 / 120, { throttle: 0.7, pitch: Math.max(-1, Math.min(1, -0.02 * h.vs - 0.002 * (h.alt - 3000))) }); }
  const h = s.hud(); const L = s.Lift, W = s.mass * G0 * (6371000 / (6371000 + h.alt)) ** 2;
  assert.ok(Math.abs(h.alt - 3000) < 150, `alt ${h.alt}`); assert.ok(Math.abs(h.vs) < 3, `vs ${h.vs}`);
  assert.ok(Math.abs(L * Math.cos(s.alpha) / W - 1) < 0.03 || Math.abs(L / W - 1) < 0.03, `L/W ${L / W}`);
  assert.ok(h.tas > 180 && h.tas < 320, `steady TAS ${h.tas} m/s`);
  // thrust = drag at equilibrium (the speed settled)
  assert.ok(Math.abs(s.lastT * Math.cos(s.alpha) - s.Drag) / s.Drag < 0.15, `T ${s.lastT} D ${s.Drag}`);
});
test('stall: CL peaks exactly at the critical α and falls after it', () => {
  const ac = P.aCrit; const c0 = liftCoef(P, ac - 0.5 * D), c1 = liftCoef(P, ac), c2 = liftCoef(P, ac + 0.5 * D), c5 = liftCoef(P, ac + 5 * D);
  assert.ok(c1 > c0 && c1 > c2 && c5 < c1 - 0.1, `${c0} ${c1} ${c2} ${c5}`);
  let best = 0, bestA = 0; for (let a = 0; a < 60; a += 0.1) { const c = liftCoef(P, a * D); if (c > best) { best = c; bestA = a; } }
  assert.ok(Math.abs(bestA - ac / D) < 0.15, `peak at ${bestA}°`);
  assert.ok(dragCoef(P, 40 * D, liftCoef(P, 40 * D), 0.3) > 0.5, 'post-stall drag rises');
});
test('stall in flight (direct mode, full aft stick, idle): α passes α_crit, stall flag; FBW limits α to 25°', () => {
  const s = new JetSim(); s.fbw = false; s.reset({ y: 3000, speed: 110, throttle: 0.1 }); s.gear = false; let stalled = false, warned = false;
  for (let i = 0; i < 120 * 12; i++) { s.step(1 / 120, { pitch: 1, throttle: 0.1 }); stalled ||= s.stalled; warned ||= s.stall; }
  assert.ok(warned && stalled, 'stall expected');
  const f = new JetSim(); f.reset({ y: 3000, speed: 110, throttle: 0.1 }); f.gear = false; let amax = 0;
  for (let i = 0; i < 120 * 12; i++) { f.step(1 / 120, { pitch: 1, throttle: 0.1 }); amax = Math.max(amax, f.alpha); }
  assert.ok(amax < 26 * D, `FBW α max ${amax / D}`);
});
test('takeoff: full afterburner, rotate → lifts off between 150 and 200 kt within 900 m', () => {
  const s = new JetSim(); s.reset({ onGround: true, throttle: 1.1 }); let lo = null;
  for (let i = 0; i < 120 * 30 && !lo; i++) { const h = s.hud(); s.step(1 / 120, { throttle: 1.1, pitch: h.kt > 135 ? 1 : 0 }); if (s.events.includes('liftoff')) lo = { kt: s.hud().kt, d: Math.hypot(s.pos.x, s.pos.z) }; }
  assert.ok(lo, 'no liftoff'); assert.ok(lo.kt > 150 && lo.kt < 200, `liftoff ${lo.kt} kt`); assert.ok(lo.d < 900, `roll ${lo.d} m`);
});
test('frame-rate independence: 20 s of manoeuvres at 30 fps == 60 fps == 144 fps', () => {
  const run = fps => { const s = new JetSim(); s.reset({ y: 1500, speed: 180, throttle: 0.9 }); s.gear = false;
    for (let i = 0; i < 20 * fps; i++) { const t = i / fps; s.update(1 / fps, { pitch: t < 5 ? 0.4 : 0, roll: t >= 6 && t < 9 ? 0.7 : 0, yaw: t >= 12 ? 0.3 : 0, throttle: t < 10 ? 1.1 : 0.6 }); } return s; };
  const a = run(30), b = run(60), c = run(144);
  // 144 fps is not a divisor of 120 Hz: the physics state is up to one step behind, the render pose is interpolated
  assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) < 1e-6, 'same steps 30/60');
  const pa = a.renderPose(), pc = c.renderPose(); assert.ok(Math.hypot(pa.pos.x - pc.pos.x, pa.pos.y - pc.pos.y, pa.pos.z - pc.pos.z) < 3, '144 fps within one step');
});
