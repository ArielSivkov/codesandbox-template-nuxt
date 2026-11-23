// node --test /home/claude/swarm/buildings/tests
'use strict';
const test = require('node:test'), assert = require('node:assert');
const TY = require('../src/typology.js'), LM = require('../src/landmarks.js');
const { T } = TY;

test('facadeLayout: מפרצים וחלונות לפי אורך קיר וקומות', () => {
  const noFlags = { pil: 0, shop: 0 };
  // שיכון: מפרץ 3.0 מ' → קיר 30 מ' = 10 מפרצים × 4 קומות = 40 חלונות
  let L = TY.facadeLayout(30, 4, T.WALKUP, noFlags); assert.equal(L.bays, 10); assert.equal(L.windows, 40); assert.ok(Math.abs(L.bayW - 3) < 1e-9);
  // קומת עמודים: קומת הקרקע בלי חלונות → 30
  L = TY.facadeLayout(30, 4, T.WALKUP, { pil: 1, shop: 0 }); assert.equal(L.windows, 30); assert.equal(L.winFloors, 3);
  // עיגול: 31.6/3.0 = 10.53 → 11 מפרצים ברוחב 2.87
  L = TY.facadeLayout(31.6, 1, T.WALKUP, noFlags); assert.equal(L.bays, 11); assert.ok(L.bayW > 2.8 && L.bayW < 2.9);
  // קיר קצר מ-2 מ' – אין חלונות; קיר 2.5 מ' – חלון אחד לפחות
  assert.equal(TY.facadeLayout(1.9, 8, T.BLOCK, noFlags).windows, 0);
  assert.equal(TY.facadeLayout(2.5, 8, T.BLOCK, noFlags).bays, 1);
  // מגדל 40 קומות, חזית 24 מ', מפרץ 3.6 → 7 מפרצים (24/3.6=6.67), עמודים/לובי → 39 קומות × 7
  L = TY.facadeLayout(24, 40, T.TOWER, { pil: 1, shop: 0 }); assert.equal(L.bays, 7); assert.equal(L.windows, 273);
  // מבנה עזר: אין חלונות בכלל
  assert.equal(TY.facadeLayout(20, 1, T.ANNEX, noFlags).windows, 0);
  // מונוטוניות: יותר קומות → יותר חלונות; קיר ארוך יותר → לא פחות מפרצים
  for (let f = 1; f < 30; f++) assert.ok(TY.facadeLayout(18, f + 1, T.BLOCK, noFlags).windows > TY.facadeLayout(18, f, T.BLOCK, noFlags).windows);
  for (let l = 2; l < 80; l += 0.5) assert.ok(TY.facadeLayout(l + 0.5, 4, T.WALKUP, noFlags).bays >= TY.facadeLayout(l, 4, T.WALKUP, noFlags).bays);
  // רוחב מפרץ תמיד בטווח [bay·2/3, bay·2] לקירות ≥ 2 מ'
  for (let l = 2; l < 120; l += 0.37) { const r = TY.facadeLayout(l, 3, T.WALKUP, noFlags); assert.ok(r.bayW >= 2.0 - 1e-9 && r.bayW <= 6.0, l + ' → ' + r.bayW); }
});

test('classify: מיפוי טיפולוגיה מנתוני האריח', () => {
  const c = b => TY.classify(Object.assign({ floorsSrc: 'R' }, b)).code;
  assert.equal(c({ typ: 'house', area: 180, floors: 2 }), T.VILLA);
  assert.equal(c({ typ: '', area: 160, floors: 2 }), T.VILLA);
  assert.equal(c({ typ: 'apartments', area: 600, floors: 4, len: 30, wid: 20 }), T.WALKUP);
  assert.equal(c({ typ: '', area: 900, floors: 4, len: 75, wid: 12 }), T.RAKEVET);       // בניין רכבת: ארוך וצר
  assert.equal(c({ typ: '', area: 900, floors: 4, len: 35, wid: 12 }), T.WALKUP);        // צר אבל קצר מ-40 מ'
  assert.equal(c({ typ: '', area: 700, floors: 8, len: 30, wid: 22 }), T.BLOCK);
  assert.equal(c({ typ: 'apartments', area: 800, floors: 20, h: 61 }), T.TOWER);
  assert.equal(c({ typ: '', area: 800, floors: 4, h: 13, name: 'Sea View Tower' }), T.WALKUP);  // שם "טאוור" לבד לא הופך 4 קומות למגדל
  assert.equal(c({ typ: 'retail', area: 2000, floors: 2 }), T.COMMERCIAL);
  assert.equal(c({ typ: '', area: 8000, floors: 3, name: 'קניון סימול' }), T.COMMERCIAL);
  assert.equal(c({ typ: '', area: 500, floors: 4, name: 'בית כנסת משכן מאיר' }), T.PUBLIC);
  assert.equal(c({ typ: 'school', area: 3000, floors: 3 }), T.PUBLIC);
  assert.equal(c({ typ: 'warehouse', area: 5000, floors: 1 }), T.INDUSTRIAL);
  assert.equal(c({ typ: '', area: 25, floors: 1 }), T.ANNEX);
  assert.equal(c({ typ: 'office', area: 1500, floors: 15, h: 52 }), T.TOWER);
  // בסיס הקביעה מדווח: data מתג/שם, shape מצורה, rule מקומות משוערות
  assert.equal(TY.classify({ typ: 'house', area: 100, floors: 1 }).basis, 'data');
  assert.equal(TY.classify({ area: 900, floors: 4, len: 75, wid: 12 }).basis, 'shape');
  assert.equal(TY.classify({ area: 700, floors: 8, floorsSrc: 'R' }).basis, 'rule');
  assert.equal(TY.classify({ area: 700, floors: 8, floorsSrc: 'L' }).basis, 'data');
});

test('footprintDims: מלבן מכוון לבניין מסובב', () => {
  const a = 30 * Math.PI / 180, R = (x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const p = [R(0, 0), R(60, 0), R(60, 12), R(0, 12)], segs = p.map((q, i) => [...q, ...p[(i + 1) % 4]]);
  const d = TY.footprintDims(segs); assert.ok(Math.abs(d.len - 60) < 1e-6); assert.ok(Math.abs(d.wid - 12) < 1e-6); assert.ok(Math.abs(d.perim - 144) < 1e-6);
});

test('LOD: סף והיסטרזיס', () => {
  const { NEAR, FAR, HYST } = TY.LOD;
  assert.equal(TY.lodFor(100), 2); assert.equal(TY.lodFor(NEAR + 1), 1); assert.equal(TY.lodFor(FAR + 1), 0);
  assert.equal(TY.lodFor(NEAR * 1.1, 2), 2, 'בתוך ההיסטרזיס נשאר קרוב');
  assert.equal(TY.lodFor(NEAR * HYST + 1, 2), 1, 'מעבר להיסטרזיס יורד');
  assert.equal(TY.lodFor(FAR * 1.1, 1), 1); assert.equal(TY.lodFor(FAR * HYST + 1, 1), 0);
  assert.equal(TY.lodFor(NEAR * 1.1, 1), 1, 'בעלייה אין היסטרזיס'); assert.equal(TY.lodFor(NEAR - 1, 1), 2);
  // הליכה הלוך-חזור סביב הגבול לא מהבהבת
  let lod = 2, flips = 0; for (let i = 0; i < 200; i++) { const d = NEAR * (1 + 0.08 * Math.sin(i / 3)); const n = TY.lodFor(d, lod); if (n !== lod) flips++; lod = n; }
  assert.equal(flips, 0);
  assert.equal(TY.clutterOn(TY.LOD.CLUTTER * 1.1, true), true); assert.equal(TY.clutterOn(TY.LOD.CLUTTER * 1.1, false), false);
});

test('אריזה לשיידר: pack/unpack הפיך ובטווח Int16', () => {
  for (let code = 0; code < 11; code++) for (const floors of [0, 1, 4, 8, 46, 63, 80]) for (const pil of [0, 1]) for (const shop of [0, 1]) for (let mat = 0; mat < 4; mat++) {
    const p = TY.pack(code, floors, { pil, shop, mat }); assert.ok(p >= 0 && p <= 32767); const u = TY.unpack(p);
    assert.deepEqual(u, { code, floors: Math.min(63, floors), pil, shop, mat }); }
});

test('דודי שמש לפי חוק 1980/2012 ומיכלים', () => {
  const k4 = TY.roofKit(T.WALKUP, 4, 440, 13, 1);              // 4 יח' לקומה × 4 קומות
  assert.equal(k4.solar, 16); assert.ok(k4.tank >= 1); assert.ok(k4.stair >= 1);
  const tw = TY.roofKit(T.TOWER, 40, 660, 142, 1);              // מעל 27 מ': רק 7 קומות עליונות
  assert.equal(tw.solar, Math.min(Math.floor(660 * 0.8 / 6), 6 * 7));
  assert.ok(TY.roofKit(T.WALKUP, 30, 60, 90, 1).solar <= Math.floor(60 * 0.8 / 6), 'קיבולת הגג מגבילה');
  assert.equal(TY.roofKit(T.INDUSTRIAL, 1, 5000, 8, 1).solar, 0); assert.equal(TY.roofKit(T.ANNEX, 1, 30, 3, 1).solar, 0);
});

test('אורות לילה: עקומה רציפה ובטווח', () => {
  for (let h = 0; h < 24; h += 0.25) { const v = TY.litFraction(h); assert.ok(v >= 0 && v <= 1); assert.ok(Math.abs(TY.litFraction(h + 0.01) - v) < 0.02); }
  assert.ok(TY.litFraction(21) > TY.litFraction(3)); assert.equal(TY.nightFactor(30), 0); assert.equal(TY.nightFactor(-10), 1);
});

test('דגלי חזית יציבים ונתוני חנויות גוברים', () => {
  const s = TY.seedOf('w358974561'); assert.equal(s, TY.seedOf('w358974561')); assert.ok(s >= 0 && s < 32768);
  assert.equal(TY.facadeFlags(T.WALKUP, s, true).shop, 1); assert.equal(TY.facadeFlags(T.COMMERCIAL, s, false).shop, 0);
  assert.equal(TY.facadeFlags(T.TOWER, s).pil, 1);
  // שיעור קומות העמודים בשיכונים ≈ ההסתברות שבטבלה (פיזור הגיבוב)
  let n = 0; for (let i = 0; i < 4000; i++) n += TY.facadeFlags(T.WALKUP, TY.seedOf('w' + i)).pil; assert.ok(Math.abs(n / 4000 - TY.FACADE[T.WALKUP].pil) < 0.03, n / 4000);
});

test('ציוני דרך: גבהים מצוטטים בלבד, מיקום בתוך הדגימה', () => {
  const k1 = LM.landmarkOf('w358974561'); assert.equal(k1.h, 142); assert.equal(k1.floors, 40);
  assert.deepEqual(LM.targetHeight(LM.landmarkOf('w189733330')), { h: 160, basis: 'data' });
  assert.equal(LM.targetHeight(LM.landmarkOf('w348041566')), null, 'עירייה – בלי גובה מצוטט');
  assert.equal(LM.targetHeight(LM.landmarkOf('w321354658')).basis, 'proc');
  for (const s of LM.STANDALONE) { assert.ok(s.src.length); assert.ok(s.itm[0] > 161860 && s.itm[0] < 170669 && s.itm[1] > 629338 && s.itm[1] < 639473, s.key); }
});
