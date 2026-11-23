import test from 'node:test'; import assert from 'node:assert/strict';
import { ShipSim, MU } from '../src/spaceship.js';
import { LocalFrame } from '../src/geo.js';
const F = new LocalFrame(); const world = { center: F.center, R: F.R, surface: () => ({ y: 0, type: 'ground' }) };
function orbitShip(alt) { const s = new ShipSim(undefined, world); const c = F.center, r = F.R + alt; s.reset({ x: 0, y: c.y + r, z: c.z, newtonian: true });
  const v = Math.sqrt(MU / r); s.vel = { x: v, y: 0, z: 0 }; s.aero = false; return s; }
test('Newtonian mode conserves orbital energy (400 km circular orbit, one period, |ΔE/E| < 1e-6)', () => {
  const s = orbitShip(400000), E0 = s.energy(), T = s.orbit().period; const n = Math.round(T * 120);
  for (let i = 0; i < n; i++) s.step(1 / 120, {});
  const dE = Math.abs(s.energy() / E0 - 1); assert.ok(dE < 1e-6, `ΔE/E ${dE}`);
  assert.ok(Math.abs(s.altitude() - 400000) < 200, `alt after 1 orbit ${s.altitude()}`);
  const Tk = 2 * Math.PI * Math.sqrt((F.R + 400000) ** 3 / MU); assert.ok(Math.abs(T - Tk) < 0.5 && T > 5500 && T < 5600, `period ${T}`);
  console.log(`# 1 orbit: ΔE/E = ${dE.toExponential(2)}, Δalt = ${(s.altitude() - 400000).toFixed(2)} m, T = ${T.toFixed(1)} s`);
});
test('Newtonian free coast: energy conserved under rotation input too (rotation does not change translation)', () => {
  const s = orbitShip(1000000), E0 = s.energy(); for (let i = 0; i < 120 * 600; i++) s.step(1 / 120, { pitch: i < 200 ? 1 : 0, roll: 0.2 });
  assert.ok(Math.abs(s.energy() / E0 - 1) < 1e-7);
});
test('thrust adds the work it does: ΔE ≈ ∫a·v dt (prograde burn)', () => {
  const s = orbitShip(400000), E0 = s.energy(); let W = 0;
  for (let i = 0; i < 120 * 10; i++) { const f = s._accel({ thrust: 1 }, {}); W += (f.x * s.vel.x + f.y * s.vel.y + f.z * s.vel.z) / 120; s.step(1 / 120, { thrust: 1 }); }
  assert.ok(Math.abs((s.energy() - E0) / W - 1) < 0.01, `${s.energy() - E0} vs ${W}`);
});
test('frame-rate independence (ship, arcade): 30 fps == 60 fps', () => {
  const run = fps => { const s = new ShipSim(undefined, world); s.reset({ y: 500, heading: 30 }); for (let i = 0; i < 15 * fps; i++) s.update(1 / fps, { thrust: 0.8, pitch: i < 3 * fps ? 0.5 : 0, roll: 0.1 }); return s; };
  const a = run(30), b = run(60); assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) < 1e-6);
});
test('re-entry heating (Sutton–Graves) is ~MW/m² at 7.5 km/s, 70 km', () => {
  const s = new ShipSim(undefined, world); s.newtonian = true; s.dampers = false; const c = F.center; s.reset({ x: 0, y: c.y + F.R + 70000, z: c.z, newtonian: true }); s.vel = { x: 7500, y: 0, z: 0 };
  s.step(1 / 120, {}); assert.ok(s.heat > 3e5 && s.heat < 5e6, `${s.heat} W/m²`);
});
