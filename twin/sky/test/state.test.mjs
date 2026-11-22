// Frame budget + extrapolation accuracy of the renderer state (src/state.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkyState } from '../src/state.js';
import * as S from '../src/sky.js';
const W = { Moon: 2 / 24, Sun: 1, Mercury: 0.5, Venus: 1, Mars: 1, Jupiter: 4, Saturn: 4 };
test('extrapolated positions inside the validity windows ≤ 5" from the full computation (60 epochs × 7 bodies × 4 offsets)', () => {
  const err = {}; let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 60; k++) { const t0 = Date.UTC(1950, 0, 1) + rnd() * 150 * 365.25 * 86400000; const st = createSkyState({ lat: 31.8, lon: 34.65 }); st.update(t0, 7);
    for (const n of Object.keys(W)) for (const f of [-0.99, -0.5, 0.5, 0.99]) { const t = t0 + f * W[n] * 86400000; st.update(t, 0);
      const b = n === 'Moon' ? S.moon(t, st.obs, st.opt) : S.body(n, t, st.obs, st.opt); err[n] = Math.max(err[n] || 0, S.angSep(b.ra, b.dec, st.bodies[n].ra, st.bodies[n].dec) * 3600); } }
  for (const [n, e] of Object.entries(err)) assert.ok(e < 5, n + ' ' + e);
  console.log('# extrapolation max error (arcsec):', JSON.stringify(Object.fromEntries(Object.entries(err).map(([k, v]) => [k, +v.toFixed(2)]))));
});
// CPU time (process.cpuUsage → not inflated by other processes on a loaded machine) per frame.
function cpuPerFrame(st, frames, step) { let t = Date.UTC(2026, 10, 22, 23); st.update(t, 7); const c0 = process.cpuUsage(); for (let f = 0; f < frames; f++) { t += step(f); st.update(t); } const c = process.cpuUsage(c0); return (c.user + c.system) / frames; }
function nsPerCos() { const c0 = process.cpuUsage(); let x = 0; for (let i = 0; i < 2e6; i++) x += Math.cos(i * 1e-3 + 1e4); const c = process.cpuUsage(c0); return (c.user + c.system) * 1000 / 2e6 + (x > 1e99 ? 1 : 0); }
test('frame budget < 1 ms (CPU time): real time, ×600, 1 day/s, and worst case = a time jump every frame', () => {
  const gauge = nsPerCos(); const mk = () => createSkyState({ lat: 31.8, lon: 34.65, gammaDeg: -0.29 });
  const rt = cpuPerFrame(mk(), 3000, () => 1000 / 60), x600 = cpuPerFrame(mk(), 3000, () => 10000), day = cpuPerFrame(mk(), 1500, () => 1440000);
  let s = 9; const jump = cpuPerFrame(mk(), 300, () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * 86400000 * 3650);
  console.log(`# CPU µs/frame: realtime ${rt.toFixed(1)}, x600 ${x600.toFixed(1)}, 1 day/s ${day.toFixed(1)}, jump-every-frame ${jump.toFixed(1)}; this machine: ${gauge.toFixed(1)} ns per Math.cos (load ${(await_load())})`);
  assert.ok(rt < 1000 && x600 < 1000 && day < 1000, 'steady state'); assert.ok(jump < 1000 * Math.max(1, gauge / 40), 'jump frames (scaled to a 40 ns/cos phone)');
});
import { readFileSync as __rf } from 'node:fs';
function await_load() { try { return __rf('/proc/loadavg', 'utf8').split(' ')[0]; } catch (e) { return '?'; } }
