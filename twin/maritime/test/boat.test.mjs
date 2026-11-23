import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoat, HZ, knots, resistanceRatio } from '../src/boat.js';
import { buildWaveSet, createSurface } from '../src/waves.js';
import { seaStateFromWind } from '../src/seastate.js';

const sea = (U = 8) => { const ss = seaStateFromWind({ x: U, z: 0 }); return createSurface(buildWaveSet({ wind: ss.wind, swell: ss.swell, seed: 9 })); };
// input changes on frame starts that both 30 and 60 fps hit (multiples of 1/30 s), as a player holding a key would
const drive = t => ({ throttle: t < 2 ? 0 : t < 14 ? 1 : 0.3, steer: t >= 8 && t < 11 ? 0.8 : t >= 16 ? -0.5 : 0, boost: t >= 5 && t < 8 });

function run(fps, seconds, S, jitter = 0) {
  const b = createBoat({ heightAt: S.height, x: 0, z: 0, h: 1.2, t: 0 });
  let t = 0, i = 0, maxAbs = 0;
  while (t < seconds - 1e-9) {
    let dt = 1 / fps; if (jitter) dt *= 1 + jitter * Math.sin(i * 12.9898);
    dt = Math.min(dt, seconds - t);
    b.step(dt, drive(t)); i++; t = jitter ? t + dt : i / fps;   // same input timeline for every fps
    const s = b.state; maxAbs = Math.max(maxAbs, Math.abs(s.pitch), Math.abs(s.roll));
    for (const k of ['x', 'z', 'y', 'u', 'pitch', 'roll', 'vy']) assert.ok(Number.isFinite(s[k]), k + ' not finite');
  }
  return { s: b.state, maxAbs, b };
}

test('boat: 30 fps and 60 fps give the same trajectory (fixed 120 Hz ticks)', () => {
  const S = sea(10);
  const a = run(30, 20, S).s, b = run(60, 20, S).s;
  for (const k of ['x', 'z', 'y', 'h', 'u', 'pitch', 'roll']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: ${a[k]} vs ${b[k]}`);
  assert.equal(a.ticks, 20 * HZ);
});

test('boat: stable with frame jitter and low fps (15, 24, 144 fps)', () => {
  const S = sea(14);
  const ref = run(60, 20, S).s;
  for (const fps of [15, 24, 144]) {
    const r = run(fps, 20, S, 0.3);
    assert.ok(r.maxAbs < 0.9, `fps ${fps}: pitch/roll ${r.maxAbs}`);
    assert.ok(Math.hypot(r.s.x - ref.x, r.s.z - ref.z) < 8, `fps ${fps}: drift ${Math.hypot(r.s.x - ref.x, r.s.z - ref.z)} m`);
  }
});

test('boat: floats on the wave surface at rest (heave equilibrium = sampled surface)', () => {
  const S = sea(6);
  const b = createBoat({ heightAt: S.height, x: 30, z: -20, h: 0, t: 0 });
  let err = 0, n = 0;
  for (let i = 0; i < 60 * 30; i++) {
    b.step(1 / 60, { throttle: 0, steer: 0 });
    if (i > 60 * 10) { const m = b.hullSample(b.state.time).mean; err += Math.abs(b.state.y - m); n++; }
  }
  assert.ok(err / n < 0.12, 'mean |y − surface| ' + err / n);
  assert.ok(b.derived.periodHeave > 0.5 && b.derived.periodHeave < 1.5, 'heave period ' + b.derived.periodHeave);
});

test('boat: top speed plausible for 6.5 m / 150 hp (30–45 kn) and planing reached', () => {
  const S = sea(3);
  const b = createBoat({ heightAt: S.height, x: 0, z: 0, h: 0, t: 0 });
  for (let i = 0; i < 60 * 40; i++) b.step(1 / 60, { throttle: 1, steer: 0 });
  const kn = knots(b.state.u);
  assert.ok(kn > 30 && kn < 45, 'top speed ' + kn + ' kn');
  assert.ok(b.state.planing > 0.95);
  assert.ok(resistanceRatio(1.6) > resistanceRatio(3.0), 'resistance hump');
});

test('boat: stops at solid (quay / beach) instead of passing through', () => {
  const S = sea(4);
  const b = createBoat({ heightAt: S.height, solid: (x) => x > 50, x: 0, z: 0, h: Math.PI / 2, t: 0 });  // heading east
  for (let i = 0; i < 60 * 15; i++) b.step(1 / 60, { throttle: 1, steer: 0 });
  assert.ok(b.state.x <= 50, 'x ' + b.state.x);
});
