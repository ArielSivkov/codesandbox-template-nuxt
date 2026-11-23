// קיר תמך עם ציורי קיר ושביל אדום בגבעת יונה – טיוטת qwen2.5-coder (מודל ענן), נכתבה מחדש בחלקה ע"י קלוד
(function () {
  'use strict';
  const LEN = 30, H = 2.2, TH = 0.3, PATH_W = 2; // כל המידות משוערות
  const E = 166600, N = 635760;
  const COLORS = ['#e63946', '#f1c453', '#2a9d8f', '#457b9d', '#f4a261'];
  function mural() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
    const x = c.getContext('2d'); let s = 77; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); // זרע קבוע – אותו ציור בכל טעינה
    x.fillStyle = '#bdb6a8'; x.fillRect(0, 0, 1024, 128);
    for (let i = 0; i < 70; i++) { x.beginPath(); x.ellipse(r() * 1024, r() * 128, 8 + r() * 40, 6 + r() * 28, r() * 3, 0, 7); x.fillStyle = COLORS[(r() * 5) | 0]; x.globalAlpha = 0.85; x.fill(); }
    x.lineCap = 'round';
    for (let i = 0; i < 25; i++) { x.beginPath(); x.moveTo(r() * 1024, r() * 128); x.quadraticCurveTo(r() * 1024, r() * 128, r() * 1024, r() * 128); x.lineWidth = 3 + r() * 9; x.strokeStyle = COLORS[(r() * 5) | 0]; x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace || t.colorSpace; t.anisotropy = 4; return t;
  }
  YZW.register({ id: 'lab-givat-yona-graffiti-wall', order: 77,
    init(world) {
      const T = THREE, g = new T.Group(); g.name = 'lab-givat-yona-graffiti-wall';
      const plain = new T.MeshStandardMaterial({ color: 0xbdb6a8, roughness: 0.95 });
      const painted = new T.MeshStandardMaterial({ map: mural(), roughness: 0.9 });
      const geo = new T.BoxGeometry(LEN, H, TH); geo.translate(0, H / 2, 0);
      const wall = new T.Mesh(geo, [plain, plain, plain, plain, painted, plain]); // פאה 4 = ‎+z
      wall.castShadow = wall.receiveShadow = true; g.add(wall);
      const path = new T.Mesh(new T.PlaneGeometry(LEN, PATH_W), new T.MeshStandardMaterial({ color: 0x9e3b2f, roughness: 0.95 }));
      path.rotation.x = -Math.PI / 2; path.position.set(0, 0.03, TH / 2 + PATH_W / 2); path.receiveShadow = true; g.add(path);
      if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g);
    },
    update() {}, dispose() {} });
})();
