/* 27wrld — sim.js : סימולציה טהורה, בלי three.js ובלי ציור (אפשר להריץ ב-Node או מעל מנוע של גדוד 6).
   1) מיקום השמש (אלגוריתם NOAA, דיוק ~0.01° בזווית; בלי שבירת אור אטמוספרית מתחת ל-0°).
   2) שדה רוח עירוני (קירוב! לא CFD): פרופיל חזקה לפי גובה, הסטת גובה אפס לפי בניינים, הצללה בתוך "חופת" הבניינים,
      תיעול לאורך קירות, משבים כתהליך אקראי חלק.
   3) רחפן מרובע (quadcopter): מסה, דחף, גרר ריבועי ביחס לאוויר (כולל רוח), בקר זווית/מהירות אנכית, אינטגרציה בצעד קבוע 1/120 ש'.
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

// ---------------- 2. מזג אוויר + רוח
SIM.weather = { windSpeed: 6, windFrom: 270, gust: 1.5, cloud: 0.2, rain: 0, source: 'ידני' };
/** מתאם ל-Open-Meteo (חינמי, בלי מפתח). כבוי בגרסה הלא-מקוונת: נקרא רק כשמפעילים במפורש (?live=1). */
SIM.openMeteoURL = (lat, lon) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation&wind_speed_unit=ms&timezone=Asia%2FJerusalem`;
SIM.fromOpenMeteo = function (j) {
  const c = j && j.current; if (!c) throw new Error('תשובה בלי current');
  return { windSpeed: +c.wind_speed_10m, windFrom: +c.wind_direction_10m, gust: c.wind_speed_10m > 0.3 ? Math.min(3, c.wind_gusts_10m / c.wind_speed_10m) : 1.3, cloud: (+c.cloud_cover) / 100, rain: +c.precipitation, source: 'Open-Meteo ' + (c.time || '') };
};
SIM.fetchWeather = async function (lat, lon) { const r = await fetch(SIM.openMeteoURL(lat, lon)); if (!r.ok) throw new Error('HTTP ' + r.status); return SIM.fromOpenMeteo(await r.json()); };

// משבים: סכום סינוסים בתדרים לא-רציונליים + פאזה מרחבית (אורך מערבולת ~40–120 מ'), ממוצע ≈ 0
function gustSignal(t, x, z) {
  return 0.45 * Math.sin(0.37 * t + x * 0.011 + z * 0.007) + 0.3 * Math.sin(1.13 * t + 1.7 - x * 0.023 + z * 0.019) + 0.25 * Math.sin(2.71 * t + 0.4 + x * 0.041 - z * 0.037);
}
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
  const hm = n ? hs / n : 0, d = 0.7 * hm;
  // פרופיל חזקה עירוני (α≈0.30 מרכז עיר, 0.14 שטח פתוח/ים); רוח הייחוס = 10 מ' בשטח פתוח
  const alpha = n ? 0.30 : 0.14;
  const zeff = Math.max(0.5, zag - d);
  let U = w.windSpeed * Math.pow(zeff / 10, alpha);
  let canopy = 0;
  if (n && zag < hmax) {                                                   // בתוך חופת הבניינים
    canopy = 1;
    U *= 0.35 + 0.65 * Math.min(1, zag / Math.max(hm, 1));                 // הצללה
    for (const b of list) { if (y > b.top) continue; const e = world.edge(b, x, z); if (e.d < nearD) { nearD = e.d; nearB = e; } }
    if (nearB && nearD < 14) {                                             // תיעול לאורך הקיר הקרוב
      let tx = x - nearB.px, tz = z - nearB.pz; const l = Math.hypot(tx, tz) || 1; const nx = tx / l, nz = tz / l;   // נורמל מהקיר
      const ex = -nz, ez = nx; const par = ux * ex + uz * ez, perp = ux * nx + uz * nz; const k = 1 - nearD / 14;
      const fx = ex * par * (1 + 0.3 * k) + nx * perp * (1 - 0.65 * k), fz = ez * par * (1 + 0.3 * k) + nz * perp * (1 - 0.65 * k);
      const fl = Math.hypot(fx, fz) || 1; const mag = Math.hypot(par * (1 + 0.3 * k), perp * (1 - 0.65 * k)); ux = fx / fl; uz = fz / fl; U *= mag;
    }
  }
  const s = gustSignal(t, x, z);                                           // משב: U·(1 + (G−1)·s⁺) − חלק קטן שלילי
  const gm = 1 + (w.gust - 1) * Math.max(-0.35, s);
  U *= gm;
  const vert = canopy ? 0 : 0.08 * U * gustSignal(t * 1.3 + 7, z, x);     // מערבולות אנכיות קטנות מעל הגגות
  out.x = ux * U; out.z = uz * U; out.y = vert; out.speed = Math.hypot(out.x, out.y, out.z); out.canopy = canopy; out.hm = hm;
  return out;
};

// ---------------- 3. רחפן
SIM.DRONE = { mass: 0.9, tw: 2.2, cdaH: 0.018, cdaV: 0.035, rho: 1.225, maxTilt: 30 * D2R, tau: 0.12, yawRate: 120 * D2R, vUp: 5, vDn: 3.5, vMaxGPS: 14, kv: 0.09, kz: 4, r: 0.35 };
SIM.newDrone = (x, y, z, yaw) => ({ x, y, z, vx: 0, vy: 0, vz: 0, yaw: yaw || 0, pitch: 0, roll: 0, thrust: 0, landed: true, gps: true, wind: { x: 0, y: 0, z: 0, speed: 0 }, air: 0, hit: 0, acc: 0 });
/** צעד רחפן. inp: {x,y (−1..1 מקל), up, down, yawIn}. world כמו ב-windAt + collide(x,z,r,y0,y1), floor(x,z,y) */
SIM.stepDrone = function (s, inp, dt, t, world) {
  const P = SIM.DRONE, g = 9.81, h = 1 / 120;
  s.acc += Math.min(dt, 0.1);
  while (s.acc >= h) { s.acc -= h; t += h;
    SIM.windAt(s.x, s.y, s.z, t, world, s.wind);
    // יעדי זווית: GPS = בקר מהירות (כמו מצב "רגיל" ברחפנים מסחריים), ATTI = המקל קובע זווית ישירות (הרוח מסיחה)
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    let tp, tr;
    if (s.gps) { const vfT = inp.y * P.vMaxGPS, vrT = inp.x * P.vMaxGPS;   // מהירות יעד במסגרת הרחפן
      const vf = s.vx * sy + s.vz * cy, vr = -s.vx * cy + s.vz * sy;
      tp = -Math.max(-P.maxTilt, Math.min(P.maxTilt, P.kv * (vfT - vf) * 3)); tr = Math.max(-P.maxTilt, Math.min(P.maxTilt, P.kv * (vrT - vr) * 3)); }
    else { tp = -inp.y * P.maxTilt; tr = inp.x * P.maxTilt; }
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
    const ux = -Math.sin(s.pitch) * fwdX + Math.sin(s.roll) * rtX, uz = -Math.sin(s.pitch) * fwdZ + Math.sin(s.roll) * rtZ, uy = cosT;
    // גרר ריבועי על המהירות היחסית לאוויר
    const rx = s.vx - s.wind.x, ry = s.vy - s.wind.y, rz = s.vz - s.wind.z, rh = Math.hypot(rx, rz);
    const fdx = -0.5 * P.rho * P.cdaH * rh * rx, fdz = -0.5 * P.rho * P.cdaH * rh * rz, fdy = -0.5 * P.rho * P.cdaV * Math.abs(ry) * ry;
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
