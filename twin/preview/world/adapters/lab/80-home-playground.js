// גן שעשועים קטן (מתמונות הלילה של אריאל) – טיוטת qwen2.5-coder (מודל ענן), תוקנה ע"י קלוד:
// מגלשה יורדת מהמשטח לקרקע (לא חותכת את הסולם), מסגרת נדנדה כ-2 משולשי A + קורה, חבלים, dispose. כל המידות משוער.
(function () {
  'use strict';
  const E = 167983, N = 632578, TILT = 35 * Math.PI / 180, CH = 2.6;
  let g = null;
  YZW.register({ id: 'lab-home-playground', order: 80,
    init(world) {
      const T = THREE; g = new T.Group(); g.name = 'lab-home-playground';
      const green = new T.MeshStandardMaterial({ color: 0x2e8b3a, roughness: 0.6 }), yellow = new T.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 });
      const ladderG = new T.BoxGeometry(0.6, 1.5, 0.4), platG = new T.BoxGeometry(1.2, 0.1, 1.2), chuteG = new T.BoxGeometry(0.6, 0.05, CH);
      for (const x of [-3, 1]) {
        const s = new T.Group(); s.position.x = x;
        const lad = new T.Mesh(ladderG, green); lad.position.set(0, 0.75, -0.6);
        const pl = new T.Mesh(platG, green); pl.position.y = 1.5;
        const ch = new T.Mesh(chuteG, yellow); ch.rotation.x = TILT; // יורדת לכיוון +z
        ch.position.set(0, 1.5 - Math.sin(TILT) * CH / 2, 0.6 + Math.cos(TILT) * CH / 2);
        for (const o of [lad, pl, ch]) { o.castShadow = true; s.add(o); }
        g.add(s);
      }
      // נדנדה: שני משולשי A בגובה 2.2 מ', 3 מ' זה מזה, קורה עליונה ושני מושבים
      const blue = new T.MeshStandardMaterial({ color: 0x2050c0, metalness: 0.4, roughness: 0.5 });
      const sw = new T.Group(); sw.position.x = 5;
      const legL = Math.hypot(2.2, 0.8), legG = new T.CylinderGeometry(0.05, 0.05, legL, 8), ang = Math.atan2(0.8, 2.2);
      for (const x of [-1.5, 1.5]) for (const sz of [-1, 1]) { const l = new T.Mesh(legG, blue); l.position.set(x, 1.1, sz * 0.4); l.rotation.x = -sz * ang; l.castShadow = true; sw.add(l); }
      const bar = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 3, 8), blue); bar.rotation.z = Math.PI / 2; bar.position.y = 2.2; bar.castShadow = true; sw.add(bar);
      const rope = new T.MeshStandardMaterial({ color: 0x222222 }), ropeG = new T.CylinderGeometry(0.01, 0.01, 1.75, 4), seatG = new T.BoxGeometry(0.45, 0.04, 0.2);
      for (const x of [-0.6, 0.6]) {
        const seat = new T.Mesh(seatG, blue); seat.position.set(x, 0.45, 0); seat.castShadow = true; sw.add(seat);
        for (const dx of [-0.2, 0.2]) { const r = new T.Mesh(ropeG, rope); r.position.set(x + dx, 1.325, 0); sw.add(r); }
      }
      g.add(sw);
      // 4 עמודי תאורה בפינות
      const postG = new T.CylinderGeometry(0.06, 0.06, 4, 10), headG = new T.SphereGeometry(0.2, 12, 8);
      const postM = new T.MeshStandardMaterial({ color: 0x3a3a3a }), headM = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 1 });
      for (const x of [-7, 7]) for (const z of [-5, 5]) {
        const p = new T.Mesh(postG, postM); p.position.set(x, 2, z); p.castShadow = true;
        const h = new T.Mesh(headG, headM); h.position.set(x, 4, z); g.add(p, h);
      }
      const floor = new T.Mesh(new T.PlaneGeometry(14, 10), new T.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.95 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02; floor.receiveShadow = true; g.add(floor);
      if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g);
    },
    update() {},
    dispose() { if (g && g.parent) g.parent.remove(g); } });
})();
