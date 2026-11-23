'use strict';
const test = require('node:test'), assert = require('node:assert');
const IN = require('../src/interiors.js');

test('planApartment: כל חדר עומד במינימום החוקי, בלי חפיפות', () => {
  for (const n of [3, 4, 5]) {
    const p = IN.planApartment(n);
    for (const r of p.rooms) assert.ok(r.ok, `${n} חד' – ${r.he}: ${r.w.toFixed(2)}×${r.d.toFixed(2)}`);
    // סכום שטחים = שטח המעטפת W×D (פריסה מלאה בלי חורים)
    const sum = p.rooms.reduce((s, r) => s + r.w * r.d, 0); assert.ok(Math.abs(sum - p.W * p.D) < 1e-6);
    assert.ok(Math.abs(sum - p.net) < 1e-6, 'שטח כל חדר נשמר בדיוק');
    for (const a of p.rooms) for (const b of p.rooms) if (a !== b) {
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oz = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
      assert.ok(ox <= 1e-6 || oz <= 1e-6, 'חפיפה ' + a.he + '/' + b.he); }
    assert.ok(p.rooms.filter(r => r.key === 'mamad').every(r => r.area >= 9), 'ממ"ד ≥ 9 מ"ר');
    assert.ok(p.rooms.filter(r => r.key === 'salon').every(r => r.area >= 12));
    assert.equal(p.rooms.filter(r => r.key === 'bed' || r.key === 'master' || r.key === 'mamad').length, n - 1, 'ספירה ישראלית: חדרים = סלון + חדרי שינה');
    assert.ok(p.ceiling >= 2.5);
  }
  // 3 חדרים ≈ 70 מ"ר כמו שיכון 1963 בחולון (±10%); 4 חדרים: ברוטו ≈ 100–115 מ"ר
  assert.ok(Math.abs(IN.planApartment(3).net - 70) / 70 < 0.1);
  const g4 = IN.planApartment(4).gross; assert.ok(g4 >= 100 && g4 <= 115, g4);
  const b4 = IN.BALCONY[4]; assert.ok(b4 >= 10 && b4 <= 14);
});

test('הפרמטרים בשיידר נוצרים מטבלת JS', () => {
  globalThis.self = globalThis;
  globalThis.ESHBuildings = { typology: require('../src/typology.js'), landmarks: require('../src/landmarks.js') };
  require('../src/facades.js');
  const g = globalThis.ESHBuildings.facades.glslParams(), F = globalThis.ESHBuildings.typology.FACADE;
  for (const [code, P] of Object.entries(F)) assert.ok(g.includes(`bay=${P.bay.toFixed(3)}`) && g.includes(`abs(code - ${(+code).toFixed(3)})`), 'code ' + code);
});
