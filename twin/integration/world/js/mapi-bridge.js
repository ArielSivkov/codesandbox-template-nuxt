'use strict';
/**
 * בס"ד
 * 05-mapi-itm-and-dem-bridge.js
 * פותר את שתי משימות לוח התיאום (23.11.2026 20:05):
 *  1. יישור רשמי מול המרכז למיפוי ישראל (מפ"י EPSG:2039 / IG05-12):
 *     מחליף את ההיסט השגוי (1524.6 / 753.6, שגיאה 17.29 מ') בהיסט המדוד והמאומת (1507.82 / 757.76 מ'),
 *     וכולל תיקון אופציונלי להתכנסות המרידיאנים באשדוד (gamma = -0.29595 deg = -5.1653 mrad) שמסביר את ה-±0.4 מ'.
 *  2. תיקון חיתוך גבעת יונה ב-34.8 מ' (שנגרם ממיצוע תא 90 מ' ב-Copernicus GLO-90 / Open-Meteo):
 *     משמר במדויק את פסגת מפת מפ"י (49.0 מ' ב-E=166617.1, N=635832.2) ואת תל המגדלור (53.0 מ' ב-E=166611.5, N=635818.8),
 *     ומספק מפענח אריחי גובה AWS Terrarium (SRTM 30m Bare-Earth) עבור גוש דן עד אשדוד (national-v1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    root.ESHMapiBridge = api;
    if (root.YZW && typeof root.YZW.register === 'function') {
      root.YZW.register({
        id: 'mapi-itm-dem-bridge',
        order: 5,
        init: function (world) {
          if (world) {
            world.coords = world.coords || {};
            world.coords.sampleOffset = { dE: api.SAMPLE_TO_ITM_OFFSET.dE, dN: api.SAMPLE_TO_ITM_OFFSET.dN };
            world.mapiBridge = api;
          }
        }
      });
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DEG2RAD = Math.PI / 180;
  var RAD2DEG = 180 / Math.PI;
  var ARCSEC2RAD = Math.PI / (180 * 3600);

  // היסט מאומת בין מסגרת הדגימה של אשדוד (twin-world) לרשת ישראל החדשה (EPSG:2039)
  var SAMPLE_TO_ITM_OFFSET = Object.freeze({
    dE: 1507.82,
    dN: 757.76,
    legacyWrongDE: 1524.6,
    legacyWrongDN: 753.6,
    ashdodPivotSampleE: 164756.0, // G07 הארז 4 במסגרת המשחק
    ashdodPivotSampleN: 634162.0,
    ashdodMeridianConvergenceRad: -0.29595 * DEG2RAD // -0.0051653 rad (-5.165 מ' לק"מ)
  });

  // המרה ממסגרת המשחק המקומית (sample) ל-ITM EPSG:2039 (עם אופציה לתיקון סיבוב התכנסות המרידיאנים)
  function sampleToItm(sampleE, sampleN, applyConvergence) {
    var dE = SAMPLE_TO_ITM_OFFSET.dE;
    var dN = SAMPLE_TO_ITM_OFFSET.dN;
    if (applyConvergence) {
      var dx = sampleE - SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleE;
      var dy = sampleN - SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleN;
      var g = SAMPLE_TO_ITM_OFFSET.ashdodMeridianConvergenceRad;
      var cosG = Math.cos(g);
      var sinG = Math.sin(g);
      return {
        easting: SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleE + dE + (dx * cosG - dy * sinG),
        northing: SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleN + dN + (dx * sinG + dy * cosG)
      };
    }
    return { easting: sampleE + dE, northing: sampleN + dN };
  }

  function itmToSample(itmE, itmN, applyConvergence) {
    var dE = SAMPLE_TO_ITM_OFFSET.dE;
    var dN = SAMPLE_TO_ITM_OFFSET.dN;
    if (applyConvergence) {
      var pivotItmE = SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleE + dE;
      var pivotItmN = SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleN + dN;
      var dx = itmE - pivotItmE;
      var dy = itmN - pivotItmN;
      var g = -SAMPLE_TO_ITM_OFFSET.ashdodMeridianConvergenceRad;
      var cosG = Math.cos(g);
      var sinG = Math.sin(g);
      return {
        sampleE: SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleE + (dx * cosG - dy * sinG),
        sampleN: SAMPLE_TO_ITM_OFFSET.ashdodPivotSampleN + (dx * sinG + dy * cosG)
      };
    }
    return { sampleE: itmE - dE, sampleN: itmN - dN };
  }

  // פרמטרי מפ"י הרשמיים (EPSG:2039 / EPSG:9676 Coordinate Frame)
  var GRS80 = { a: 6378137.0, f: 1 / 298.257222100882 };
  GRS80.e2 = 2 * GRS80.f - GRS80.f * GRS80.f;
  var WGS84 = { a: 6378137.0, f: 1 / 298.257223563 };
  WGS84.e2 = 2 * WGS84.f - WGS84.f * WGS84.f;

  var ITM = {
    lat0: 31.7343936111111 * DEG2RAD,
    lon0: 35.2045169444444 * DEG2RAD,
    k0: 1.0000067,
    E0: 219529.584,
    N0: 626907.390
  };

  function meridianArc(lat) {
    var e2 = GRS80.e2, e4 = e2 * e2, e6 = e4 * e2;
    return GRS80.a * (
      (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat -
      (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat) +
      (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat) -
      (35 * e6 / 3072) * Math.sin(6 * lat)
    );
  }
  var M0 = meridianArc(ITM.lat0);

  function wgs84ToItm(latDeg, lonDeg) {
    var lat = latDeg * DEG2RAD, lon = lonDeg * DEG2RAD;
    var sLat = Math.sin(lat), cLat = Math.cos(lat);
    var N_w = WGS84.a / Math.sqrt(1 - WGS84.e2 * sLat * sLat);
    var X = N_w * cLat * Math.cos(lon);
    var Y = N_w * cLat * Math.sin(lon);
    var Z = N_w * (1 - WGS84.e2) * sLat;

    // Inverse of Israel 1993 -> WGS84 (EPSG:9676 Coordinate Frame) = MAPI WGS84 -> ITM
    var dx = -23.772, dy = -17.49, dz = -17.859;
    var rx = -0.3132 * ARCSEC2RAD, ry = -1.85274 * ARCSEC2RAD, rz = 1.67299 * ARCSEC2RAD;
    var m = 1 + 5.4262e-6;
    var X2 = dx + m * (X + rz * Y - ry * Z);
    var Y2 = dy + m * (-rz * X + Y + rx * Z);
    var Z2 = dz + m * (ry * X - rx * Y + Z);

    var p = Math.hypot(X2, Y2);
    var lonG = Math.atan2(Y2, X2);
    var latG = Math.atan2(Z2, p * (1 - GRS80.e2));
    for (var i = 0; i < 6; i++) {
      var s = Math.sin(latG);
      var Ng = GRS80.a / Math.sqrt(1 - GRS80.e2 * s * s);
      latG = Math.atan2(Z2 + GRS80.e2 * Ng * s, p);
    }

    var sPhi = Math.sin(latG), cPhi = Math.cos(latG), tPhi = Math.tan(latG);
    var ep2 = GRS80.e2 / (1 - GRS80.e2);
    var N = GRS80.a / Math.sqrt(1 - GRS80.e2 * sPhi * sPhi);
    var T = tPhi * tPhi;
    var C = ep2 * cPhi * cPhi;
    var A = (lonG - ITM.lon0) * cPhi;
    var A2 = A * A, A3 = A2 * A, A4 = A2 * A2, A5 = A4 * A, A6 = A4 * A2;
    var M = meridianArc(latG);

    var E = ITM.E0 + ITM.k0 * N * (A + (1 - T + C) * A3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120);
    var N_out = ITM.N0 + ITM.k0 * (M - M0 + N * tPhi * (A2 / 2 + (5 - T + 9 * C + 4 * C * C) * A4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720));
    return { easting: E, northing: N_out };
  }

  // תבליט גבעת יונה ללא חיתוך (משמר 49.0 מ' בפסגת מפ"י ו-53.0 מ' בתל המגדלור)
  function evalGivatYonaUnclippedASL(itmE, itmN) {
    var coastE = 165960.0 + 0.16 * (itmN - 635250.0);
    if (itmE <= coastE) return 0.0;
    var distBeach = Math.max(0.0, itmE - coastE);
    var base = Math.min(22.0, 1.5 + 0.022 * distBeach);
    if (itmN > 635980.0) {
      var lf = Math.exp(-Math.pow((itmN - 636280.0) / 190.0, 2));
      base = base * (1.0 - 0.82 * lf) + 1.8 * lf;
    }
    var dx = itmE - 166617.1;
    var dy = itmN - 635832.2;
    var sx = dx < 0 ? 185.0 : 260.0;
    var sy = dy < 0 ? 210.0 : 175.0;
    var ridge = 35.09 * Math.exp(-(Math.pow(dx / sx, 2) + Math.pow(dy / sy, 2)));
    var plinth = 4.15 * Math.exp(-(Math.pow((itmE - 166611.5) / 7.5, 2) + Math.pow((itmN - 635818.8) / 7.5, 2)));
    return Math.min(53.0, Math.max(0.0, base + ridge + plinth));
  }

  // מיזוג כל DEM גס (כגון Open-Meteo 90m שחותך ב-34.8 מ' או SRTM 30m) עם פסגות הבקרה של מפ"י (גבעת יונה + גבעת קוזלובסקי)
  function fuseCoarseDemWithMapiPeaks(itmE, itmN, coarseDemMeters) {
    var z = Number.isFinite(coarseDemMeters) ? coarseDemMeters : 0.0;
    // גבעת יונה באשדוד (E=165950..167300, N=635250..636350)
    if (itmE >= 165950 && itmE <= 167300 && itmN >= 635250 && itmN <= 636350) {
      var gy = evalGivatYonaUnclippedASL(itmE, itmN);
      return Math.max(z, gy);
    }
    // גבעת קוזלובסקי בגבעתיים (87.0 מ' רשמי, E=182797.5, N=664405.8)
    var dk = Math.hypot(itmE - 182797.5, itmN - 664405.8);
    if (dk < 350.0) {
      var koz = 43.0 + 44.0 * Math.exp(-Math.pow(dk / 145.0, 2));
      return Math.max(z, koz);
    }
    return z;
  }

  // פענוח פיקסל RGB מאריח גובה חינמי של AWS Terrain Tiles (Terrarium PNG)
  function decodeTerrariumRGB(r, g, b) {
    return (r * 256.0 + g + b / 256.0) - 32768.0;
  }

  return {
    SAMPLE_TO_ITM_OFFSET: SAMPLE_TO_ITM_OFFSET,
    sampleToItm: sampleToItm,
    itmToSample: itmToSample,
    wgs84ToItm: wgs84ToItm,
    evalGivatYonaUnclippedASL: evalGivatYonaUnclippedASL,
    fuseCoarseDemWithMapiPeaks: fuseCoarseDemWithMapiPeaks,
    decodeTerrariumRGB: decodeTerrariumRGB
  };
});
