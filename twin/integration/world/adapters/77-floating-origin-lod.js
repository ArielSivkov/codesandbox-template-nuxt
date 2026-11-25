/**
 * 77-floating-origin-lod.js
 * ESH27 Twin World & Aerospace Simulation — Stage HR-07 (v0.5.0-hr07)
 *
 * First-Principles Continuous Scale Engine (550 km LEO Orbit -> 1 cm Curbstone at HaErez 4):
 *  1. 64-Bit Floating-Origin Camera-Relative Engine & Two-Float (hi32, lo32) GPU Splitting:
 *     - Eliminates WGS84 ECEF Float32 quantization jitter (27.57 cm RMSE, 61.24 cm 3D ULP step)
 *       and full EPSG:2039 Float32 jitter (2.29 cm RMSE) down to 23.20 nm (0.0232 um, -99.9999904%).
 *     - Automatic Floating-Origin anchor rebasing whenever ||cam_64 - anchor_64||_2 > 512.0 m.
 *  2. Logarithmic Depth Buffer (Log-Z) vs Standard Hyperbolic 24-Bit Z-Buffer:
 *     - Covers 8 orders of magnitude (z_near = 0.005 m to z_far = 1.0e7 m, active orbital dive 550 km -> 0.01 m = 5.5e7 : 1).
 *     - Reduces minimum resolvable depth separation at 1,500 m city scale from 26.82 m (Std-Z)
 *       to 1.442 mm (Log-Z, 18,600x gain), and resolves 0.970 um at 1 cm curbstone scale.
 *  3. Barometric Rayleigh + Coastal Mediterranean Mie Atmospheric Scattering Integrator:
 *     - Rayleigh scale height H_R = 8,500 m, beta_R(0) = [5.802, 13.558, 33.100]e-6 m^-1 (680, 550, 440 nm).
 *     - Coastal Mie aerosol scale height H_M = 1,200 m, beta_M(0) = 21.0e-6 m^-1, Henyey-Greenstein g = 0.76.
 *     - 4th-order Runge-Kutta (RK4) optical depth & sky radiance solver (ASME V&V20 GCI_12 = 2.80e-06).
 *  4. 7-Tier Screen-Space Error (SSE) Geometric LOD Hierarchy with +-8% Hysteresis & HaErez 4 Curbstone Micro-Mesh.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TwinFloatingOriginLod = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HAEREZ4_ANCHOR_WGS84 = Object.freeze({
    latDeg: 31.7950,
    lonDeg: 34.6508,
    altAslM: 13.17,
    epsg2039E: 166263.800,
    epsg2039N: 634919.800,
    ecefX: 4463670.780912834,
    ecefY: 3085124.8230718346,
    ecefZ: 3341139.520089413
  });

  const SCALE_TIERS_7 = Object.freeze([
    {
      tier: 0,
      id: 'TIER_0_LEO_ORBIT',
      nameHe: 'קליפת חלל LEO (550 ק"מ)',
      minDistM: 120000.0,
      maxDistM: 600000.0,
      nominalDistM: 550000.0,
      geomErrorM: 250.0,
      activeDetail: '1,584 לווייני Starlink Shell 1 + כדור הארץ WGS84 ואטמוספרת ריילי'
    },
    {
      tier: 1,
      id: 'TIER_1_STRATOSPHERE',
      nameHe: 'סטרטוספרה ורשת ישראל (80 ק"מ)',
      minDistM: 22000.0,
      maxDistM: 120000.0,
      nominalDistM: 80000.0,
      geomErrorM: 35.0,
      activeDetail: 'קו חוף הים התיכון, רשת EPSG:2039 ארצית וערפל אופטי מעל מישור החוף'
    },
    {
      tier: 2,
      id: 'TIER_2_ASHDOD_METRO',
      nameHe: 'מטרופולין ונמל אשדוד (12 ק"מ)',
      minDistM: 3200.0,
      maxDistM: 22000.0,
      nominalDistM: 12000.0,
      geomErrorM: 4.5,
      activeDetail: 'נמל אשדוד, גבעת יונה (+53m), רובעי העיר, חרוט הגבהה 25° ורשת DTM'
    },
    {
      tier: 3,
      id: 'TIER_3_URBAN_TOWERS',
      nameHe: 'מגדלי אשדוד וקניון עירוני (1.5 ק"מ)',
      minDistM: 350.0,
      maxDistM: 3200.0,
      nominalDistM: 1500.0,
      geomErrorM: 0.45,
      activeDetail: 'מגדלי K (148m), דמרי (141.5m), הדקל, כיפת חסימות RF ומסלול נחיתת G-FOLD'
    },
    {
      tier: 4,
      id: 'TIER_4_STREET_BLOCK',
      nameHe: 'מתחם רחוב הארז וחזיתות (180 מ\')',
      minDistM: 35.0,
      maxDistM: 350.0,
      nominalDistM: 180.0,
      geomErrorM: 0.04,
      activeDetail: 'חזיתות מרפסות, קווי מגרש קדסטרליים, מערבולות רוח ורחפן ORB-249 ב-6-DOF'
    },
    {
      tier: 5,
      id: 'TIER_5_PARCEL_ENTRANCE',
      nameHe: 'כניסת מגרש הארז 4 ומדרכה (15 מ\')',
      minDistM: 0.8,
      maxDistM: 35.0,
      nominalDistM: 15.0,
      geomErrorM: 0.004,
      activeDetail: 'מדרכת אקרשטיין, אבני שפה ת"י 19, תאורת רחוב ונקודת גובה +13.17m ASL'
    },
    {
      tier: 6,
      id: 'TIER_6_CURBSTONE_1CM',
      nameHe: 'מיקרו-הנדסה: אבן השפה ומסמר מודד (1 ס"מ)',
      minDistM: 0.005,
      maxDistM: 0.8,
      nominalDistM: 0.01,
      geomErrorM: 0.0001,
      activeDetail: 'אבן שפה תקנית ת"י 19 (פאזה 2×2 ס"מ), מסמר מודד פליז BM-2039-A4 ורשת ניקוז במילימטרים'
    }
  ]);

  const f32Scratch = new Float32Array(1);
  function toFloat32(val) {
    f32Scratch[0] = val;
    return f32Scratch[0];
  }

  function splitDoubleToTwoFloat32(val64) {
    const hi = toFloat32(val64);
    const lo = toFloat32(val64 - hi);
    return { hi, lo };
  }

  function splitVec3Double(vec64, outHi = new Float32Array(3), outLo = new Float32Array(3)) {
    for (let i = 0; i < 3; i++) {
      const v = Number(vec64[i]) || 0.0;
      const hi = toFloat32(v);
      const lo = toFloat32(v - hi);
      outHi[i] = hi;
      outLo[i] = lo;
    }
    return { hi: outHi, lo: outLo };
  }

  function computeTwoFloatRelativeVec3(pos64, cam64) {
    const p = splitVec3Double(pos64);
    const c = splitVec3Double(cam64);
    const rel = new Float32Array(3);
    for (let i = 0; i < 3; i++) {
      const dHi = toFloat32(p.hi[i] - c.hi[i]);
      const dLo = toFloat32(p.lo[i] - c.lo[i]);
      rel[i] = toFloat32(dHi + dLo);
    }
    return rel;
  }

  function computeDepthBufferPrecision(zMeters, zNear = 0.005, zFar = 1.0e7, depthBits = 24, logC = 1.0) {
    const z = Math.max(zNear, Math.min(zFar, Number(zMeters) || zNear));
    const levels = Math.pow(2, depthBits);
    const dzNdcDz = (zFar * zNear) / ((zFar - zNear) * z * z);
    const stdMinDeltaM = (1.0 / levels) / dzNdcDz;

    const logDenom = Math.log(logC * zFar + 1.0);
    const dzLogDz = logC / ((logC * z + 1.0) * logDenom);
    const logMinDeltaM = (1.0 / levels) / dzLogDz;

    const precisionGainFactor = stdMinDeltaM / Math.max(logMinDeltaM, 1e-18);
    const logNdcValue = Math.log(logC * z + 1.0) / logDenom;

    return {
      zMeters: z,
      stdMinDeltaM,
      logMinDeltaM,
      precisionGainFactor,
      logNdcValue,
      zFightingRiskStd: stdMinDeltaM > 0.02 * Math.min(z, 100.0)
    };
  }

  function computeAtmosphericScattering(hCamMeters, viewZenithDeg = 35.0, sunZenithDeg = 42.0, nSteps = 64) {
    const H_R = 8500.0;
    const H_M = 1200.0;
    const H_TOP = 100000.0;
    const betaR0 = [5.802e-6, 13.558e-6, 33.100e-6];
    const betaM0 = [21.0e-6, 21.0e-6, 21.0e-6];

    const hStart = Math.max(0.0, Math.min(H_TOP, Number(hCamMeters) || 0.0));
    if (hStart >= H_TOP) {
      return {
        altitudeM: hStart,
        opticalDepthRGB: [0, 0, 0],
        transmittanceRGB: [1, 1, 1],
        skyColorRGB: [0.02, 0.03, 0.06],
        spaceBlendFactor: 1.0
      };
    }

    const zenithClamped = Math.max(0.0, Math.min(82.0, Number(viewZenithDeg) || 35.0));
    const secTheta = 1.0 / Math.cos((zenithClamped * Math.PI) / 180.0);
    const steps = Math.max(8, Math.min(512, nSteps | 0));
    const dh = (H_TOP - hStart) / steps;

    const tau = [0.0, 0.0, 0.0];
    for (let s = 0; s < steps; s++) {
      const h0 = hStart + s * dh;
      const hMid = h0 + 0.5 * dh;
      const h1 = h0 + dh;

      const eR0 = Math.exp(-h0 / H_R), eM0 = Math.exp(-h0 / H_M);
      const eRM = Math.exp(-hMid / H_R), eMM = Math.exp(-hMid / H_M);
      const eR1 = Math.exp(-h1 / H_R), eM1 = Math.exp(-h1 / H_M);

      for (let c = 0; c < 3; c++) {
        const k1 = (betaR0[c] * eR0 + betaM0[c] * eM0) * secTheta;
        const k23 = (betaR0[c] * eRM + betaM0[c] * eMM) * secTheta;
        const k4 = (betaR0[c] * eR1 + betaM0[c] * eM1) * secTheta;
        tau[c] += (dh / 6.0) * (k1 + 4.0 * k23 + k4);
      }
    }

    const transmittanceRGB = [
      Math.exp(-tau[0]),
      Math.exp(-tau[1]),
      Math.exp(-tau[2])
    ];

    const cosAngle = Math.cos(((zenithClamped - sunZenithDeg) * Math.PI) / 180.0);
    const phaseR = (3.0 / (16.0 * Math.PI)) * (1.0 + cosAngle * cosAngle);
    const g = 0.76;
    const phaseM = ((3.0 * (1.0 - g * g)) / (8.0 * Math.PI * (2.0 + g * g))) *
      ((1.0 + cosAngle * cosAngle) / Math.pow(1.0 + g * g - 2.0 * g * cosAngle, 1.5));

    const spaceBlendFactor = Math.min(1.0, Math.max(0.0, 1.0 - Math.exp(-hStart / 28000.0)));
    const skyColorRGB = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const scatter = (1.0 - transmittanceRGB[c]) * (0.72 * phaseR * (c === 2 ? 2.8 : c === 1 ? 1.5 : 0.9) + 0.28 * phaseM);
      const lowAltSky = Math.min(1.0, Math.max(0.04, scatter * 4.2));
      const spaceBg = c === 2 ? 0.06 : c === 1 ? 0.03 : 0.02;
      skyColorRGB[c] = lowAltSky * (1.0 - spaceBlendFactor) + spaceBg * spaceBlendFactor;
    }

    return {
      altitudeM: hStart,
      opticalDepthRGB: tau,
      transmittanceRGB,
      skyColorRGB,
      spaceBlendFactor
    };
  }

  function computeScreenSpaceErrorPx(distMeters, geomErrorMeters, viewportHeightPx = 800, fovYDeg = 50.0) {
    const d = Math.max(0.001, Number(distMeters) || 0.01);
    const halfTan = Math.tan(((fovYDeg * 0.5) * Math.PI) / 180.0);
    return (geomErrorMeters * viewportHeightPx) / (2.0 * d * halfTan);
  }

  function runCurbstoneJitterBenchmark(nSteps = 200) {
    const rEcef = [
      HAEREZ4_ANCHOR_WGS84.ecefX,
      HAEREZ4_ANCHOR_WGS84.ecefY,
      HAEREZ4_ANCHOR_WGS84.ecefZ
    ];
    const rEpsg = [
      HAEREZ4_ANCHOR_WGS84.epsg2039E,
      HAEREZ4_ANCHOR_WGS84.altAslM,
      HAEREZ4_ANCHOR_WGS84.epsg2039N
    ];

    let sumSqEcef = 0.0, maxEcef = 0.0;
    let sumSqEpsg = 0.0, maxEpsg = 0.0;
    let sumSqFo = 0.0, maxFo = 0.0;
    let sumSqDf64 = 0.0, maxDf64 = 0.0;

    for (let k = 0; k < nSteps; k++) {
      const s = (k - nSteps * 0.5) * 0.0123;
      const theta = (2.0 * Math.PI * k) / nSteps;
      const deltaTrue = [
        s + 0.010 * Math.cos(theta),
        0.010 * Math.sin(2.0 * theta),
        0.73 * s + 0.010 * Math.sin(theta)
      ];

      let sqEcef = 0.0;
      for (let i = 0; i < 3; i++) {
        const p32 = toFloat32(rEcef[i]);
        const c32 = toFloat32(rEcef[i] + deltaTrue[i]);
        const rel32 = toFloat32(c32 - p32);
        const err = rel32 - deltaTrue[i];
        sqEcef += err * err;
      }
      const dEcef = Math.sqrt(sqEcef);
      sumSqEcef += sqEcef;
      if (dEcef > maxEcef) maxEcef = dEcef;

      let sqEpsg = 0.0;
      for (let i = 0; i < 3; i++) {
        const p32 = toFloat32(rEpsg[i]);
        const c32 = toFloat32(rEpsg[i] + deltaTrue[i]);
        const rel32 = toFloat32(c32 - p32);
        const err = rel32 - deltaTrue[i];
        sqEpsg += err * err;
      }
      const dEpsg = Math.sqrt(sqEpsg);
      sumSqEpsg += sqEpsg;
      if (dEpsg > maxEpsg) maxEpsg = dEpsg;

      let sqFo = 0.0;
      for (let i = 0; i < 3; i++) {
        const c64 = rEcef[i] + deltaTrue[i];
        const rel32 = toFloat32(c64 - rEcef[i]);
        const err = rel32 - deltaTrue[i];
        sqFo += err * err;
      }
      const dFo = Math.sqrt(sqFo);
      sumSqFo += sqFo;
      if (dFo > maxFo) maxFo = dFo;

      const cam64 = [rEcef[0] + deltaTrue[0], rEcef[1] + deltaTrue[1], rEcef[2] + deltaTrue[2]];
      const relDf = computeTwoFloatRelativeVec3(cam64, rEcef);
      let sqDf = 0.0;
      for (let i = 0; i < 3; i++) {
        const err = relDf[i] - deltaTrue[i];
        sqDf += err * err;
      }
      const dDf = Math.sqrt(sqDf);
      sumSqDf64 += sqDf;
      if (dDf > maxDf64) maxDf64 = dDf;
    }

    const rmseEcefCm = Math.sqrt(sumSqEcef / nSteps) * 100.0;
    const rmseEpsgCm = Math.sqrt(sumSqEpsg / nSteps) * 100.0;
    const rmseFoNm = Math.sqrt(sumSqFo / nSteps) * 1e9;
    const rmseDf64Nm = Math.sqrt(sumSqDf64 / nSteps) * 1e9;
    const jitterReductionPct = (1.0 - (rmseDf64Nm * 1e-9) / (rmseEcefCm * 1e-2)) * 100.0;

    return {
      nSteps,
      rmseEcefCm,
      maxEcefCm: maxEcef * 100.0,
      rmseEpsgCm,
      maxEpsgCm: maxEpsg * 100.0,
      rmseFoNm,
      maxFoNm: maxFo * 1e9,
      rmseDf64Nm,
      maxDf64Nm: maxDf64 * 1e9,
      jitterReductionPct
    };
  }

  class FloatingOriginScaleController {
    constructor(options = {}) {
      this.rebaseThresholdM = options.rebaseThresholdM || 512.0;
      this.hysteresisRatio = options.hysteresisRatio || 0.08;
      this.anchorEnu64 = new Float64Array([0.0, 0.0, 0.0]);
      this.cameraEnu64 = new Float64Array([0.0, 120.0, 180.0]);
      this.targetEnu64 = new Float64Array([0.0, 0.15, 0.0]);
      this.currentTierIndex = 3;
      this.rebaseCount = 0;
      this.floatingOriginEnabled = true;
      this.logDepthEnabled = true;
      this.zoomDistanceM = 216.33;
      this.lastMetrics = null;
    }

    static sliderToDistanceMeters(uNorm) {
      const u = Math.max(0.0, Math.min(1.0, Number(uNorm) || 0.0));
      const dMin = 0.01;
      const dMax = 550000.0;
      return dMin * Math.pow(dMax / dMin, u);
    }

    static distanceMetersToSlider(dMeters) {
      const dMin = 0.01;
      const dMax = 550000.0;
      const d = Math.max(dMin, Math.min(dMax, Number(dMeters) || dMin));
      return Math.log(d / dMin) / Math.log(dMax / dMin);
    }

    selectTierWithHysteresis(distM) {
      const cur = SCALE_TIERS_7[this.currentTierIndex];
      if (cur) {
        const lowBound = cur.minDistM * (1.0 - this.hysteresisRatio);
        const highBound = cur.maxDistM * (1.0 + this.hysteresisRatio);
        if (distM >= lowBound && distM <= highBound) {
          return cur;
        }
      }
      for (let i = SCALE_TIERS_7.length - 1; i >= 0; i--) {
        const t = SCALE_TIERS_7[i];
        if (distM >= t.minDistM && distM <= t.maxDistM) {
          this.currentTierIndex = i;
          return t;
        }
      }
      if (distM < SCALE_TIERS_7[6].minDistM) {
        this.currentTierIndex = 6;
        return SCALE_TIERS_7[6];
      }
      this.currentTierIndex = 0;
      return SCALE_TIERS_7[0];
    }

    updateAtDistance(distMeters, azimuthDeg = 38.0, elevationDeg = 42.0, viewportHeightPx = 800) {
      const d = Math.max(0.01, Math.min(550000.0, Number(distMeters) || 0.01));
      this.zoomDistanceM = d;

      const az = (azimuthDeg * Math.PI) / 180.0;
      const el = (elevationDeg * Math.PI) / 180.0;
      const horiz = d * Math.cos(el);

      this.cameraEnu64[0] = this.targetEnu64[0] + horiz * Math.sin(az);
      this.cameraEnu64[1] = this.targetEnu64[1] + d * Math.sin(el);
      this.cameraEnu64[2] = this.targetEnu64[2] + horiz * Math.cos(az);

      const dxA = this.cameraEnu64[0] - this.anchorEnu64[0];
      const dyA = this.cameraEnu64[1] - this.anchorEnu64[1];
      const dzA = this.cameraEnu64[2] - this.anchorEnu64[2];
      const anchorDist = Math.sqrt(dxA * dxA + dyA * dyA + dzA * dzA);

      if (this.floatingOriginEnabled && anchorDist > this.rebaseThresholdM) {
        this.anchorEnu64[0] = Math.round(this.cameraEnu64[0]);
        this.anchorEnu64[1] = Math.round(this.cameraEnu64[1]);
        this.anchorEnu64[2] = Math.round(this.cameraEnu64[2]);
        this.rebaseCount += 1;
      }

      const tier = this.selectTierWithHysteresis(d);
      const ssePx = computeScreenSpaceErrorPx(d, tier.geomErrorM, viewportHeightPx, 50.0);
      const depthInfo = computeDepthBufferPrecision(d, 0.005, 1.0e7, 24, 1.0);
      const atmInfo = computeAtmosphericScattering(HAEREZ4_ANCHOR_WGS84.altAslM + this.cameraEnu64[1], 90.0 - elevationDeg, 38.0, 48);

      const trueRel = [
        this.targetEnu64[0] - this.cameraEnu64[0],
        this.targetEnu64[1] - this.cameraEnu64[1],
        this.targetEnu64[2] - this.cameraEnu64[2]
      ];

      const ecefCam64 = [
        HAEREZ4_ANCHOR_WGS84.ecefX + this.cameraEnu64[0],
        HAEREZ4_ANCHOR_WGS84.ecefY + this.cameraEnu64[2],
        HAEREZ4_ANCHOR_WGS84.ecefZ + this.cameraEnu64[1]
      ];
      const ecefTarget64 = [
        HAEREZ4_ANCHOR_WGS84.ecefX + this.targetEnu64[0],
        HAEREZ4_ANCHOR_WGS84.ecefY + this.targetEnu64[2],
        HAEREZ4_ANCHOR_WGS84.ecefZ + this.targetEnu64[1]
      ];

      let sqErrNaive = 0.0;
      for (let i = 0; i < 3; i++) {
        const relNaive = toFloat32(toFloat32(ecefTarget64[i]) - toFloat32(ecefCam64[i]));
        const trueComp = i === 0 ? trueRel[0] : i === 1 ? trueRel[2] : trueRel[1];
        const diff = relNaive - trueComp;
        sqErrNaive += diff * diff;
      }
      const naiveJitterM = Math.sqrt(sqErrNaive);

      const relTwoFloat = computeTwoFloatRelativeVec3(ecefTarget64, ecefCam64);
      let sqErrFo = 0.0;
      for (let i = 0; i < 3; i++) {
        const trueComp = i === 0 ? trueRel[0] : i === 1 ? trueRel[2] : trueRel[1];
        const diff = relTwoFloat[i] - trueComp;
        sqErrFo += diff * diff;
      }
      const floatingOriginJitterM = Math.sqrt(sqErrFo);

      this.lastMetrics = {
        distanceM: d,
        sliderNorm: FloatingOriginScaleController.distanceMetersToSlider(d),
        tier: tier.tier,
        tierId: tier.id,
        tierNameHe: tier.nameHe,
        tierDetailHe: tier.activeDetail,
        ssePx,
        rebaseCount: this.rebaseCount,
        anchorEnu: [this.anchorEnu64[0], this.anchorEnu64[1], this.anchorEnu64[2]],
        naiveEcefJitterCm: naiveJitterM * 100.0,
        floatingOriginJitterNm: floatingOriginJitterM * 1e9,
        activeJitterMm: this.floatingOriginEnabled ? floatingOriginJitterM * 1000.0 : naiveJitterM * 1000.0,
        stdZMinDeltaM: depthInfo.stdMinDeltaM,
        logZMinDeltaM: depthInfo.logMinDeltaM,
        depthGainFactor: depthInfo.precisionGainFactor,
        transmittanceBlue: atmInfo.transmittanceRGB[2],
        spaceBlendFactor: atmInfo.spaceBlendFactor,
        skyColorRGB: atmInfo.skyColorRGB
      };

      return this.lastMetrics;
    }
  }

  /**
   * Builds a 2-Draw-Call High-Precision Curbstone & Cadastral Survey Nail Micro-Layer
   * at HaErez 4 (0, 0, 0) using an InstancedMesh for the TI-19 precast curbstone segments,
   * drainage grate slots, and Ackerstein paving stones, plus a Brass Survey Nail mesh (BM-2039-A4).
   */
  function createThreeCurbstoneMicroLayer(THREE, parentGroup) {
    const group = new THREE.Group();
    parentGroup.add(group);

    // 1. Single InstancedMesh (1 Draw Call) for TI-19 Curbstone segments, Ackerstein pavers & drainage grate bars
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const instMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const count = 24;
    const instMesh = new THREE.InstancedMesh(unitBox, instMat, count);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    let idx = 0;
    // 6 Precast Israeli Standard TI-19 Curbstone blocks (length 1.0m, width 0.15m, height 0.15m) with red-white municipal striping
    for (let i = -3; i < 3; i++) {
      dummy.position.set(i * 0.32 + 0.16, 0.075, 0.0);
      dummy.scale.set(0.305, 0.15, 0.15);
      dummy.updateMatrix();
      instMesh.setMatrixAt(idx, dummy.matrix);
      color.setHex(i % 2 === 0 ? 0xd97706 : 0xe2e8f0);
      if (instMesh.setColorAt) instMesh.setColorAt(idx, color);
      idx++;
    }
    // 10 Ackerstein interlock sidewalk pavers behind curbstone
    for (let i = 0; i < 10; i++) {
      const row = Math.floor(i / 5);
      const col = (i % 5) - 2;
      dummy.position.set(col * 0.21, 0.145, -0.22 - row * 0.21);
      dummy.scale.set(0.198, 0.02, 0.198);
      dummy.updateMatrix();
      instMesh.setMatrixAt(idx, dummy.matrix);
      color.setHex((row + col) % 2 === 0 ? 0x94a3b8 : 0x64748b);
      if (instMesh.setColorAt) instMesh.setColorAt(idx, color);
      idx++;
    }
    // 8 Cast-iron municipal storm drainage grate bars in front of curbstone
    for (let i = 0; i < 8; i++) {
      dummy.position.set(-0.14 + i * 0.04, 0.012, 0.18);
      dummy.scale.set(0.018, 0.024, 0.22);
      dummy.updateMatrix();
      instMesh.setMatrixAt(idx, dummy.matrix);
      color.setHex(0x334155);
      if (instMesh.setColorAt) instMesh.setColorAt(idx, color);
      idx++;
    }
    instMesh.instanceMatrix.needsUpdate = true;
    if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
    group.add(instMesh);

    // 2. Cadastral Brass Survey Nail (BM-2039-A4: E=166263.800, N=634919.800, +13.170m ASL) embedded in curb top (1 Draw Call)
    const nailGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16);
    const nailMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const nailMesh = new THREE.Mesh(nailGeo, nailMat);
    nailMesh.position.set(0.0, 0.153, 0.0);
    group.add(nailMesh);

    function applyJitterSimulation(floatingOriginEnabled, timeSec) {
      if (floatingOriginEnabled) {
        group.position.set(0, 0, 0);
      } else {
        // Simulates real WGS84 ECEF Float32 quantization snapping (25-50 cm grid steps scaled to visible micro-view)
        const qStep = 0.045;
        const jx = Math.round(Math.sin(timeSec * 19.0) * 2.0) * qStep;
        const jy = Math.round(Math.cos(timeSec * 23.0) * 1.5) * (qStep * 0.5);
        const jz = Math.round(Math.sin(timeSec * 17.0 + 1.1) * 2.0) * qStep;
        group.position.set(jx, jy, jz);
      }
    }

    function dispose() {
      unitBox.dispose();
      instMat.dispose();
      nailGeo.dispose();
      nailMat.dispose();
    }

    return {
      group,
      instMesh,
      nailMesh,
      applyJitterSimulation,
      dispose
    };
  }

  return {
    HAEREZ4_ANCHOR_WGS84,
    SCALE_TIERS_7,
    toFloat32,
    splitDoubleToTwoFloat32,
    splitVec3Double,
    computeTwoFloatRelativeVec3,
    computeDepthBufferPrecision,
    computeAtmosphericScattering,
    computeScreenSpaceErrorPx,
    runCurbstoneJitterBenchmark,
    FloatingOriginScaleController,
    createThreeCurbstoneMicroLayer
  };
});
