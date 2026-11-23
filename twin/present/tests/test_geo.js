/* בדיקות למתמטיקה של מודול המצגת. הרצה: node tests/test_geo.js */
'use strict';
const G = require('../js/geo.js');
const ref = require('./solar_reference_pvlib_spa.json');
let pass = 0, fail = 0;
function ok(cond, name, info) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info ? '  → ' + info : '')); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const angDiff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return Math.abs(d); };

console.log('מסה (massing)');
{
  const rect = [[0, 0], [20, 0], [20, 30], [0, 30]];
  ok(near(G.area(rect), 600, 1e-9), 'שטח מלבן 20×30 = 600');
  const ins = G.insetPolygon(rect, 2);
  ok(near(G.area(ins), 16 * 26, 1e-9), 'הזחה 2 מ\' → 16×26 = 416', G.area(ins));
  const cwRect = rect.slice().reverse();
  ok(near(G.area(G.insetPolygon(cwRect, 2)), 416, 1e-9), 'הזחה עובדת גם לפוליגון בכיוון השעון');
  ok(G.insetPolygon(rect, 10.5) === null, 'נסיגה גדולה מחצי הרוחב → null (לא ממציאים קומה)');
  const m = G.buildMassing({ footprint: rect, floors: 12, floorHeight: 3.1, groundFloorHeight: 4.5, setbacks: [{ fromFloor: 10, inset: 2 }] });
  ok(near(m.grossArea, 9 * 600 + 3 * 416, 1e-6), 'שטח ברוטו = 9×600 + 3×416 = 6648', m.grossArea);
  ok(near(m.height, 4.5 + 11 * 3.1, 1e-9), 'גובה = 4.5 + 11×3.1 = 38.6', m.height);
  ok(m.tiers.length === 2 && near(m.tiers[0].z1, 4.5 + 8 * 3.1, 1e-9), 'שתי מדרגות, המעבר בתקרת קומה 9');
  const m2 = G.buildMassing({ footprint: rect, floors: 10, floorHeight: 3, setbacks: [{ fromFloor: 5, inset: 2 }, { fromFloor: 8, inset: 4 }] });
  ok(near(m2.grossArea, 4 * 600 + 3 * 416 + 3 * (12 * 22), 1e-6), 'שתי נסיגות מצטברות (4/2 מ\')', m2.grossArea);
  const L = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  ok(near(G.area(L), 500, 1e-9), 'שטח צורת L = 500');
  ok(near(G.area(G.insetPolygon(L, 1)), 28 * 8 + 8 * 20, 1e-6), 'הזחת L ב-1 מ\' = 384', G.area(G.insetPolygon(L, 1)));
}

console.log('צל – מקרה תיבה אנליטי');
{
  // תיבה w×d×h, שמש בגובה el ובאזימוט az. אורך צל L = h/tan(el). שטח צל על הקרקע (כולל הבסיס) =
  // w·d + L·(רוחב ההיטל של הבסיס בניצב לכיוון הצל) = w·d + L·(w·|cos(az)| + d·|sin(az)|) לתיבה מיושרת לצירים (w לאורך מזרח).
  const w = 20, d = 30, h = 40;
  const box = [[0, 0], [w, 0], [w, d], [0, d]];
  for (const [az, el] of [[180, 35], [150, 30], [210, 25], [135, 45], [240, 12], [90, 20]]) {
    const s = G.prismShadow(box, 0, h, 0, az, el), A = G.area(s.polys[0]);
    const Ls = h / Math.tan(el * Math.PI / 180), a = az * Math.PI / 180;
    const expect = w * d + Ls * (w * Math.abs(Math.cos(a)) + d * Math.abs(Math.sin(a)));
    ok(near(A, expect, 1e-6 * expect), `az ${az}° el ${el}° שטח צל ${A.toFixed(2)} = ${expect.toFixed(2)}`);
  }
  // הקצה הרחוק: בשמש דרומית (az 180) הצל נמשך צפונה בדיוק h/tan(el)
  const s = G.prismShadow(box, 0, h, 0, 180, 35), maxY = Math.max(...s.polys[0].map(p => p[1]));
  ok(near(maxY - d, h / Math.tan(35 * Math.PI / 180), 1e-6), 'אורך הצל צפונה = h/tan(el) = ' + (h / Math.tan(35 * Math.PI / 180)).toFixed(3));
  ok(G.prismShadow(box, 0, h, 0, 180, -3) === null, 'שמש מתחת לאופק → אין צל');
  // עקביות: קרן מנקודה בקרקע בתוך פוליגון הצל פוגעת בתיבה, ומחוצה לו – לא
  let agree = 0, tot = 0;
  for (const [az, el] of [[180, 35], [150, 30], [215, 22]]) {
    const sp = G.prismShadow(box, 0, h, 0, az, el).polys[0], sv = G.sunVector(az, el);
    for (let x = -80; x <= 100; x += 3.7) for (let y = -40; y <= 140; y += 3.3) {
      if (G.pointInPolygon(x, y, box)) continue;
      const inS = G.pointInPolygon(x, y, sp), hit = G.rayPrism([x, y, 0.0], sv, box, 0, h) >= 0;
      tot++; if (inS === hit) agree++;
    }
  }
  ok(agree / tot > 0.997, `קרן↔פוליגון צל מסכימים ב-${agree}/${tot} נקודות (הפער רק על קו הגבול)`);
  // חלון בקומה: נקודה צפונית לתיבה בגובה 10 מ' – מוצלת אם tan(el) < (h-10)/מרחק
  const sv = G.sunVector(180, 35);
  ok(G.rayPrism([10, d + 20, 10], sv, box, 0, h) >= 0, 'חלון 20 מ\' צפונה בגובה 10 – בצל (30/20 > tan35)');
  ok(G.rayPrism([10, d + 50, 10], sv, box, 0, h) < 0, 'חלון 50 מ\' צפונה בגובה 10 – בשמש (30/50 < tan35)');
  ok(G.rayPrism([10, d + 20, 45], sv, box, 0, h) < 0, 'נקודה מעל הגג – בשמש');
  const conc = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  const sc = G.prismShadow(conc, 0, 20, 0, 160, 30); ok(!sc.convex && sc.polys.length === 7, 'פוליגון קעור → איחוד בסיס + 6 רביעיות');
}

console.log('מיקום שמש NOAA מול NREL SPA (pvlib)');
{
  let maxEl = 0, maxAz = 0;
  for (const p of ref.points) {
    const r = G.solarPosition(Date.parse(p.utc), ref.lat, ref.lon);
    if (p.elevation_true > 0) { maxEl = Math.max(maxEl, Math.abs(r.elevation - p.elevation_true)); maxAz = Math.max(maxAz, angDiff(r.azimuth, p.azimuth)); }
  }
  ok(maxEl < 0.02, `סטייה מרבית בגובה ${maxEl.toFixed(4)}° (<0.02°) ב-${ref.points.length} נקודות`);
  ok(maxAz < 0.05, `סטייה מרבית באזימוט ${maxAz.toFixed(4)}° (<0.05°)`);
  // צהרי היום ב-21.12: גובה ≈ 90 − רוחב − 23.44
  let best = -90; for (let m = 0; m < 240; m++) { const r = G.solarPosition(Date.UTC(2026, 11, 21, 8, 0) + m * 60000, 31.79, 34.65); best = Math.max(best, r.elevation); }
  ok(near(best, 90 - 31.79 - 23.435, 0.05), 'גובה שמש מרבי ב-21.12 ≈ 34.78°: ' + best.toFixed(3));
}

console.log('שעון ישראל, ITM');
{
  ok(G.israelOffset(2026, 11, 21, 12) === 2, '21.12.2026 = UTC+2');
  ok(G.israelOffset(2026, 5, 21, 12) === 3, '21.6.2026 = UTC+3');
  ok(G.israelOffset(2026, 2, 27, 3) === 3 && G.israelOffset(2026, 2, 26, 12) === 2, 'מעבר לשעון קיץ ב-27.3.2026 (שישי)');
  ok(G.israelOffset(2026, 9, 25, 3) === 2 && G.israelOffset(2026, 9, 24, 12) === 3, 'חזרה לשעון חורף ב-25.10.2026');
  ok(G.israelToUTC('2026-12-21', 12) === Date.UTC(2026, 11, 21, 10), '12:00 שעון ישראל = 10:00 UTC בחורף');
  const [lat, lon] = G.itmToWgs84(165472, 631060);
  ok(near(lat, 31.78, 0.03) && near(lon, 34.64, 0.03), `ITM 165472/631060 → ${lat.toFixed(4)}, ${lon.toFixed(4)} (אשדוד)`);
  const [la0, lo0] = G.itmToWgs84(219529.584, 626907.390);
  ok(near(la0, 31.73439, 1e-4) && near(lo0, 35.20452, 1e-4), 'נקודת המוצא של רשת ישראל החדשה חוזרת למקור ההטלה');
}

console.log('תרחיש ⇄ כתובת');
{
  const s = { site: 'w552921285', footprint: [[0, 0], [31.2, -4.5], [26.1, 12.3]], floors: 14, floorHeight: 3.1, groundFloorHeight: 4.5,
    setbacks: [{ fromFloor: 11, inset: 2 }, { fromFloor: 13, inset: 4 }], rotation: 15, model: 'models/tower.gltf', modelFloors: 14, modelGrossArea: 7200,
    date: '2026-12-21', hour: 9.5, view: 'swipe', swipe: 0.4, shot: 3, window: { building: 'w552921274', floor: 3 }, play: true };
  const h = G.encodeScenario(s), back = G.decodeScenario('#' + h);
  ok(JSON.stringify(back) === JSON.stringify(s), 'הלוך-חזור זהה', h);
  ok(G.encodeScenario(back) === h, 'קידוד חוזר יציב');
  const bad = G.decodeScenario('#fl=999&fh=abc&model=javascript:alert(1)&v=evil&site=<x>&shot=-4&evil=1');
  ok(bad.floors === 80 && bad.floorHeight === undefined && !bad.model && !bad.view && !bad.site && bad.shot === 0, 'קלט זדוני/חורג נחתך או נזרק');
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
