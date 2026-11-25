(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.YZW || typeof window.YZW.register !== 'function') return;

  var S = {
    group: null,
    disposables: [],
    beacons: null,
    time: 0
  };

  // Canonical ITM EPSG:2039 anchors in Ashdod synced to A27 Construction Hour 83/100 (Rev 8.3 · 204 STEP/GLB)
  var ECOSYSTEM_NODES = [
    { id: 'HR-109', kind: 'invention', title: 'גשר מעוגן-כבלים HR-109 (+58 מ׳, שלוחת 96 מ׳)', E: 166410.0, N: 635210.0, h: 58.0, spanM: 96.0, w: 14.0, glb: 'assets/glb_public_twin_world/HR-109-ASM_public_shell.glb', color: 0x38bdf8 },
    { id: 'HR-086', kind: 'invention', title: 'מגדל בינה בונה 30 קומות (LRB + סוכות)', E: 166520.0, N: 634680.0, h: 108.0, w: 20.0, glb: 'assets/glb_public_twin_world/HR-086-ASM_public_shell.glb', color: 0x0284c7 },
    { id: 'HR-114', kind: 'invention', title: 'מנהרת תשתיות אל-חפירה MUT (1,240 מ׳ + 4 צווארוני גזירה)', E: 166074.0, N: 634956.0, h: 6.4, lengthM: 1240.0, w: 6.0, glb: 'assets/glb_public_twin_world/HR-114-ASM_public_shell.glb', color: 0x10b981 },
    { id: 'E27-BOT', kind: 'robotics', title: 'רובוט בינה בונה 68 ס"מ (BOM סדרתי 53,850 ₪)', E: 166263.8, N: 634919.8, h: 1.52, w: 0.68, glb: 'assets/glb_public_twin_world/E27-BOT-ASM_public_shell.glb', color: 0xf97316 },
    { id: 'HR-124', kind: 'manufacturing', title: 'תא ייצור D&A Rev 8.3 (204 מכלולי STEP/GLB · OEE 98.68%)', E: 166790.0, N: 635640.0, h: 14.0, assemblies: 204, w: 18.0, glb: 'assets/glb_public_twin_world/HR-124-ASM_public_shell.glb', color: 0xa855f7 },
    { id: 'HR-125', kind: 'aerospace', title: 'תורן וקן רחפן D&A 38cc + ממסר ORB-249', E: 166617.1, N: 635832.2, h: 42.0, w: 6.0, glb: 'assets/glb_public_twin_world/HR-125-ASM_public_shell.glb', color: 0xf59e0b },
    { id: 'BIZ-LIDO-01', kind: 'business_ad', title: 'מתחם מסעדות ועסקים – טיילת לידו (עולם היזמים)', E: 165695.0, N: 635150.0, h: 4.5, w: 12.0, glb: null, color: 0xec4899 }
  ];

  window.YZW.register({
    id: 'step-ecosystem-bridge',
    name: 'גשר עולם היזמים ו-204 מכלולי STEP/GLB (A27 Rev 8.3)',
    order: 68,
    init: function (world) {
      var T = window.THREE;
      if (!T || !world || !world.scene) return;
      S.group = new T.Group();
      S.group.name = 'esh27-step-ecosystem-bridge-rev83';

      // Single InstancedMesh for all 7 ecosystem beacons -> 1 Draw Call total!
      var pinGeo = new T.CylinderGeometry(1.1, 0.25, 4.2, 12);
      pinGeo.translate(0, 2.1, 0);
      var pinMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.45 });
      S.disposables.push(pinGeo, pinMat);

      var inst = new T.InstancedMesh(pinGeo, pinMat, ECOSYSTEM_NODES.length);
      inst.name = 'ecosystem-pins-instanced';
      var dummy = new T.Object3D();
      var col = new T.Color();

      for (var i = 0; i < ECOSYSTEM_NODES.length; i++) {
        var n = ECOSYSTEM_NODES[i];
        var anchor = new T.Group();
        if (typeof window.YZW_placeITM === 'function') {
          window.YZW_placeITM(anchor, n.E, n.N);
        } else {
          anchor.position.set(n.E - 166263.8, 0, -(n.N - 634919.8));
        }
        dummy.position.copy(anchor.position);
        dummy.position.y += n.h + 3.0;
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        if (typeof inst.setColorAt === 'function') {
          inst.setColorAt(i, col.setHex(n.color));
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.userData = { ecosystemNodes: ECOSYSTEM_NODES, rev: '8.3-hour83', assembliesCount: 204 };

      S.beacons = inst;
      S.group.add(inst);
      world.scene.add(S.group);
      world.ecosystemRegistry = ECOSYSTEM_NODES;
    },
    update: function (dt) {
      if (!S.beacons) return;
      S.time += (dt && dt > 0 && dt < 1) ? dt : 0.016;
      S.beacons.position.y = Math.sin(S.time * 2.2) * 0.45;
    },
    dispose: function (world) {
      if (S.group && world && world.scene) {
        world.scene.remove(S.group);
      }
      for (var i = 0; i < S.disposables.length; i++) {
        if (S.disposables[i] && typeof S.disposables[i].dispose === 'function') {
          S.disposables[i].dispose();
        }
      }
      S.disposables = [];
      S.beacons = null;
      S.group = null;
    }
  });
})();
