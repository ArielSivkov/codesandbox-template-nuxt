/* itm.js — המרה מדויקת WGS84 ⇄ רשת ישראל החדשה (ITM, EPSG:2039), בלי תלויות.
 * שיטה: הלמרט 7 פרמטרים (EPSG:9676 "Israel 1993 to WGS 84 (2)", ברירת המחדל של PROJ, בלי קבצי רשת)
 *       + טרנסוורס מרקטור על GRS80 בטורי קריגר (סדר 6, דיוק תת־מילימטרי בתחום ישראל).
 * פרמטרים מאומתים מול pyproj/PROJ 9 (בדיקה: tools/test-itm.py). מקור הפרמטרים: חבילת Gemini r5 (23.11.2026), נבדקו בנפרד.
 * מסגרת הדגימה של האריחים: ITM אמיתי = דגימה + SAMPLE_OFFSET (twin/groundtruth/ashdod_reference.json, אושר מול עוגנים K Towers 2 + דימרי).
 */
(function (G) {
  'use strict';
  const D2R = Math.PI / 180, AS = D2R / 3600;
  const a = 6378137.0, fW = 1 / 298.257223563, fG = 1 / 298.257222101;   // WGS84, GRS80
  const lat0 = 31.7343936111111 * D2R, lon0 = 35.2045169444444 * D2R, k0 = 1.0000067, FE = 219529.584, FN = 626907.39;
  // Israel 1993 → WGS84, וקטור מיקום (Position Vector)
  const H = { tx: 23.772, ty: 17.49, tz: 17.859, rx: -0.3132 * AS, ry: -1.85274 * AS, rz: 1.67299 * AS, s: -5.4262e-6 };

  const n = fG / (2 - fG), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const al = [0, n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840, 212378941 * n6 / 319334400];
  const be = [0, n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680, 20648693 * n6 / 638668800];
  const eG = Math.sqrt(fG * (2 - fG));

  function tmXY(phi, lam) {   // (רדיאנים, GRS80) → (ξ', η') מנורמל
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - eG * Math.atanh(eG * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(lam - lon0)), eta = Math.atanh(Math.sin(lam - lon0) / Math.sqrt(1 + t * t));
    let X = xi, Y = eta; for (let j = 1; j <= 6; j++) { X += al[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); Y += al[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
    return [X, Y];
  }
  const X0 = tmXY(lat0, lon0)[0];
  function geoToTM(phi, lam) { const [X, Y] = tmXY(phi, lam); return { E: FE + k0 * A * Y, N: FN + k0 * A * (X - X0) }; }
  function tmToGeo(E, N) {
    const xi = (N - FN) / (k0 * A) + X0, eta = (E - FE) / (k0 * A);
    let x = xi, y = eta; for (let j = 1; j <= 6; j++) { x -= be[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); y -= be[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
    const tp = Math.sin(x) / Math.sqrt(Math.sinh(y) ** 2 + Math.cos(x) ** 2); let t = tp;
    for (let i = 0; i < 6; i++) { const s = t / Math.sqrt(1 + t * t), sg = Math.sinh(eG * Math.atanh(eG * s)); const ti = t * Math.sqrt(1 + sg * sg) - sg * Math.sqrt(1 + t * t);
      t += (tp - ti) / Math.sqrt(1 + ti * ti) * (1 + (1 - eG * eG) * t * t) / ((1 - eG * eG) * Math.sqrt(1 + t * t)); }
    return { phi: Math.atan(t), lam: lon0 + Math.atan2(Math.sinh(y), Math.cos(x)) };
  }
  function toECEF(phi, lam, f) { const e2 = f * (2 - f), N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [N * Math.cos(phi) * Math.cos(lam), N * Math.cos(phi) * Math.sin(lam), N * (1 - e2) * Math.sin(phi)]; }
  function fromECEF(X, Y, Z, f) { const e2 = f * (2 - f), p = Math.hypot(X, Y); let phi = Math.atan2(Z, p * (1 - e2));
    for (let i = 0; i < 6; i++) { const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), h = p / Math.cos(phi) - N; phi = Math.atan2(Z, p * (1 - e2 * N / (N + h))); }
    return { phi, lam: Math.atan2(Y, X) }; }
  function helmert(P, sign) {   // sign=+1: Israel1993→WGS84, −1: הפוך (קירוב ליניארי, שגיאה < 0.1 מ"מ)
    const k = 1 + sign * H.s, rx = sign * H.rx, ry = sign * H.ry, rz = sign * H.rz, [x, y, z] = P;
    return [sign * H.tx + k * (x - rz * y + ry * z), sign * H.ty + k * (rz * x + y - rx * z), sign * H.tz + k * (-ry * x + rx * y + z)];
  }
  const ITM = {
    SAMPLE_OFFSET: { dE: 1524.6, dN: 753.6 },
    wgs84ToItm(lat, lon) { const P = helmert(toECEF(lat * D2R, lon * D2R, fW), -1), g = fromECEF(P[0], P[1], P[2], fG); return geoToTM(g.phi, g.lam); },
    itmToWgs84(E, N) { const g = tmToGeo(E, N), P = helmert(toECEF(g.phi, g.lam, fG), +1), w = fromECEF(P[0], P[1], P[2], fW); return { lat: w.phi / D2R, lon: w.lam / D2R }; },
    sampleToItm(E, N) { return { E: E + ITM.SAMPLE_OFFSET.dE, N: N + ITM.SAMPLE_OFFSET.dN }; },
    itmToSample(E, N) { return { E: E - ITM.SAMPLE_OFFSET.dE, N: N - ITM.SAMPLE_OFFSET.dN }; },
  };
  G.ITM = ITM;
  if (typeof module !== 'undefined') module.exports = ITM;
})(typeof window !== 'undefined' ? window : globalThis);
