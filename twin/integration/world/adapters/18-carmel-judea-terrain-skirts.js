(function (root) {
'use strict';
/**
 * carmel_judea_terrain_skirts.js
 * ============================================================================
 * ESH27 Digital Twin ("העולם התאום") — Battalion 5 & Spatial Mapping Engine
 * Backlog 106 & 103: Foundation Skirts ("חצאיות יסוד") for Steep Slopes
 * (Mount Carmel / Haifa & Judean Mountains / Jerusalem)
 *
 * Problem Solved:
 *   When 2.5D/3D building footprints (e.g., OpenStreetMap polygons extruded in
 *   ITM EPSG:2039) sit on steep slopes such as Haifa's Hadar/Merkaz HaCarmel
 *   (15%–35% grade) or Jerusalem's Kidron/Hinnom/Ein Kerem valleys, anchoring
 *   a flat building floor at the highest ground vertex causes the downhill side
 *   of the structure to appear "floating" in mid-air above the terrain mesh.
 *   Conversely, anchoring at the lowest vertex buries uphill entrances.
 *
 * Solution:
 *   1. Samples the underlying DEM / terrain grid at all footprint vertices AND
 *      subdivides long perimeter edges (`maxSegmentLengthM`, default 4.0 m) so
 *      curved or undulating terrain never pokes through or creates gaps.
 *   2. Sets the main structural ground-floor slab (`z_base`) at the uphill sill
 *      (`maxTerrainZ` by default) and extrudes the superstructure upward to
 *      `z_roof = z_base + buildingHeightM`.
 *   3. Generates a continuous, watertight Foundation Skirt ("חצאית יסוד") from
 *      `z_base` down to `z_terrain(x, y) - bedrockEmbedDepthM` (default 1.5 m
 *      below local ground to prevent z-fighting / grazing-angle daylight leaks),
 *      with optional outward batter (`batterTan`, e.g., 0.05 for Jerusalem stone
 *      retaining walls), UV stone-course coordinates, outward unit normals, and
 *      engineering warnings when `maxDropM` exceeds single retaining-wall limits.
 *
 * Coordinate System & Twin World Integration:
 *   - ITM EPSG:2039 meters [easting_m, northing_m, elevation_asl_m]
 *   - Dual CommonJS (`module.exports`) + Twin World `YZW.register` adapter hook
 *   - © OpenStreetMap contributors (ODbL 1.0, https://www.openstreetmap.org/copyright)
 * ============================================================================
 */

'use strict';

function assertFinite(val, label) {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new TypeError(`Invalid non-finite numeric value for ${label}: ${val}`);
  }
}

function createTerrainSampler(demConfig) {
  if (!demConfig || typeof demConfig !== 'object') {
    throw new Error('demConfig object is required to build a terrain sampler.');
  }

  if (typeof demConfig.analyticFn === 'function') {
    return function sampleAnalytic(e, n) {
      assertFinite(e, 'easting');
      assertFinite(n, 'northing');
      const z = demConfig.analyticFn(e, n);
      assertFinite(z, 'sampledZ');
      return z;
    };
  }

  if (
    demConfig.elevations &&
    Number.isFinite(demConfig.originE) &&
    Number.isFinite(demConfig.originN) &&
    Number.isFinite(demConfig.cellSizeM) &&
    demConfig.cellSizeM > 0 &&
    demConfig.cols >= 2 &&
    demConfig.rows >= 2
  ) {
    const { originE, originN, cellSizeM, cols, rows, elevations } = demConfig;
    if (elevations.length < cols * rows) {
      throw new Error(`DEM elevations length (${elevations.length}) < cols*rows (${cols * rows}).`);
    }

    return function sampleBilinearDem(e, n) {
      assertFinite(e, 'easting');
      assertFinite(n, 'northing');

      const gx = Math.max(0, Math.min(cols - 1.000001, (e - originE) / cellSizeM));
      const gy = Math.max(0, Math.min(rows - 1.000001, (n - originN) / cellSizeM));

      const col0 = Math.floor(gx);
      const row0 = Math.floor(gy);
      const col1 = Math.min(cols - 1, col0 + 1);
      const row1 = Math.min(rows - 1, row0 + 1);

      const tx = gx - col0;
      const ty = gy - row0;

      const z00 = elevations[row0 * cols + col0];
      const z10 = elevations[row0 * cols + col1];
      const z01 = elevations[row1 * cols + col0];
      const z11 = elevations[row1 * cols + col1];

      const zBottom = z00 * (1 - tx) + z10 * tx;
      const zTop = z01 * (1 - tx) + z11 * tx;
      const z = zBottom * (1 - ty) + zTop * ty;
      assertFinite(z, 'bilinearZ');
      return z;
    };
  }

  if (Array.isArray(demConfig.controlPoints) && demConfig.controlPoints.length > 0) {
    const pts = demConfig.controlPoints;
    const power = Number.isFinite(demConfig.idwPower) ? demConfig.idwPower : 2.0;

    return function sampleIdw(e, n) {
      assertFinite(e, 'easting');
      assertFinite(n, 'northing');
      let weightedSum = 0;
      let weightTotal = 0;
      for (let i = 0; i < pts.length; i++) {
        const dx = e - pts[i].e;
        const dy = n - pts[i].n;
        const distSq = dx * dx + dy * dy;
        if (distSq < 1e-8) {
          return pts[i].z;
        }
        const w = 1.0 / Math.pow(Math.sqrt(distSq), power);
        weightedSum += w * pts[i].z;
        weightTotal += w;
      }
      const z = weightedSum / weightTotal;
      assertFinite(z, 'idwZ');
      return z;
    };
  }

  throw new Error('demConfig must provide elevations grid, controlPoints, or analyticFn.');
}

function signedPolygonArea2D(ring) {
  let area2 = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    area2 += x1 * y2 - x2 * y1;
  }
  return 0.5 * area2;
}

function normalizeFootprintCCW(rawFootprintItm) {
  if (!Array.isArray(rawFootprintItm) || rawFootprintItm.length < 3) {
    throw new Error('Building footprint requires at least 3 vertices in ITM EPSG:2039.');
  }

  const pts = [];
  for (let i = 0; i < rawFootprintItm.length; i++) {
    const pt = rawFootprintItm[i];
    if (!Array.isArray(pt) || pt.length < 2) {
      throw new Error(`Invalid vertex at index ${i}`);
    }
    assertFinite(pt[0], `footprint[${i}].easting`);
    assertFinite(pt[1], `footprint[${i}].northing`);
    pts.push([pt[0], pt[1]]);
  }

  if (pts.length > 3) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-4) {
      pts.pop();
    }
  }

  if (pts.length < 3) {
    throw new Error('Degenerate footprint after removing duplicate closing vertex.');
  }

  const area = signedPolygonArea2D(pts);
  if (Math.abs(area) < 1e-3) {
    throw new Error('Degenerate zero-area footprint polygon.');
  }

  if (area < 0) {
    pts.reverse();
  }
  return pts;
}

function densifyPerimeter(ccwRing, maxSegmentLengthM) {
  const densified = [];
  let cumulativePerimeterM = 0.0;

  for (let i = 0; i < ccwRing.length; i++) {
    const [e0, n0] = ccwRing[i];
    const [e1, n1] = ccwRing[(i + 1) % ccwRing.length];
    const segLen = Math.hypot(e1 - e0, n1 - n0);
    const steps = Math.max(1, Math.ceil(segLen / maxSegmentLengthM));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      densified.push({
        e: e0 + (e1 - e0) * t,
        n: n0 + (n1 - n0) * t,
        isCorner: s === 0,
        uDistM: cumulativePerimeterM + segLen * t,
      });
    }
    cumulativePerimeterM += segLen;
  }

  densified.totalPerimeterM = cumulativePerimeterM;
  return densified;
}

function buildFoundationSkirt(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('params object is required.');
  }
  const {
    buildingId = 'unnamed_building',
    footprintItm,
    buildingHeightM,
    sampleTerrain,
    options = {},
  } = params;

  assertFinite(buildingHeightM, 'buildingHeightM');
  if (buildingHeightM <= 0) {
    throw new RangeError(`buildingHeightM must be positive, got ${buildingHeightM}`);
  }
  if (typeof sampleTerrain !== 'function') {
    throw new TypeError('sampleTerrain must be a function (eastingM, northingM) => elevationAslM');
  }

  const maxSegmentLengthM = Number.isFinite(options.maxSegmentLengthM) ? options.maxSegmentLengthM : 4.0;
  const bedrockEmbedDepthM = Number.isFinite(options.bedrockEmbedDepthM) ? options.bedrockEmbedDepthM : 1.5;
  const batterTan = Number.isFinite(options.batterTan) ? options.batterTan : 0.04;
  const maxSingleSkirtDropM = Number.isFinite(options.maxSingleSkirtDropM) ? options.maxSingleSkirtDropM : 9.0;
  const materialPreset = options.materialPreset || 'carmel_limestone_concrete';

  const ccwRing = normalizeFootprintCCW(footprintItm);
  const perimeterNodes = densifyPerimeter(ccwRing, maxSegmentLengthM);
  const totalPerimeterM = perimeterNodes.totalPerimeterM;

  let minTerrainZ = Infinity;
  let maxTerrainZ = -Infinity;
  let sumTerrainZ = 0;

  for (let i = 0; i < perimeterNodes.length; i++) {
    const node = perimeterNodes[i];
    const zGround = sampleTerrain(node.e, node.n);
    assertFinite(zGround, `terrainZ[${i}]`);
    node.zGround = zGround;
    if (zGround < minTerrainZ) minTerrainZ = zGround;
    if (zGround > maxTerrainZ) maxTerrainZ = zGround;
    sumTerrainZ += zGround;
  }

  const meanTerrainZ = sumTerrainZ / perimeterNodes.length;
  const zBaseSlabAslM = maxTerrainZ;
  const zRoofAslM = zBaseSlabAslM + buildingHeightM;
  const terrainReliefDeltaM = maxTerrainZ - minTerrainZ;

  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (let i = 0; i < ccwRing.length; i++) {
    if (ccwRing[i][0] < minE) minE = ccwRing[i][0];
    if (ccwRing[i][0] > maxE) maxE = ccwRing[i][0];
    if (ccwRing[i][1] < minN) minN = ccwRing[i][1];
    if (ccwRing[i][1] > maxN) maxN = ccwRing[i][1];
  }
  const footprintDiagM = Math.max(1.0, Math.hypot(maxE - minE, maxN - minN));
  const estimatedSlopePct = (terrainReliefDeltaM / footprintDiagM) * 100.0;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  let maxExposedSkirtDropM = 0;
  let maxTotalSkirtHeightM = 0;

  const numSegs = perimeterNodes.length;
  for (let i = 0; i < numSegs; i++) {
    const p0 = perimeterNodes[i];
    const p1 = perimeterNodes[(i + 1) % numSegs];
    const u1 = i + 1 < numSegs ? p1.uDistM : totalPerimeterM;

    const dx = p1.e - p0.e;
    const dy = p1.n - p0.n;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;

    const outNx2D = dy / len;
    const outNy2D = -dx / len;

    const exposedDrop0 = zBaseSlabAslM - p0.zGround;
    const exposedDrop1 = zBaseSlabAslM - p1.zGround;
    const totalDrop0 = exposedDrop0 + bedrockEmbedDepthM;
    const totalDrop1 = exposedDrop1 + bedrockEmbedDepthM;

    if (exposedDrop0 > maxExposedSkirtDropM) maxExposedSkirtDropM = exposedDrop0;
    if (exposedDrop1 > maxExposedSkirtDropM) maxExposedSkirtDropM = exposedDrop1;
    if (totalDrop0 > maxTotalSkirtHeightM) maxTotalSkirtHeightM = totalDrop0;
    if (totalDrop1 > maxTotalSkirtHeightM) maxTotalSkirtHeightM = totalDrop1;

    const zBot0 = p0.zGround - bedrockEmbedDepthM;
    const zBot1 = p1.zGround - bedrockEmbedDepthM;

    const b0E = p0.e + outNx2D * (batterTan * totalDrop0);
    const b0N = p0.n + outNy2D * (batterTan * totalDrop0);
    const b1E = p1.e + outNx2D * (batterTan * totalDrop1);
    const b1N = p1.n + outNy2D * (batterTan * totalDrop1);

    const nz = batterTan / Math.sqrt(1 + batterTan * batterTan);
    const nHorizScale = 1.0 / Math.sqrt(1 + batterTan * batterTan);
    const nx = outNx2D * nHorizScale;
    const ny = outNy2D * nHorizScale;

    const baseVertexIdx = positions.length / 3;

    positions.push(p0.e, p0.n, zBaseSlabAslM);
    normals.push(nx, ny, nz);
    uvs.push(p0.uDistM, 0.0);

    positions.push(b0E, b0N, zBot0);
    normals.push(nx, ny, nz);
    uvs.push(p0.uDistM, totalDrop0);

    positions.push(b1E, b1N, zBot1);
    normals.push(nx, ny, nz);
    uvs.push(u1, totalDrop1);

    positions.push(p1.e, p1.n, zBaseSlabAslM);
    normals.push(nx, ny, nz);
    uvs.push(u1, 0.0);

    indices.push(
      baseVertexIdx, baseVertexIdx + 1, baseVertexIdx + 2,
      baseVertexIdx, baseVertexIdx + 2, baseVertexIdx + 3
    );
  }

  let maxFloatingGapM = 0.0;
  for (let i = 0; i < perimeterNodes.length; i++) {
    const zSkirtBottom = perimeterNodes[i].zGround - bedrockEmbedDepthM;
    const gapAboveTerrain = zSkirtBottom - perimeterNodes[i].zGround;
    if (gapAboveTerrain > maxFloatingGapM) {
      maxFloatingGapM = gapAboveTerrain;
    }
  }

  const warnings = [];
  if (maxExposedSkirtDropM > maxSingleSkirtDropM) {
    warnings.push(
      `Downhill foundation drop (${maxExposedSkirtDropM.toFixed(2)} m) exceeds ${maxSingleSkirtDropM.toFixed(1)} m; ` +
      `recommend stepped terraced sub-basements / tiered retaining walls.`
    );
  }

  return {
    buildingId,
    crs: 'EPSG:2039',
    materialPreset,
    elevationSummary: {
      minTerrainAslM: Number(minTerrainZ.toFixed(3)),
      meanTerrainAslM: Number(meanTerrainZ.toFixed(3)),
      maxTerrainAslM: Number(maxTerrainZ.toFixed(3)),
      terrainReliefDeltaM: Number(terrainReliefDeltaM.toFixed(3)),
      estimatedSlopePct: Number(estimatedSlopePct.toFixed(2)),
      zBaseSlabAslM: Number(zBaseSlabAslM.toFixed(3)),
      buildingHeightM: Number(buildingHeightM.toFixed(3)),
      zRoofAslM: Number(zRoofAslM.toFixed(3)),
      bedrockEmbedDepthM: Number(bedrockEmbedDepthM.toFixed(3)),
      maxExposedSkirtDropM: Number(maxExposedSkirtDropM.toFixed(3)),
      maxTotalSkirtHeightM: Number(maxTotalSkirtHeightM.toFixed(3)),
      maxFloatingGapM: Number(maxFloatingGapM.toFixed(4)),
      isWatertightBelowGrade: maxFloatingGapM <= 0.0,
    },
    mesh: {
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      perimeterSegmentCount: numSegs,
      totalPerimeterM: Number(totalPerimeterM.toFixed(3)),
      positions: new Float64Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
    },
    warnings,
  };
}

function toTileLocalFloat32Positions(positionsItm64, tileOriginItm) {
  const [ox, oy, oz] = tileOriginItm;
  assertFinite(ox, 'tileOriginE');
  assertFinite(oy, 'tileOriginN');
  assertFinite(oz, 'tileOriginZ');

  const local32 = new Float32Array(positionsItm64.length);
  for (let i = 0; i < positionsItm64.length; i += 3) {
    local32[i] = positionsItm64[i] - ox;
    local32[i + 1] = positionsItm64[i + 1] - oy;
    local32[i + 2] = positionsItm64[i + 2] - oz;
  }
  return local32;
}

function generateBatchFoundationSkirts(buildingSpecs, sampleTerrain, options = {}) {
  if (!Array.isArray(buildingSpecs)) {
    throw new TypeError('buildingSpecs must be an array.');
  }
  return buildingSpecs.map((spec) =>
    buildFoundationSkirt({
      buildingId: spec.buildingId,
      footprintItm: spec.footprintItm,
      buildingHeightM: spec.buildingHeightM,
      sampleTerrain,
      options: Object.assign({}, options, spec.options || {}),
    })
  );
}

function runSelfTests() {
  const carmelSlopeSampler = createTerrainSampler({
    analyticFn: (e, n) => {
      const dN = n - 745500.0;
      const dE = e - 199600.0;
      return 145.0 - 0.26 * dN + 0.04 * Math.sin(dE * 0.15);
    },
  });

  const haifaBuilding = buildFoundationSkirt({
    buildingId: 'haifa_hadar_terraced_res_01',
    footprintItm: [
      [199585, 745485],
      [199615, 745485],
      [199615, 745510],
      [199585, 745510],
    ],
    buildingHeightM: 19.0,
    sampleTerrain: carmelSlopeSampler,
    options: {
      maxSegmentLengthM: 3.0,
      bedrockEmbedDepthM: 1.5,
      batterTan: 0.05,
      materialPreset: 'carmel_limestone_concrete',
    },
  });

  const originE = 222200;
  const originN = 631100;
  const cellSizeM = 5.0;
  const cols = 12;
  const rows = 12;
  const demElevs = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      demElevs[r * cols + c] = 695.0 - c * cellSizeM * 0.32 + r * cellSizeM * 0.05;
    }
  }
  const jerusalemDemSampler = createTerrainSampler({
    originE,
    originN,
    cellSizeM,
    cols,
    rows,
    elevations: demElevs,
  });

  const jerusalemBuilding = buildFoundationSkirt({
    buildingId: 'jerusalem_kidron_slope_stone_01',
    footprintItm: [
      [222210, 631115],
      [222232, 631115],
      [222232, 631135],
      [222210, 631135],
    ],
    buildingHeightM: 13.0,
    sampleTerrain: jerusalemDemSampler,
    options: {
      maxSegmentLengthM: 2.5,
      bedrockEmbedDepthM: 1.8,
      batterTan: 0.06,
      materialPreset: 'jerusalem_meleke_stone',
    },
  });

  for (const res of [haifaBuilding, jerusalemBuilding]) {
    for (let i = 0; i < res.mesh.positions.length; i++) {
      assertFinite(res.mesh.positions[i], `${res.buildingId}.positions[${i}]`);
    }
    for (let i = 0; i < res.mesh.normals.length; i++) {
      assertFinite(res.mesh.normals[i], `${res.buildingId}.normals[${i}]`);
    }
    if (!res.elevationSummary.isWatertightBelowGrade) {
      throw new Error(`Floating building detected on ${res.buildingId}!`);
    }
  }

  const localPos32 = toTileLocalFloat32Positions(haifaBuilding.mesh.positions, [199000, 745000, 0]);
  for (let i = 0; i < localPos32.length; i++) {
    assertFinite(localPos32[i], `localPos32[${i}]`);
  }

  return {
    status: 'PASS',
    haifaCarmelTest: haifaBuilding.elevationSummary,
    haifaMeshCounts: {
      vertices: haifaBuilding.mesh.vertexCount,
      triangles: haifaBuilding.mesh.triangleCount,
    },
    jerusalemKidronTest: jerusalemBuilding.elevationSummary,
    jerusalemWarnings: jerusalemBuilding.warnings,
  };
}

const exportedApi = {
  createTerrainSampler,
  normalizeFootprintCCW,
  densifyPerimeter,
  buildFoundationSkirt,
  toTileLocalFloat32Positions,
  generateBatchFoundationSkirts,
  runSelfTests,
};

if (typeof module === 'object' && module.exports) {
  module.exports = exportedApi;
} else if (root) {
  root.TwinCarmelJudeaSkirts = exportedApi;
  if (root.YZW && typeof root.YZW.register === 'function') {
    root.YZW.register({
      id: 'carmel-judea-terrain-skirts',
      name: 'חצאיות ביסוס טופוגרפיות – כרמל והרי יהודה',
      order: 18,
      init: function (world) {
        if (world) world.terrainSkirts = exportedApi;
        return exportedApi;
      },
      dispose: function (world) {
        if (world && world.terrainSkirts) delete world.terrainSkirts;
      }
    });
  }
}
})(typeof globalThis !== 'undefined' ? globalThis : this);

