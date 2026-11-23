// פרגולה + מדרגות בגבעת יונה – טיוטת qwen2.5-coder (מודל ענן), תוקנה ונבדקה ע"י קלוד
// מידות לפי המפרט (לא נמדדו): משוער. גובה הרחבה מחושב מ-10 מדרגות × 0.15 מ'.
(function () {
  'use strict';
  const L = 12, W = 4, H = 2.8, POST = 0.15, SLAT_W = 0.15, SLAT_H = 0.05, SLAT_GAP = 0.4;
  const RISE = 0.15, TREAD = 0.35, STEPS = 10, PLAT = RISE * STEPS; // רחבה 1.5 מ' – משוער
  const E = 166560, N = 635790;
  function build() {
    const T = THREE, g = new T.Group(); g.name = 'lab-givat-yona-pergola';
    const mPost = new T.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5, metalness: 0.3 });
    const mSlat = new T.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.8, metalness: 0 });
    const mConc = new T.MeshStandardMaterial({ color: 0xa7a39b, roughness: 0.9, metalness: 0 });
    const m4 = new T.Matrix4();
    // רחבת בטון מתחת לפרגולה
    const plat = new T.Mesh(new T.BoxGeometry(L, PLAT, W), mConc); plat.position.y = PLAT / 2; g.add(plat);
    // עמודים כל 3 מ' בשני הצדדים
    const nx = Math.floor(L / 3) + 1, posts = new T.InstancedMesh(new T.BoxGeometry(POST, H, POST), mPost, nx * 2);
    let k = 0;
    for (let i = 0; i < nx; i++) for (const z of [-W / 2 + POST / 2, W / 2 - POST / 2])
      posts.setMatrixAt(k++, m4.makeTranslation(-L / 2 + POST / 2 + i * (L - POST) / (nx - 1), PLAT + H / 2, z));
    g.add(posts);
    // קורות אורך על העמודים
    for (const z of [-W / 2 + POST / 2, W / 2 - POST / 2]) {
      const b = new T.Mesh(new T.BoxGeometry(L, POST, POST), mPost); b.position.set(0, PLAT + H + POST / 2, z); g.add(b);
    }
    // שלבי עץ לרוחב כל 0.4 מ'
    const ns = Math.floor((L - SLAT_W) / SLAT_GAP) + 1, slats = new T.InstancedMesh(new T.BoxGeometry(SLAT_W, SLAT_H, W + 0.3), mSlat, ns);
    for (let i = 0; i < ns; i++) slats.setMatrixAt(i, m4.makeTranslation(-L / 2 + SLAT_W / 2 + i * SLAT_GAP, PLAT + H + POST + SLAT_H / 2, 0));
    g.add(slats);
    // מדרגות עולות אל הרחבה מצד ‎-x
    const steps = new T.InstancedMesh(new T.BoxGeometry(TREAD, 1, W), mConc, STEPS);
    for (let i = 0; i < STEPS; i++) {
      const h = RISE * (i + 1);
      m4.makeScale(1, h, 1).setPosition(-L / 2 - (STEPS - i - 0.5) * TREAD, h / 2, 0); steps.setMatrixAt(i, m4);
    }
    g.add(steps);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  YZW.register({ id: 'lab-givat-yona-pergola', order: 71,
    init(world) { const g = build(); if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g); },
    update() {}, dispose() {} });
})();
