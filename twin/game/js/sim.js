/* 27wrld — sim.js : סימולציה טהורה, בלי three.js ובלי ציור (אפשר להריץ ב-Node או מעל מנוע של גדוד 6).
   1) מיקום השמש (אלגוריתם NOAA, דיוק ~0.01° בזווית; בלי שבירת אור אטמוספרית מתחת ל-0°).
   2) שדה רוח עירוני (קירוב! לא CFD): פרופיל לוגריתמי ממוצע זהה למודול הקנוני (גובה ערבוב, חופת בניינים), תיעול לאורך קירות, משבים = מערבולות דריידן (MIL-F-8785C) בסינתזה ספקטרלית, ממוצע 0.
   3) רחפן מרובע (quadcopter): מסה, דחף, גרר ריבועי + גרר רוטור ליניארי ביחס לאוויר (כולל רוח), בקר זווית/מהירות אנכית, אינטגרציה בצעד קבוע 1/120 ש'.
   יחידות SI. מערכת צירים כמו בעולם: x = מזרח, y = מעלה, z = דרום (−צפון). */
(function (G) {
'use strict';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const SIM = {};

// ---------------- 1. שמש
/** @returns {azimuth: מעלות מצפון אמיתי עם כיוון השעון, elevation: מעלות מעל האופק (כולל שבירה מעל −1°)} */
SIM.sunPosition = function (date, latDeg, lonDeg) {
  const jd = date.getTime() / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * D2R;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(om * D2R)) * D2R;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60, eps = (eps0 + 0.00256 * Math.cos(om * D2R)) * D2R;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const y = Math.tan(eps / 2) ** 2, L0r = L0 * D2R;
  const eot = 4 * R2D * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = ((utcMin + eot + 4 * lonDeg) % 1440 + 1440) % 1440;
  const ha = (tst / 4 - 180) * D2R, lat = latDeg * D2R;
  const cz = Math.min(1, Math.max(-1, Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)));
  let el = 90 - Math.acos(cz) * R2D;
  // שבירה אטמוספרית (NOAA, קירוב)
  if (el > -0.575) { const te = Math.tan(el * D2R); el += (el > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5 : 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)))) / 3600; }
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * R2D + 180;
  az = (az % 360 + 360) % 360;
  return { azimuth: az, elevation: el, declination: decl * R2D, eot };
};
/** וקטור יחידה לשמש בצירי העולם. gamma = התכנסות רשת ITM (מעלות): אזימוט רשת = אמיתי − gamma */
SIM.sunVector = function (sp, gammaDeg) {
  const az = (sp.azimuth - (gammaDeg || 0)) * D2R, el = sp.elevation * D2R;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
};
/** התכנסות הרשת ברשת ישראל החדשה (TM, מרידיאן מרכזי 35.2045°): γ ≈ (λ−λ0)·sinφ */
SIM.itmConvergence = (latDeg, lonDeg) => (lonDeg - 35.2045169444) * Math.sin(latDeg * D2R);
/** קרינה ישירה יחסית לפי כיסוי עננים (Kasten & Czeplak 1980): G = G0·(1 − 0.75·N^3.4) */
SIM.cloudFactor = cover => 1 - 0.75 * Math.pow(Math.max(0, Math.min(1, cover)), 3.4);
/** הפרש שעון ישראל (דקות) לתאריך נתון – מהדפדפן (Intl), כולל שעון קיץ */
SIM.israelOffsetMin = function (date) {
  try { const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute); return Math.round((asUTC - date.getTime()) / 60000); } catch (e) { return 120; }
};

// ---------------- 1ב. שעות שמש ישירה בנקודה (חזית / קרקע) – הצללה מבניינים שכנים, עם טווח מאי־ודאות הגובה
/** כניסת קרן אופקית (ox,oz)+t·(dx,dz) לפוליגון: t מינימלי > 0, 0 אם הנקודה בפנים, Infinity אם אין חיתוך */
function rayPolyEntry(p, n, ox, oz, dx, dz) {
  let tmin = Infinity, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = p[j * 2], az = p[j * 2 + 1], ex = p[i * 2] - ax, ez = p[i * 2 + 1] - az;
    if ((p[i * 2 + 1] > oz) !== (az > oz) && ox < ex * (oz - az) / ez + ax) inside = !inside;
    const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-12) continue;
    const qx = ax - ox, qz = az - oz, t = (qx * ez - qz * ex) / den, s = (qx * dz - qz * dx) / den;
    if (s >= 0 && s <= 1 && t > 1e-6 && t < tmin) tmin = t;
  }
  return inside ? 0 : tmin;
}
SIM.rayPolyEntry = rayPolyEntry;
/** שעות שמש ישירה ביום אחד (לפי לוח ישראל). o = { x, y, z, nx?, nz? (נורמל חזית החוצה; בלי = משטח אופקי פתוח),
 *  day: 'YYYY-MM-DD', near(x,z,r) → בניינים {p,n,top,sigma,minx..maxz,id}, exclude: id, step: דקות (ברירת מחדל 5), lat, lon, gamma }
 *  מחזיר { hours, lo, hi (שעות כששכנים נמוכים/גבוהים ב-σ), first, last (דקות מחצות שעון ישראל), dayHours }.
 *  מקורב: אין הצללת תבליט/אופק, עצים ומרפסות; הבניינים מנסרות עם גג שטוח; רק אריחים טעונים; רזולוציה ±step/2 לכל מעבר. */
SIM.sunHours = function (o) {
  const step = o.step || 5, lat = o.lat, lon = o.lon, gam = o.gamma || 0, MAXR = 800, MAXTOP = 250;
  const [Y, M, Dd] = o.day.split('-').map(Number), mid = new Date(Date.UTC(Y, M - 1, Dd, 12));
  const off = SIM.israelOffsetMin(mid), t0 = Date.UTC(Y, M - 1, Dd) - off * 60000;
  const cand = o.near(o.x, o.z, MAXR).filter(b => b.id !== o.exclude);   // פעם אחת לכל נקודה
  let cnt = [0, 0, 0], first = -1, last = -1, day = 0; const d = new Date();
  for (let m = step / 2; m < 1440; m += step) {
    d.setTime(t0 + m * 60000); const sp = SIM.sunPosition(d, lat, lon); if (sp.elevation <= 0) continue; day++;
    const v = SIM.sunVector(sp, gam), hl = Math.hypot(v.x, v.z), dx = v.x / hl, dz = v.z / hl, tanEl = v.y / hl;
    if (o.nx !== undefined && dx * o.nx + dz * o.nz <= 0) continue;               // השמש מאחורי החזית
    const R = Math.min(MAXR, (MAXTOP - o.y) / tanEl);
    let lo = true, mi = true, hi = true;                                            // מואר כשהשכנים ב-−σ / 0 / +σ
    for (const b of cand) {
      // דחייה מהירה: מלבן חוסם מול הקרן
      const cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2, rr = Math.hypot(b.maxx - b.minx, b.maxz - b.minz) / 2;
      const along = (cx - o.x) * dx + (cz - o.z) * dz; if (along < -rr || along > R + rr) continue;
      if (Math.abs((cx - o.x) * dz - (cz - o.z) * dx) > rr) continue;
      const t = rayPolyEntry(b.p, b.n, o.x, o.z, dx, dz); if (t === Infinity) continue;
      const yr = o.y + t * tanEl, s = b.sigma || 0;                                 // גובה הקרן בכניסה (הנמוך ביותר בתוך הטביעה)
      if (yr < b.top + s) hi = false; if (yr < b.top) mi = false; if (yr < b.top - s) { lo = false; break; }
    }
    if (mi) { cnt[1]++; if (first < 0) first = m; last = m; } if (lo) cnt[0]++; if (hi) cnt[2]++;
  }
  const h = c => c * step / 60;
  return { hours: h(cnt[1]), lo: h(cnt[2]), hi: h(cnt[0]), first: first < 0 ? null : first - step / 2, last: last < 0 ? null : last + step / 2, dayHours: h(day) };
};
/** זריחה ושקיעה (דקות מחצות שעון ישראל): השפה העליונה באופק = גובה גאומטרי של המרכז −0.833° (חצי קוטר 0.267° + שבירה תקנית 0.567°; מתחת ל-−0.575° NOAA לא מוסיף שבירה). חיפוש בינארי. */
SIM.sunRiseSet = function (day, lat, lon) {
  const [Y, M, D] = day.split('-').map(Number), off = SIM.israelOffsetMin(new Date(Date.UTC(Y, M - 1, D, 12))), t0 = Date.UTC(Y, M - 1, D) - off * 60000;
  const f = m => SIM.sunPosition(new Date(t0 + m * 60000), lat, lon).elevation + 0.833;
  let noon = 0, best = -99; for (let m = 0; m < 1440; m += 10) { const e = f(m); if (e > best) { best = e; noon = m; } }
  if (best < 0) return { rise: null, set: null, noon };
  const bis = (a, b) => { const up = f(a) < f(b); for (let i = 0; i < 40; i++) { const c = (a + b) / 2; if ((f(c) < 0) === up) a = c; else b = c; } return (a + b) / 2; };
  return { rise: f(0) < 0 ? bis(0, noon) : null, set: f(1439.99) < 0 ? bis(noon, 1439.99) : null, noon };
};
/** נקודות מדידה לחזיתות בניין: לכל כיוון (דרום/מזרח/מערב/צפון) הקיר הארוך שהנורמל שלו הכי קרוב, 0.5 מ' מחוץ לקיר */
SIM.facadePoints = function (b) {
  const dirs = { 'דרום': [0, 1], 'מזרח': [1, 0], 'מערב': [-1, 0], 'צפון': [0, -1] }, out = {};
  const p = b.p, n = b.n; let area = 0; for (let i = 0, j = n - 1; i < n; j = i++) area += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  const sg = area > 0 ? 1 : -1;
  for (const [name, [ux, uz]] of Object.entries(dirs)) {
    let best = null, bs = -1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = p[j * 2], az = p[j * 2 + 1], ex = p[i * 2] - ax, ez = p[i * 2 + 1] - az, L = Math.hypot(ex, ez); if (L < 3) continue;
      let nx = -ez / L * sg, nz = ex / L * sg; const mx = ax + ex / 2, mz = az + ez / 2;
      // ודא שהנורמל פונה החוצה: נקודה קטנה החוצה מחוץ לפוליגון
      if (rayPolyEntry(p, n, mx + nx * 0.3, mz + nz * 0.3, 1, 0.0001) === 0) { nx = -nx; nz = -nz; }
      const c = nx * ux + nz * uz; if (c < 0.5) continue; const sc = c * Math.sqrt(L); if (sc > bs) { bs = sc; best = { x: mx + nx * 0.5, z: mz + nz * 0.5, nx, nz, len: L }; }
    }
    if (best) out[name] = best;
  }
  return out;
};

// ---------------- 2. מזג אוויר + רוח
SIM.weather = { windSpeed: 6, windFrom: 270, gust: 1.5, cloud: 0.2, rain: 0, source: 'ידני' };
/** מתאם ל-Open-Meteo (חינמי, בלי מפתח). כבוי בגרסה הלא-מקוונת: נקרא רק כשמפעילים במפורש (?live=1). */
SIM.openMeteoURL = (lat, lon) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation&wind_speed_unit=ms&timezone=Asia%2FJerusalem`;
SIM.fromOpenMeteo = function (j) {
  const c = j && j.current; if (!c) throw new Error('תשובה בלי current');
  return { windSpeed: +c.wind_speed_10m, windFrom: +c.wind_direction_10m, gust: c.wind_speed_10m > 0.3 ? Math.min(3, c.wind_gusts_10m / c.wind_speed_10m) : 1.3, cloud: (+c.cloud_cover) / 100, rain: +c.precipitation, source: 'Open-Meteo ' + (c.time || '') };
};
SIM.fetchWeather = async function (lat, lon) { const r = await fetch(SIM.openMeteoURL(lat, lon)); if (!r.ok) throw new Error('HTTP ' + r.status); return SIM.fromOpenMeteo(await r.json()); };

/** פרופיל רוח ממוצע (בלי משבים ובלי השפעת קיר מקומית), מ'/ש'. u10 = רוח 10 מ' בשטח פתוח (תחנה / Open-Meteo wind_speed_10m),
 *  z = גובה מעל הקרקע, hm = גובה בניינים ממוצע סביב (0 = שטח פתוח). אותן נוסחאות כמו physics/src/wind.js (meanSpeed):
 *  חוק לוגריתמי u = (u*)÷κ·ln((z−d)/z0), κ=0.4; שטח פתוח z0=0.03 מ' (WMO/Davenport); עיר: d=0.7·H, z0=0.1·H (Grimmond & Oke 1999);
 *  מעבר שטח פתוח→עיר בגובה ערבוב zb=60 מ' שבו שני הפרופילים שווים (Wieringa 1986); מתחת לגג: u(H)·e^{2(z/H−1)} (Macdonald 2000, a=2 משוער).
 *  ים (sea=true, בלי בניינים): חספוס צ'רנוק z0 = α·u*²/g + 0.11·ν/u*, α=0.011 (Charnock 1955; Smith 1988), u* נפתר במשוואה סתומה;
 *  רוח התחנה עוברת לים דרך אותו גובה ערבוב. נבדק מול מקדם הגרר של Smith 1980: CD10 = (0.61+0.063·U10)·10⁻³.
 *  מקורב: ים בשיווי משקל (בלי שכבת גבול פנימית ליד החוף, בלי גיל גלים), יציבות ניטרלית בלבד, H הוא ממוצע הבניינים ברדיוס 40 מ' ולא שדה גבהים. */
const KAPPA = 0.4, Z0_OPEN = 0.03, ZB = 60, CANOPY_A = 2;
const lawLog = (z, us, z0, d) => (z - d <= z0 ? 0 : us / KAPPA * Math.log((z - d) / z0));
const CHARNOCK = 0.011, NU_AIR = 1.5e-5, G0 = 9.81;
SIM.seaZ0 = (us) => { const u = Math.max(us, 1e-3); return CHARNOCK * u * u / G0 + 0.11 * NU_AIR / u; };
SIM.seaUstar = function (U, z) {   // u* מעל ים כך שהחוק הלוגריתמי נותן U בגובה z (נקודת שבת)
  if (!(U > 0)) return 0; let us = Math.max(0.04 * U, 1e-3);
  for (let i = 0; i < 100; i++) { const n = KAPPA * U / Math.log(z / SIM.seaZ0(us)); if (Math.abs(n - us) < 1e-12) return n; us = n; }
  return us;
};
let seaCache = { ub: -1, us: 0, z0: 0 };
SIM.meanWind = function (u10, z, hm, sea) {
  const usO = u10 * KAPPA / Math.log(10 / Z0_OPEN);
  if (sea && !(hm > 0)) {                                                       // ים פתוח: חספוס צ'רנוק
    const ub = lawLog(ZB, usO, Z0_OPEN, 0);
    if (ub !== seaCache.ub) { const us = SIM.seaUstar(ub, ZB); seaCache = { ub, us, z0: SIM.seaZ0(us) }; }
    return lawLog(Math.max(z, seaCache.z0 * 1.0001), seaCache.us, seaCache.z0, 0);
  }
  if (!(hm > 0)) return lawLog(Math.max(z, Z0_OPEN * 1.0001), usO, Z0_OPEN, 0);
  const z0 = Math.max(0.1 * hm, Z0_OPEN), d = 0.7 * hm, zb = Math.max(ZB, 2 * hm), us = lawLog(zb, usO, Z0_OPEN, 0) * KAPPA / Math.log((zb - d) / z0);   // גובה ערבוב ≥ 2H (Grimmond & Oke 1999) – ליד מגדלים d>60 נתן לוג של שלילי = NaN
  const Hc = Math.max(hm, d + 1.5 * z0);
  if (z >= Hc) return lawLog(z, us, z0, d);
  return lawLog(Hc, us, z0, d) * Math.exp(CANOPY_A * (Math.max(z, 0) / Hc - 1));
};
// ---- משבים: מערבולות דריידן (MIL-F-8785C, נמוך: σw=0.1·W20, σu=σv=σw/(0.177+0.000823h)^0.4, Lw=h, Lu=Lv=h/(…)^1.2, h ברגל)
// אותן נוסחאות בדיוק כמו drydenParams ב-physics/src/wind.js (נבדק ב-test-sim). שדה "קפוא" (טיילור): u'(ξ−Uc·t) – פונקציה טהורה
// של מקום וזמן, בלי מצב, ולכן אותו משב בדיוק לרחפן, למסוק ולמחוון. סינתזה ספקטרלית (Shinozuka & Deodatis 1991):
// u' = Σ aᵢ·cos(Kᵢ·(ξ−Uc·t) + cᵢ·Kᵢ·η + eᵢ·Kᵢ·y + φᵢ), aᵢ = √(2·Φ(Kᵢ)·ΔKᵢ), 64 מספרי גל לוגריתמיים (אורך גל 1.5 מ' – 20 ק"מ),
// השונות מנורמלת ל-σ² בדיוק. Φu = σ²·(2L/π)/(1+(LK)²); Φv,w = σ²·(L/π)(1+3(LK)²)/(1+(LK)²)² (הצורה המלאה של דריידן, גם ל-v,w).
// עוצמה: G (יחס משב/רוח ממוצעת, מהמחוון או Open-Meteo) → כפל עוצמה s = (G−1)/(3·Iu10), כי G ≈ 1 + g·Iu עם g≈3 למשב 3 ש'
// (Wieringa 1973; Harper, Kepert & Ginger 2010, WMO/TD-1555). G=1 → בלי משבים. בברירת המחדל G=1.5 → s≈0.96 (דריידן כמעט כמו שהוא).
// מקורב: Uc = רוח התחנה (לא הרוח המקומית), קוהרנטיות רוחבית/אנכית אמפירית (cᵢ∈[−1,1], eᵢ∈[−0.5,0.5]), דריידן נגזר לשטח פתוח –
// אין מערבולות שבניינים משילים (כמו [W5][W6] במודול הקנוני), עוצמה אחידה גם בתוך חופת הבניינים.
const FT = 0.3048;
SIM.drydenParams = function (hMeters, W20) {
  const hf = Math.max(10, Math.min(1000, hMeters / FT)), sw = 0.1 * W20, k = 0.177 + 0.000823 * hf, su = sw / Math.pow(k, 0.4);
  const Lw = hf * FT, Lu = (hf / Math.pow(k, 1.2)) * FT;
  return { sigmaU: su, sigmaV: su, sigmaW: sw, Lu, Lv: Lu, Lw };
};
SIM.W20 = (u10) => lawLog(20 * FT, u10 * KAPPA / Math.log(10 / Z0_OPEN), Z0_OPEN, 0);   // רוח בגובה 20 רגל בשטח פתוח
SIM.GUST_PEAK = 3;                                                     // g – מקדם שיא למשב 3 ש' (מקורב, 2.5–3.5 בספרות)
SIM.turbScale = function (G, u10) {
  if (!(G > 1) || !(u10 > 0)) return 0;
  const Iu10 = SIM.drydenParams(10, SIM.W20(u10)).sigmaU / u10;       // עוצמת מערבולות של דריידן ב-10 מ' (≈0.17, בלי תלות ב-u10)
  return (G - 1) / (SIM.GUST_PEAK * Iu10);
};
const NK = 64, KMIN = 2 * Math.PI / 20000, KMAX = 2 * Math.PI / 1.5;
const GK = new Float64Array(NK), GDK = new Float64Array(NK), GPH = [new Float64Array(NK), new Float64Array(NK), new Float64Array(NK)];
const GC = [new Float64Array(NK), new Float64Array(NK), new Float64Array(NK)], GE = [new Float64Array(NK), new Float64Array(NK), new Float64Array(NK)];
{ let a = 0x2f6b1e9d >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32, זרע קבוע = עולם חוזר
  const r = Math.log(KMAX / KMIN) / NK;
  for (let i = 0; i < NK; i++) { GK[i] = KMIN * Math.exp((i + 0.5) * r); GDK[i] = KMIN * (Math.exp((i + 1) * r) - Math.exp(i * r));
    for (let c = 0; c < 3; c++) { GPH[c][i] = 2 * Math.PI * rnd(); GC[c][i] = 2 * rnd() - 1; GE[c][i] = rnd() - 0.5; } } }
const gAmp = [new Float64Array(NK), new Float64Array(NK), new Float64Array(NK)];
/** משב (u לאורך הרוח, v רוחבי, w אנכי), מ'/ש', בנקודה: ξ לאורך הרוח, η רוחבי, y גובה מוחלט, zag גובה מעל הקרקע. */
SIM.gustAt = function (xi, eta, y, zag, t, u10, scale, out) {
  out = out || {}; out.u = out.v = out.w = 0;
  if (!(scale > 0) || !(u10 > 0)) return out;
  const p = SIM.drydenParams(Math.max(zag, 3), SIM.W20(u10)), Uc = Math.max(1, u10), s0 = xi - Uc * t;
  const Ls = [p.Lu, p.Lv, p.Lw], sg = [p.sigmaU * scale, p.sigmaV * scale, p.sigmaW * scale], res = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const L = Ls[c], A = gAmp[c]; let tot = 0;
    for (let i = 0; i < NK; i++) { const x = L * GK[i], x2 = x * x;
      const phi = c === 0 ? 2 * L / Math.PI / (1 + x2) : L / Math.PI * (1 + 3 * x2) / ((1 + x2) * (1 + x2));
      A[i] = phi * GDK[i]; tot += A[i]; }
    const nrm = sg[c] * Math.SQRT2 / Math.sqrt(tot); let v = 0;          // Σ aᵢ²/2 = σ² בדיוק
    const ph = GPH[c], cc = GC[c], ee = GE[c];
    for (let i = 0; i < NK; i++) { const K = GK[i]; v += Math.sqrt(A[i]) * Math.cos(K * (s0 + cc[i] * eta + ee[i] * y) + ph[i]); }
    res[c] = v * nrm;
  }
  out.u = res[0]; out.v = res[1]; out.w = res[2] * Math.min(1, zag / 3);  // ליד הקרקע אין זרימה דרכה (כמו במודול הקנוני)
  return out;
};
const gTmp = {};
/** רוח מקומית (מ'/ש') בנקודה. world = { H(x,z), near(x,z,r) → בניינים {top,base,p,n,cx,cz,minx..}, edge(b,x,z) → {d,px,pz} }.
 *  מחזיר out = {x,y,z, speed, canopy, info} */
SIM.windAt = function (x, y, z, t, world, out) {
  out = out || {}; const w = SIM.weather;
  const flowAz = ((w.windFrom + 180) % 360) * D2R;                     // כיוון זרימה (לאן)
  let ux = Math.sin(flowAz), uz = -Math.cos(flowAz);
  const g = world.H(x, z), zag = Math.max(0.3, y - Math.max(g, 0));
  // בניינים סביב (רדיוס 40 מ'): גובה ממוצע/מקסימלי → הסטת גובה אפס d ≈ 0.7·H̄
  let hs = 0, n = 0, hmax = 0, nearB = null, nearD = 1e9;
  const list = world.near(x, z, 40);
  for (const b of list) { const h = b.top - Math.max(g, 0); hs += h; n++; if (h > hmax) hmax = h; }
  const hm = n ? hs / n : 0;
  const sea = !n && world.isSea ? world.isSea(x, z) : false;               // מעל הים (בלי בניינים סביב): חספוס צ'רנוק
  let U = SIM.meanWind(w.windSpeed, zag, hm, sea);                              // פרופיל ממוצע – זהה למודול הקנוני physics/src/wind.js
  let canopy = 0;
  if (n && zag < hmax) {                                                   // בתוך חופת הבניינים (ההאטה כבר בפרופיל החופה)
    canopy = 1;
    for (const b of list) { if (y > b.top) continue; const e = world.edge(b, x, z); if (e.d < nearD) { nearD = e.d; nearB = e; } }
    if (nearB && nearD < 14) {                                             // תיעול לאורך הקיר הקרוב
      let tx = x - nearB.px, tz = z - nearB.pz; const l = Math.hypot(tx, tz) || 1; const nx = tx / l, nz = tz / l;   // נורמל מהקיר
      const ex = -nz, ez = nx; const par = ux * ex + uz * ez, perp = ux * nx + uz * nz; const k = 1 - nearD / 14;
      const fx = ex * par * (1 + 0.3 * k) + nx * perp * (1 - 0.65 * k), fz = ez * par * (1 + 0.3 * k) + nz * perp * (1 - 0.65 * k);
      const fl = Math.hypot(fx, fz) || 1; const mag = Math.hypot(par * (1 + 0.3 * k), perp * (1 - 0.65 * k)); ux = fx / fl; uz = fz / fl; U *= mag;
    }
  }
  const fx0 = Math.sin(flowAz), fz0 = -Math.cos(flowAz);                     // ξ, η לפי כיוון הרוח הכללי (לא המתועל) – השדה הקפוא לא זז עם הקיר
  SIM.gustAt(x * fx0 + z * fz0, -x * fz0 + z * fx0, y, zag, t, w.windSpeed, SIM.turbScale(w.gust, w.windSpeed), gTmp);
  const px = -uz, pz = ux;                                                // u' לאורך הזרימה המקומית, v' רוחבי לה
  const gx = ux * gTmp.u + px * gTmp.v, gz = uz * gTmp.u + pz * gTmp.v, vert = gTmp.w;
  out.x = ux * U + gx; out.z = uz * U + gz; out.y = vert; out.mean = U; out.gu = gTmp.u; out.gv = gTmp.v; out.gw = gTmp.w; out.speed = Math.hypot(out.x, out.y, out.z); out.canopy = canopy; out.hm = hm; out.sea = sea;
  return out;
};

// ---------------- 3. רחפן
SIM.DRONE = { mass: 0.9, tw: 2.2, cdaH: 0.018, cdaV: 0.035, rho: 1.225, maxTilt: 35 * D2R, tau: 0.12, yawRate: 120 * D2R, vUp: 5, vDn: 3.5, vMaxGPS: 14, kv: 0.09, kz: 4, r: 0.35, cRotor: 0.12, ki: 0.12 };   // cRotor: גרר רוטור ליניארי (blade flapping) נ'·ש'/מ' בריחוף
/** כיוון הדחף (ציר "מעלה" של הגוף) אחרי pitch ואז roll – וקטור יחידה מדויק (כמו rotateX(−pitch)·rotateZ(roll) בציור).
 *  f = רכיב קדימה, r = ימינה, y = מעלה. f² + r² + y² = 1 לכל זווית. */
SIM.tiltUp = (p, r) => ({ f: -Math.sin(p) * Math.cos(r), r: Math.sin(r), y: Math.cos(p) * Math.cos(r) });
/** הגבלת הטיה כוללת: θ = acos(cos p · cos r) ≤ max, באותו כיוון (כמו בבקרי טיסה – מגבלה על הזווית הכוללת, לא לכל ציר בנפרד). */
SIM.limitTilt = function (p, r, max) {
  const u = SIM.tiltUp(p, r); if (u.y >= Math.cos(max)) return [p, r];
  const hl = Math.hypot(u.f, u.r) || 1, k = Math.sin(max) / hl, uf = u.f * k, ur = u.r * k, uy = Math.cos(max);
  return [Math.atan2(-uf, uy), Math.asin(ur)];
};
/** ATTI: הטיה כוללת = |מקל|·max בכיוון המקל (ix ימינה, iy קדימה) → [pitch, roll]. */
SIM.tiltFromStick = function (ix, iy, max) {
  const m = Math.hypot(ix, iy); if (m < 1e-9) return [0, 0];
  const th = Math.min(1, m) * max, uf = Math.sin(th) * iy / m, ur = Math.sin(th) * ix / m;
  return [Math.atan2(-uf, Math.cos(th)), Math.asin(ur)];
};
SIM.newDrone = (x, y, z, yaw) => ({ x, y, z, vx: 0, vy: 0, vz: 0, yaw: yaw || 0, pitch: 0, roll: 0, thrust: 0, landed: true, gps: true, wind: { x: 0, y: 0, z: 0, speed: 0 }, air: 0, hit: 0, acc: 0 });
/** צעד רחפן. inp: {x,y (−1..1 מקל), up, down, yawIn}. world כמו ב-windAt + collide(x,z,r,y0,y1), floor(x,z,y) */
SIM.stepDrone = function (s, inp, dt, t, world) {
  const P = SIM.DRONE, g = 9.81, h = 1 / 120;
  s.acc += Math.min(dt, 0.1);
  while (s.acc >= h) { s.acc -= h; t += h;
    SIM.windAt(s.x, s.y, s.z, t, world, s.wind);
    // מקל עגול: עוצמה ≤ 1 (אלכסון במקלדת לא נותן √2)
    const sm = Math.hypot(inp.x || 0, inp.y || 0), sk = sm > 1 ? 1 / sm : 1, ix = (inp.x || 0) * sk, iy = (inp.y || 0) * sk;
    // יעדי זווית: GPS = בקר מהירות (כמו מצב "רגיל" ברחפנים מסחריים), ATTI = המקל קובע זווית ישירות (הרוח מסיחה)
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    let tp, tr;
    if (s.gps) { const vfT = iy * P.vMaxGPS, vrT = ix * P.vMaxGPS;   // מהירות יעד במסגרת הרחפן
      const vf = s.vx * sy + s.vz * cy, vr = -s.vx * cy + s.vz * sy;
      const ef = vfT - vf, er = vrT - vr; if (!s.landed) { s.iF = Math.max(-3, Math.min(3, (s.iF || 0) + ef * h)); s.iR = Math.max(-3, Math.min(3, (s.iR || 0) + er * h)); }   // PI: מבטל סחיפה ברוח קבועה
      tp = -Math.max(-P.maxTilt, Math.min(P.maxTilt, P.kv * ef * 3 + P.ki * (s.iF || 0))); tr = Math.max(-P.maxTilt, Math.min(P.maxTilt, P.kv * er * 3 + P.ki * (s.iR || 0))); }
    else { s.iF = s.iR = 0; }
    if (!s.gps) {
      [tp, tr] = SIM.tiltFromStick(ix, iy, P.maxTilt); }
    [tp, tr] = SIM.limitTilt(tp, tr, P.maxTilt);
    const a = 1 - Math.exp(-h / P.tau); s.pitch += (tp - s.pitch) * a; s.roll += (tr - s.roll) * a;   // תגובת זווית מסדר ראשון
    s.yaw -= (inp.yawIn || 0) * P.yawRate * h;
    // דחף: בקר מהירות אנכית, מוגבל ל-T/W
    const vzT = inp.up ? P.vUp : inp.down ? -P.vDn : 0;
    const cosT = Math.cos(s.pitch) * Math.cos(s.roll);
    let T = P.mass * (g + P.kz * (vzT - s.vy)) / Math.max(0.5, cosT); T = Math.max(0, Math.min(P.mass * g * P.tw, T));
    if (s.landed && !inp.up) T = 0;
    s.thrust = T;
    // וקטור הדחף: ציר "מעלה" של הגוף אחרי yaw→pitch→roll. pitch<0 = אף למטה → תאוצה קדימה
    const fwdX = sy, fwdZ = cy, rtX = -cy, rtZ = sy;
    const U = SIM.tiltUp(s.pitch, s.roll), ux = U.f * fwdX + U.r * rtX, uz = U.f * fwdZ + U.r * rtZ, uy = U.y;
    // גרר ריבועי על המהירות היחסית לאוויר
    const rx = s.vx - s.wind.x, ry = s.vy - s.wind.y, rz = s.vz - s.wind.z, rh = Math.hypot(rx, rz);
    const kr = P.cRotor * T / (P.mass * g);   // גרר רוטור יחסי לדחף
    const fdx = -0.5 * P.rho * P.cdaH * rh * rx - kr * rx, fdz = -0.5 * P.rho * P.cdaH * rh * rz - kr * rz, fdy = -0.5 * P.rho * P.cdaV * Math.abs(ry) * ry;
    s.air = Math.hypot(rx, ry, rz);
    if (!s.landed || T > P.mass * g) {
      s.vx += (T * ux + fdx) / P.mass * h; s.vz += (T * uz + fdz) / P.mass * h; s.vy += ((T * uy + fdy) / P.mass - g) * h;
      s.landed = false;
    }
    let nx = s.x + s.vx * h, ny = s.y + s.vy * h, nz = s.z + s.vz * h;
    const c = world.collide(nx, nz, P.r, ny - 0.1, ny + 0.15);
    if (c.hit) { const vn = s.vx * c.nx + s.vz * c.nz; if (vn < 0) { s.hit = Math.max(s.hit, -vn); s.vx -= 1.4 * vn * c.nx; s.vz -= 1.4 * vn * c.nz; } nx = c.x; nz = c.z; }
    const fl = Math.max(world.floor(nx, nz, ny + 0.3), 0);
    if (ny <= fl) { ny = fl; if (s.vy < 0) { if (s.vy < -4) s.hit = Math.max(s.hit, -s.vy); s.vy = 0; } if (T < P.mass * g * 1.02) { s.landed = true; s.vx *= 0.8; s.vz *= 0.8; s.pitch *= 0.8; s.roll *= 0.8; } }
    s.x = nx; s.y = ny; s.z = nz;
  }
  return s;
};

G.SIM = SIM;
if (typeof module !== 'undefined') module.exports = SIM;
})(typeof window !== 'undefined' ? window : globalThis);
