/**
 * negev_desert_biome.js — ESH27 Twin World · Backlog 105 (באר שבע ופני השטח המדבריים בנגב)
 *
 * ביומת מדבר הנגב ובקעת באר שבע (~260–310 מ' מעל פני הים):
 * - גווני אדמת לס ואבן גיר/קירטון בהירה
 * - ערוצי ואדיות יבשים (נחל באר שבע, נחל כובשים, נחל עשן)
 * - אובך מדברי קל באופק (Mie dust haze)
 * - צמחייה מדברית דלילה מבוססת מרחק מוואדי (שיטה סלילנית, אשל היאור, רותם המדבר)
 * - התאמת אלבדו שמש גבוה ביום והתקררות קרינתית לילית ללא ערכי NaN
 *
 * רישוי נתונים גיאוגרפיים משולבים: © OpenStreetMap contributors (ODbL 1.0)
 * מקורות מדעיים וציבוריים:
 * - בקעת באר שבע: https://he.wikipedia.org/wiki/%D7%91%D7%90%D7%A8_%D7%A9%D7%91%D7%A2
 * - אדמת לס: https://he.wikipedia.org/wiki/%D7%9C%D7%A1
 * - שיטה סלילנית: https://he.wikipedia.org/wiki/%D7%A9%D7%99%D7%98%D7%94_%D7%A1%D7%9C%D7%99%D7%9C%D7%A0%D7%99%D7%AA
 * - אשל היאור: https://he.wikipedia.org/wiki/%D7%90%D7%A9%D7%9C_%D7%94%D7%99%D7%90%D7%95%D7%A8
 * - רותם המדבר: https://he.wikipedia.org/wiki/%D7%A8%D7%95%D7%AA%D7%9D_%D7%94%D7%9E%D7%93%D7%91%D7%A8
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ESHNegevBiome = factory();
    if (root.YZW && typeof root.YZW.register === 'function') {
      root.YZW.register({
        id: 'negev-desert-biome',
        name: 'ביומת מדבר הנגב ובקעת באר שבע (מופעלת דרומית ל-N=605000)',
        dept: 'spatial-south',
        order: 34,
        init: function (world) {
          if (world) {
            world.negevBiome = root.ESHNegevBiome;
            world._negevBiomeActive = false;
          }
        },
        update: function (_dt, world) {
          if (!world || !world.camera || typeof root.YZW_worldToITM !== 'function') return;
          var itm = root.YZW_worldToITM(world.camera.position.x, world.camera.position.z);
          var inNegev = itm && Number.isFinite(itm.N) && itm.N < 605000;
          if (inNegev && !world._negevBiomeActive) {
            root.ESHNegevBiome.applyNegevLookToWorld(world);
            world._negevBiomeActive = true;
          } else if (!inNegev && world._negevBiomeActive) {
            root.ESHNegevBiome.disposeNegevLookFromWorld(world);
            world._negevBiomeActive = false;
          }
        },
        dispose: function (world) {
          if (world && world._negevBiomeActive) {
            root.ESHNegevBiome.disposeNegevLookFromWorld(world);
            world._negevBiomeActive = false;
          }
        }
      });
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_LOOK = {
    profileId: 'negev_desert_v1',
    elevationBandM: { min: 255.0, mean: 291.0, max: 325.0 },
    paletteHex: {
      loessBase: '#D4BA8E',
      loessDryCrust: '#DFC9A3',
      limestonePale: '#E8DFCC',
      brutalistConcrete: '#CFC8BA',
      wadiThalwegPebble: '#B8A280',
      wadiSiltBar: '#CBB58D',
      horizonDustDay: '#E6D5B8',
      horizonDustGolden: '#E5B582',
      skyZenithDay: '#3C78B8',
      skyZenithNight: '#0B1326'
    },
    albedo: {
      loess: 0.35,
      limestone: 0.43,
      wadiBed: 0.31,
      meanBasin: 0.36
    },
    fog: {
      betaDay: 0.000145,
      betaNight: 0.000065,
      mieTurbidityDay: 3.8,
      mieDirectionalG: 0.76,
      baseElevM: 260.0,
      falloffM: 180.0
    },
    thermal: {
      summerPeakC: 36.5,
      summerMinC: 20.5,
      winterPeakC: 18.5,
      winterMinC: 6.5,
      bloomNight: 0.40,
      middayExposureEvOffset: -0.35,
      groundBounceDay: 0.42
    },
    species: [
      {
        id: 'vachellia_tortilis_raddiana',
        nameHe: 'שיטה סלילנית',
        minH: 4.0,
        maxH: 8.5,
        minR: 2.8,
        maxR: 5.6,
        maxWadiDistM: 65.0,
        wadiWeight: 0.32,
        plainWeight: 0.04
      },
      {
        id: 'tamarix_nilotica',
        nameHe: 'אשל היאור',
        minH: 3.5,
        maxH: 7.5,
        minR: 2.0,
        maxR: 4.2,
        maxWadiDistM: 90.0,
        wadiWeight: 0.45,
        plainWeight: 0.08
      },
      {
        id: 'retama_raetam',
        nameHe: 'רותם המדבר',
        minH: 1.2,
        maxH: 2.8,
        minR: 0.9,
        maxR: 1.9,
        maxWadiDistM: 250.0,
        wadiWeight: 0.85,
        plainWeight: 0.22
      }
    ]
  };

  function clamp(val, min, max) {
    if (!Number.isFinite(val)) return min;
    return val < min ? min : val > max ? max : val;
  }

  function hexToRgbLinear(hex) {
    var clean = String(hex || '#D4BA8E').replace('#', '');
    if (clean.length !== 6) clean = 'D4BA8E';
    var r = parseInt(clean.slice(0, 2), 16) / 255;
    var g = parseInt(clean.slice(2, 4), 16) / 255;
    var b = parseInt(clean.slice(4, 6), 16) / 255;
    function toLin(c) {
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return [
      Number(toLin(clamp(r, 0, 1)).toFixed(6)),
      Number(toLin(clamp(g, 0, 1)).toFixed(6)),
      Number(toLin(clamp(b, 0, 1)).toFixed(6))
    ];
  }

  function lerp(a, b, t) {
    var u = clamp(t, 0, 1);
    return a + (b - a) * u;
  }

  function lerpRgb(rgbA, rgbB, t) {
    return [
      Number(lerp(rgbA[0], rgbB[0], t).toFixed(6)),
      Number(lerp(rgbA[1], rgbB[1], t).toFixed(6)),
      Number(lerp(rgbA[2], rgbB[2], t).toFixed(6))
    ];
  }

  /**
   * דטרמיניסטי 32-bit PRNG (Mulberry32) למיקום שיחים וערוצי ואדי ללא רעש אקראי בלתי-הדיר
   */
  function mulberry32(seed) {
    var a = (Number(seed) | 0) >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * מחשב מצב אטמוספירי, תרמי, אלבדו וצבע קרקע לביומת הנגב ללא ערכי NaN.
   * @param {Object} params
   * @param {number} params.solarElevationDeg זווית גובה השמש במעלות (-90..90)
   * @param {number} params.hourLocal שעה מקומית (0..24)
   * @param {number} params.terrainElevM גובה טופוגרפי מעל פני הים במטרים
   * @param {number} params.wadiDistanceM מרחק אופקי מערוץ ואדי יבש במטרים
   * @param {number} [params.dayOfYear=327] יום בשנה (ברירת מחדל: 23 בנובמבר = 327)
   */
  function computeNegevBiomeState(params) {
    var p = params || {};
    var sunDeg = clamp(Number(p.solarElevationDeg ?? 35), -90, 90);
    var hour = ((Number(p.hourLocal ?? 12) % 24) + 24) % 24;
    if (!Number.isFinite(hour)) hour = 12;
    var elevM = clamp(Number(p.terrainElevM ?? 291), -430, 1200);
    var wadiDistM = clamp(Number(p.wadiDistanceM ?? 150), 0, 10000);
    var doy = clamp(Number(p.dayOfYear ?? 327), 1, 366);

    // גורם יום/שעת זהב/לילה לפי גובה השמש
    var dayFactor = clamp((sunDeg + 6) / 24, 0, 1);
    var goldenFactor = clamp(1 - Math.abs(sunDeg - 6) / 10, 0, 1);
    var highNoonFactor = clamp((sunDeg - 20) / 55, 0, 1);

    // חישוב אלבדו משטח לפי שילוב לס, גיר חשוף ברכסים וערוץ ואדי
    var ridgeExposure = clamp((elevM - 285) / 40, 0, 1);
    var wadiChannelFactor = clamp(1 - wadiDistM / 35, 0, 1);

    var baseSurfaceAlbedo = lerp(
      DEFAULT_LOOK.albedo.loess,
      DEFAULT_LOOK.albedo.limestone,
      ridgeExposure * 0.65
    );
    var effectiveAlbedo = lerp(
      baseSurfaceAlbedo,
      DEFAULT_LOOK.albedo.wadiBed,
      wadiChannelFactor * 0.8
    );

    // פיצוי חשיפה (EV) בשל אלבדו גבוה ביום מדברי והחזר אור קרקע חם
    var exposureEvOffset = Number(
      lerp(0.05, DEFAULT_LOOK.thermal.middayExposureEvOffset, highNoonFactor).toFixed(4)
    );
    var groundBounceIntensity = Number(
      (DEFAULT_LOOK.thermal.groundBounceDay * dayFactor * (effectiveAlbedo / 0.36)).toFixed(4)
    );

    // אובך מדברי קל באופק ודעיכת גובה מעל בקעת באר שבע
    var heightAboveBasin = Math.max(0, elevM - DEFAULT_LOOK.fog.baseElevM);
    var heightAtten = Math.exp(-heightAboveBasin / DEFAULT_LOOK.fog.falloffM);
    var fogBeta = Number(
      (lerp(DEFAULT_LOOK.fog.betaNight, DEFAULT_LOOK.fog.betaDay, dayFactor) * heightAtten).toFixed(7)
    );

    var dustDayLin = hexToRgbLinear(DEFAULT_LOOK.paletteHex.horizonDustDay);
    var dustGoldLin = hexToRgbLinear(DEFAULT_LOOK.paletteHex.horizonDustGolden);
    var nightHorizonLin = hexToRgbLinear(DEFAULT_LOOK.paletteHex.skyZenithNight);
    var dayHorizonMix = lerpRgb(dustDayLin, dustGoldLin, goldenFactor);
    var horizonLinearRgb = lerpRgb(nightHorizonLin, dayHorizonMix, clamp((sunDeg + 10) / 18, 0, 1));

    // מודל טמפרטורה יממתי והתקררות קרינתית לילית בנגב
    var summerWeight = 0.5 - 0.5 * Math.cos(((doy - 15) * 2 * Math.PI) / 365);
    var tMin = lerp(DEFAULT_LOOK.thermal.winterMinC, DEFAULT_LOOK.thermal.summerMinC, summerWeight);
    var tMax = lerp(DEFAULT_LOOK.thermal.winterPeakC, DEFAULT_LOOK.thermal.summerPeakC, summerWeight);
    // שיא חום סביב 14:30, מינימום קרינתי סביב 05:30 לפני זריחה
    var diurnalPhase = 0.5 - 0.5 * Math.cos(((hour - 5.5) * 2 * Math.PI) / 24);
    var ambientTempC = Number((lerp(tMin, tMax, diurnalPhase) - (elevM - 291) * 0.0065).toFixed(2));
    var radiativeCoolingActive = sunDeg < -2.0;

    // צבע קרקע משולב בליניאר
    var loessLin = hexToRgbLinear(DEFAULT_LOOK.paletteHex.loessBase);
    var limeLin = hexToRgbLinear(DEFAULT_LOOK.paletteHex.limestonePale);
    var wadiLin = hexToRgbLinear(DEFAULT_LOOK.paletteHex.wadiThalwegPebble);
    var terrainSoilLin = lerpRgb(
      lerpRgb(loessLin, limeLin, ridgeExposure * 0.6),
      wadiLin,
      wadiChannelFactor * 0.85
    );

    return {
      profileId: DEFAULT_LOOK.profileId,
      dayFactor: Number(dayFactor.toFixed(4)),
      goldenFactor: Number(goldenFactor.toFixed(4)),
      surfaceAlbedo: Number(effectiveAlbedo.toFixed(4)),
      exposureEvOffset: exposureEvOffset,
      groundBounceIntensity: groundBounceIntensity,
      fogBeta: fogBeta,
      mieTurbidity: Number(lerp(1.4, DEFAULT_LOOK.fog.mieTurbidityDay, dayFactor).toFixed(3)),
      horizonLinearRgb: horizonLinearRgb,
      terrainLinearRgb: terrainSoilLin,
      ambientTempC: ambientTempC,
      radiativeCoolingActive: radiativeCoolingActive,
      uBloomStr: Number(lerp(DEFAULT_LOOK.thermal.bloomNight, 0.22, dayFactor).toFixed(3))
    };
  }

  /**
   * מייצר פיזור צמחייה מדברית דלילה באריח ITM של 1 ק"מ (EPSG:2039) סביב ערוץ ואדי.
   * @param {Object} tileOpts
   * @param {number} tileOpts.tileE_km אינדקס אריח מזרח (למשל 180 עבור E=180,000)
   * @param {number} tileOpts.tileN_km אינדקס אריח צפון (למשל 572 עבור N=572,000)
   * @param {Array<[number,number]>} [tileOpts.wadiPolylineItm] קו שבר של ערוץ הוואדי ב-ITM
   * @param {number} [tileOpts.maxInstances=48] תקרת שיחים/עצים לאריח לשמירת תקציב טלפון
   */
  function generateWadiFloraPlacements(tileOpts) {
    var opts = tileOpts || {};
    var tileE = Math.floor(Number(opts.tileE_km ?? 180));
    var tileN = Math.floor(Number(opts.tileN_km ?? 572));
    var maxCount = clamp(Math.floor(Number(opts.maxInstances ?? 48)), 0, 250);
    var wadiLine = Array.isArray(opts.wadiPolylineItm) ? opts.wadiPolylineItm : [];

    var seed = ((tileE * 73856093) ^ (tileN * 19349663)) >>> 0;
    var rand = mulberry32(seed);
    var originE = tileE * 1000;
    var originN = tileN * 1000;
    var placements = [];

    function distToWadiM(e, n) {
      if (wadiLine.length === 0) return 180.0;
      var bestSq = Infinity;
      for (var i = 0; i < wadiLine.length; i++) {
        var pt = wadiLine[i];
        var dx = e - Number(pt[0]);
        var dy = n - Number(pt[1]);
        var sq = dx * dx + dy * dy;
        if (sq < bestSq) bestSq = sq;
        if (i + 1 < wadiLine.length) {
          var pt2 = wadiLine[i + 1];
          var vx = Number(pt2[0]) - Number(pt[0]);
          var vy = Number(pt2[1]) - Number(pt[1]);
          var lenSq = vx * vx + vy * vy;
          if (lenSq > 0.01) {
            var proj = clamp(((e - pt[0]) * vx + (n - pt[1]) * vy) / lenSq, 0, 1);
            var px = pt[0] + proj * vx;
            var py = pt[1] + proj * vy;
            var segSq = (e - px) * (e - px) + (n - py) * (n - py);
            if (segSq < bestSq) bestSq = segSq;
          }
        }
      }
      return Number.isFinite(bestSq) ? Math.sqrt(bestSq) : 180.0;
    }

    var candidates = maxCount * 4;
    for (var c = 0; c < candidates && placements.length < maxCount; c++) {
      var e = originE + rand() * 1000;
      var n = originN + rand() * 1000;
      var dWadi = distToWadiM(e, n);
      var spIdx = Math.floor(rand() * DEFAULT_LOOK.species.length);
      var sp = DEFAULT_LOOK.species[spIdx];
      var prob = dWadi <= sp.maxWadiDistM ? sp.wadiWeight * (1 - dWadi / (sp.maxWadiDistM * 1.25)) : sp.plainWeight;
      if (rand() <= prob) {
        var h = lerp(sp.minH, sp.maxH, rand());
        var r = lerp(sp.minR, sp.maxR, rand());
        placements.push({
          speciesId: sp.id,
          nameHe: sp.nameHe,
          itmE: Number(e.toFixed(2)),
          itmN: Number(n.toFixed(2)),
          heightM: Number(h.toFixed(2)),
          crownRadiusM: Number(r.toFixed(2)),
          wadiDistanceM: Number(dWadi.toFixed(1)),
          rotationRad: Number((rand() * Math.PI * 2).toFixed(4))
        });
      }
    }
    return placements;
  }

  /**
   * מחיל את פרופיל הנגב על אובייקט העולם המאוחד (YZW / integration world) בצורה בטוחה.
   */
  function applyNegevLookToWorld(world, opts) {
    var state = computeNegevBiomeState(opts || {});
    if (world && typeof world === 'object') {
      world.biome = world.biome || {};
      if (world._prevCoastalBiome === undefined) {
        world._prevCoastalBiome = world.biome.active || 'coastal_ashdod';
        world._prevFogDensity = (world.fog && typeof world.fog === 'object') ? world.fog.density : null;
      }
      world.biome.active = 'negev_desert_v1';
      world.biome.state = state;
      world.biome.credits = '© OpenStreetMap contributors (ODbL 1.0)';
      if (world.fog && typeof world.fog === 'object') {
        world.fog.density = state.fogBeta;
      }
    }
    return state;
  }

  function disposeNegevLookFromWorld(world) {
    if (world && typeof world === 'object') {
      if (world.fog && typeof world.fog === 'object' && world._prevFogDensity !== null && world._prevFogDensity !== undefined) {
        world.fog.density = world._prevFogDensity;
      }
      if (world.biome && typeof world.biome === 'object') {
        world.biome.active = world._prevCoastalBiome || 'coastal_ashdod';
        delete world.biome.state;
      }
      delete world._prevCoastalBiome;
      delete world._prevFogDensity;
    }
  }

  return {
    DEFAULT_LOOK: DEFAULT_LOOK,
    disposeNegevLookFromWorld: disposeNegevLookFromWorld,
    hexToRgbLinear: hexToRgbLinear,
    computeNegevBiomeState: computeNegevBiomeState,
    generateWadiFloraPlacements: generateWadiFloraPlacements,
    applyNegevLookToWorld: applyNegevLookToWorld
  };
});
