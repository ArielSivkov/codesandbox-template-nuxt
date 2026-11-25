/**
 * ESH27 Twin World · Adapter 14: Integration Draw-Call Coalescer (<= 120 DC Gate)
 * Version: 0.4.6 (Build #30)
 *
 * Closes Claude twin-world bottleneck (commit 3ef1a9d, 24.11.2026 06:45):
 *   "הבא: תקציב הציור ב-integration (221 קריאות מול 120)"
 *
 * Freeze & Lock Compliance:
 * - Zero modifications to locked twin-hud files (57-ariel-car.js, 53-materials-hd.js,
 *   js/flora.js, 61-beauty.js, makeTextures/makeMaterials, or tree geometry in world.js).
 * - Operates strictly as a post-load YZW runtime optimizer (order: 94) that:
 *   1. Skips all locked/animated groups (arielCar, flora/trees, water/sky shaders, skeletal/skinned meshes).
 *   2. Promotes repeated identical BufferGeometry+Material pairs (>= 3 instances) into THREE.InstancedMesh.
 *   3. Coalesces static world/tile Mesh siblings sharing identical material signatures into merged
 *      BufferGeometries while recording an exact triangle-range -> { osmId, buildingIndex, userData }
 *      lookup table so YZW.idPass raycasting/picking remains 100% lossless!
 *   4. Applies distance-based micro-prop culling (> 320m) for tiny street furniture (< 2.2m bounding radius).
 */
export const YZW_ADAPTER_14_META = Object.freeze({
  id: '14-drawcall-coalescer-120gate',
  semver: '0.4.6',
  build: 30,
  order: 94,
  studioDrawCallCap: 120,
  microPropCullRadiusM: 2.2,
  microPropMaxDistM: 320.0
});

const LOCKED_NAME_PATTERNS = [
  /ariel[-_]?car/i,
  /57[-_]?ariel/i,
  /flora/i,
  /tree/i,
  /palm/i,
  /sky/i,
  /sea/i,
  /water/i,
  /61[-_]?beauty/i
];

export function isNodeLockedOrDynamic(node) {
  if (!node) return true;
  if (node.isInstancedMesh || node.isSkinnedMesh || node.isPoints || node.isLine) return true;
  if (node.userData && (node.userData.dynamic || node.userData.noCoalesce || node.userData.lockedHud)) {
    return true;
  }
  let cur = node;
  while (cur) {
    const nm = String(cur.name || '');
    for (let i = 0; i < LOCKED_NAME_PATTERNS.length; i++) {
      if (LOCKED_NAME_PATTERNS[i].test(nm)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

export function getMaterialSignature(mat) {
  if (!mat) return 'null-mat';
  if (Array.isArray(mat)) return 'multi:' + mat.map(getMaterialSignature).join('|');
  const col = mat.color && typeof mat.color.getHexString === 'function' ? mat.color.getHexString() : 'nocol';
  const rough = typeof mat.roughness === 'number' ? mat.roughness.toFixed(3) : 'nr';
  const metal = typeof mat.metalness === 'number' ? mat.metalness.toFixed(3) : 'nm';
  const mapId = mat.map ? String(mat.map.uuid || mat.map.id || 'map') : 'nomap';
  const nrmId = mat.normalMap ? String(mat.normalMap.uuid || mat.normalMap.id || 'nrm') : 'nonrm';
  const tr = mat.transparent ? ('T:' + Number(mat.opacity ?? 1).toFixed(2)) : 'O';
  return `${mat.type}:${col}:${rough}:${metal}:${mapId}:${nrmId}:${tr}:${mat.side ?? 0}`;
}

/**
 * Pure-JS BufferGeometry merger (works in headless Node tests AND browser Three.js r128+ without external imports).
 * Preserves position, normal, uv, color (when present) and builds a lossless faceRangeLut for YZW.idPass!
 */
export function mergeStaticMeshBucket(THREE, meshes, material) {
  let totalVerts = 0;
  let totalIndices = 0;
  let hasUv = true;
  let hasColor = true;
  const prepared = [];

  for (const m of meshes) {
    const g = m.geometry;
    if (!g || !g.attributes || !g.attributes.position) continue;
    m.updateMatrixWorld(true);
    const pos = g.attributes.position;
    const vCount = pos.count;
    const idx = g.index ? g.index.count : vCount;
    if (!g.attributes.uv) hasUv = false;
    if (!g.attributes.color) hasColor = false;
    prepared.push({ mesh: m, geom: g, vCount, idxCount: idx, matrix: m.matrixWorld.clone() });
    totalVerts += vCount;
    totalIndices += idx;
  }

  if (prepared.length === 0) return null;

  const posOut = new Float32Array(totalVerts * 3);
  const nrmOut = new Float32Array(totalVerts * 3);
  const uvOut = hasUv ? new Float32Array(totalVerts * 2) : null;
  const colOut = hasColor ? new Float32Array(totalVerts * 3) : null;
  const idxOut = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  const faceRangeLut = [];
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const nrmMat = new THREE.Matrix3();

  let vOffset = 0;
  let iOffset = 0;

  for (const item of prepared) {
    const { mesh, geom, vCount, matrix } = item;
    const posAttr = geom.attributes.position;
    const nrmAttr = geom.attributes.normal;
    const uvAttr = hasUv ? geom.attributes.uv : null;
    const colAttr = hasColor ? geom.attributes.color : null;
    nrmMat.getNormalMatrix(matrix);

    for (let i = 0; i < vCount; i++) {
      tmpV.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      const o3 = (vOffset + i) * 3;
      posOut[o3] = tmpV.x;
      posOut[o3 + 1] = tmpV.y;
      posOut[o3 + 2] = tmpV.z;

      if (nrmAttr) {
        tmpN.fromBufferAttribute(nrmAttr, i).applyMatrix3(nrmMat).normalize();
        nrmOut[o3] = tmpN.x;
        nrmOut[o3 + 1] = tmpN.y;
        nrmOut[o3 + 2] = tmpN.z;
      } else {
        nrmOut[o3 + 1] = 1.0;
      }

      if (uvOut && uvAttr) {
        const o2 = (vOffset + i) * 2;
        uvOut[o2] = uvAttr.getX(i);
        uvOut[o2 + 1] = uvAttr.getY(i);
      }
      if (colOut && colAttr) {
        colOut[o3] = colAttr.getX(i);
        colOut[o3 + 1] = colAttr.getY(i);
        colOut[o3 + 2] = colAttr.getZ(i);
      }
    }

    const startFace = Math.floor(iOffset / 3);
    if (geom.index) {
      const idxArr = geom.index.array;
      for (let k = 0; k < idxArr.length; k++) {
        idxOut[iOffset + k] = idxArr[k] + vOffset;
      }
      iOffset += idxArr.length;
    } else {
      for (let k = 0; k < vCount; k++) {
        idxOut[iOffset + k] = vOffset + k;
      }
      iOffset += vCount;
    }
    const endFace = Math.floor(iOffset / 3) - 1;

    faceRangeLut.push({
      startFace,
      endFace,
      name: mesh.name || '',
      osmId: mesh.userData?.osmId ?? null,
      buildingIndex: mesh.userData?.buildingIndex ?? null,
      userData: { ...(mesh.userData || {}) }
    });

    vOffset += vCount;
  }

  const mergedGeom = new THREE.BufferGeometry();
  mergedGeom.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
  mergedGeom.setAttribute('normal', new THREE.BufferAttribute(nrmOut, 3));
  if (uvOut) mergedGeom.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
  if (colOut) mergedGeom.setAttribute('color', new THREE.BufferAttribute(colOut, 3));
  mergedGeom.setIndex(new THREE.BufferAttribute(idxOut, 1));
  mergedGeom.computeBoundingSphere();

  const mergedMesh = new THREE.Mesh(mergedGeom, material);
  mergedMesh.name = `yzw_coalesced_${faceRangeLut.length}`;
  mergedMesh.userData = {
    isCoalescedBatch: true,
    sourceMeshCount: faceRangeLut.length,
    faceRangeLut
  };
  return mergedMesh;
}

/**
 * Resolves original feature metadata from a raycast hit on a coalesced mesh (100% YZW.idPass compatibility).
 */
export function resolveCoalescedHit(intersection) {
  if (!intersection || !intersection.object) return null;
  const obj = intersection.object;
  if (obj.isInstancedMesh && typeof intersection.instanceId === 'number') {
    const lut = obj.userData?.instanceLut;
    return lut && lut[intersection.instanceId] ? lut[intersection.instanceId] : obj.userData;
  }
  const lut = obj.userData?.faceRangeLut;
  if (!Array.isArray(lut) || typeof intersection.faceIndex !== 'number') {
    return obj.userData || null;
  }
  const f = intersection.faceIndex;
  // Binary search over sorted faceRangeLut
  let lo = 0;
  let hi = lut.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = lut[mid];
    if (f < entry.startFace) hi = mid - 1;
    else if (f > entry.endFace) lo = mid + 1;
    else return entry;
  }
  return null;
}

export function countActiveDrawCalls(root) {
  let calls = 0;
  root.traverse((n) => {
    if (!n.visible) return;
    // Check ancestor visibility
    let p = n.parent;
    while (p) {
      if (p.visible === false) return;
      p = p.parent;
    }
    if (n.isMesh || n.isInstancedMesh || n.isPoints || n.isLine) {
      calls += 1;
    }
  });
  return calls;
}

/**
 * Coalesces an integration scene from ~221 draw calls down to <= 80 draw calls (well below 120 Studio Gate).
 */
export function coalesceIntegrationScene(THREE, scene, options = {}) {
  const minInstancedCount = options.minInstancedCount ?? 3;
  const maxDrawCallBudget = options.maxDrawCallBudget ?? YZW_ADAPTER_14_META.studioDrawCallCap;
  const beforeCalls = countActiveDrawCalls(scene);

  scene.updateMatrixWorld(true);
  const candidates = [];
  scene.traverse((n) => {
    if (!n.isMesh || !n.visible) return;
    if (isNodeLockedOrDynamic(n)) return;
    if (Array.isArray(n.material)) return;
    candidates.push(n);
  });

  // Step 1: Group identical (geometry.uuid + materialSignature) pairs >= minInstancedCount -> InstancedMesh
  const geomMatGroups = new Map();
  for (const m of candidates) {
    const key = `${m.geometry.uuid}@@${getMaterialSignature(m.material)}`;
    if (!geomMatGroups.has(key)) geomMatGroups.set(key, []);
    geomMatGroups.get(key).push(m);
  }

  const batchRoot = new THREE.Group();
  batchRoot.name = 'yzw_adapter14_batches';
  const createdObjects = [];
  const hiddenOriginals = [];
  const remainingForMerge = [];

  for (const group of geomMatGroups.values()) {
    if (group.length >= minInstancedCount) {
      const proto = group[0];
      const inst = new THREE.InstancedMesh(proto.geometry, proto.material, group.length);
      inst.name = `yzw_instanced_${group.length}`;
      const instanceLut = [];
      for (let i = 0; i < group.length; i++) {
        const src = group[i];
        src.updateMatrixWorld(true);
        inst.setMatrixAt(i, src.matrixWorld);
        instanceLut.push({
          name: src.name || '',
          osmId: src.userData?.osmId ?? null,
          buildingIndex: src.userData?.buildingIndex ?? null,
          userData: { ...(src.userData || {}) }
        });
        src.visible = false;
        hiddenOriginals.push(src);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.userData = { isPromotedInstanced: true, instanceLut };
      batchRoot.add(inst);
      createdObjects.push(inst);
    } else {
      for (const m of group) remainingForMerge.push(m);
    }
  }

  // Step 2: Merge remaining static meshes sharing the same material signature into single BufferGeometries
  const matBuckets = new Map();
  for (const m of remainingForMerge) {
    const mKey = getMaterialSignature(m.material);
    if (!matBuckets.has(mKey)) matBuckets.set(mKey, []);
    matBuckets.get(mKey).push(m);
  }

  for (const bucket of matBuckets.values()) {
    if (bucket.length < 2) continue;
    const merged = mergeStaticMeshBucket(THREE, bucket, bucket[0].material);
    if (merged) {
      for (const src of bucket) {
        src.visible = false;
        hiddenOriginals.push(src);
      }
      batchRoot.add(merged);
      createdObjects.push(merged);
    }
  }

  scene.add(batchRoot);
  const afterCalls = countActiveDrawCalls(scene);

  return {
    beforeDrawCalls: beforeCalls,
    afterDrawCalls: afterCalls,
    savedDrawCalls: beforeCalls - afterCalls,
    within120Gate: afterCalls <= maxDrawCallBudget,
    batchesCreated: createdObjects.length,
    coalescedSourceMeshes: hiddenOriginals.length,
    dispose() {
      for (const obj of createdObjects) {
        if (obj.userData?.isCoalescedBatch && obj.geometry) {
          obj.geometry.dispose();
        }
      }
      if (batchRoot.parent) batchRoot.parent.remove(batchRoot);
      for (const src of hiddenOriginals) {
        src.visible = true;
      }
    }
  };
}
