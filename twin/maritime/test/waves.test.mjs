// node --test   (cd /home/claude/swarm/maritime)
import test from 'node:test';
import assert from 'node:assert/strict';
import { G, TAU, omegaFromK, kFromOmega, wavelengthFromPeriod, phaseSpeed, groupSpeed, buildWaveSet, createSurface, packUniforms, phasesAt } from '../src/waves.js';
import { fetchLimited, seaStateFromWind, beaufort } from '../src/seastate.js';
import { buildGrid, sampleGrid, attenuation, profileDepth, contour } from '../src/grid.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

test('dispersion: deep water ω² = g k, L = g T² / 2π', () => {
  for (const T of [2, 5, 8, 12]) {
    const L = wavelengthFromPeriod(T);
    close(L, G * T * T / TAU, 1e-9, 'deep L');
    const k = TAU / L; close(omegaFromK(k) ** 2, G * k, 1e-9);
  }
  // textbook: T = 8 s deep → L ≈ 99.9 m, c ≈ 12.49 m/s, cg = c/2
  const k8 = kFromOmega(TAU / 8); close(TAU / k8, 99.93, 0.05); close(phaseSpeed(k8), 12.49, 0.01); close(groupSpeed(k8), phaseSpeed(k8) / 2, 1e-12);
});

test('dispersion: finite depth satisfies ω² = g k tanh(k h) and shallow limit c → sqrt(g h)', () => {
  for (const [T, h] of [[8, 10], [6, 3], [12, 50], [4, 1]]) {
    const w = TAU / T, k = kFromOmega(w, h);
    close(G * k * Math.tanh(k * h), w * w, 1e-9, `T=${T} h=${h}`);
    assert.ok(k >= kFromOmega(w), 'waves shorten in shallow water');
  }
  // T = 8 s, h = 10 m: h/L0 = 0.100 → h/L = 0.1410 (linear-theory tables, e.g. CEM / SPM App. C) → L ≈ 70.9 m
  close(TAU / kFromOmega(TAU / 8, 10), 70.9, 0.3);
  const k = kFromOmega(TAU / 30, 2); close(phaseSpeed(k, 2), Math.sqrt(G * 2), 0.02, 'shallow c');
});

test('wave set: Hs reproduced, steepness < 1, deterministic by seed', () => {
  const ss = seaStateFromWind({ x: 8, z: 0 });
  const a = buildWaveSet({ wind: ss.wind, swell: ss.swell, seed: 5 });
  const b = buildWaveSet({ wind: ss.wind, swell: ss.swell, seed: 5 });
  close(a.Hs, ss.HsTotal, 1e-9, 'Hs');
  assert.ok(a.steep < 1 && a.steep > 0);
  assert.deepEqual(a.waves.map(w => w.phi), b.waves.map(w => w.phi));
  assert.ok(a.waves.length <= 8);
});

test('sampling: inverse Gerstner lands exactly on the displaced vertex (boat floats on the drawn surface)', () => {
  const ss = seaStateFromWind({ x: 12, z: 3 });
  const set = buildWaveSet({ wind: ss.wind, swell: ss.swell, seed: 11, choppy: 0.75 });
  const S = createSurface(set);
  let worst = 0, worstErr = 0;
  for (let i = 0; i < 400; i++) {
    const x0 = (i * 37.3) % 300 - 150, z0 = (i * 91.7) % 300 - 150, t = i * 0.173;
    const P = S.displace(x0, z0, t);                 // what the vertex shader does to grid vertex (x0,z0)
    const r = S.solve(P.x, P.z, t);                  // what the boat asks at the vertex's world position
    worst = Math.max(worst, Math.abs(r.y - P.y)); worstErr = Math.max(worstErr, r.err);
  }
  assert.ok(worst < 1e-6, 'height mismatch ' + worst);
  assert.ok(worstErr < 1e-6, 'xz residual ' + worstErr);
  // deterministic
  assert.equal(S.height(12.5, -40.25, 100.5), S.height(12.5, -40.25, 100.5));
  assert.equal(createSurface(set).height(12.5, -40.25, 100.5), S.height(12.5, -40.25, 100.5));
});

test('sampling: mesh interpolation error at 2.5 m vertex spacing stays small (documented bound)', () => {
  const ss = seaStateFromWind({ x: 10, z: 0 });
  const S = createSurface(buildWaveSet({ wind: ss.wind, swell: ss.swell, seed: 3 }));
  // rendered surface between vertices = linear interpolation of displaced vertices; compare midpoints on a 2 m lattice
  let worst = 0; const t = 7.3, h = 2.5;
  for (let i = 0; i < 200; i++) {
    const x0 = i * 1.7 - 170, z0 = (i * 13.1) % 200 - 100;
    const a = S.displace(x0, z0, t), b = S.displace(x0 + h, z0, t);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (a.y + b.y) / 2;
    worst = Math.max(worst, Math.abs(S.height(mx, mz, t) - my));
  }
  assert.ok(worst < 0.06, 'interp error ' + worst);
});

test('GPU uniforms: phases wrapped in double precision match the CPU sampler', () => {
  const ss = seaStateFromWind({ x: 6, z: -2 });
  const set = buildWaveSet({ wind: ss.wind, swell: ss.swell });
  const t = 123456.789;                     // long session: phases still exact
  const u = packUniforms(set, t), p = phasesAt(set, t);
  for (let i = 0; i < u.n; i++) { close(u.B[i * 2 + 1], p[i], 1e-6); assert.ok(p[i] >= 0 && p[i] < TAU); }
});

test('sea state: CEM fetch-limited relations & fully-developed cap', () => {
  // U10 = 10 m/s, X = 100 km → Hm0 ≈ 1.6 m, Tp ≈ 4.8 s (hand calculation from eq. II-2-36)
  const r = fetchLimited(10, 100e3); close(r.Hs, 1.59, 0.03); close(r.Tp, 4.78, 0.05); assert.equal(r.fullyDeveloped, false);
  const fd = fetchLimited(10, 1e9); assert.equal(fd.fullyDeveloped, true); close(fd.Hs, 211.5 * fd.ustar ** 2 / G, 1e-9);
  assert.ok(fetchLimited(15, 300e3).Hs > fetchLimited(8, 300e3).Hs);
  // offshore wind (from the east, air moves west −x) uses short fetch → smaller sea than onshore
  const on = seaStateFromWind({ x: 10, z: 0 }, { swell: null }), off = seaStateFromWind({ x: -10, z: 0 }, { swell: null });
  assert.equal(on.onshore, true); assert.equal(off.onshore, false); assert.ok(on.wind.Hs > 2 * off.wind.Hs);
  // wave travel direction = wind vector direction
  close(on.wind.dirX, 1, 1e-12);
  assert.equal(beaufort(0.2), 0); assert.equal(beaufort(10), 5); assert.equal(beaufort(33), 12);
});

test('grid: bilinear sample = node values; attenuation zero on land, one offshore', () => {
  const nx = 40, nz = 20, cs = 25;
  const g = buildGrid({ x0: 0, z0: 0, nx, nz, cs, classify: (x) => ({ land: x > 600, h: 2 }) });
  const s = sampleGrid(g, 10 * cs, 5 * cs); close(s.depth, g.depth[5 * nx + 10], 1e-6);
  const at = attenuation(g, 2);
  assert.equal(at(800, 100), 0); close(at(25, 100), 1, 1e-9);
  assert.ok(profileDepth(1000) > profileDepth(100));
  const lines = contour(g, 0); assert.ok(lines.length >= 1);
  for (const [x] of lines[0]) assert.ok(x > 575 && x < 625, 'coast x ' + x);
});
