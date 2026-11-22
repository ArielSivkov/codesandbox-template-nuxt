import test from 'node:test';
import assert from 'node:assert/strict';
import { project, solveOne, solveCamera, calibrateFromPhoto, focalPx } from '../src/calib.js';
import * as S from '../src/sky.js';
test('one body, roll 0: closed form recovers yaw/pitch exactly for 500 random cameras', () => {
  let s = 1; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) { const cam = { yaw: r() * 360, pitch: r() * 60 - 20, roll: 0, W: 4000, H: 3000, f: focalPx(4000, 40 + r() * 40) };
    const az = cam.yaw + (r() - 0.5) * 40, alt = cam.pitch + (r() - 0.5) * 25; const p = project(az, alt, cam); if (!p.front) continue;
    const sol = solveOne(az, alt, p.u, p.v, cam.W, cam.H, cam.f); const dy = ((sol.yaw - cam.yaw + 540) % 360) - 180;
    assert.ok(Math.abs(dy) < 1e-6 && Math.abs(sol.pitch - cam.pitch) < 1e-6, JSON.stringify({ cam, sol })); }
});
test('two bodies (Moon + Jupiter): yaw, pitch within 0.05°, roll within 0.25° with 2 px noise', () => {
  const d = new Date('2026-11-22T23:00:00Z'), obs = S.observer(31.7995, 34.647), m = S.moon(d, obs), j = S.body('Jupiter', d, obs);
  // a wide camera looking between them is impossible (174° apart) → Moon + Saturn (≈ 30° apart)
  const s = S.body('Saturn', d, obs); const cam = { yaw: 255, pitch: 28, roll: 3.5, W: 4032, H: 3024, f: focalPx(4032, 70) };
  const pm = project(m.az, m.altApparent, cam), ps = project(s.az, s.altApparent, cam);
  const sol = solveCamera([{ az: m.az, alt: m.altApparent, u: pm.u + 2, v: pm.v - 2 }, { az: s.az, alt: s.altApparent, u: ps.u - 2, v: ps.v + 1 }], { W: cam.W, H: cam.H, f: cam.f, solveRoll: true });
  assert.ok(Math.abs(sol.yaw - 255) < 0.05 && Math.abs(sol.pitch - 28) < 0.05 && Math.abs(sol.roll - 3.5) < 0.25, JSON.stringify(sol));   // roll: noise/separation ≈ 3 px / 1500 px ≈ 0.1°
});
test('calibrateFromPhoto: synthetic phone photo of the Moon → heading within 1 px-equivalent', () => {
  const d = Date.UTC(2026, 10, 22, 23, 0, 0), obs = S.observer(31.7995, 34.647), m = S.moon(d, obs);
  const cam = { yaw: 250, pitch: 40, roll: 0, W: 4000, H: 3000, f: focalPx(4000, 66) }, p = project(m.az, m.altApparent, cam);
  const r = calibrateFromPhoto({ date: d, lat: 31.7995, lon: 34.647, W: 4000, H: 3000, fovDeg: 66, marks: [{ body: 'Moon', u: p.u, v: p.v }], gammaDeg: -0.29 });
  assert.ok(Math.abs(r.heading - 250) < 1e-4 && Math.abs(r.headingGrid - 250.29) < 1e-4 && r.sigmaHeading < 0.1, JSON.stringify(r));
});
