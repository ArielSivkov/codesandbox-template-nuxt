// שער רחוב עם עמודים מטויחים ומשטח אבנים – טיוטת qwen2.5-coder (מודל ענן), תוקנה ע"י קלוד (dispose). כל המידות משוער.
(function () {
  'use strict';
  const E = 168132, N = 632713;
  let g = null;
  YZW.register({ id: 'lab-street-gate', order: 78,
    init(world) {
      const T = THREE; g = new T.Group(); g.name = 'lab-street-gate';
      const pillarGeo = new T.BoxGeometry(0.4, 2.0, 0.4), pillarMat = new T.MeshStandardMaterial({ color: 0xefe4cc, roughness: 0.9 });
      for (const x of [-2.2, 2.2]) { const p = new T.Mesh(pillarGeo, pillarMat); p.position.set(x, 1.0, 0); p.castShadow = p.receiveShadow = true; g.add(p); }
      const metal = new T.MeshStandardMaterial({ color: 0x6b4a2b, metalness: 0.5, roughness: 0.6 });
      const railGeo = new T.BoxGeometry(4, 0.06, 0.06);
      for (const y of [0.1, 1.8]) { const r = new T.Mesh(railGeo, metal); r.position.set(0, y, 0); r.castShadow = true; g.add(r); }
      const bars = new T.InstancedMesh(new T.BoxGeometry(0.04, 1.7, 0.04), metal, 33), m = new T.Matrix4();
      for (let i = 0; i < 33; i++) { m.makeTranslation(-1.94 + i * 0.12, 0.95, 0); bars.setMatrixAt(i, m); }
      bars.castShadow = true; g.add(bars);
      const pav = new T.Mesh(new T.PlaneGeometry(6, 4), new T.MeshStandardMaterial({ color: 0x786c3b, roughness: 0.95 }));
      pav.rotation.x = -Math.PI / 2; pav.position.set(0, 0.02, 2.2); pav.receiveShadow = true; g.add(pav);
      if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g);
    },
    update() {},
    dispose() { if (g && g.parent) g.parent.remove(g); } });
})();
