/* present/geo.js — מתמטיקה טהורה למודול המצגת של "לוח היזם" (בלי three.js, רץ גם ב-node וגם בדפדפן).
 * קואורדינטות מקומיות: x = מזרח (מ'), y = צפון (מ'), z = מעלה (מ'). מקור = מרכז האתר.
 * כל מה שמקורב – כתוב כאן שהוא מקורב.
 *  - מיקום שמש: אלגוריתם NOAA (Meeus מקוצר). נבדק מול NREL SPA (pvlib) – ראו tests/.
 *  - ITM→WGS84: הטלה רוחבית הפוכה על GRS80 בלי הזזת דאטום (שגיאה < ~100 מ', זניחה לשמש: < 0.001°).
 *  - צל: קרן ישרה מול מנסרות (פוליגון × גובה) – מדויק למנסרה. גובה שכנים = הערכת הנתונים (±σ).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PGEO = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ---------------------------------------------------------------- פוליגונים
  function signedArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[i], r = p[(i + 1) % n]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; }
  const area = p => Math.abs(signedArea(p));
  function ccw(p) { return signedArea(p) < 0 ? p.slice().reverse() : p.slice(); }
  function dedupe(p, eps = 1e-6) {
    const o = []; for (const q of p) { const l = o[o.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > eps) o.push([q[0], q[1]]); }
    if (o.length > 1 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) <= eps) o.pop();
    return o;
  }
  function centroid(p) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = p.length; i < n; i++) { const q = p[i], r = p[(i + 1) % n], c = q[0] * r[1] - r[0] * q[1]; a += c; cx += (q[0] + r[0]) * c; cy += (q[1] + r[1]) * c; }
    if (Math.abs(a) < 1e-12) { let sx = 0, sy = 0; for (const q of p) { sx += q[0]; sy += q[1]; } return [sx / p.length, sy / p.length]; }
    return [cx / (3 * a), cy / (3 * a)];
  }
  function bbox(p) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const q of p) { if (q[0] < a) a = q[0]; if (q[1] < b) b = q[1]; if (q[0] > c) c = q[0]; if (q[1] > d) d = q[1]; } return [a, b, c, d]; }
  function perimeter(p) { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; s += Math.hypot(r[0] - q[0], r[1] - q[1]); } return s; }
  function pointInPolygon(x, y, p) {
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function isConvex(p) {
    let s = 0; for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n], c = p[(i + 2) % n];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-9) continue; const sg = Math.sign(cr); if (!s) s = sg; else if (sg !== s) return false;
    } return true;
  }
  function convexHull(pts) {
    const snap = v => Math.round(v * 1e7) / 1e7;           // נקודות כמעט-זהות (שמש בדיוק מדרום) שוברות את המיון
    const P = pts.map(q => [snap(q[0]), snap(q[1])]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return P;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q); }
    for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  /** הזחה פנימה של פוליגון פשוט במרחק d (קווים מקבילים + חיתוך שכנים). מדויק לקמור; לקעור מתון – תקין כל עוד d קטן מרוחב האגף. */
  function insetPolygon(p, d) {
    if (!d) return p.map(q => [q[0], q[1]]);
    const P = ccw(dedupe(p)), n = P.length, L = [];
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;                       // נורמל פנימי (CCW → שמאלה)
      L.push({ px: a[0] + nx * d, py: a[1] + ny * d, dx, dy });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const l1 = L[(i - 1 + n) % n], l2 = L[i], den = l1.dx * l2.dy - l1.dy * l2.dx;
      if (Math.abs(den) < 1e-9) { out.push([l2.px, l2.py]); continue; }
      const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
      out.push([l1.px + l1.dx * t, l1.py + l1.dy * t]);
    }
    if (signedArea(out) <= 0 || area(out) < 1e-6) return null;  // הנסיגה גדולה מהבניין
    return out;
  }
  function rotate(p, deg, cx = 0, cy = 0) { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return p.map(q => [cx + (q[0] - cx) * c - (q[1] - cy) * s, cy + (q[0] - cx) * s + (q[1] - cy) * c]); }
  function translate(p, dx, dy) { return p.map(q => [q[0] + dx, q[1] + dy]); }
  /** כיוון הצלע הארוכה (מעלות, מזרח=0, נגד כיוון השעון) – ליישור מודל glTF לחלקה */
  function principalAngle(p) { let best = 0, ang = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * R2D; } } return ang; }

  // ---------------------------------------------------------------- מסה (massing)
  /** spec: { footprint:[[x,y]..] (מ'), floors, floorHeight, groundFloorHeight?, setbacks:[{fromFloor, inset}] }
   *  setbacks: מקומה fromFloor ומעלה הקומה מוזחת פנימה ב-inset מטר ביחס לקונטור המקורי (הגדולה מבין החלים).
   *  מחזיר קומות (שטח ברוטו לכל קומה = שטח הקונטור החיצוני), מדרגות (tiers) לגאומטריה ולצל, גובה. */
  function buildMassing(spec) {
    const fp = ccw(dedupe(spec.footprint)), N = Math.max(1, Math.round(spec.floors || 1));
    const fh = +spec.floorHeight || 3.0, gf = +spec.groundFloorHeight || fh;
    const sbs = (spec.setbacks || []).filter(s => s && s.fromFloor >= 1 && s.inset > 0).sort((a, b) => a.fromFloor - b.fromFloor);
    const floors = []; let z = 0;
    for (let k = 1; k <= N; k++) {
      let inset = 0; for (const s of sbs) if (k >= s.fromFloor) inset = Math.max(inset, s.inset);
      const poly = inset ? insetPolygon(fp, inset) : fp;
      const h = k === 1 ? gf : fh;
      if (!poly) break;                                           // נסיגה שמבטלת את הקומה – עוצרים בכנות
      floors.push({ n: k, z0: z, z1: z + h, inset, poly, area: area(poly) });
      z += h;
    }
    const tiers = [];
    for (const f of floors) { const t = tiers[tiers.length - 1]; if (t && t.inset === f.inset) t.z1 = f.z1; else tiers.push({ z0: f.z0, z1: f.z1, inset: f.inset, poly: f.poly }); }
    const gross = floors.reduce((s, f) => s + f.area, 0);
    return { floors, tiers, height: z, grossArea: gross, footprintArea: area(fp), footprint: fp, floorsBuilt: floors.length, floorsAsked: N };
  }

  // ---------------------------------------------------------------- שמש (NOAA)
  function julianDay(ms) { return ms / 86400000 + 2440587.5; }
  /** NOAA Solar Calculator (Meeus). ms = זמן UTC. lat/lon במעלות (מזרח חיובי).
   *  מחזיר azimuth (מצפון, עם כיוון השעון), elevation גאומטרי, apparentElevation (עם שבירה אטמוספרית מקורבת של NOAA). */
  function solarPosition(ms, lat, lon) {
    const jd = julianDay(ms), T = (jd - 2451545) / 36525;
    const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const Mr = M * D2R;
    const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
    const trueLong = L0 + C, omega = 125.04 - 1934.136 * T;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
    const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R));
    const y = Math.tan(eps * D2R / 2) ** 2, L0r = L0 * D2R;
    const eqt = 4 * R2D * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
    const minUTC = ((ms % 86400000) + 86400000) % 86400000 / 60000;
    let tst = (minUTC + eqt + 4 * lon) % 1440; if (tst < 0) tst += 1440;
    let ha = tst / 4 - 180; if (ha < -180) ha += 360;
    const latr = lat * D2R, har = ha * D2R;
    const cz = Math.min(1, Math.max(-1, Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(har)));
    const zen = Math.acos(cz);
    let az; const den = Math.cos(latr) * Math.sin(zen);
    if (Math.abs(den) < 1e-9) az = lat > 0 ? 180 : 0;
    else {
      const ca = Math.min(1, Math.max(-1, (Math.sin(latr) * Math.cos(zen) - Math.sin(decl)) / den));
      const a = Math.acos(ca) * R2D; az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
    }
    const el = 90 - zen * R2D;
    let refr = 0;                                                  // שבירה – קירוב NOAA (בדקות קשת)
    if (el <= 85) { const te = Math.tan(el * D2R);
      if (el > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
      else if (el > -0.575) refr = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
      else refr = -20.772 / te; refr /= 3600; }
    return { azimuth: az, elevation: el, apparentElevation: el + refr, declination: decl * R2D, eqTimeMin: eqt, hourAngle: ha };
  }
  /** וקטור יחידה לכיוון השמש: [מזרח, צפון, מעלה] */
  function sunVector(azDeg, elDeg) { const a = azDeg * D2R, e = elDeg * D2R; return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]; }

  // ---------------------------------------------------------------- שעון ישראל
  function lastSunday(y, m) { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - d.getUTCDay(); } // m: 0-based
  /** הפרש שעון ישראל מ-UTC בשעות (חוק השעון 2013: קיץ מיום שישי שלפני יום א' האחרון של מרץ 02:00 עד יום א' האחרון של אוקטובר 02:00) */
  function israelOffset(y, m, d, hour) {
    const startDay = lastSunday(y, 2) - 2, endDay = lastSunday(y, 9);
    const t = (m * 100 + d) * 100 + hour, s = (2 * 100 + startDay) * 100 + 2, e = (9 * 100 + endDay) * 100 + 2;
    return t >= s && t < e ? 3 : 2;
  }
  /** "YYYY-MM-DD", שעה עשרונית בשעון ישראל → ms UTC */
  function israelToUTC(dateStr, hourDec) {
    const [y, m, d] = dateStr.split('-').map(Number), off = israelOffset(y, m - 1, d, Math.floor(hourDec));
    return Date.UTC(y, m - 1, d, 0, 0, 0) + (hourDec - off) * 3600000;
  }

  // ---------------------------------------------------------------- ITM → WGS84 (מקורב, ראו כותרת)
  function itmToWgs84(E, N) {
    const a = 6378137, f = 1 / 298.257222101, k0 = 1.0000067, lat0 = (31 + 44 / 60 + 3.817 / 3600) * D2R, lon0 = (35 + 12 / 60 + 16.261 / 3600) * D2R;
    const FE = 219529.584, FN = 626907.390, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const Mf = phi => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    const M = Mf(lat0) + (N - FN) / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = (E - FE) / (N1 * k0);
    const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
    return [lat * R2D, lon * R2D];
  }

  // ---------------------------------------------------------------- צל
  /** הטלת נקודה בגובה z לאורך קרני השמש אל מישור zg */
  function projectToPlane(x, y, z, zg, sv) { const t = (z - zg) / sv[2]; return [x - sv[0] * t, y - sv[1] * t]; }
  /** צל של מנסרה (poly, z0..z1) על מישור zg. קמור → מעטפת קמורה (מדויק). קעור → איחוד של בסיס+רביעיות לכל צלע (מדויק כאיחוד).
   *  מחזיר { polys:[...], convex } או null כשהשמש מתחת לאופק */
  function prismShadow(poly, z0, z1, zg, azDeg, elDeg) {
    if (elDeg <= 0.1) return null;
    const sv = sunVector(azDeg, elDeg);
    const lo = poly.map(q => projectToPlane(q[0], q[1], Math.max(z0, zg), zg, sv)), hi = poly.map(q => projectToPlane(q[0], q[1], z1, zg, sv));
    if (isConvex(poly)) return { convex: true, polys: [convexHull(lo.concat(hi))] };
    const polys = [lo]; for (let i = 0; i < poly.length; i++) { const j = (i + 1) % poly.length; polys.push(ccw([lo[i], lo[j], hi[j], hi[i]])); }
    return { convex: false, polys };
  }
  /** קרן p + t·d (t>0, d[2]>0) פוגעת במנסרה? חיתוך מדויק: מרווחי t שבהם ההיטל האופקי בתוך הפוליגון ∩ מרווח הגובה. מחזיר t של הכניסה או -1 */
  function rayPrism(p, d, poly, z0, z1, bb) {
    if (d[2] <= 0) return -1;
    let tz0 = (z0 - p[2]) / d[2], tz1 = (z1 - p[2]) / d[2]; if (tz1 <= 1e-9) return -1; if (tz0 < 0) tz0 = 0;
    if (bb) {                                                      // דחייה מהירה מול תיבה תוחמת (slab)
      let t0 = tz0, t1 = tz1;
      for (let k = 0; k < 2; k++) { const lo = bb[k], hi = bb[k + 2];
        if (Math.abs(d[k]) < 1e-12) { if (p[k] < lo || p[k] > hi) return -1; }
        else { let a = (lo - p[k]) / d[k], b = (hi - p[k]) / d[k]; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; } }
    }
    const ts = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const A = poly[i], B = poly[(i + 1) % n], ex = B[0] - A[0], ey = B[1] - A[1];
      const den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-12) continue;
      const wx = A[0] - p[0], wy = A[1] - p[1];
      const t = (wx * ey - wy * ex) / den, s = (wx * d[1] - wy * d[0]) / den;
      if (s >= 0 && s < 1 && t > 0) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    const intervals = []; let i = 0;
    if (pointInPolygon(p[0], p[1], poly)) { intervals.push([0, ts.length ? ts[0] : Infinity]); i = 1; }
    for (; i + 1 < ts.length; i += 2) intervals.push([ts[i], ts[i + 1]]);
    for (const [a, b] of intervals) { const lo = Math.max(a, tz0), hi = Math.min(b, tz1); if (hi - lo > 1e-6) return lo; }
    return -1;
  }
  /** דגימות על חזיתות ועל הגג של מנסרה: נקודות 5 ס"מ מחוץ לחזית + נורמל חיצוני. step = מרווח אופקי, levels = גבהים יחסיים */
  function surfaceSamples(poly, z0, z1, step = 4, levelStep = 3, roof = true) {
    const P = ccw(poly), out = [], H = z1 - z0;
    const levels = []; for (let h = Math.min(1.5, H / 2); h < H - 0.5; h += levelStep) levels.push(z0 + h); if (!levels.length) levels.push(z0 + H / 2);
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1) continue;
      const nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;   // נורמל חיצוני ל-CCW
      const k = Math.max(1, Math.round(len / step));
      for (let j = 0; j < k; j++) { const u = (j + 0.5) / k, x = a[0] + (b[0] - a[0]) * u + nx * 0.05, y = a[1] + (b[1] - a[1]) * u + ny * 0.05;
        for (const z of levels) out.push({ p: [x, y, z], n: [nx, ny, 0], kind: 'facade' }); }
    }
    if (roof) { const c = centroid(P); out.push({ p: [c[0], c[1], z1 + 0.05], n: [0, 0, 1], kind: 'roof' });
      for (const q of P) out.push({ p: [c[0] + (q[0] - c[0]) * 0.6, c[1] + (q[1] - c[1]) * 0.6, z1 + 0.05], n: [0, 0, 1], kind: 'roof' }); }
    return out;
  }

  // ---------------------------------------------------------------- תרחיש ⇄ כתובת (hash)
  const SC_KEYS = ['site', 'fp', 'fl', 'fh', 'gf', 'sb', 'rot', 'model', 'mf', 'ma', 'd', 'h', 'v', 'sw', 'shot', 'win', 'play'];
  const r1 = v => Math.round(v * 10) / 10;
  function encodeScenario(s) {
    const q = [];
    const put = (k, v) => { if (v !== undefined && v !== null && v !== '') q.push(k + '=' + encodeURIComponent(v).replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%3B/g, ';')); };   // קריא לבני אדם
    put('site', s.site);
    if (s.footprint) put('fp', s.footprint.map(p => r1(p[0]) + ',' + r1(p[1])).join(';'));
    put('fl', s.floors); put('fh', s.floorHeight); put('gf', s.groundFloorHeight);
    if (s.setbacks && s.setbacks.length) put('sb', s.setbacks.map(b => b.fromFloor + ':' + b.inset).join(','));
    if (s.rotation) put('rot', s.rotation);
    put('model', s.model); put('mf', s.modelFloors); put('ma', s.modelGrossArea);
    put('d', s.date); put('h', s.hour); put('v', s.view); put('sw', s.swipe);
    if (s.shot !== undefined && s.shot !== null) put('shot', s.shot);
    if (s.window) put('win', s.window.building + ':' + s.window.floor);
    if (s.play) put('play', 1);
    return q.join('&');
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function decodeScenario(str) {
    const s = {}; const h = String(str || '').replace(/^#/, '');
    const kv = {}; for (const part of h.split('&')) { if (!part) continue; const i = part.indexOf('='); const k = i < 0 ? part : part.slice(0, i); if (SC_KEYS.includes(k)) kv[k] = decodeURIComponent(i < 0 ? '' : part.slice(i + 1)); }
    const num = (k, a, b) => { if (kv[k] === undefined) return undefined; const v = parseFloat(kv[k]); return isFinite(v) ? clamp(v, a, b) : undefined; };
    if (kv.site && /^[A-Za-z0-9_\-]{1,40}$/.test(kv.site)) s.site = kv.site;
    if (kv.fp) { const pts = kv.fp.split(';').map(t => t.split(',').map(Number)).filter(p => p.length === 2 && p.every(isFinite)); if (pts.length >= 3 && pts.length <= 64) s.footprint = pts; }
    const fl = num('fl', 1, 80); if (fl !== undefined) s.floors = Math.round(fl);
    const fh = num('fh', 2.4, 8); if (fh !== undefined) s.floorHeight = fh;
    const gf = num('gf', 2.4, 10); if (gf !== undefined) s.groundFloorHeight = gf;
    if (kv.sb) { const b = kv.sb.split(',').map(t => t.split(':').map(Number)).filter(x => x.length === 2 && x.every(isFinite)).map(([f, i]) => ({ fromFloor: Math.round(clamp(f, 1, 80)), inset: clamp(i, 0, 30) })); if (b.length) s.setbacks = b.slice(0, 8); }
    const rot = num('rot', -360, 360); if (rot !== undefined) s.rotation = rot;
    if (kv.model && /^(models\/[A-Za-z0-9_\-\/]+\.(gltf|glb)|https:\/\/[^\s"'<>]+\.(gltf|glb))$/.test(kv.model)) s.model = kv.model;
    const mf = num('mf', 1, 80); if (mf !== undefined) s.modelFloors = Math.round(mf);
    const ma = num('ma', 1, 1e6); if (ma !== undefined) s.modelGrossArea = ma;
    if (kv.d && /^\d{4}-\d{2}-\d{2}$/.test(kv.d)) s.date = kv.d;
    const hh = num('h', 0, 24); if (hh !== undefined) s.hour = hh;
    if (['before', 'after', 'swipe'].includes(kv.v)) s.view = kv.v;
    const sw = num('sw', 0, 1); if (sw !== undefined) s.swipe = sw;
    const sh = num('shot', 0, 50); if (sh !== undefined) s.shot = Math.round(sh);
    if (kv.win) { const m = /^([A-Za-z0-9_\-]{1,40}):(\d{1,2})$/.exec(kv.win); if (m) s.window = { building: m[1], floor: +m[2] }; }
    if (kv.play) s.play = true;
    return s;
  }

  return { D2R, R2D, signedArea, area, ccw, dedupe, centroid, bbox, perimeter, pointInPolygon, isConvex, convexHull, insetPolygon, rotate, translate, principalAngle,
    buildMassing, julianDay, solarPosition, sunVector, israelOffset, israelToUTC, itmToWgs84, projectToPlane, prismShadow, rayPrism, surfaceSamples,
    encodeScenario, decodeScenario };
});
