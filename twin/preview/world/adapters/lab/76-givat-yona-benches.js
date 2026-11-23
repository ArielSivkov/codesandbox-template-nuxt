// 6 ספסלים לצד הפרגולה בגבעת יונה – טיוטת qwen2.5-coder (מודל ענן), תוקנה ע"י קלוד
(function () {
  'use strict';
  const L = 1.8, D = 0.45, SH = 0.45, BR = 0.4, SL = 0.06, LEG = 0.05; // עובי מושב ורגליים משוער
  const E = 166560, N = 635790;
  const SPOTS = []; for (const x of [-4, 0, 4]) { SPOTS.push([x, 3, 1]); SPOTS.push([x, -3, -1]); } // s=+1: גב בצד +z, פונה ל־-z
  YZW.register({ id: 'lab-givat-yona-benches', order: 76,
    init(world) {
      const T = THREE, g = new T.Group(); g.name = 'lab-givat-yona-benches';
      const wood = new T.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.85 });
      const steel = new T.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.6 });
      const seat = new T.InstancedMesh(new T.BoxGeometry(L, SL, D), wood, 6);
      const back = new T.InstancedMesh(new T.BoxGeometry(L, BR, SL), wood, 6);
      const leg = new T.InstancedMesh(new T.BoxGeometry(LEG, SH, LEG), steel, 24);
      const post = new T.InstancedMesh(new T.BoxGeometry(LEG, BR, LEG), steel, 12);
      const m = new T.Matrix4(); let li = 0, pi = 0;
      SPOTS.forEach(([x, z, s], i) => {
        m.makeTranslation(x, SH - SL / 2, z); seat.setMatrixAt(i, m);
        const bz = z + s * (D / 2 - SL / 2);
        m.makeTranslation(x, SH + BR / 2, bz); back.setMatrixAt(i, m);
        for (const dx of [-1, 1]) {
          for (const dz of [-1, 1]) { m.makeTranslation(x + dx * (L / 2 - 0.1), SH / 2 - SL / 2, z + dz * (D / 2 - LEG)); leg.setMatrixAt(li++, m); }
          m.makeTranslation(x + dx * (L / 2 - 0.1), SH + BR / 2, bz - s * SL); post.setMatrixAt(pi++, m);
        }
      });
      for (const o of [seat, back, leg, post]) { o.castShadow = true; o.receiveShadow = true; g.add(o); }
      if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g);
    },
    update() {}, dispose() {} });
})();
