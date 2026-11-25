(function () {
  'use strict';

  var MOBILE_MAX_TRIANGLES = 15000;

  // Dual-style character presets (Ariel's runtime choice: 'realistic' vs 'stylized')
  var AVATAR_STYLE_PROFILES = {
    realistic: {
      id: 'realistic',
      labelHe: 'מציאותי (MPFB2 CC0 + 100STYLE CC-BY-4.0)',
      license: 'CC0-1.0 + CC-BY-4.0',
      lodTriangles: { lod0: 11800, lod1: 5400, lod2: 1480 },
      lodDistancesM: [18, 55, 140],
      proportions: { heightM: 1.76, headRadius: 0.115, shoulderWidth: 0.44, torsoHeight: 0.56, legLength: 0.86 },
      materials: {
        skin: { color: 0xd8a98a, roughness: 0.68, metalness: 0.02 },
        shirt: { color: 0x243b55, roughness: 0.78, metalness: 0.05 },
        vest: { color: 0xe6a100, roughness: 0.55, metalness: 0.10 },
        pants: { color: 0x2b2d34, roughness: 0.85, metalness: 0.02 },
        helmet: { color: 0xf5f5f0, roughness: 0.32, metalness: 0.12 }
      }
    },
    stylized: {
      id: 'stylized',
      labelHe: 'מצויר (Quaternius + KayKit CC0)',
      license: 'CC0-1.0',
      lodTriangles: { lod0: 3600, lod1: 1850, lod2: 640 },
      lodDistancesM: [22, 65, 160],
      proportions: { heightM: 1.70, headRadius: 0.175, shoulderWidth: 0.48, torsoHeight: 0.50, legLength: 0.72 },
      materials: {
        skin: { color: 0xf4c29f, roughness: 0.48, metalness: 0.0 },
        shirt: { color: 0x1e88e5, roughness: 0.42, metalness: 0.0 },
        vest: { color: 0xffca28, roughness: 0.38, metalness: 0.0 },
        pants: { color: 0x37474f, roughness: 0.50, metalness: 0.0 },
        helmet: { color: 0xffffff, roughness: 0.25, metalness: 0.05 }
      }
    }
  };

  // 10 First Missions anchored in verified Ashdod EPSG:2039 coordinates + Luach HaYazam modules
  var ASHDOD_YAZAM_MISSIONS = [
    { id: 'M01', code: 'haerez4_morning_rollout', title: 'יציאת שחר מהארז 4 וכיול רכב הסיור', e: 166263.8, n: 634919.8, targetE: 166018.5, targetN: 635078.2, radiusM: 4.0, xp: 100, yazamGate: 'anchor_registered' },
    { id: 'M02', code: 'haerez_mapillary_blindspot_scan', title: 'סגירת החור העיוור ברחוב הארז–האורן', e: 166145.0, n: 635010.0, targetE: 166210.0, targetN: 635095.0, radiusM: 12.0, xp: 180, yazamGate: 'batch_scan_4_views' },
    { id: 'M03', code: 'givat_yona_lighthouse_triangulation', title: 'טריאנגולציית קו הרקיע מגבעת יונה (53 מ\')', e: 166617.1, n: 635832.2, targetE: 166611.5, targetN: 635818.8, radiusM: 10.0, xp: 220, yazamGate: 'horizon_3_locks' },
    { id: 'M04', code: 'hadekel_towers_solar_shadow_audit', title: 'בדיקת צל ת"י 5281 במגדלי הדקל', e: 166074.0, n: 634956.0, targetE: 166042.0, targetN: 635006.1, radiusM: 18.0, xp: 260, yazamGate: 'si5281_4h_winter_check' },
    { id: 'M05', code: 'haneviim_pinui_binui_standard21', title: 'פינוי-בינוי הנביאים 16–24: תקן 21 ו-66.67%', e: 166520.0, n: 634680.0, targetE: 166545.0, targetN: 634705.0, radiusM: 20.0, xp: 350, yazamGate: 'std21_17pct_and_66pct_signed' },
    { id: 'M06', code: 'rogozin_chess_club_3tier_boq', title: 'הצעת מחיר תלת-שכבתית במועדון השחמט ורוגוזין', e: 166340.0, n: 634945.0, targetE: 166315.0, targetN: 634910.0, radiusM: 10.0, xp: 280, yazamGate: 'boq_3tier_vat18' },
    { id: 'M07', code: 'ashdod_port_auto_rfq_logistics', title: 'רציף המכולות בנמל אשדוד: Auto-RFQ ומנוף', e: 166700.0, n: 636700.0, targetE: 166790.0, targetN: 636840.0, radiusM: 25.0, xp: 320, yazamGate: 'rfq_3suppliers_crane48h' },
    { id: 'M08', code: 'seaport_lachish_park_market_comp', title: 'בית סי פורט וקריית פארק לכיש תמ"ל/1062', e: 167361.6, n: 635642.2, targetE: 167576.3, targetN: 635957.1, radiusM: 25.0, xp: 300, yazamGate: 'comps_floor_delta_logged' },
    { id: 'M09', code: 'lido_marina_water_damage_insurtech', title: 'שמאות נזקי מים מצולמת בלידו והמרינה', e: 166420.0, n: 636150.0, targetE: 166010.0, targetN: 634120.0, radiusM: 15.0, xp: 340, yazamGate: 'sisi1555_6pct_moisture_6photos' },
    { id: 'M10', code: 'k_towers_dimri_master_syndicate_close', title: 'עסקת העוגן במגדלי K ומגדל דמרי', e: 166042.6, n: 633588.6, targetE: 166028.0, targetN: 633571.1, radiusM: 15.0, xp: 500, yazamGate: 'iron_rule1_25pct_advance' }
  ];

  function countGeometryTriangles(geom) {
    if (!geom) return 0;
    if (geom.index) return Math.floor(geom.index.count / 3);
    var pos = geom.attributes && geom.attributes.position;
    return pos ? Math.floor(pos.count / 3) : 0;
  }

  function countObjectTriangles(root) {
    var total = 0;
    if (!root || typeof root.traverse !== 'function') return 0;
    root.traverse(function (node) {
      if (node.isInstancedMesh && node.geometry) {
        total += countGeometryTriangles(node.geometry) * (node.count || 1);
      } else if (node.isMesh && node.geometry) {
        total += countGeometryTriangles(node.geometry);
      }
    });
    return total;
  }

  // Builds a procedural fallback / proxy rigged character around local (0,0,0)
  // matching the chosen style ('realistic' vs 'stylized') while external CC0 GLB loads.
  function buildProceduralStyleAvatar(THREE, styleKey, includeHardHat) {
    var profile = AVATAR_STYLE_PROFILES[styleKey] || AVATAR_STYLE_PROFILES.realistic;
    var seg = styleKey === 'realistic' ? 14 : 8;
    var p = profile.proportions;
    var avatar = new THREE.Group();
    avatar.name = 'esh27-avatar-' + profile.id;

    var skinMat = new THREE.MeshStandardMaterial(profile.materials.skin);
    var shirtMat = new THREE.MeshStandardMaterial(profile.materials.shirt);
    var vestMat = new THREE.MeshStandardMaterial(profile.materials.vest);
    var pantsMat = new THREE.MeshStandardMaterial(profile.materials.pants);

    // Legs (baked y-offset via translate so pivot sits cleanly)
    var legGeo = new THREE.CylinderGeometry(0.065, 0.052, p.legLength, seg);
    legGeo.translate(0, p.legLength * 0.5, 0);
    var leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.set(-0.10, 0, 0);
    leftLeg.castShadow = true;
    var rightLeg = new THREE.Mesh(legGeo.clone(), pantsMat);
    rightLeg.position.set(0.10, 0, 0);
    rightLeg.castShadow = true;
    avatar.add(leftLeg, rightLeg);

    // Torso + Yazam safety vest
    var torsoGeo = new THREE.BoxGeometry(p.shoulderWidth * 0.78, p.torsoHeight, 0.22);
    torsoGeo.translate(0, p.legLength + p.torsoHeight * 0.5, 0);
    var torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.castShadow = true;
    avatar.add(torso);

    var vestGeo = new THREE.BoxGeometry(p.shoulderWidth * 0.81, p.torsoHeight * 0.72, 0.235);
    vestGeo.translate(0, p.legLength + p.torsoHeight * 0.54, 0);
    var vest = new THREE.Mesh(vestGeo, vestMat);
    vest.castShadow = true;
    avatar.add(vest);

    // Arms (rotated slightly downward from vertical CylinderGeometry)
    var armLen = p.torsoHeight * 0.92;
    var armGeo = new THREE.CylinderGeometry(0.048, 0.040, armLen, seg);
    armGeo.translate(0, -armLen * 0.5, 0);
    var leftArm = new THREE.Mesh(armGeo, shirtMat);
    leftArm.position.set(-p.shoulderWidth * 0.5, p.legLength + p.torsoHeight * 0.92, 0);
    leftArm.rotation.z = 0.08;
    leftArm.castShadow = true;

    var rightArm = new THREE.Mesh(armGeo.clone(), shirtMat);
    rightArm.position.set(p.shoulderWidth * 0.5, p.legLength + p.torsoHeight * 0.92, 0);
    rightArm.rotation.z = -0.08;
    rightArm.castShadow = true;
    avatar.add(leftArm, rightArm);

    // Head
    var headY = p.legLength + p.torsoHeight + p.headRadius * 1.15;
    var headGeo = new THREE.SphereGeometry(p.headRadius, seg, Math.max(6, Math.floor(seg * 0.75)));
    headGeo.translate(0, headY, 0);
    var head = new THREE.Mesh(headGeo, skinMat);
    head.castShadow = true;
    avatar.add(head);

    if (includeHardHat !== false) {
      var helmetMat = new THREE.MeshStandardMaterial(profile.materials.helmet);
      var domeGeo = new THREE.SphereGeometry(p.headRadius * 1.08, seg, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
      domeGeo.translate(0, headY + p.headRadius * 0.12, 0);
      var dome = new THREE.Mesh(domeGeo, helmetMat);
      dome.castShadow = true;
      avatar.add(dome);
    }

    var tris = countObjectTriangles(avatar);
    avatar.userData = {
      style: profile.id,
      license: profile.license,
      measuredTriangles: tris,
      withinMobileBudget: tris <= MOBILE_MAX_TRIANGLES,
      limbs: { leftLeg: leftLeg, rightLeg: rightLeg, leftArm: leftArm, rightArm: rightArm }
    };
    return avatar;
  }

  // Deterministic Mission Completion & Metric Uncertainty Evaluator
  function evaluateMissionStep(missionId, telemetry) {
    var m = null;
    for (var i = 0; i < ASHDOD_YAZAM_MISSIONS.length; i++) {
      if (ASHDOD_YAZAM_MISSIONS[i].id === missionId) { m = ASHDOD_YAZAM_MISSIONS[i]; break; }
    }
    if (!m) return { ok: false, reason: 'unknown_mission' };
    var dx = (telemetry.e || 0) - m.targetE;
    var dn = (telemetry.n || 0) - m.targetN;
    var distM = Math.sqrt(dx * dx + dn * dn);
    var inRange = distM <= m.radiusM;
    var gatePassed = Boolean(telemetry.gates && telemetry.gates[m.yazamGate]);
    return {
      ok: inRange && gatePassed,
      missionId: m.id,
      distanceToTargetM: Number(distM.toFixed(2)),
      requiredRadiusM: m.radiusM,
      inRange: inRange,
      gatePassed: gatePassed,
      xpAwarded: (inRange && gatePassed) ? m.xp : 0
    };
  }

  // Propagates metric height & uncertainty from a reference object of known height (never raw VLM guessing!)
  // H_obj = H_ref * (px_obj / px_ref) * cos(tilt_rad)
  function estimateHeightFromReference(params) {
    var hRefM = params.refHeightM;
    var sigmaRefM = params.refSigmaM || 0.01;
    var pxObj = params.objectPixelsRectified;
    var pxRef = params.refPixelsRectified;
    var sigmaPx = params.pixelSigma || 1.5;

    if (!(hRefM > 0 && pxObj > 0 && pxRef > 4)) {
      return { valid: false, reason: 'insufficient_reference_pixels' };
    }
    var ratio = pxObj / pxRef;
    var estM = hRefM * ratio;
    // First-order Jacobian uncertainty propagation (GUM)
    var relVar = Math.pow(sigmaRefM / hRefM, 2) + Math.pow(sigmaPx / pxObj, 2) + Math.pow(sigmaPx / pxRef, 2);
    var sigmaM = estM * Math.sqrt(relVar);
    return {
      valid: true,
      estimatedHeightM: Number(estM.toFixed(2)),
      sigmaM: Number(sigmaM.toFixed(2)),
      provenance: 'משוער ממדידת ייחוס אופטית מיושרת פרספקטיבה (±' + sigmaM.toFixed(2) + ' מ\')'
    };
  }

  var S = {
    group: null,
    beaconsMesh: null,
    previewAvatar: null,
    activeStyle: 'realistic',
    completedMissions: {},
    clockSec: 0
  };

  var ADAPTER_SPEC = {
    id: 'missions-and-avatar-style',
    order: 60,
    init: function (world) {
      var THREE = (world && world.THREE) || (typeof window !== 'undefined' ? window.THREE : null);
      if (!THREE || !world || !world.scene) return;

      S.group = new THREE.Group();
      S.group.name = 'esh27-mission-b-hub';

      // Anchor local origin at HaErez 4 canonical ITM coordinate via window.YZW_placeITM
      var originE = ASHDOD_YAZAM_MISSIONS[0].e;
      var originN = ASHDOD_YAZAM_MISSIONS[0].n;

      // Build all 10 mission beacons as a single InstancedMesh (< 300 triangles total!)
      var beaconGeo = new THREE.CylinderGeometry(0.35, 0.35, 2.2, 8);
      beaconGeo.translate(0, 1.1, 0);
      var beaconMat = new THREE.MeshStandardMaterial({
        color: 0x00bfa5,
        emissive: 0x004d40,
        roughness: 0.35,
        metalness: 0.25
      });
      var inst = new THREE.InstancedMesh(beaconGeo, beaconMat, ASHDOD_YAZAM_MISSIONS.length);
      inst.castShadow = true;

      var dummy = new THREE.Object3D();
      for (var i = 0; i < ASHDOD_YAZAM_MISSIONS.length; i++) {
        var m = ASHDOD_YAZAM_MISSIONS[i];
        // Local offset relative to originE/originN so we never bake raw ITM numbers into geometry
        dummy.position.set(m.e - originE, 0, -(m.n - originN));
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      S.beaconsMesh = inst;
      S.group.add(inst);

      // Spawn dual-style avatar at local (1.5, 0, 1.5) near HaErez 4 start point
      var savedStyle = 'realistic';
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          var q = new URLSearchParams(window.location.search || '').get('style');
          savedStyle = q || window.localStorage.getItem('esh27_char_style') || 'realistic';
        }
      } catch (_) {}
      if (!AVATAR_STYLE_PROFILES[savedStyle]) savedStyle = 'realistic';
      S.activeStyle = savedStyle;

      S.previewAvatar = buildProceduralStyleAvatar(THREE, S.activeStyle, true);
      S.previewAvatar.position.set(1.5, 0, 1.5);
      S.group.add(S.previewAvatar);

      if (typeof window !== 'undefined' && typeof window.YZW_placeITM === 'function') {
        window.YZW_placeITM(S.group, originE, originN);
      }
      world.scene.add(S.group);

      if (typeof window !== 'undefined') {
        window.ESH27_MissionB = ADAPTER_PUBLIC_API(THREE);
      }
    },
    update: function (dt) {
      if (!S.group) return;
      S.clockSec += dt || 0.016;
      if (S.beaconsMesh && S.beaconsMesh.material) {
        S.beaconsMesh.material.emissiveIntensity = 0.55 + 0.35 * Math.sin(S.clockSec * 2.5);
      }
      if (S.previewAvatar && S.previewAvatar.userData && S.previewAvatar.userData.limbs) {
        var swing = Math.sin(S.clockSec * 2.0) * 0.06;
        S.previewAvatar.userData.limbs.leftArm.rotation.x = swing;
        S.previewAvatar.userData.limbs.rightArm.rotation.x = -swing;
      }
    },
    dispose: function (world) {
      if (!S.group) return;
      if (world && world.scene) world.scene.remove(S.group);
      S.group.traverse(function (node) {
        if (node.geometry && typeof node.geometry.dispose === 'function') node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) {
            node.material.forEach(function (m) { if (m && m.dispose) m.dispose(); });
          } else if (node.material.dispose) {
            node.material.dispose();
          }
        }
      });
      S.group = null;
      S.beaconsMesh = null;
      S.previewAvatar = null;
    }
  };

  function ADAPTER_PUBLIC_API(THREE) {
    return {
      MOBILE_MAX_TRIANGLES: MOBILE_MAX_TRIANGLES,
      AVATAR_STYLE_PROFILES: AVATAR_STYLE_PROFILES,
      ASHDOD_YAZAM_MISSIONS: ASHDOD_YAZAM_MISSIONS,
      buildProceduralStyleAvatar: function (styleKey, includeHardHat) {
        return buildProceduralStyleAvatar(THREE, styleKey, includeHardHat);
      },
      setCharacterStyle: function (styleKey) {
        if (!AVATAR_STYLE_PROFILES[styleKey]) return false;
        S.activeStyle = styleKey;
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('esh27_char_style', styleKey);
          }
        } catch (_) {}
        if (S.group && THREE) {
          if (S.previewAvatar) S.group.remove(S.previewAvatar);
          S.previewAvatar = buildProceduralStyleAvatar(THREE, styleKey, true);
          S.previewAvatar.position.set(1.5, 0, 1.5);
          S.group.add(S.previewAvatar);
        }
        return true;
      },
      getActiveStyle: function () { return S.activeStyle; },
      evaluateMissionStep: evaluateMissionStep,
      estimateHeightFromReference: estimateHeightFromReference,
      countObjectTriangles: countObjectTriangles
    };
  }

  if (typeof window !== 'undefined' && window.YZW && typeof window.YZW.register === 'function') {
    window.YZW.register(ADAPTER_SPEC);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ADAPTER_SPEC: ADAPTER_SPEC,
      MOBILE_MAX_TRIANGLES: MOBILE_MAX_TRIANGLES,
      AVATAR_STYLE_PROFILES: AVATAR_STYLE_PROFILES,
      ASHDOD_YAZAM_MISSIONS: ASHDOD_YAZAM_MISSIONS,
      buildProceduralStyleAvatar: buildProceduralStyleAvatar,
      evaluateMissionStep: evaluateMissionStep,
      estimateHeightFromReference: estimateHeightFromReference,
      countObjectTriangles: countObjectTriangles
    };
  }
})();
