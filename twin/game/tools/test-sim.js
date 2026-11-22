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
// פרופיל רוח: חזק יותר בגובה
const a = SIM.windAt(0, 2, 0, 0, flat).speed, b = SIM.windAt(0, 60, 0, 0, flat).speed; ok(b > a, `רוח ב-60 מ' (${b.toFixed(1)}) > ב-2 מ' (${a.toFixed(1)})`);
console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); process.exit(fail ? 1 : 0);
