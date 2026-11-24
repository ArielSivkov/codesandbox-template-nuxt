// אתר הבנייה ליד מגדלי הדקל: שלד 18 קומות + פודיום עם 3 עגורני צריח (צילומים 031, 070, 074)
// נתונים: חבילת ג'מיני twin_haerez_groundtruth_life_v1 (62-haerez-groundtruth.js) – מיקום ITM אמיתי, מידות משוער.
// משאר החבילה (קופסאות לבניינים שכבר קיימים באריחים) לא נלקח – היה מכפיל בניינים.
(function () {
  'use strict';
  const S = { groups: [], t: 0, lights: null };
  YZW.register({
    id: 'lab-haerez-construction', order: 82,
    init(world) {
      const T = THREE;
      const concrete = new T.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.9 });
      const red = new T.MeshStandardMaterial({ color: 0xc8372d, roughness: 0.5 });
      const yellow = new T.MeshStandardMaterial({ color: 0xd99b26, roughness: 0.5 });
      S.lights = new T.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 1 });

      // שלד בטון 18 קומות, 25×23 מ', קומה 3.2 מ' (משוער): תקרות + עמודים, בלי קירות
      const sk = new T.Group(), FL = 18, FH = 3.2, W = 25, D = 23;
      const slab = new T.InstancedMesh(new T.BoxGeometry(W, 0.3, D).translate(0, 0.15, 0), concrete, FL + 1);
      const m = new T.Matrix4();
      for (let i = 0; i <= FL; i++) slab.setMatrixAt(i, m.makeTranslation(0, i * FH, 0));
      const cols = [], nx = 5, nz = 4;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) cols.push([-W / 2 + 0.4 + a * (W - 0.8) / (nx - 1), -D / 2 + 0.4 + b * (D - 0.8) / (nz - 1)]);
      const col = new T.InstancedMesh(new T.BoxGeometry(0.5, FL * FH, 0.5).translate(0, FL * FH / 2, 0), concrete, cols.length);
      cols.forEach(([x, z], i) => col.setMatrixAt(i, m.makeTranslation(x, 0, z)));
      slab.castShadow = col.castShadow = true; sk.add(slab, col);
      window.YZW_placeITM(sk, 166175.0, 635072.0); S.groups.push(sk);

      // פודיום 3 קומות 38×28 מ' + 3 עגורני צריח (68/56/44 מ', משוער)
      const site = new T.Group();
      const pod = new T.Mesh(new T.BoxGeometry(38, 10.5, 28).translate(0, 5.25, 0), concrete); pod.castShadow = true; site.add(pod);
      [[68, yellow, 0], [56, red, 0.85], [44, red, 1.7]].forEach(([h, mat, rot], i) => {
        const c = new T.Group(); c.position.set((i - 1) * 14, 0, (i % 2) * 8 - 4); c.rotation.y = rot;
        const mast = new T.Mesh(new T.BoxGeometry(1.6, h, 1.6).translate(0, h / 2, 0), mat);
        const jib = new T.Mesh(new T.BoxGeometry(42, 1.2, 1.2).translate(10, h - 1.5, 0), red);
        const cab = new T.Mesh(new T.BoxGeometry(2.2, 2.4, 2.2).translate(0, h - 3.5, 1.6), yellow);
        const cw = new T.Mesh(new T.BoxGeometry(3, 2.5, 2).translate(-9, h - 2.5, 0), concrete);   // משקולת נגד
        const lamp = new T.Mesh(new T.SphereGeometry(0.5, 8, 6).translate(0, h + 0.6, 0), S.lights);
        mast.castShadow = jib.castShadow = true; c.add(mast, jib, cab, cw, lamp); site.add(c);
      });
      window.YZW_placeITM(site, 166003.09, 635006.19); S.groups.push(site);
    },
    update(dt) { S.t += dt; if (S.lights) S.lights.emissiveIntensity = (S.t % 2) < 1 ? 1 : 0.05; },   // נורות אזהרה מהבהבות
    dispose() { for (const g of S.groups) if (g.parent) g.parent.remove(g); S.groups = []; },
  });
})();
