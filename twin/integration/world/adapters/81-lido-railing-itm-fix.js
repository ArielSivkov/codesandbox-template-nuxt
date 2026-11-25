/**
 * ESH27 Twin World · Adapter 81 & 15 Drift Corrections (Build #31) — Classic Browser <script> + UMD
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.YZW_LidoFix = api;
    if (root.YZW && typeof root.YZW.register === 'function') {
      root.YZW.register(api.ADAPTER_SPEC);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var LIDO_RAILING_ANCHOR_ITM = Object.freeze({
    itmE: 165695.0,
    itmN: 635150.0,
    elevationM: 3.1,
    azimuthDeg: 9.2,
    lengthM: 180.0
  });

  var UNIFIED_STUDIO_BUDGETS = Object.freeze({
    SCENE_DRAW_CALL_BUDGET: 98,
    STUDIO_RELEASE_GATE_CAP: 120,
    SCENE_TRIANGLE_BUDGET: 250000,
    MOBILE_VRAM_BUDGET_MB: 40.0,
    CSS_BACKDROP_FILTER_BUDGET: 0
  });

  function patchLidoRailingAndGovernor(registry) {
    registry = registry || {};
    if (registry.lidoRailing) {
      registry.lidoRailing.itmE = LIDO_RAILING_ANCHOR_ITM.itmE;
      registry.lidoRailing.itmN = LIDO_RAILING_ANCHOR_ITM.itmN;
      registry.lidoRailing.elevationM = LIDO_RAILING_ANCHOR_ITM.elevationM;
    }
    if (registry.seaLodGovernor) {
      registry.seaLodGovernor.SCENE_DRAW_CALL_BUDGET = UNIFIED_STUDIO_BUDGETS.STUDIO_RELEASE_GATE_CAP;
    }
    return UNIFIED_STUDIO_BUDGETS;
  }

  var ADAPTER_SPEC = {
    id: '81-lido-railing-itm-fix',
    order: 82,
    init: function (world) {
      if (!world) return;
      patchLidoRailingAndGovernor(world);
      if (world.scene && typeof world.scene.traverse === 'function') {
        world.scene.traverse(function (n) {
          if (n && /lido[-_]?railing/i.test(String(n.name || '')) && typeof world.placeITM === 'function') {
            world.placeITM(n, LIDO_RAILING_ANCHOR_ITM.itmE, LIDO_RAILING_ANCHOR_ITM.itmN, LIDO_RAILING_ANCHOR_ITM.elevationM);
          }
        });
      }
    },
    dispose: function () {}
  };

  return {
    LIDO_RAILING_ANCHOR_ITM: LIDO_RAILING_ANCHOR_ITM,
    UNIFIED_STUDIO_BUDGETS: UNIFIED_STUDIO_BUDGETS,
    ADAPTER_SPEC: ADAPTER_SPEC,
    patchLidoRailingAndGovernor: patchLidoRailingAndGovernor
  };
});
