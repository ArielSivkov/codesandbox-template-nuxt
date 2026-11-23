// עמודי מחסום בטיילת הלידו – טיוטת qwen2.5-coder (מודל ענן), נבדקה ותוקנה ע"י קלוד
(function () {
  'use strict';
  const COUNT = 24, GAP = 1.6, R = 0.12, H = 0.8, CAP = 0.05; // מרווח 1.6 משוער
  const E = 166420, N = 636150;
  YZW.register({ id: 'lab-promenade-bollards', order: 75,
    init(world) {
      const T = THREE, g = new T.Group(); g.name = 'lab-promenade-bollards';
      const body = new T.CylinderGeometry(R, R, H, 12); body.translate(0, H / 2, 0);
      const cap = new T.CylinderGeometry(R * 0.85, R, CAP, 12); cap.translate(0, H + CAP / 2, 0);
      const mB = new T.MeshStandardMaterial({ color: 0xc8c4bc, roughness: 0.9 });
      const mC = new T.MeshStandardMaterial({ color: 0x5a5852, roughness: 0.8 });
      const a = new T.InstancedMesh(body, mB, COUNT), b = new T.InstancedMesh(cap, mC, COUNT), m = new T.Matrix4();
      const x0 = -(COUNT - 1) * GAP / 2;
      for (let i = 0; i < COUNT; i++) { m.makeTranslation(x0 + i * GAP, 0, 0); a.setMatrixAt(i, m); b.setMatrixAt(i, m); }
      a.castShadow = b.castShadow = true; a.receiveShadow = true; g.add(a, b);
      if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g);
    },
    update() {}, dispose() {} });
})();
