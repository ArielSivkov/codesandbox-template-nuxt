/* WGS84 ↔ רשת ישראל החדשה (ITM, EPSG:2039) + תיקון סטייה מגנטית + כיוון מצלמה מחיישני הטלפון.
 * EPSG:2039: tmerc lat0=31.7343936111111 lon0=35.2045169444444 k=1.0000067 x0=219529.584 y0=626907.39, GRS80; דאטום: EPSG Israel 1993→WGS84 (2), 7 פרמטרים.
 * שיטה: גיאודטי WGS84 → ECEF → הזזת דאטום → גיאודטי GRS80 → טרנסברס מרקטור (סדרות קרוגר, דיוק מילימטרים). נבדק מול pyproj (tests).
 * עובד ב-node (module.exports) ובדפדפן (window.ESH_ITM). */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const WGS = { a: 6378137, f: 1 / 298.257223563 }, GRS = { a: 6378137, f: 1 / 298.257222101 };
  const ITM = { lat0: 31.7343936111111, lon0: 35.2045169444444, k0: 1.0000067, x0: 219529.584, y0: 626907.39 };
  // EPSG "Israel 1993 to WGS 84 (2)" – 7 פרמטרים, coordinate frame (כמו ש-PROJ בוחר כברירת מחדל). ISR→WGS: X_w = T + (1+s)·R·X_i
  const H7 = { t: [23.772, 17.49, 17.859], r: [0.3132, 1.85274, -1.67299].map(v => v / 3600 * D2R), s: -5.4262e-6 };

  function toECEF(lat, lon, h, E) { const e2 = E.f * (2 - E.f), s = Math.sin(lat * D2R), N = E.a / Math.sqrt(1 - e2 * s * s);
    return [(N + h) * Math.cos(lat * D2R) * Math.cos(lon * D2R), (N + h) * Math.cos(lat * D2R) * Math.sin(lon * D2R), (N * (1 - e2) + h) * s]; }
  function fromECEF(X, Y, Z, E) { const e2 = E.f * (2 - E.f), b = E.a * (1 - E.f), p = Math.hypot(X, Y), lon = Math.atan2(Y, X);
    let lat = Math.atan2(Z, p * (1 - e2)), h = 0;
    for (let i = 0; i < 8; i++) { const s = Math.sin(lat), N = E.a / Math.sqrt(1 - e2 * s * s); h = p / Math.cos(lat) - N; lat = Math.atan2(Z, p * (1 - e2 * N / (N + h))); }
    return [lat * R2D, lon * R2D, h]; }

  // טרנסברס מרקטור – סדרות קרוגר (Karney 2011, סדר 6)
  function tmFwd(lat, lon, E, lat0, lon0, k0) {
    const f = E.f, n = f / (2 - f), A = E.a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64 + n ** 6 / 256);
    const al = [0, n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180 - 127 * n ** 5 / 288 + 7891 * n ** 6 / 37800,
      13 * n * n / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440 + 281 * n ** 5 / 630 - 1983433 * n ** 6 / 1935360,
      61 * n ** 3 / 240 - 103 * n ** 4 / 140 + 15061 * n ** 5 / 26880 + 167603 * n ** 6 / 181440,
      49561 * n ** 4 / 161280 - 179 * n ** 5 / 168 + 6601661 * n ** 6 / 7257600, 34729 * n ** 5 / 80640 - 3418889 * n ** 6 / 1995840, 212378941 * n ** 6 / 319334400];
    const e = Math.sqrt(f * (2 - f));
    const merid = phi => { const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi))); const xi = Math.atan2(t, 1); let s = xi; for (let j = 1; j <= 6; j++) s += al[j] * Math.sin(2 * j * xi); return A * s; };
    const phi = lat * D2R, lam = (lon - lon0) * D2R;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let x = eta, y = xi; for (let j = 1; j <= 6; j++) { x += al[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); y += al[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
    return [k0 * A * x, k0 * (A * y - merid(lat0 * D2R))];
  }

  function wgs84ToITM(lat, lon, h = 0) {
    const [X, Y, Z] = toECEF(lat, lon, h, WGS);
    const [rx, ry, rz] = H7.r, k = 1 + H7.s, a = X - H7.t[0], b = Y - H7.t[1], c = Z - H7.t[2];
    // היפוך: X_i = Rᵀ·(X_w − T)/(1+s)  (R ≈ אורתוגונלית; שגיאת הקירוב < 1 מ"מ)
    const Xi = (a - rz * b + ry * c) / k, Yi = (rz * a + b - rx * c) / k, Zi = (-ry * a + rx * b + c) / k;
    const [la, lo] = fromECEF(Xi, Yi, Zi, GRS);
    const [e, n] = tmFwd(la, lo, GRS, ITM.lat0, ITM.lon0, ITM.k0);
    return [e + ITM.x0, n + ITM.y0];
  }

  // סטייה מגנטית: אמיתי = מגנטי + D. ברירת מחדל לאשדוד 2026: ~+5.0° מזרחה (משוער – לאמת מול מחשבון WMM של NOAA; שינוי שנתי ~+0.1°)
  const DECL_DEFAULT = 5.0;
  function magToTrue(magHeading, decl = DECL_DEFAULT) { return ((magHeading + decl) % 360 + 360) % 360; }

  // כיוון המצלמה האחורית מ-DeviceOrientation (W3C: R = Rz(α)·Rx(β)·Ry(γ); מצלמה = −Z של המכשיר)
  function cameraPose(alpha, beta, gamma) {
    const a = alpha * D2R, b = beta * D2R, g = gamma * D2R, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    const R = [[ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg], [sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg], [-cb * sg, sb, cb * cg]];
    const d = [-R[0][2], -R[1][2], -R[2][2]];   // −Z במערכת כדור הארץ (X מזרח, Y צפון, Z למעלה)
    const xr = [R[0][0], R[1][0], R[2][0]];       // ציר X של המכשיר (ימין) → גלגול
    const heading = ((Math.atan2(d[0], d[1]) * R2D) % 360 + 360) % 360, pitch = Math.asin(Math.max(-1, Math.min(1, d[2]))) * R2D;
    const roll = Math.asin(Math.max(-1, Math.min(1, xr[2]))) * R2D;
    return { heading, pitch, roll };
  }
  // iOS: webkitCompassHeading = כיוון מגנטי של קצה המכשיר העליון → alpha מוחלט = 360 − heading
  const iosAlpha = wch => (360 - wch) % 360;

  const API = { wgs84ToITM, magToTrue, cameraPose, iosAlpha, DECL_DEFAULT, ITM };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ESH_ITM = API;
})(typeof self !== 'undefined' ? self : this);
