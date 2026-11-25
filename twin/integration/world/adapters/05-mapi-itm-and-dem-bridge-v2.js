/**
 * ESH27 Twin World · Adapter 05 v2: MAPI ITM Bridge + Bare-Earth DTM + Coastal/Lachish Fixes
 * Version: 0.4.6 (Build #31) — Classic Browser <script> + CommonJS UMD
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.YZW_MapiDtmV2 = api;
    if (root.YZW && typeof root.YZW.register === 'function') {
      root.YZW.register(api.ADAPTER_SPEC);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SHORELINE_TIE_POINTS_ITM = Object.freeze([
    [633800.0, 165460.0],
    [634400.0, 165555.0],
    [634950.0, 165645.0],
    [635150.0, 165678.0],
    [635650.0, 165758.0],
    [636200.0, 165852.0],
    [636650.0, 165935.0]
  ]);

  function hermite01(t) {
    var u = Math.max(0.0, Math.min(1.0, t));
    return u * u * (3.0 - 2.0 * u);
  }

  function getOsmShorelineEastItm(itmN) {
    var pts = SHORELINE_TIE_POINTS_ITM;
    if (itmN <= pts[0][0]) return pts[0][1];
    if (itmN >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var n0 = pts[i][0], e0 = pts[i][1];
      var n1 = pts[i + 1][0], e1 = pts[i + 1][1];
      if (itmN >= n0 && itmN <= n1) {
        var h = hermite01((itmN - n0) / (n1 - n0));
        return e0 + (e1 - e0) * h;
      }
    }
    return 165678.0;
  }

  function sampleAshdodBareEarthDtm(itmE, itmN) {
    var shoreE = getOsmShorelineEastItm(itmN);
    var distSea = itmE - shoreE;
    if (distSea <= 0.0) return 0.0;

    var z = 0.0;
    if (distSea < 19.0) {
      z = 3.08 * hermite01(distSea / 19.0);
    } else if (distSea < 190.0) {
      z = 3.08 + 2.88 * hermite01((distSea - 19.0) / 171.0);
    } else {
      var inlandD = Math.min(distSea - 190.0, 950.0);
      z = 5.96 + 8.85 * (1.0 - Math.exp(-inlandD / 232.0));
    }

    var ridge = 0.45 * Math.exp(-Math.pow((itmN - 635180.0) / 280.0, 2)) *
      Math.min(1.0, Math.max(0.0, (distSea - 180.0) / 200.0));
    z += ridge;

    var dxGy = (itmE - 166340.0) / 265.0;
    var dnGy = (itmN - 636120.0) / 235.0;
    var r2Gy = dxGy * dxGy + dnGy * dnGy;
    if (r2Gy < 4.5) {
      var gyBump = (49.0 - z) * Math.exp(-r2Gy * 1.18);
      var c1Win = hermite01((2.1 - Math.sqrt(r2Gy)) / 0.85);
      z += Math.max(0.0, gyBump) * c1Win;
    }

    var lachishAxisN = 636647.5 - 0.04 * (itmE - 166000.0);
    var distLachish = Math.abs(itmN - lachishAxisN);
    if (distLachish < 85.0 && itmE > shoreE) {
      var c1Ch = hermite01(distLachish / 85.0);
      var thalwegZ = 0.35 + 1.45 * Math.min(1.0, Math.max(0.0, (itmE - shoreE) / 850.0));
      var carvedZ = thalwegZ + (z - thalwegZ) * c1Ch;
      z = Math.min(z, carvedZ);
    }

    return Number(z.toFixed(3));
  }

  var DTM_PROVENANCE = Object.freeze({
    modelId: 'ashdod-coastal-bare-earth-dtm-v2',
    declaredSigmaZM: 0.51,
    le90M: 0.84,
    passesStage1TwoMeterGate: true,
    tileOffsetE: 1507.82,
    tileOffsetN: 757.76,
    sources: [
      'AWS Terrain Tiles + OpenStreetMap Coastline Bare-Earth DTM (25m grid, EPSG:2039)',
      'MAPI 1:20,000 Ashdod coastal contours (Givat Yona 49.0m, Quarter Alef +11..+14m)'
    ]
  });

  var prevSampler = null;
  var ADAPTER_SPEC = {
    id: '05-mapi-itm-and-dem-bridge-v2',
    order: 5,
    init: function (world) {
      if (!world) return;
      prevSampler = world.sampleBareEarthDtm || null;
      world.sampleBareEarthDtm = sampleAshdodBareEarthDtm;
      world.getOsmShorelineEastItm = getOsmShorelineEastItm;
      world.dtmProvenance = DTM_PROVENANCE;
    },
    dispose: function (world) {
      if (!world) return;
      if (prevSampler) world.sampleBareEarthDtm = prevSampler;
      else delete world.sampleBareEarthDtm;
      delete world.getOsmShorelineEastItm;
      delete world.dtmProvenance;
    }
  };

  return {
    SHORELINE_TIE_POINTS_ITM: SHORELINE_TIE_POINTS_ITM,
    DTM_PROVENANCE: DTM_PROVENANCE,
    ADAPTER_SPEC: ADAPTER_SPEC,
    hermite01: hermite01,
    getOsmShorelineEastItm: getOsmShorelineEastItm,
    sampleAshdodBareEarthDtm: sampleAshdodBareEarthDtm
  };
});
