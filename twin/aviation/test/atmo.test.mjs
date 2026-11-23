import test from 'node:test'; import assert from 'node:assert/strict';
import { isa } from '../src/atmo.js';
// U.S. Standard Atmosphere 1976 (NOAA/NASA/USAF, NOAA-S/T 76-1562), geometric altitude table values
const TABLE = [[0, 1.2250, 288.15], [5000, 0.73643, 255.68], [11000, 0.36480, 216.77], [20000, 0.088910, 216.65], [32000, 0.013555, 228.49]];
test('ISA density 0 / 5 / 11 / 20 / 32 km vs US76 table (±0.2 %)', () => {
  for (const [h, rho, T] of TABLE) { const a = isa(h); assert.ok(Math.abs(a.rho / rho - 1) < 2e-3, `ρ(${h}) = ${a.rho} vs ${rho}`); assert.ok(Math.abs(a.T - T) < 0.3, `T(${h}) = ${a.T}`); }
});
test('speed of sound at sea level 340.29 m/s, at 11 km 295.07 m/s', () => { assert.ok(Math.abs(isa(0).a - 340.294) < 0.05); assert.ok(Math.abs(isa(11000).a - 295.07) < 0.2); });
test('upper atmosphere follows the US76 table and reaches ~0 in space', () => {
  assert.ok(Math.abs(isa(100000).rho / 5.604e-7 - 1) < 1e-3); assert.ok(Math.abs(isa(400000).rho / 2.803e-12 - 1) < 1e-3); assert.equal(isa(3e6).rho, 0);
  let last = Infinity; for (let h = 0; h < 1e6; h += 5000) { const r = isa(h).rho; assert.ok(r <= last, `monotonic at ${h}`); last = r; }
});
