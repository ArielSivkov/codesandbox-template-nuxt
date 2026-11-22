import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/time.js';
test('Meeus ch.7 examples: J2000, 1957 Oct 4.81, 333 Jan 27.5 (Julian), −4712 Jan 1.5', () => {
  assert.equal(T.jdFromCalendar(2000, 1, 1.5), 2451545.0);
  assert.ok(Math.abs(T.jdFromCalendar(1957, 10, 4.81) - 2436116.31) < 1e-9);
  assert.equal(T.jdFromCalendar(333, 1, 27.5), 1842713.0);
  assert.equal(T.jdFromCalendar(-4712, 1, 1.5), 0);
  assert.equal(T.jdFromCalendar(-1000, 7, 12.5), 1356001.0);   // Meeus table 7.a
});
test('Gregorian reform: 1582-10-04 (Julian) is followed by 1582-10-15 (Gregorian)', () => {
  assert.equal(T.jdFromCalendar(1582, 10, 15) - T.jdFromCalendar(1582, 10, 4), 1);
  const c = T.calendarFromJd(2299160.5); assert.deepEqual([c.y, c.m, c.d, c.cal], [1582, 10, 15, 'gregorian']);
  const j = T.calendarFromJd(2299159.5); assert.deepEqual([j.y, j.m, j.d, j.cal], [1582, 10, 4, 'julian']);
});
test('calendar round trip, −2000 … 3000', () => {
  for (let jd = 990557.5; jd < 2816787; jd += 3337.37) { const c = T.calendarFromJd(jd); const back = T.jdFromCalendar(c.y, c.m, c.d + (c.h + c.mi / 60 + c.s / 3600) / 24); assert.ok(Math.abs(back - jd) < 2e-5, jd); }
});
test('ΔT vs NASA (Espenak–Meeus) table values', () => {
  for (const [y, v, tol] of [[-1000, 25400, 60], [-500, 17190, 30], [0, 10580, 10], [500, 5710, 10], [1000, 1570, 10], [1600, 120, 2], [1800, 13.7, 0.5], [1900, -2.7, 0.3], [1950, 29.1, 0.3], [2000, 63.8, 0.2], [2020, 69.36, 0.1]]) assert.ok(Math.abs(T.deltaT(y) - v) < tol, y + ': ' + T.deltaT(y));
});
test('ΔT is continuous at every polynomial boundary (< 1 s jump)', () => {
  for (const y of [-500, 500, 1600, 1700, 1800, 1860, 1900, 1920, 1941, 1961, 1986, 2005, 2026, 2150]) assert.ok(Math.abs(T.deltaT(y - 1e-6) - T.deltaT(y + 1e-6)) < 1.0, y);
});
test('ΔT uncertainty statement: ≈ ±7 min at 500 BCE, ±11 min at 1000 BCE, ±0.1 s today', () => {
  assert.ok(Math.abs(T.deltaTSigma(-499) / 60 - 7.2) < 0.5); assert.ok(Math.abs(T.deltaTSigma(-999) / 60 - 10.6) < 0.5); assert.ok(T.deltaTSigma(2026) <= 0.11);
});
