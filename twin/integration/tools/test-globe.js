#!/usr/bin/env node
/* test-globe.js — בדיקות המתמטיקה של world/adapters/67-globe.js (קומה 1 של המנוע הגלובלי).
 * 1) lat/lon → נקודה על הכדור → lat/lon: שגיאה במטרים (float64, וגם float32 כמו ב-GPU).
 * 2) שרשרת מלאה: ITM (מסגרת הדגימה) → ITM אמיתי → WGS84 → כדור → WGS84 → ITM → דגימה: שגיאה במטרים.
 * 3) ENU אורתונורמלי, וכיוון "צפון" על הכדור אכן מגדיל רוחב.
 * 4) נקודת התת־שמש עקבית עם SIM.sunPosition: זווית בין "מעלה" באשדוד לכיוון השמש = 90° − גובה השמש (גיאומטרי).
 * 5) קרן ↔ כדור: הקשה במרכז המסך פוגעת בנקודה שמתחת למצלמה.
 * הרצה: node twin/integration/tools/test-globe.js  (יציאה 1 בכישלון) */
'use strict';
const path = require('path');
const W = path.join(__dirname, '..', 'world');
const G = require(path.join(W, 'adapters', '67-globe.js'));
const ITM = require(path.join(W, 'js', 'itm.js'));
const SIM = require(path.join(W, 'js', 'sim.js'));
const D2R = Math.PI / 180, RM = G.RE_KM * 1000;
let fails = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fails++; };
const f32 = a => a.map(Math.fround);
const geoErrM = (a, b) => G.gcKm(a, b) * 1000;

// 1) הלוך-חזור על הכדור
const P = [['אשדוד, הארז 4', 31.8014, 34.6435], ['תל אביב', 32.0853, 34.7818], ['אילת', 29.5577, 34.9519], ['מטולה', 33.2774, 35.5786],
  ['קו התאריך', -16.5, 179.999], ['קו התאריך-', -16.5, -179.999], ['כמעט קוטב', 89.9, 12], ['גריניץ׳', 51.4779, 0], ['ניו יורק', 40.7128, -74.006]];
let m64 = 0, m32 = 0;
for (const [n, lat, lon] of P) {
  const v = G.ll2v(lat, lon, G.RE_KM), b = G.v2ll(...v), v2 = f32(v), b2 = G.v2ll(...v2);
  const e = geoErrM({ lat, lon }, b), e2 = geoErrM({ lat, lon }, b2); m64 = Math.max(m64, e); m32 = Math.max(m32, e2);
  ok(Math.abs(b.r - G.RE_KM) < 1e-9, `${n}: רדיוס נשמר`);
}
ok(m64 < 1e-6, `הלוך-חזור float64: שגיאה מרבית ${m64.toExponential(2)} מ'`);
ok(m32 < 2, `הלוך-חזור float32 (כמו ב-GPU, יחידות ק"מ): שגיאה מרבית ${m32.toFixed(3)} מ' — מספיק לכדור, לא לרחוב (ולכן הרחוב נשאר ב-ITM)`);

// 2) שרשרת רשת ישראל ⇄ כדור
const off = ITM.SAMPLE_OFFSET; let mc = 0;
for (const [E, N] of [[164751, 634164], [165000, 640000], [180000, 665000], [195000, 385000], [258000, 790000]]) {
  const real = { E: E + off.dE, N: N + off.dN }, ll = ITM.itmToWgs84(real.E, real.N), v = G.ll2v(ll.lat, ll.lon, G.RE_KM), b = G.v2ll(...v), it = ITM.wgs84ToItm(b.lat, b.lon);
  const e = Math.hypot(it.E - off.dE - E, it.N - off.dN - N); mc = Math.max(mc, e);
}
ok(mc < 0.01, `שרשרת דגימה→ITM→WGS84→כדור→WGS84→ITM→דגימה: שגיאה מרבית ${(mc * 1000).toFixed(3)} מ"מ`);
{ const h = ITM.itmToWgs84(164751 + off.dE, 634164 + off.dN); ok(geoErrM(h, { lat: 31.8014, lon: 34.6435 }) < 3000, `רחוב הארז (בית) ב-WGS84: ${h.lat.toFixed(5)}, ${h.lon.toFixed(5)} (קרוב לנקודת השמש של המארח, ${geoErrM(h, { lat: 31.8014, lon: 34.6435 }).toFixed(0)} מ')`); }

// 3) ENU
{ const { e, n, u } = G.enu(31.8, 34.65), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const orth = Math.max(Math.abs(dot(e, n)), Math.abs(dot(e, u)), Math.abs(dot(n, u))), unit = Math.max(...[e, n, u].map(a => Math.abs(Math.hypot(...a) - 1)));
  ok(orth < 1e-12 && unit < 1e-12, `ENU אורתונורמלי (סטייה ${Math.max(orth, unit).toExponential(1)})`);
  const p = G.ll2v(31.8, 34.65, G.RE_KM), q = p.map((x, i) => x + n[i] * 1), r = p.map((x, i) => x + e[i] * 1); // 1 ק"מ צפונה / מזרחה
  const bq = G.v2ll(...q), br = G.v2ll(...r); ok(bq.lat > 31.8 && Math.abs(bq.lon - 34.65) < 1e-9 && br.lon > 34.65, 'צפון מגדיל רוחב, מזרח מגדיל אורך'); }

// 4) נקודת התת־שמש מול SIM.sunPosition
let maxA = 0;
for (const iso of ['2026-11-23T12:30:00Z', '2026-06-21T05:00:00Z', '2026-03-20T15:00:00Z', '2026-12-21T09:10:00Z', '2027-09-01T03:20:00Z']) {
  const d = new Date(iso), s = G.subsolar(d, SIM), sun = G.ll2v(s.lat, s.lon, 1);
  for (const [lat, lon] of [[31.8014, 34.6435], [51.48, 0], [-33.9, 151.2]]) {
    const up = G.ll2v(lat, lon, 1), ang = Math.acos(Math.max(-1, Math.min(1, up[0] * sun[0] + up[1] * sun[1] + up[2] * sun[2]))) / D2R;
    const sp = SIM.sunPosition(d, lat, lon); if (sp.elevation < 3) continue;  // מתחת: שבירה אטמוספרית לא מוגדרת זהה
    const refr = sp.elevation > 5 ? (58.1 / Math.tan(sp.elevation * D2R)) / 3600 : 0.2;   // SIM מוסיף שבירה; הכדור גיאומטרי
    maxA = Math.max(maxA, Math.abs(ang - (90 - (sp.elevation - refr))));
  }
}
ok(maxA < 0.3, `כיוון השמש על הכדור = SIM.sunPosition (NOAA): סטייה מרבית ${maxA.toFixed(3)}° (רוחב גיאודטי על כדור עגול ≤0.19°)`);

// 5) קרן ↔ כדור
{ const c = G.ll2v(31.8, 34.65, G.RE_KM + 16500), d = c.map(x => -x / Math.hypot(...c)), t = G.raySphere(c, d, G.RE_KM), hit = G.v2ll(...c.map((x, i) => x + d[i] * t));
  ok(t != null && Math.abs(t - 16500) < 1e-6 && geoErrM(hit, { lat: 31.8, lon: 34.65 }) < 1e-3, `קרן מהמצלמה לנדיר פוגעת בנקודה שמתחת (t=${t.toFixed(3)} ק"מ)`);
  ok(G.raySphere(c, [d[1], -d[0], 0].map((x, i, a) => x / Math.hypot(...a)), G.RE_KM) == null, 'קרן משיקה לחלל לא פוגעת'); }

console.log(fails ? `\n${fails} כישלונות` : '\nכל הבדיקות עברו');
process.exit(fails ? 1 : 0);
