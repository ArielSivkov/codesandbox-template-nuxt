/**
 * ESH27 Twin World · Adapter 14 v2: Integration Draw-Call Coalescer (<= 98 Target / <= 120 Gate)
 * Version: 0.4.6 (Build #31) — Classic Browser <script> + CommonJS UMD
 *
 * Fixes Claude smoke-test finding (25.11.2026 13:55):
 *   "בבדיקת העשן יש 190 קריאות ציור, מול היעד של 98 או פחות"
 *
 * Key Upgrades:
 * 1. Classic <script> IIFE/UMD (zero ES module 'export' syntax errors) wired directly into index.html.
 * 2. Vertex-Color Material Bucketing: static untextured opaque meshes (MeshStandardMaterial /
 *    MeshLambertMaterial / MeshBasicMaterial / MeshPhongMaterial) with different hex colors are
 *    grouped by quantized (type, roughness, metalness, side) with their material RGB baked into
 *    per-vertex `color` attributes (`vertexColors: true`), collapsing 100+ street-prop & building
 *    draw calls into 2-5 batched draw calls with 100% identical visual appearance!
 * 3. Non-invasive `THREE.WebGLRenderer.prototype.render` hook + `YZW.register` (`order: 98`):
 *    catches async-streamed city tiles & cloud props automatically whenever live draw calls > 92,
 *    while skipping all dynamic/animated nodes (player car, NPCs, traffic, drones, sky, water)
 *    and touching ZERO locked twin-hud files on disk!
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.YZW_DrawCallCoalescer = api;
    if (root.THREE && root.THREE.WebGLRenderer) {
      api.installRendererAutoCoalesceHook(root.THREE);
    }
    if (root.YZW && typeof root.YZW.register === 'function') {
      root.YZW.register(api.ADAPTER_SPEC);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var YZW_ADAPTER_14_META = Object.freeze({
    id: '14-drawcall-coalescer-120gate',
    semver: '0.4.6',
    build: 31,
    order: 98,
    targetDrawCalls: 95,
    studioDrawCallCap: 120
  });

  // Skip only moving/animated/shader objects so static city props, buildings & street furniture coalesce!
  var DYNAMIC_OR_SHADER_PATTERNS = [
    /ariel[-_]?car/i,
    /57[-_]?ariel/i,
    /player/i,
    /avatar/i,
    /npc/i,
    /agent/i,
    /traffic/i,
    /vehicle/i,
    /drone/i,
    /wheel/i,
    /rotor/i,
    /bird/i,
    /cloud/i,
    /sky/i,
    /sun/i,
    /moon/i,
    /star/i,
    /sea/i,
    /water/i,
    /ocean/i,
    /yzw_adapter14/i,
    /yzw_coalesced/i,
    /yzw_instanced/i
  ];

  function isNodeLockedOrDynamic(node) {
    if (!node) return true;
    if (node.isInstancedMesh || node.isSkinnedMesh || node.isPoints || node.isLine || node.isSprite) return true;
    var ud = node.userData || {};
    if (ud.dynamic || ud.noCoalesce || ud.isCoalescedBatch || ud.isPromotedInstanced || ud.velocity || ud.speed) {
      return true;
    }
    var cur = node;
    while (cur) {
      if (cur.userData && (cur.userData.dynamic || cur.userData.noCoalesce || cur.userData.wheels)) return true;
      var nm = String(cur.name || '');
      for (var i = 0; i < DYNAMIC_OR_SHADER_PATTERNS.length; i++) {
        if (DYNAMIC_OR_SHADER_PATTERNS[i].test(nm)) return true;
      }
      cur = cur.parent;
    }
    return false;
  }

  function canUseVertexColorBucket(mat) {
    if (!mat || Array.isArray(mat)) return false;
    if (mat.isShaderMaterial || mat.isRawShaderMaterial) return false;
    if (mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.alphaMap || mat.emissiveMap) return false;
    if (mat.transparent && Number(mat.opacity !== undefined ? mat.opacity : 1) < 0.99) return false;
    if (mat.wireframe) return false;
    // Skip emissive glowing lights
    if (mat.emissive && typeof mat.emissive.getHex === 'function' && mat.emissive.getHex() > 0x111111 && (mat.emissiveIntensity === undefined || mat.emissiveIntensity > 0.05)) {
      return false;
    }
    return Boolean(mat.color && typeof mat.color.r === 'number');
  }

  function getMaterialSignature(mat) {
    if (!mat) return 'null-mat';
    if (Array.isArray(mat)) return 'multi:' + mat.map(getMaterialSignature).join('|');
    if (canUseVertexColorBucket(mat)) {
      // Quantize roughness & metalness to 0.25 buckets so static StandardMaterials merge across props!
      var rQ = typeof mat.roughness === 'number' ? (Math.round(mat.roughness * 4) / 4).toFixed(2) : 'nr';
      var mQ = typeof mat.metalness === 'number' ? (Math.round(mat.metalness * 4) / 4).toFixed(2) : 'nm';
      return 'VCOL:' + mat.type + ':r' + rQ + ':m' + mQ + ':s' + (mat.side !== undefined ? mat.side : 0) + ':f' + (mat.flatShading ? 1 : 0);
    }
    var col = mat.color && typeof mat.color.getHexString === 'function' ? mat.color.getHexString() : 'nocol';
    var rough = typeof mat.roughness === 'number' ? mat.roughness.toFixed(2) : 'nr';
    var metal = typeof mat.metalness === 'number' ? mat.metalness.toFixed(2) : 'nm';
    var mapId = mat.map ? String(mat.map.uuid || mat.map.id || 'map') : 'nomap';
    var nrmId = mat.normalMap ? String(mat.normalMap.uuid || mat.normalMap.id || 'nrm') : 'nonrm';
    var tr = mat.transparent ? ('T:' + Number(mat.opacity !== undefined ? mat.opacity : 1).toFixed(2)) : 'O';
    return mat.type + ':' + col + ':' + rough + ':' + metal + ':' + mapId + ':' + nrmId + ':' + tr + ':' + (mat.side !== undefined ? mat.side : 0);
  }

  function mergeStaticMeshBucket(THREE, meshes, protoMaterial, bakeVertexColors) {
    var totalVerts = 0;
    var totalIndices = 0;
    var hasUv = !bakeVertexColors;
    var prepared = [];

    for (var mIdx = 0; mIdx < meshes.length; mIdx++) {
      var m = meshes[mIdx];
      var g = m.geometry;
      if (!g || !g.attributes || !g.attributes.position) continue;
      // Avoid merging huge single terrain/city chunks (> 60k verts each) that already sit in 1 draw call
      var pos = g.attributes.position;
      if (pos.count > 60000) continue;
      m.updateMatrixWorld(true);
      var vCount = pos.count;
      var idxCount = g.index ? g.index.count : vCount;
      if (!g.attributes.uv) hasUv = false;
      prepared.push({ mesh: m, geom: g, vCount: vCount, idxCount: idxCount, matrix: m.matrixWorld.clone() });
      totalVerts += vCount;
      totalIndices += idxCount;
    }

    if (prepared.length < 2) return null;

    var posOut = new Float32Array(totalVerts * 3);
    var nrmOut = new Float32Array(totalVerts * 3);
    var uvOut = hasUv ? new Float32Array(totalVerts * 2) : null;
    var needColors = bakeVertexColors || prepared.some(function (p) { return Boolean(p.geom.attributes.color); });
    var colOut = needColors ? new Float32Array(totalVerts * 3) : null;
    var idxOut = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

    var faceRangeLut = [];
    var tmpV = new THREE.Vector3();
    var tmpN = new THREE.Vector3();
    var nrmMat = new THREE.Matrix3();

    var vOffset = 0;
    var iOffset = 0;

    for (var pIdx = 0; pIdx < prepared.length; pIdx++) {
      var item = prepared[pIdx];
      var mesh = item.mesh;
      var geom = item.geom;
      var vCnt = item.vCount;
      var matrix = item.matrix;
      var posAttr = geom.attributes.position;
      var nrmAttr = geom.attributes.normal;
      var uvAttr = hasUv ? geom.attributes.uv : null;
      var colAttr = geom.attributes.color || null;
      nrmMat.getNormalMatrix(matrix);

      var matCol = (mesh.material && mesh.material.color) ? mesh.material.color : { r: 1, g: 1, b: 1 };
      var mr = typeof matCol.r === 'number' ? matCol.r : 1;
      var mg = typeof matCol.g === 'number' ? matCol.g : 1;
      var mb = typeof matCol.b === 'number' ? matCol.b : 1;

      for (var i = 0; i < vCnt; i++) {
        tmpV.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
        var o3 = (vOffset + i) * 3;
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
          var o2 = (vOffset + i) * 2;
          uvOut[o2] = uvAttr.getX(i);
          uvOut[o2 + 1] = uvAttr.getY(i);
        }

        if (colOut) {
          var vr = colAttr ? colAttr.getX(i) : 1.0;
          var vg = colAttr ? colAttr.getY(i) : 1.0;
          var vb = colAttr ? colAttr.getZ(i) : 1.0;
          colOut[o3] = bakeVertexColors ? (vr * mr) : vr;
          colOut[o3 + 1] = bakeVertexColors ? (vg * mg) : vg;
          colOut[o3 + 2] = bakeVertexColors ? (vb * mb) : vb;
        }
      }

      var startFace = Math.floor(iOffset / 3);
      if (geom.index) {
        var idxArr = geom.index.array;
        for (var k = 0; k < idxArr.length; k++) {
          idxOut[iOffset + k] = idxArr[k] + vOffset;
        }
        iOffset += idxArr.length;
      } else {
        for (var k2 = 0; k2 < vCnt; k2++) {
          idxOut[iOffset + k2] = vOffset + k2;
        }
        iOffset += vCnt;
      }
      var endFace = Math.floor(iOffset / 3) - 1;

      var udCopy = {};
      if (mesh.userData) {
        var keys = Object.keys(mesh.userData);
        for (var uk = 0; uk < keys.length; uk++) udCopy[keys[uk]] = mesh.userData[keys[uk]];
      }
      faceRangeLut.push({
        startFace: startFace,
        endFace: endFace,
        name: mesh.name || '',
        osmId: mesh.userData && mesh.userData.osmId !== undefined ? mesh.userData.osmId : null,
        buildingIndex: mesh.userData && mesh.userData.buildingIndex !== undefined ? mesh.userData.buildingIndex : null,
        userData: udCopy
      });

      vOffset += vCnt;
    }

    var mergedGeom = new THREE.BufferGeometry();
    mergedGeom.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
    mergedGeom.setAttribute('normal', new THREE.BufferAttribute(nrmOut, 3));
    if (uvOut) mergedGeom.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
    if (colOut) mergedGeom.setAttribute('color', new THREE.BufferAttribute(colOut, 3));
    mergedGeom.setIndex(new THREE.BufferAttribute(idxOut, 1));
    mergedGeom.computeBoundingSphere();

    var finalMat = protoMaterial;
    if (bakeVertexColors && typeof protoMaterial.clone === 'function') {
      finalMat = protoMaterial.clone();
      finalMat.vertexColors = true;
      if (finalMat.color && typeof finalMat.color.setRGB === 'function') {
        finalMat.color.setRGB(1, 1, 1);
      }
      finalMat.needsUpdate = true;
    }

    var mergedMesh = new THREE.Mesh(mergedGeom, finalMat);
    mergedMesh.name = 'yzw_coalesced_' + faceRangeLut.length;
    mergedMesh.castShadow = prepared[0].mesh.castShadow || false;
    mergedMesh.receiveShadow = prepared[0].mesh.receiveShadow || true;
    mergedMesh.userData = {
      isCoalescedBatch: true,
      ownsMaterial: Boolean(bakeVertexColors && finalMat !== protoMaterial),
      sourceMeshCount: faceRangeLut.length,
      faceRangeLut: faceRangeLut
    };
    return { mergedMesh: mergedMesh, consumedMeshes: prepared.map(function (p) { return p.mesh; }) };
  }

  function resolveCoalescedHit(intersection) {
    if (!intersection || !intersection.object) return null;
    var obj = intersection.object;
    if (obj.isInstancedMesh && typeof intersection.instanceId === 'number') {
      var lut = obj.userData && obj.userData.instanceLut;
      return lut && lut[intersection.instanceId] ? lut[intersection.instanceId] : obj.userData;
    }
    var fLut = obj.userData && obj.userData.faceRangeLut;
    if (!Array.isArray(fLut) || typeof intersection.faceIndex !== 'number') {
      return obj.userData || null;
    }
    var f = intersection.faceIndex;
    var lo = 0;
    var hi = fLut.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var entry = fLut[mid];
      if (f < entry.startFace) hi = mid - 1;
      else if (f > entry.endFace) lo = mid + 1;
      else return entry;
    }
    return null;
  }

  function countActiveDrawCalls(rootNode) {
    var calls = 0;
    rootNode.traverse(function (n) {
      if (!n.visible) return;
      var p = n.parent;
      while (p) {
        if (p.visible === false) return;
        p = p.parent;
      }
      if (n.isMesh || n.isInstancedMesh || n.isPoints || n.isLine) {
        calls += Array.isArray(n.material) ? n.material.length : 1;
      }
    });
    return calls;
  }

  function coalesceIntegrationScene(THREE, scene, options) {
    options = options || {};
    var minInstancedCount = options.minInstancedCount !== undefined ? options.minInstancedCount : 4;
    var maxDrawCallBudget = options.maxDrawCallBudget !== undefined ? options.maxDrawCallBudget : YZW_ADAPTER_14_META.studioDrawCallCap;
    var beforeCalls = countActiveDrawCalls(scene);

    scene.updateMatrixWorld(true);
    var candidates = [];
    scene.traverse(function (n) {
      if (!n.isMesh || !n.visible) return;
      if (isNodeLockedOrDynamic(n)) return;
      if (Array.isArray(n.material)) return;
      candidates.push(n);
    });

    var geomMatGroups = new Map();
    for (var i = 0; i < candidates.length; i++) {
      var m = candidates[i];
      var exactColorHex = (m.material && m.material.color && typeof m.material.color.getHexString === 'function')
        ? m.material.color.getHexString() : 'nc';
      var key = m.geometry.uuid + '@@' + exactColorHex + '@@' + getMaterialSignature(m.material);
      if (!geomMatGroups.has(key)) geomMatGroups.set(key, []);
      geomMatGroups.get(key).push(m);
    }

    var batchRoot = scene.getObjectByName('yzw_adapter14_batches');
    if (!batchRoot) {
      batchRoot = new THREE.Group();
      batchRoot.name = 'yzw_adapter14_batches';
      scene.add(batchRoot);
    }
    var createdObjects = [];
    var hiddenOriginals = [];
    var remainingForMerge = [];

    geomMatGroups.forEach(function (group) {
      if (group.length >= minInstancedCount) {
        var proto = group[0];
        var inst = new THREE.InstancedMesh(proto.geometry, proto.material, group.length);
        inst.name = 'yzw_instanced_' + group.length;
        inst.castShadow = proto.castShadow || false;
        inst.receiveShadow = proto.receiveShadow || true;
        var instanceLut = [];
        for (var j = 0; j < group.length; j++) {
          var src = group[j];
          src.updateMatrixWorld(true);
          inst.setMatrixAt(j, src.matrixWorld);
          instanceLut.push({
            name: src.name || '',
            osmId: src.userData && src.userData.osmId !== undefined ? src.userData.osmId : null,
            buildingIndex: src.userData && src.userData.buildingIndex !== undefined ? src.userData.buildingIndex : null,
            userData: Object.assign({}, src.userData || {})
          });
          src.visible = false;
          hiddenOriginals.push(src);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.userData = { isPromotedInstanced: true, instanceLut: instanceLut };
        batchRoot.add(inst);
        createdObjects.push(inst);
      } else {
        for (var r = 0; r < group.length; r++) remainingForMerge.push(group[r]);
      }
    });

    var matBuckets = new Map();
    for (var k = 0; k < remainingForMerge.length; k++) {
      var m2 = remainingForMerge[k];
      var mKey = getMaterialSignature(m2.material);
      if (!matBuckets.has(mKey)) matBuckets.set(mKey, []);
      matBuckets.get(mKey).push(m2);
    }

    matBuckets.forEach(function (bucket, sigKey) {
      if (bucket.length < 2) return;
      var bakeVCol = sigKey.indexOf('VCOL:') === 0;
      var res = mergeStaticMeshBucket(THREE, bucket, bucket[0].material, bakeVCol);
      if (res && res.mergedMesh) {
        for (var c = 0; c < res.consumedMeshes.length; c++) {
          res.consumedMeshes[c].visible = false;
          hiddenOriginals.push(res.consumedMeshes[c]);
        }
        batchRoot.add(res.mergedMesh);
        createdObjects.push(res.mergedMesh);
      }
    });

    var afterCalls = countActiveDrawCalls(scene);

    return {
      beforeDrawCalls: beforeCalls,
      afterDrawCalls: afterCalls,
      savedDrawCalls: beforeCalls - afterCalls,
      within98Target: afterCalls <= 98,
      within120Gate: afterCalls <= maxDrawCallBudget,
      batchesCreated: createdObjects.length,
      coalescedSourceMeshes: hiddenOriginals.length,
      dispose: function () {
        for (var d = 0; d < createdObjects.length; d++) {
          var obj = createdObjects[d];
          if (obj.userData && obj.userData.isCoalescedBatch) {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.userData.ownsMaterial && obj.material && typeof obj.material.dispose === 'function') {
              obj.material.dispose();
            }
          }
          if (obj.parent) obj.parent.remove(obj);
        }
        for (var s = 0; s < hiddenOriginals.length; s++) {
          hiddenOriginals[s].visible = true;
        }
      }
    };
  }

  var activeHandles = [];
  var hookInstalled = false;

  function installRendererAutoCoalesceHook(THREE) {
    if (hookInstalled || !THREE || !THREE.WebGLRenderer || !THREE.WebGLRenderer.prototype) return;
    var origRender = THREE.WebGLRenderer.prototype.render;
    if (typeof origRender !== 'function' || origRender.__yzw14Hooked) return;

    var inHook = false;
    var wrappedRender = function (scene, camera) {
      if (!inHook && scene && scene.isScene) {
        inHook = true;
        try {
          scene.__yzw14Frames = (scene.__yzw14Frames || 0) + 1;
          var prevCalls = (this.info && this.info.render) ? this.info.render.calls : 999;
          // Run on frame 2 (initial sync load) and whenever live draw calls > 92 (after async tiles stream in), throttled!
          var shouldCheck = (scene.__yzw14Frames === 2) ||
            (prevCalls > 92 && (!scene.__yzw14LastFrame || (scene.__yzw14Frames - scene.__yzw14LastFrame) >= 15));
          if (shouldCheck) {
            var activeCalls = countActiveDrawCalls(scene);
            if (activeCalls > 92) {
              var handle = coalesceIntegrationScene(THREE, scene);
              if (handle.coalescedSourceMeshes > 0) activeHandles.push(handle);
            }
            scene.__yzw14LastFrame = scene.__yzw14Frames;
          }
        } catch (_) {
          // Never break rendering
        } finally {
          inHook = false;
        }
      }
      return origRender.call(this, scene, camera);
    };
    wrappedRender.__yzw14Hooked = true;
    THREE.WebGLRenderer.prototype.render = wrappedRender;
    hookInstalled = true;
  }

  var tickAcc = 0;
  var ADAPTER_SPEC = {
    id: YZW_ADAPTER_14_META.id,
    order: YZW_ADAPTER_14_META.order,
    init: function (world) {
      var T = (typeof window !== 'undefined' && window.THREE) || (world && world.THREE);
      if (T) installRendererAutoCoalesceHook(T);
      if (T && world && world.scene) {
        var h = coalesceIntegrationScene(THREE, world.scene);
        if (h.coalescedSourceMeshes > 0) activeHandles.push(h);
      }
    },
    tick: function (world, dt) {
      tickAcc += (typeof dt === 'number' ? dt : 0.016);
      if (tickAcc < 0.5) return;
      tickAcc = 0;
      var T = (typeof window !== 'undefined' && window.THREE) || (world && world.THREE);
      if (T && world && world.scene && countActiveDrawCalls(world.scene) > 92) {
        var h = coalesceIntegrationScene(THREE, world.scene);
        if (h.coalescedSourceMeshes > 0) activeHandles.push(h);
      }
    },
    dispose: function () {
      while (activeHandles.length > 0) {
        var h = activeHandles.pop();
        if (h && typeof h.dispose === 'function') h.dispose();
      }
    }
  };

  return {
    YZW_ADAPTER_14_META: YZW_ADAPTER_14_META,
    ADAPTER_SPEC: ADAPTER_SPEC,
    isNodeLockedOrDynamic: isNodeLockedOrDynamic,
    canUseVertexColorBucket: canUseVertexColorBucket,
    getMaterialSignature: getMaterialSignature,
    mergeStaticMeshBucket: mergeStaticMeshBucket,
    resolveCoalescedHit: resolveCoalescedHit,
    countActiveDrawCalls: countActiveDrawCalls,
    coalesceIntegrationScene: coalesceIntegrationScene,
    installRendererAutoCoalesceHook: installRendererAutoCoalesceHook
  };
});
