// בדיקת דיוק מודול השמש מול ייחוס בלתי תלוי: NREL SPA (Reda & Andreas 2008, ±0.0003°) דרך pvlib.
// הייחוס נוצר ע"י twin/physics/tools/make_spa_reference.py (ראו שם). הרצה: node --test twin/physics/test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as S from '../src/sun.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const REF = JSON.parse(fs.readFileSync(here('./spa_reference.json'), 'utf8'));
const D2R = Math.PI / 180;

test('מיקום השמש מול NREL SPA: 4 ערים, 2000–2035, שגיאה זוויתית מרבית < 0.02° (NOAA ~0.01°)', () => {
  const errs = [];
  for (const p of REF.positions) {
    const s = S.sunPosition(p.ms, p.lat, p.lon, { parallax: true, refraction: false });
    const de = s.elevationGeometric - p.elevation;
    let da = Math.abs(s.azimuth - p.azimuth); da = Math.min(da, 360 - da);
    errs.push(Math.hypot(de, da * Math.cos(p.elevation * D2R)));   // מרחק זוויתי על הכיפה
  }
  errs.sort((a, b) => a - b);
  const max = errs.at(-1), p50 = errs[errs.length >> 1];
  console.log(`# n=${errs.length} חציון=${(p50 * 3600).toFixed(1)}" מרבי=${(max * 3600).toFixed(1)}"`);
  assert.ok(REF.positions.length > 700);
  assert.ok(max < 0.02, `max ${max}°`);
  assert.ok(p50 < 0.006, `p50 ${p50}°`);
});

test('השלכה לצל: שגיאת השמש המרבית → < 0.5 מ\' באורך צל של בניין 30 מ\' בגובה שמש 10°', () => {
  // dL = h·dθ / sin²(e)  (נגזרת של L = h / tan e)
  const dL = 30 * (0.02 * D2R) / Math.sin(10 * D2R) ** 2;
  assert.ok(dL < 0.5, dL);
});

test('זריחה, שקיעה וצהרי שמש מול SPA: 4 ערים × 24 ימים ב-2026, הפרש < 10 שניות', () => {
  let mx = 0;
  for (const t of REF.sunTimes) {
    const s = S.sunTimes(t.y, t.m, t.d, t.lat, t.lon);
    mx = Math.max(mx, Math.abs(s.sunrise - t.sunrise), Math.abs(s.sunset - t.sunset), Math.abs(s.solarNoon - t.transit));
  }
  console.log(`# הפרש מרבי ${(mx / 1000).toFixed(1)} שנ'`);
  assert.ok(mx < 10000, mx);
});

test('חוזה אחד: עותקי המודולים בעולם המאוחד זהים למקור הקנוני (twin/physics, twin/weather)', () => {
  const pairs = ['sun.js', 'wind.js', 'drone.js', 'shadow.js', 'index.js']
    .map((f) => [`../src/${f}`, `../../integration/world/mods/physics/src/${f}`])
    .concat([['../../weather/weather.js', '../../integration/world/mods/weather/weather.js']]);
  for (const [a, b] of pairs) {
    if (!fs.existsSync(here(b))) continue;
    assert.equal(fs.readFileSync(here(a), 'utf8'), fs.readFileSync(here(b), 'utf8'), `${b} נפרד מהמקור – להעתיק מחדש`);
  }
});
