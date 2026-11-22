// Ephemeris accuracy vs. python `ephem` 4.2.1 and JPL DE421 (skyfield). References: ref/sky_refs.json (tools/make_refs.py).
// Tolerances: the task's targets (Moon < 0.1°, planets < 0.05°) AND tight regression bounds just above what was measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../src/sky.js';
import { measureAll, sepAltAz } from '../tools/measure.mjs';
const R = JSON.parse(readFileSync(new URL('../ref/sky_refs.json', import.meta.url)));
const M = measureAll();
const PL = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

test('≥ 50 random dates 1900–2100 × Ashdod/Jerusalem in the reference set', () => {
  assert.ok(R.cases.length >= 100); const years = R.cases.map(c => +c.iso.slice(0, 4));
  assert.ok(Math.min(...years) < 1910 && Math.max(...years) > 2090);
});
test('Moon vs ephem: < 0.1° (target); measured max < 15"', () => { assert.ok(M.ephem.Moon.max < 360); assert.ok(M.ephem.Moon.max < 15, M.ephem.Moon.max); });
test('Moon vs JPL DE421 (1900–2049): measured max < 15"', () => { assert.ok(M.de421.Moon.max < 15, M.de421.Moon.max); });
test('Planets Mercury–Saturn vs ephem: < 0.05° (target); measured max < 10"', () => { for (const p of PL) { assert.ok(M.ephem[p].max < 180); assert.ok(M.ephem[p].max < 10, p + ' ' + M.ephem[p].max); } });
test('Planets vs JPL DE421: measured max < 10"', () => { for (const p of PL) assert.ok(M.de421[p].max < 10, p + ' ' + M.de421[p].max); });
test('Sun (VSOP87) vs DE421 < 3"', () => assert.ok(M.de421.Sun.max < 3, M.de421.Sun.max));
test('with our own ΔT model (not the reference ΔT) Moon still < 60" over 1900–2100', () => assert.ok(M.ephemOwnDT.Moon.max < 60, M.ephemOwnDT.Moon.max));
test('Moon illuminated fraction vs ephem |Δk| < 0.001', () => assert.ok(M.phase < 0.001, M.phase));
test('Stars (BSC5 + proper motion, precession, nutation, aberration) vs skyfield < 2"', () => assert.ok(M.stars.max < 2, M.stars.max));
test('Moon & Sun rise / set / transit vs ephem (Ashdod, 20 days) < 5 s', () => { for (const [k, v] of Object.entries(M.riseSet)) assert.ok(v < 5, k + ' ' + v); });
test('task check 2026-11-22 23:00 UTC Ashdod — matches ephem/DE421; the task\'s rounded numbers within 0.35°', () => {
  const c = R.check, ctx = S.time(new Date(c.iso), { deltaT: c.ephemDeltaT }), obs = S.observer(c.lat, c.lon, 0);
  const m = S.moon(ctx, obs, { refraction: false }), j = S.body('Jupiter', ctx, obs, { refraction: false }), s = S.body('Saturn', ctx, obs, { refraction: false });
  for (const [b, n] of [[m, 'Moon'], [j, 'Jupiter'], [s, 'Saturn']]) assert.ok(sepAltAz(b.az, b.alt, c.ephem[n].az, c.ephem[n].alt) < 0.003, n);
  assert.ok(Math.abs(m.phase - 0.96) < 0.005);
  const given = { Moon: [265.0, 44.2], Jupiter: [90.1, 26.5], Saturn: [261.7, 14.7] };
  for (const [b, n] of [[m, 'Moon'], [j, 'Jupiter'], [s, 'Saturn']]) assert.ok(sepAltAz(b.az, b.alt, ...given[n]) < 0.35, n);
});
test('ancient dates vs ephem, −1350…1400 (same ΔT): Moon < 60", planets < 15"', () => {
  for (const c of R.ancient) { if (c.y < -1350) continue;
    const ctx = S.time({ jdUT: c.jdUT }, { deltaT: c.ephemDeltaT }), obs = S.observer(31.7781, 35.2354, 0);
    const m = S.moon(ctx, obs, { refraction: false }); assert.ok(sepAltAz(m.az, m.alt, c.ephem.Moon.az, c.ephem.Moon.alt) * 3600 < 60, 'moon ' + c.y);
    for (const p of PL) { const b = S.body(p, ctx, obs, { refraction: false }); assert.ok(sepAltAz(b.az, b.alt, c.ephem[p].az, c.ephem[p].alt) * 3600 < 15, p + ' ' + c.y); }
  }
});
test('historical eclipses come out central with our ΔT (Bur-Sagale 763 BCE Nineveh, Thales 585 BCE Miletus)', async () => {
  const { jdFromCalendar } = await import('../src/time.js');
  for (const [y, mo, d, lat, lon] of [[-762, 6, 15, 36.36, 43.15], [-584, 5, 28, 37.8, 27.3]]) {
    const obs = S.observer(lat, lon, 0), j0 = jdFromCalendar(y, mo, d, 'julian') - 0.25; let best = 9;
    for (let k = 0; k < 24 * 60; k++) { const c = S.time({ jdUT: j0 + k / 1440 }); const a = S.body('Sun', c, obs, { refraction: false }), b = S.moon(c, obs, { refraction: false }); if (a.alt > 0) best = Math.min(best, S.angSep(a.ra, a.dec, b.ra, b.dec)); }
    assert.ok(best < 0.1, `${y}: min separation ${best}`);
  }
});
test('twin vector convention matches physics sunVector (x east, y up, z south, γ)', async () => {
  const P = await import('../../physics/src/sun.js'); const v1 = S.twinVector(30, 120, -0.29), v2 = P.sunVector(30, 120, -0.29);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(v1[k] - v2[k]) < 1e-12);
});
test('Sun vs physics NOAA module (the twin\'s current source of truth) < 0.02° for 2000–2030 (difference = NOAA low-precision error; ours ≤ 2" vs DE421)', async () => {
  const P = await import('../../physics/src/sun.js'); let mx = 0;
  for (let i = 0; i < 200; i++) { const d = new Date(Date.UTC(2000, 0, 1) + i * 54.7 * 86400000 + i * 3700000); const a = S.body('Sun', d, S.observer(31.8, 34.65), { refraction: false }), b = P.sunPosition(d, 31.8, 34.65, { refraction: false });
    mx = Math.max(mx, sepAltAz(a.az, a.alt, b.azimuth, b.elevation)); }
  assert.ok(mx < 0.02, mx); console.log('# max difference ours vs physics NOAA sun:', (mx * 3600).toFixed(1) + '"');
});
test('equatorialToTwinMatrix reproduces topocentric() direction for a star', () => {
  const d = new Date('2026-11-22T23:00:00Z'), st = S.star('Sirius', d, S.observer(31.8, 34.65), { refraction: false, gammaDeg: -0.29 });
  const F = S.starField(d), i = F.names.indexOf('Sirius'), M3 = S.equatorialToTwinMatrix(d, 31.8, 34.65, -0.29);
  const v = [F.eq[i * 3], F.eq[i * 3 + 1], F.eq[i * 3 + 2]], x = M3[0] * v[0] + M3[1] * v[1] + M3[2] * v[2], y = M3[3] * v[0] + M3[4] * v[1] + M3[5] * v[2], z = M3[6] * v[0] + M3[7] * v[1] + M3[8] * v[2];
  assert.ok(Math.hypot(x - st.vec.x, y - st.vec.y, z - st.vec.z) < 1e-5);
});
