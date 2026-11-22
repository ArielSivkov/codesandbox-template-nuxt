import test from 'node:test';
import assert from 'node:assert/strict';
import { zmanim, elevationDip } from '../src/zmanim.js';
import { measureZmanim } from '../tools/measure_zmanim.mjs';
test('240 day×place×elevation rows vs python zmanim 0.3.1 (KosherJava port): every zman ≤ 10 s (measured ≤ 4 s)', () => {
  const st = measureZmanim(); for (const [k, s] of Object.entries(st)) { assert.ok(s.max <= 10, k + ' ' + s.max); assert.ok(s.max < 4.5, k + ' tight ' + s.max); }
});
// hebcal.com zmanim API (fetched 2026-11-23; values rounded by hebcal to the minute)
const HEBCAL = [
  [2026, 11, 23, 31.7995, 34.647, { sunrise: '06:17', sofZmanShmaMGA72: '08:16', sofZmanShmaGRA: '08:52', sofZmanTfilaGRA: '09:44', chatzos: '11:28', minchaGedola: '11:54', minchaKetana: '14:29', plagHamincha: '15:34', sunset: '16:39', tzeis8_5: '17:17', tzeisRT72: '17:51' }],
  [2027, 6, 21, 31.7781, 35.2354, { alos16_1: '04:06', misheyakir11_5: '04:34', misheyakir10_2: '04:42', sunrise: '05:34', sofZmanShmaMGA16_1: '08:24', sofZmanShmaMGA72: '08:31', sofZmanShmaGRA: '09:07', sofZmanTfilaMGA16_1: '09:49', sofZmanTfilaMGA72: '09:55', sofZmanTfilaGRA: '10:19', chatzos: '12:41', minchaGedola: '13:16', minchaKetana: '16:50', plagHamincha: '18:19', sunset: '19:48', tzeis8_5: '20:30', tzeisRT72: '21:00' }],
];
test('hebcal.com (2 days, 28 zmanim) agree to the minute after rounding', () => {
  for (const [y, m, d, lat, lon, ref] of HEBCAL) { const z = zmanim(y, m, d, lat, lon);
    for (const [k, v] of Object.entries(ref)) { const [hh, mm, ss] = z.local[k].split(':').map(Number); let r = hh * 60 + mm + (ss >= 30 ? 1 : 0); const [a, b] = v.split(':').map(Number); assert.ok(Math.abs(r - (a * 60 + b)) <= 1, `${y}-${m}-${d} ${k} ${z.local[k]} vs ${v}`); assert.equal(r, a * 60 + b, `${k} exact-minute`); } }
});
test('elevation: Jerusalem 740 m → dip 0.87°, sunrise earlier & sunset later by 3–5 min', () => {
  assert.ok(Math.abs(elevationDip(740) - 0.873) < 0.005);
  const a = zmanim(2026, 3, 20, 31.7781, 35.2354), b = zmanim(2026, 3, 20, 31.7781, 35.2354, { elev: 740, useElevation: true });
  const dr = (a.times.sunrise - b.times.sunrise) * 1440, ds = (b.times.sunset - a.times.sunset) * 1440; assert.ok(dr > 3 && dr < 5 && ds > 3 && ds < 5, dr + ' ' + ds);
});
test('visible-horizon option: a ridge 1° high delays sunrise and advances sunset', () => {
  const a = zmanim(2026, 6, 21, 31.78, 35.23), b = zmanim(2026, 6, 21, 31.78, 35.23, { horizonDeg: 1 }); assert.ok(b.times.sunrise > a.times.sunrise + 3 / 1440 && b.times.sunset < a.times.sunset - 3 / 1440);
});
test('historical: Jerusalem 15 June 763 BCE (Julian) — zmanim exist, ordered, local mean time', () => {
  const z = zmanim(-762, 6, 15, 31.7781, 35.2354); assert.equal(z.tz, 'lmt');
  const order = ['alos16_1', 'misheyakir11_5', 'sunrise', 'sofZmanShmaGRA', 'chatzos', 'minchaGedola', 'plagHamincha', 'sunset', 'tzeis8_5'];
  for (let i = 1; i < order.length; i++) assert.ok(z.times[order[i]] > z.times[order[i - 1]], order[i]);
  assert.ok(Math.abs(z.shaahZmanitGRA - 70.5) < 1.5, z.shaahZmanitGRA);   // summer solstice day ≈ 14.1 h
});
