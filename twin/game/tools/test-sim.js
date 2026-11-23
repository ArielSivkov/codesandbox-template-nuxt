// בדיקות יחידה לסימולציה (בלי דפדפן): node tools/test-sim.js
const SIM = require('../js/sim.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const LAT = 31.8014, LON = 34.6435;
// 1) שמש: גובה בצהרי השמש = 90 − φ + δ
for (const [d, name] of [['2026-06-21', 'היפוך קיץ'], ['2026-03-20', 'שוויון'], ['2026-12-21', 'היפוך חורף']]) {
  let best = { elevation: -99 }, bt = null;
  for (let m = 8 * 60; m < 12 * 60; m++) { const t = new Date(d + 'T00:00:00Z'); t.setUTCMinutes(m); const sp = SIM.sunPosition(t, LAT, LON); if (sp.elevation > best.elevation) { best = sp; bt = t; } }
  const expect = 90 - LAT + best.declination;
  ok(Math.abs(best.elevation - expect) < 0.1, `${name}: גובה מרבי ${best.elevation.toFixed(2)}° (צפוי ${expect.toFixed(2)}°, δ=${best.declination.toFixed(2)}°) ב-${bt.toISOString().slice(11, 16)} UTC, אזימוט ${best.azimuth.toFixed(1)}°`);
  ok(Math.abs(best.azimuth - 180) < 2, `${name}: בצהרי השמש אזימוט ≈ 180°`);
}
const sp = SIM.sunPosition(new Date('2026-06-21T00:00:00Z'), LAT, LON); const de = SIM.sunPosition(new Date('2026-06-21T10:00:00Z'), LAT, LON).declination;
ok(Math.abs(de - 23.44) < 0.05, `נטיית השמש ביום היפוך הקיץ ${de.toFixed(3)}°`);
ok(sp.elevation < 0, 'חצות: השמש מתחת לאופק');
ok(Math.abs(SIM.itmConvergence(LAT, LON) + 0.29) < 0.02, `התכנסות רשת ITM באשדוד ${SIM.itmConvergence(LAT, LON).toFixed(3)}°`);
// 2) רחפן בשדה פתוח (בלי בניינים)
const flat = { H: () => 0, near: () => [], edge: () => ({ d: 1e9 }), collide: (x, z) => ({ x, z, hit: false }), floor: () => 0 };
SIM.weather.windSpeed = 0; SIM.weather.gust = 1;
let q = SIM.newDrone(0, 0, 0, 0);
for (let i = 0; i < 600; i++) SIM.stepDrone(q, { x: 0, y: 0, up: i < 240, down: false }, 1 / 60, i / 60, flat);
ok(Math.abs(q.thrust / (SIM.DRONE.mass * 9.81) - 1) < 0.02 && Math.abs(q.vy) < 0.05, `ריחוף: דחף ${(q.thrust / (SIM.DRONE.mass * 9.81)).toFixed(3)}g, גובה ${q.y.toFixed(1)} מ'`);
// מהירות מרבית ב-ATTI (זווית 30°, גרר ריבועי): v = sqrt(2·m·g·tanθ / (ρ·CdA))
q.gps = false; for (let i = 0; i < 1800; i++) SIM.stepDrone(q, { x: 0, y: 1 }, 1 / 60, 10 + i / 60, flat);
const P = SIM.DRONE, Th = P.mass * 9.81 / Math.cos(P.maxTilt), kr = P.cRotor * Th / (P.mass * 9.81), A2 = 0.5 * P.rho * P.cdaH, F = P.mass * 9.81 * Math.tan(P.maxTilt);
const vth = (-kr + Math.sqrt(kr * kr + 4 * A2 * F)) / (2 * A2), vh = Math.hypot(q.vx, q.vz);   // ½ρCdA·v² + k·v = m·g·tanθ
ok(Math.abs(vh - vth) / vth < 0.05, `מהירות סופית ATTI ${vh.toFixed(2)} מ'/ש' (תאורטי ${vth.toFixed(2)})`);
// סחיפה ב-ATTI עם רוח 8 מ'/ש' ממערב, מקל במרכז → הרחפן נע מזרחה במהירות ≈ הרוח המקומית
SIM.weather.windSpeed = 8; SIM.weather.windFrom = 270; q = SIM.newDrone(0, 40, 0, 0); q.landed = false; q.gps = false;
for (let i = 0; i < 3600; i++) SIM.stepDrone(q, { x: 0, y: 0 }, 1 / 60, 50 + i / 60, flat);
const w = SIM.windAt(q.x, q.y, q.z, 110, flat);
ok(q.vx > 0 && Math.abs(q.vx - w.x) < 1.0, `ATTI ברוח: סחיפה מזרחה ${q.vx.toFixed(2)} מ'/ש' (רוח מקומית ${w.x.toFixed(2)} ±משבים)`);
// GPS ברוח: מחזיק מיקום (סחיפה קטנה)
q = SIM.newDrone(0, 40, 0, 0); q.landed = false; q.gps = true; for (let i = 0; i < 1800; i++) SIM.stepDrone(q, { x: 0, y: 0 }, 1 / 60, 50 + i / 60, flat);
ok(Math.hypot(q.vx, q.vz) < 1.0, `GPS ברוח: מהירות קרקע ${Math.hypot(q.vx, q.vz).toFixed(2)} מ'/ש', הטיה ${(q.pitch * 57.3).toFixed(1)}°/${(q.roll * 57.3).toFixed(1)}°`);
// 3) דיוק גאומטרי של הדחף ומגבלת הטיה כוללת (אלכסון לא נותן מהירות √2)
let worstN = 0; for (let p = -0.8; p <= 0.8; p += 0.1) for (let r = -0.8; r <= 0.8; r += 0.1) { const u = SIM.tiltUp(p, r); worstN = Math.max(worstN, Math.abs(Math.hypot(u.f, u.r, u.y) - 1)); }
ok(worstN < 1e-12, `וקטור הדחף הוא וקטור יחידה (סטייה מרבית ${worstN.toExponential(1)})`);
SIM.weather.windSpeed = 0; SIM.weather.gust = 1;
const fly = (gps, sx, sy) => { const d = SIM.newDrone(0, 50, 0, 0.3); d.landed = false; d.gps = gps; let mt = 0;
  for (let i = 0; i < 2400; i++) { SIM.stepDrone(d, { x: sx, y: sy }, 1 / 60, i / 60, flat); mt = Math.max(mt, Math.acos(Math.cos(d.pitch) * Math.cos(d.roll))); }
  return { v: Math.hypot(d.vx, d.vz), tilt: mt / D2R_, alt: d.y }; };
const D2R_ = Math.PI / 180, aS = fly(false, 0, 1), aD = fly(false, 1, 1), gD = fly(true, 1, 1);
ok(Math.abs(aD.v - aS.v) / aS.v < 0.01 && aD.tilt <= P.maxTilt / D2R_ + 0.05, `ATTI באלכסון: ${aD.v.toFixed(2)} מ'/ש' = ישר ${aS.v.toFixed(2)}, הטיה כוללת ${aD.tilt.toFixed(1)}° ≤ ${(P.maxTilt / D2R_).toFixed(0)}° (היה 24.0 מ'/ש' ו-47.9°)`);
ok(gD.v <= P.vMaxGPS + 0.1 && gD.tilt <= P.maxTilt / D2R_ + 0.05 && Math.abs(gD.alt - 50) < 0.2, `GPS באלכסון: ${gD.v.toFixed(2)} ≤ ${P.vMaxGPS} מ'/ש', הטיה ${gD.tilt.toFixed(1)}°, גובה נשמר ${gD.alt.toFixed(1)} מ' (היה 19.3 מ'/ש')`);
// חוזה: העותקים בעולם המאוחד ובתצוגה המקדימה זהים למקור
const fs = require('fs'), path = require('path'), src = fs.readFileSync(path.join(__dirname, '../js/sim.js'), 'utf8');
for (const c of ['../../integration/world/js/sim.js', '../../preview/world/js/sim.js']) { const f = path.join(__dirname, c); if (fs.existsSync(f)) ok(fs.readFileSync(f, 'utf8') === src, `העותק ${c.replace('../../', '')} זהה ל-game/js/sim.js`); }
for (const c of ['../../integration/world/js/itm.js', '../../preview/world/js/itm.js']) { const f = path.join(__dirname, c); if (fs.existsSync(f)) ok(fs.readFileSync(f, 'utf8') === fs.readFileSync(path.join(__dirname, '../js/itm.js'), 'utf8'), `העותק ${c.replace('../../', '')} זהה ל-game/js/itm.js`); }
// 4) שעות שמש בחזית: בלי שכנים, מול נוסחת אורך היום, ומול קיר אינסופי (חישוב אנליטי נפרד)
{ const none = () => [], base = { lat: LAT, lon: LON, gamma: SIM.itmConvergence(LAT, LON), near: none, x: 0, y: 1.5, z: 0, step: 2 };
  const dl = (decl) => { const f = LAT * Math.PI / 180, d = decl * Math.PI / 180, H0 = Math.acos((Math.sin(-0.833 * Math.PI / 180) - Math.sin(f) * Math.sin(d)) / (Math.cos(f) * Math.cos(d))); return 2 * H0 * 180 / Math.PI / 15; };
  const W12 = SIM.sunHours({ ...base, day: '2026-12-21' }), S12 = SIM.sunHours({ ...base, day: '2026-12-21', nx: 0, nz: 1 }), N12 = SIM.sunHours({ ...base, day: '2026-12-21', nx: 0, nz: -1 });
  const S6 = SIM.sunHours({ ...base, day: '2026-06-21', nx: 0, nz: 1 }), N6 = SIM.sunHours({ ...base, day: '2026-06-21', nx: 0, nz: -1 }), D6 = SIM.sunHours({ ...base, day: '2026-06-21' });
  ok(Math.abs(W12.dayHours - dl(-23.44)) < 0.08 && Math.abs(D6.dayHours - dl(23.44)) < 0.08, `אורך יום באשדוד: 21.12 ${W12.dayHours.toFixed(2)} ש' (נוסחה ${dl(-23.44).toFixed(2)}), 21.6 ${D6.dayHours.toFixed(2)} ש' (נוסחה ${dl(23.44).toFixed(2)})`);
  ok(Math.abs(S12.hours - W12.dayHours) < 0.05 && N12.hours === 0, `21.12 בלי שכנים: חזית דרום ${S12.hours.toFixed(2)} ש' (כל היום), צפון ${N12.hours} ש'`);
  ok(N6.hours > 1 && Math.abs(S6.hours + N6.hours - D6.dayHours) < 0.1, `21.6 בלי שכנים: דרום ${S6.hours.toFixed(2)} + צפון ${N6.hours.toFixed(2)} = יום ${D6.dayHours.toFixed(2)} ש'`);
  // קיר ארוך (4 ק"מ) בגובה 9 מ', 15 מ' מדרום לנקודה. מוסתר אם 1.5 + (D/dz)·tanEl < 9 – נספר כאן בנפרד
  const Dw = 15, Hw = 9, wall = { id: 'wall', p: new Float32Array([-2000, Dw, 2000, Dw, 2000, Dw + 10, -2000, Dw + 10]), n: 4, top: Hw, sigma: 3, minx: -2000, maxx: 2000, minz: Dw, maxz: Dw + 10 };
  const near1 = () => [wall], day = '2026-12-21', got = SIM.sunHours({ ...base, near: near1, day, nx: 0, nz: 1 });
  let lit = 0; const off = SIM.israelOffsetMin(new Date(Date.UTC(2026, 11, 21, 12))), t0 = Date.UTC(2026, 11, 21) - off * 60000;
  for (let m = 1; m < 1440; m += 2) { const sp = SIM.sunPosition(new Date(t0 + m * 60000), LAT, LON); if (sp.elevation <= 0) continue; const v = SIM.sunVector(sp, base.gamma), hl = Math.hypot(v.x, v.z);
    if (v.z / hl <= 0) continue; const t = Dw / (v.z / hl), xw = t * v.x / hl; if (Math.abs(xw) > 2000 || 1.5 + t * v.y / hl >= Hw) lit++; }
  ok(Math.abs(got.hours - lit * 2 / 60) < 0.05 && got.lo <= got.hours && got.hours <= got.hi && got.hi - got.lo > 0.1, `קיר 9±3 מ' במרחק 15 מ' דרומה, 21.12: ${got.hours.toFixed(2)} ש' (אנליטי ${(lit * 2 / 60).toFixed(2)}), טווח ${got.lo.toFixed(2)}–${got.hi.toFixed(2)}`);
  // חזיתות של קופסה: נורמלים החוצה ובכיוון הנכון
  const box = { p: new Float32Array([0, 0, 20, 0, 20, 10, 0, 10]), n: 4 }, fp = SIM.facadePoints(box);
  ok(fp['דרום'] && fp['דרום'].nz > 0.99 && fp['דרום'].z > 10 && fp['צפון'].nz < -0.99 && fp['צפון'].z < 0 && fp['מזרח'].nx > 0.99 && fp['מערב'].nx < -0.99, 'נקודות חזית: 4 כיוונים, נורמלים החוצה'); }
// 5) זריחה ושקיעה באשדוד מול NREL SPA (pvlib, 23.11.2026): 06:16:34 / 16:38:45
{ const r = SIM.sunRiseSet('2026-11-23', LAT, LON), ref = [6 * 60 + 16 + 34 / 60, 16 * 60 + 38 + 45 / 60];
  ok(Math.abs(r.rise - ref[0]) < 1 && Math.abs(r.set - ref[1]) < 1, `זריחה ${(r.rise / 60 | 0)}:${(r.rise % 60).toFixed(1)} (SPA 6:16.6), שקיעה ${(r.set / 60 | 0)}:${(r.set % 60).toFixed(1)} (SPA 16:38.8) – פחות מדקה`); }
// פרופיל רוח: חזק יותר בגובה
SIM.weather.windSpeed = 8; SIM.weather.gust = 1.5;
const a = SIM.windAt(0, 2, 0, 0, flat).speed, b = SIM.windAt(0, 60, 0, 0, flat).speed; ok(b > a, `רוח ב-60 מ' (${b.toFixed(1)}) > ב-2 מ' (${a.toFixed(1)})`);
// פרופיל רוח ממוצע: זהה למודול הקנוני physics/src/wind.js (חוק לוגריתמי, גובה ערבוב 60 מ' – Wieringa 1986, d=0.7H/z0=0.1H – Grimmond & Oke 1999, חופה – Macdonald 2000)
(async () => {
  const { createWind } = await import('../../physics/src/wind.js');
  let maxRel = 0, under = true, eq60 = 0;
  for (const H of [0, 6, 12, 20, 35, 60, 100]) {
    const C = createWind(H ? { speed10: 7, meanHeight: H, gusts: false } : { speed10: 7, z0: 0.03, d: 0, gusts: false });   // H=0: שטח פתוח (ברירת המחדל הקנונית בלי גבהים היא עיר z0=1)
    for (let z = 0.5; z <= 150; z += 0.5) { const g = SIM.meanWind(7, z, H), c = C.meanSpeed(z); maxRel = Math.max(maxRel, Math.abs(g - c) / Math.max(c, 0.05));
      if (H > 0 && z < Math.max(60, 2 * H) && g > SIM.meanWind(7, z, 0) + 1e-9) under = false; }
    if (H > 0) { const zb = Math.max(60, 2 * H); eq60 = Math.max(eq60, Math.abs(SIM.meanWind(7, zb, H) - SIM.meanWind(7, zb, 0))); }   // גובה ערבוב ≥ 2H
  }
  ok(maxRel < 1e-9, `פרופיל רוח במשחק = המודול הקנוני (סטייה יחסית מרבית ${maxRel.toExponential(1)}, 6 גובהי עיר × 300 גבהים)`);
  ok(under && eq60 < 1e-9, `עיר מאטה את הרוח: מתחת ל-60 מ' רוח עירונית ≤ שטח פתוח, ובגובה הערבוב שוות (הפרש ${eq60.toExponential(1)})`);
  ok(Math.abs(SIM.meanWind(7, 10, 0) - 7) < 1e-9, `שטח פתוח ב-10 מ' = רוח התחנה (${SIM.meanWind(7, 10, 0).toFixed(3)})`);
  // בשכונה של בניינים בגובה 20 מ' (שני בלוקים 20×20 מ' במרחק 30 מ'), בלי משבים: windAt בגגות = meanWind
  const sq = (cx, cz, h) => ({ top: h, base: 0, p: [cx - 10, cz - 10, cx + 10, cz - 10, cx + 10, cz + 10, cx - 10, cz + 10], n: 4, cx, cz, minx: cx - 10, maxx: cx + 10, minz: cz - 10, maxz: cz + 10 });
  const bs = [sq(30, 0, 20), sq(-30, 0, 20)], town = { H: () => 0, near: () => bs, edge: (b, x, z) => ({ d: 20, px: x + 20, pz: z }) };
  SIM.weather.windSpeed = 6; SIM.weather.gust = 1; const o30 = SIM.windAt(0, 30, 0, 0, town), r30 = Math.hypot(o30.x, o30.z);   // אופקי (מעל הגגות יש רכיב אנכי קטן)
  ok(Math.abs(r30 - SIM.meanWind(6, 30, 20)) < 1e-9 && r30 < 6.91 * 0.8, `שכונה 20 מ', רוח 6 מ'/ש': ב-30 מ' ${r30.toFixed(2)} מ'/ש' (היה 6.91 – העיר הגבירה רוח במקום להאט)`);
  // משבים: ממוצע זמן = 1 (לפני התיקון +2.5% ב-G=1.5)
  for (const G of [1.5, 2.5]) { SIM.weather.gust = G; let s = 0, N = 0; const open = { H: () => 0, near: () => [] };
    for (let k = 0; k < 8; k++) for (let t = 0; t < 4000; t += 0.05) { s += SIM.windAt(k * 173.1, 10, k * 91.7, t, open).speed / 6; N++; }
    ok(Math.abs(s / N - 1) < 0.01, `משבים G=${G}: ממוצע רוח / רוח ממוצעת = ${(s / N).toFixed(4)} (יעד 1 ±1%)`); }
  console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); process.exit(fail ? 1 : 0);
})();
