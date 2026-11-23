// שלט 'גבעת יונה' על בסיס אבן ליד הפרגולה – טיוטת qwen2.5-coder (מודל ענן), תוקנה ע"י קלוד
(function () {
  'use strict';
  const PW = 1.2, PD = 0.9, PH = 0.4, SW = 0.8, SHh = 0.5, TILT = Math.PI / 6;
  const E = 166560, N = 635786;
  function plaqueTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320; const x = c.getContext('2d');
    x.fillStyle = '#8c6a3c'; x.fillRect(0, 0, 512, 320); // רקע ברונזה – בלי רקע שקוף המפה מחשיכה את כל השלט
    x.strokeStyle = '#3b2a14'; x.lineWidth = 10; x.strokeRect(14, 14, 484, 292);
    x.fillStyle = '#2a1d0e'; x.font = 'bold 96px "Noto Sans Hebrew", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    x.fillText('גבעת יונה', 256, 160);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace || t.colorSpace; return t;
  }
  YZW.register({ id: 'lab-jonah-plaque', order: 79,
    init(world) {
      const T = THREE, g = new T.Group(); g.name = 'lab-jonah-plaque';
      const base = new T.Mesh(new T.BoxGeometry(PW, PH, PD), new T.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.95 }));
      base.position.y = PH / 2; base.castShadow = base.receiveShadow = true; g.add(base);
      const plate = new T.Mesh(new T.BoxGeometry(SW, SHh, 0.02), new T.MeshStandardMaterial({ map: plaqueTex(), metalness: 0.6, roughness: 0.45 }));
      plate.rotation.x = -(Math.PI / 2 - TILT); // משופע 30° מהאופק, פונה למעלה ול־+z
      plate.position.y = PH + Math.sin(TILT) * SHh / 2 + 0.01; plate.castShadow = true; g.add(plate);
      if (window.YZW_placeITM) window.YZW_placeITM(g, E, N); else world.scene.add(g);
    },
    update() {}, dispose() {} });
})();
