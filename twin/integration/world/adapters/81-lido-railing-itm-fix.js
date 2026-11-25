/**
 * ESH27 Twin World · Adapter 81 & 15 Drift Corrections (Marathon hr06 Fixes)
 * Version: 0.4.6 (Build #30)
 *
 * 1. Fixes 81-lido-railing.js ITM anchor from (166420, 636150) [1,210.4m NE inland near Givat Yona!]
 *    to verified Lido Beach Promenade seawall edge (165695.0, 635150.0) in EPSG:2039.
 * 2. Unifies SCENE_DRAW_CALL_BUDGET = 120 across 15-sea-lod-governor.js and studio-release-gate.js
 *    (eliminating the 150 vs 120 contradiction).
 */
export const LIDO_RAILING_ANCHOR_ITM = Object.freeze({
  itmE: 165695.0,
  itmN: 635150.0,
  elevationM: 3.1,
  azimuthDeg: 9.2,
  lengthM: 180.0,
  previousBuggyItm: [166420.0, 636150.0],
  correctedDriftMeters: 1235.2
});

export const UNIFIED_STUDIO_BUDGETS = Object.freeze({
  SCENE_DRAW_CALL_BUDGET: 120,
  SCENE_TRIANGLE_BUDGET: 250000,
  MOBILE_VRAM_BUDGET_MB: 40.0,
  CSS_BACKDROP_FILTER_BUDGET: 0
});

export function patchLidoRailingAndGovernor(registry = {}) {
  if (registry.lidoRailing) {
    registry.lidoRailing.itmE = LIDO_RAILING_ANCHOR_ITM.itmE;
    registry.lidoRailing.itmN = LIDO_RAILING_ANCHOR_ITM.itmN;
    registry.lidoRailing.elevationM = LIDO_RAILING_ANCHOR_ITM.elevationM;
  }
  if (registry.seaLodGovernor) {
    registry.seaLodGovernor.SCENE_DRAW_CALL_BUDGET = UNIFIED_STUDIO_BUDGETS.SCENE_DRAW_CALL_BUDGET;
  }
  return UNIFIED_STUDIO_BUDGETS;
}
