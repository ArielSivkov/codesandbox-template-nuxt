// שני מגדלי מים בגבעת יונה – טיוטת qwen2.5-coder (מודל ענן), תוקנה ונבדקה ע"י קלוד
(function () {
  'use strict';
  const R = 5, D = 6, H_EST = 14; // גובה משוער – לא נמדד
  const BAND = 1.4, E = 166590, N = 635810;
  function build() {
    const T = THREE, g = new T.Group(); g.name = 'lab-water-towers';
    const mC = new T.MeshStandardMaterial({ color: 0xd9cfb8, roughness: 0.9, metalness: 0 });
    const mB = new T.MeshStandardMaterial({ color: 0xa99b85, roughness: 0.9, metalness: 0 });
    const body = new T.CylinderGeometry(R, R, H_EST - BAND, 32); body.translate(0, (H_EST - BAND) / 2, 0);
    const band = new T.CylinderGeometry(R + 0.05, R + 0.05, BAND, 32); band.translate(0, H_EST - BAND / 2, 0);
    // המפרט: "6 מ' זה מזה" – מרווח בין הקירות; מרכזים 2R+D
    for (const x of [-(R + D / 2), R + D / 2]) {
      const a = new T.Mesh(body, mC), b = new T.Mesh(band, mB);
      a.position.x = b.position.x = x; a.castShadow = b.castShadow = true; a.receiveShadow = true; g.add(a, b);
    }
    return g;
  }
  YZW.register({ id: 'lab-water-towers', order: 72,
    init(world) { const g = build(); if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g); },
    update() {}, dispose() {} });
})();
