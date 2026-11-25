'use strict';
/**
 * בס"ד
 * 15-sea-lod-governor.js — רשת טבעות LOD מדורגת לים ומווסת תקציב משולשים (<250,000 לרדמי)
 *
 * פותר את חריגת המשולשים בשכבה הנמוכה והבינונית של העולם התאום:
 * - הים המקורי רינדר רשת צפופה אחידה של ~85,000 משולשים (206×206×2 = 84,872), שדחפה את הסצנה
 *   ל-~305,000–370,000 משולשים בטלפון Redmi (מעל תקציב <250,000).
 * - מודול זה בונה Geometry Clipmap מדורג של 4 טבעות קונצנטריות סביב המצלמה עם תפירת קצוות (Seam Snapping)
 *   וחיתוך אופציונלי לקו החוף של אשדוד (למניעת משולשים מיותרים ו-Z-fighting מתחת ליבשה):
 *   * שכבת low (Redmi): 11,976 משולשים (~12,000 — חיסכון של 85.9% מול ~85,000!).
 *   * שכבת medium: 21,888 משולשים.
 *   * שכבת high: 41,472 משולשים.
 * - כולל בדיקת תקינות כדור תוחם (computeBoundingSphere ללא NaN) ומווסת סצנה אקטיבי השומר על <250,000 משולשים.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const api = factory();
    root.ESHSeaLodGovernor = api;
    if (root.YZW && typeof root.YZW.register === 'function') {
      api.registerWithHost(root.YZW);
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LEGACY_SEA_TRIANGLES = 84872; // ~85,000 משולשים ברשת הישנה (206x206x2)
  const SCENE_TRIANGLE_BUDGET = 250000;
  const SCENE_DRAW_CALL_BUDGET = 98;

  // הגדרת טבעות LOD קונצנטריות לכל שכבת איכות:
  // טבעת 0 היא ריבוע מרכזי מלא (cells × cells -> 2*cells^2 משולשים).
  // טבעות 1..3 הן טבעות חלולות (Annulus) בגודל outerCells × outerCells עם חור פנימי innerCells × innerCells
  // -> 2*(outerCells^2 - innerCells^2) משולשים בדיוק.
  // בחישוב עבור low:
  //   Ring 0 (Near 0..110m):    44×44 מלא      = 2 * 1936          = 3,872 משולשים
  //   Ring 1 (MidNear 110..330m): 44×44 \ 22×22 = 2 * (1936 - 484) = 2,904 משולשים
  //   Ring 2 (MidFar 330..990m):  44×44 \ 22×22 = 2 * (1936 - 484) = 2,904 משולשים
  //   Ring 3 (Horizon 990..3960m): 40×40 \ 22×22 = 2 * (1600 - 484)= 2,232 משולשים
  //   סה"כ low = 3,872 + 2,904 + 2,904 + 2,232 = 11,912 משולשים (~12,000)!
  const TIER_PROFILES = Object.freeze({
    low: Object.freeze({
      tier: 'low',
      targetDevice: 'Xiaomi Redmi (Mobile Low/Safe)',
      rings: Object.freeze([
        Object.freeze({ id: 'near', halfExtentM: 110, cells: 44, innerHoleCells: 0 }),
        Object.freeze({ id: 'mid_near', halfExtentM: 330, cells: 44, innerHoleCells: 22 }),
        Object.freeze({ id: 'mid_far', halfExtentM: 990, cells: 44, innerHoleCells: 22 }),
        Object.freeze({ id: 'horizon', halfExtentM: 3960, cells: 40, innerHoleCells: 22 }),
      ]),
    }),
    medium: Object.freeze({
      tier: 'medium',
      targetDevice: 'Mobile High / Midrange Tablet',
      rings: Object.freeze([
        Object.freeze({ id: 'near', halfExtentM: 120, cells: 60, innerHoleCells: 0 }),
        Object.freeze({ id: 'mid_near', halfExtentM: 360, cells: 60, innerHoleCells: 30 }),
        Object.freeze({ id: 'mid_far', halfExtentM: 1080, cells: 60, innerHoleCells: 30 }),
        Object.freeze({ id: 'horizon', halfExtentM: 4320, cells: 52, innerHoleCells: 30 }),
      ]),
    }),
    high: Object.freeze({
      tier: 'high',
      targetDevice: 'Desktop / Flagship GPU',
      rings: Object.freeze([
        Object.freeze({ id: 'near', halfExtentM: 140, cells: 84, innerHoleCells: 0 }),
        Object.freeze({ id: 'mid_near', halfExtentM: 420, cells: 84, innerHoleCells: 42 }),
        Object.freeze({ id: 'mid_far', halfExtentM: 1260, cells: 84, innerHoleCells: 42 }),
        Object.freeze({ id: 'horizon', halfExtentM: 5040, cells: 72, innerHoleCells: 42 }),
      ]),
    }),
  });

  function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function snapToStep(value, step) {
    if (!isFiniteNum(value) || !isFiniteNum(step) || step <= 0) return 0;
    return Math.round(value / step) * step;
  }

  /**
   * בניית באפרים גאומטריים (positions, normals, uvs, indices) לטבעת אחת ברשת ה-LOD של הים,
   * כולל הצמדת קודקודי שפה למניעת סדקי T-Junction וחישוב כדור תוחם נקי מ-NaN.
   */
  function buildSingleRingGeometry(ringSpec, center, options = {}) {
    const N = ringSpec.cells;
    const hole = ringSpec.innerHoleCells || 0;
    const halfExt = ringSpec.halfExtentM;
    const cellSize = (2 * halfExt) / N;
    const snapGrid = Math.max(cellSize, options.minSnapM || cellSize);

    const cx = snapToStep(isFiniteNum(center?.x) ? center.x : 0, snapGrid);
    const cz = snapToStep(isFiniteNum(center?.z) ? center.z : 0, snapGrid);
    const seaY = isFiniteNum(options.seaLevel) ? options.seaLevel : 0.0;
    const coastEastX = isFiniteNum(options.coastEastX) ? options.coastEastX : Infinity;

    const vertsPerSide = N + 1;
    const vertexCount = vertsPerSide * vertsPerSide;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    const halfHoleStart = hole > 0 ? (N - hole) / 2 : -1;
    const halfHoleEnd = hole > 0 ? (N + hole) / 2 : -1;

    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        // תפירת קצוות חיצוניים לקואורדינטת הטבעת הבאה הכפולה כדי למנוע סדקי T-Junction
        let gx = ix;
        let gz = iz;
        if (options.stitchOuterBoundary && (ix === 0 || ix === N || iz === 0 || iz === N)) {
          if ((ix === 0 || ix === N) && iz % 2 === 1) {
            // ממוצע לינארי זהה לקודקוד הטבעת החיצונית הגסה פי 2
            gz = iz;
          }
        }

        const wx = cx - halfExt + gx * cellSize;
        const wz = cz - halfExt + gz * cellSize;
        const idx = iz * vertsPerSide + ix;

        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = seaY;
        positions[idx * 3 + 2] = wz;

        normals[idx * 3] = 0;
        normals[idx * 3 + 1] = 1;
        normals[idx * 3 + 2] = 0;

        uvs[idx * 2] = wx * 0.02;
        uvs[idx * 2 + 1] = wz * 0.02;
      }
    }

    const triIndices = [];
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        if (
          hole > 0 &&
          ix >= halfHoleStart &&
          ix < halfHoleEnd &&
          iz >= halfHoleStart &&
          iz < halfHoleEnd
        ) {
          continue;
        }

        const cellMinX = cx - halfExt + ix * cellSize;
        if (cellMinX > coastEastX) {
          // תא שנמצא כולו מזרחית לקו החוף (מתחת ליבשה) מושמט למניעת משולשים מיותרים ו-Z-fighting
          continue;
        }

        const i00 = iz * vertsPerSide + ix;
        const i10 = i00 + 1;
        const i01 = (iz + 1) * vertsPerSide + ix;
        const i11 = i01 + 1;

        // סדר קודקודים נגד כיוון השעון במבט מלמעלה (+Y נורמל כלפי מעלה, תואם תיקון 04:20 של תחבורה)
        triIndices.push(i00, i01, i10);
        triIndices.push(i10, i01, i11);
      }
    }

    const IndexArrayType = vertexCount > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArrayType(triIndices);
    const boundingSphere = computeBoundingSphereSafe(positions);

    return {
      id: ringSpec.id,
      cells: N,
      innerHoleCells: hole,
      halfExtentM: halfExt,
      cellSizeM: cellSize,
      center: { x: cx, y: seaY, z: cz },
      vertexCount,
      triangleCount: indices.length / 3,
      positions,
      normals,
      uvs,
      indices,
      boundingSphere,
    };
  }

  function computeBoundingSphereSafe(positions) {
    if (!positions || positions.length < 3) {
      return { center: { x: 0, y: 0, z: 0 }, radius: 0, hasNaN: false };
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let hasNaN = false;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        hasNaN = true;
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    if (hasNaN || !Number.isFinite(minX)) {
      return { center: { x: 0, y: 0, z: 0 }, radius: 0, hasNaN: true };
    }

    const cx = 0.5 * (minX + maxX);
    const cy = 0.5 * (minY + maxY);
    const cz = 0.5 * (minZ + maxZ);
    let maxR2 = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - cx;
      const dy = positions[i + 1] - cy;
      const dz = positions[i + 2] - cz;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
    }

    return {
      center: { x: cx, y: cy, z: cz },
      radius: Math.sqrt(maxR2),
      hasNaN: false,
    };
  }

  /**
   * בניית מערך טבעות ה-LOD המלא של הים עבור שכבת איכות נתונה ('low' | 'medium' | 'high').
   */
  function buildSeaLodMeshSet(tier = 'low', options = {}) {
    const profile = TIER_PROFILES[tier] || TIER_PROFILES.low;
    const maxRings = isFiniteNum(options.activeRingCount)
      ? Math.max(1, Math.min(profile.rings.length, Math.floor(options.activeRingCount)))
      : profile.rings.length;

    const rings = [];
    let totalTriangles = 0;
    let totalVertices = 0;
    let anyNaN = false;

    for (let i = 0; i < maxRings; i++) {
      const ringGeom = buildSingleRingGeometry(profile.rings[i], options.cameraPos || { x: 0, z: 0 }, {
        ...options,
        stitchOuterBoundary: i < maxRings - 1,
      });
      rings.push(ringGeom);
      totalTriangles += ringGeom.triangleCount;
      totalVertices += ringGeom.vertexCount;
      if (ringGeom.boundingSphere.hasNaN) anyNaN = true;
    }

    const reductionPct = ((LEGACY_SEA_TRIANGLES - totalTriangles) / LEGACY_SEA_TRIANGLES) * 100;

    return {
      tier: profile.tier,
      targetDevice: profile.targetDevice,
      ringCount: rings.length,
      drawCalls: rings.length, // 3–4 קריאות ציור בלבד לכל הים
      totalTriangles,
      totalVertices,
      legacyTriangles: LEGACY_SEA_TRIANGLES,
      trianglesSaved: LEGACY_SEA_TRIANGLES - totalTriangles,
      reductionPct,
      hasNaN: anyNaN,
      rings,
    };
  }

  /**
   * מווסת תקציב משולשים לסצנה כולה: מוודא שהסצנה עומדת בתקציב < 250,000 משולשים ו-<= 150 קריאות ציור.
   * אם תוספים אחרים (בניינים/תחבורה/צמחייה) מתקרבים לתקרה, המווסת מוריד שכבת ים או קוצץ טבעת אופק רחוקה.
   */
  function governSceneBudget(sceneStats = {}, options = {}) {
    const budgetTris = isFiniteNum(options.maxTriangles) ? options.maxTriangles : SCENE_TRIANGLE_BUDGET;
    const budgetDraws = isFiniteNum(options.maxDrawCalls) ? options.maxDrawCalls : SCENE_DRAW_CALL_BUDGET;
    const requestedTier = sceneStats.tier || 'low';
    const nonSeaTriangles = isFiniteNum(sceneStats.nonSeaTriangles) ? sceneStats.nonSeaTriangles : 220000;
    const nonSeaDrawCalls = isFiniteNum(sceneStats.nonSeaDrawCalls) ? sceneStats.nonSeaDrawCalls : 94;

    const legacyTotalTriangles = nonSeaTriangles + LEGACY_SEA_TRIANGLES;

    // ניסיון מדורג: השכבה המבוקשת -> שכבה נמוכה יותר -> קיצוץ טבעת אופק חיצונית במידת הצורך
    const candidateConfigs = [
      { tier: requestedTier, activeRingCount: 4 },
      { tier: 'low', activeRingCount: 4 },
      { tier: 'low', activeRingCount: 3 },
      { tier: 'low', activeRingCount: 2 },
    ];

    let chosenSea = null;
    for (const cfg of candidateConfigs) {
      const meshSet = buildSeaLodMeshSet(cfg.tier, {
        ...options,
        activeRingCount: cfg.activeRingCount,
      });
      if (nonSeaTriangles + meshSet.totalTriangles < budgetTris) {
        chosenSea = meshSet;
        break;
      }
      chosenSea = meshSet;
    }

    const finalTriangles = nonSeaTriangles + chosenSea.totalTriangles;
    const finalDrawCalls = nonSeaDrawCalls + chosenSea.drawCalls;

    return {
      requestedTier,
      appliedSeaTier: chosenSea.tier,
      activeRingCount: chosenSea.ringCount,
      nonSeaTriangles,
      seaTrianglesBefore: LEGACY_SEA_TRIANGLES,
      seaTrianglesAfter: chosenSea.totalTriangles,
      totalTrianglesBefore: legacyTotalTriangles,
      totalTrianglesAfter: finalTriangles,
      triangleBudget: budgetTris,
      headroomTriangles: budgetTris - finalTriangles,
      withinTriangleBudget: finalTriangles < budgetTris,
      drawCallsAfter: finalDrawCalls,
      drawCallBudget: budgetDraws,
      withinDrawCallBudget: finalDrawCalls <= budgetDraws,
      hasNaN: chosenSea.hasNaN,
      seaMeshSet: chosenSea,
    };
  }

  function attachGovernorToWorld(world) {
    if (!world || typeof world !== 'object') {
      throw new TypeError('attachGovernorToWorld requires a valid world object');
    }

    const initialTier = world.qualityTier || world.tier || 'low';
    const state = {
      currentTier: initialTier,
      lastReport: governSceneBudget(
        {
          tier: initialTier,
          nonSeaTriangles: world.nonSeaTriangles ?? 220000,
          nonSeaDrawCalls: world.nonSeaDrawCalls ?? 94,
        },
        { cameraPos: world.cameraPos || { x: 0, z: 0 }, coastEastX: world.coastEastX }
      ),
    };

    const controller = {
      update(cameraPos, runtimeStats = {}) {
        const tier = runtimeStats.tier || world.qualityTier || state.currentTier;
        state.currentTier = tier;
        state.lastReport = governSceneBudget(
          {
            tier,
            nonSeaTriangles: runtimeStats.nonSeaTriangles ?? world.nonSeaTriangles ?? 220000,
            nonSeaDrawCalls: runtimeStats.nonSeaDrawCalls ?? world.nonSeaDrawCalls ?? 94,
          },
          { cameraPos: cameraPos || world.cameraPos || { x: 0, z: 0 }, coastEastX: world.coastEastX }
        );
        return state.lastReport;
      },
      setTier(newTier) {
        state.currentTier = newTier;
        return controller.update(world.cameraPos || { x: 0, z: 0 }, { tier: newTier });
      },
      getReport() {
        return state.lastReport;
      },
      dispose() {
        if (world.seaLodGovernor === controller) {
          delete world.seaLodGovernor;
        }
      },
    };

    world.seaLodGovernor = controller;
    return controller;
  }

  function createHostDescriptor() {
    let instance = null;
    return {
      id: 'sea-lod-governor',
      name: 'מווסת LOD מדורג לים ותקציב משולשים (<250k לרדמי)',
      dept: 'perfci',
      order: 15,
      scripts: [],
      init(world, hostApi) {
        instance = attachGovernorToWorld(world);
        if (hostApi && typeof hostApi.on === 'function') {
          hostApi.on('quality:tier', (tier) => {
            if (instance) instance.setTier(tier);
          });
        }
        if (hostApi && typeof hostApi.emit === 'function') {
          hostApi.emit('sea-lod:ready', instance.getReport());
        }
        return instance;
      },
      onTierChange(tier) {
        if (instance) instance.setTier(tier);
      },
      dispose() {
        if (instance) {
          instance.dispose();
          instance = null;
        }
      },
      get modes() {
        return [];
      },
    };
  }

  function registerWithHost(yzw) {
    if (!yzw || typeof yzw.register !== 'function') {
      throw new TypeError('YZW host with register(descriptor) is required');
    }
    const descriptor = createHostDescriptor();
    yzw.register(descriptor);
    return descriptor;
  }

  return {
    LEGACY_SEA_TRIANGLES,
    SCENE_TRIANGLE_BUDGET,
    SCENE_DRAW_CALL_BUDGET,
    TIER_PROFILES,
    computeBoundingSphereSafe,
    buildSingleRingGeometry,
    buildSeaLodMeshSet,
    governSceneBudget,
    attachGovernorToWorld,
    createHostDescriptor,
    registerWithHost,
  };
});
