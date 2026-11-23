// מגדלור אשדוד, גבעת יונה – טיוטה: qwen2.5-coder בענן; תיקונים: קלוד (פריזמה משולשת אנכית, כיפה, מעקה, משתנה world)
// מידות: גובה 42 מ', חצי תחתון פריזמה משולשת בטון אפור, חצי עליון גליל משובץ אדום-לבן (ויקיפדיה). רוחב הבסיס משוער.
(function () {
  'use strict';
  const S = { group: null };
  function checker() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 320; const x = c.getContext('2d');
    for (let i = 0; i < 8; i++) for (let j = 0; j < 10; j++) { x.fillStyle = (i + j) % 2 ? '#ffffff' : '#c8262b'; x.fillRect(i * 32, j * 32, 32, 32); }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function build() {
    const T = THREE, g = new T.Group(); g.name = 'lab-lighthouse';
    const concrete = new T.MeshStandardMaterial({ color: 0x8f8f8a, roughness: 0.9 });
    const paint = new T.MeshStandardMaterial({ map: checker(), roughness: 0.6 });
    const glass = new T.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.7 });
    const metal = new T.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
    const H1 = 21, H2 = 19, side = 7;   // משוער: צלע הבסיס
    const prism = new T.CylinderGeometry(side * 0.5, side / Math.sqrt(3), H1, 3);   // פריזמה משולשת מתחדדת מעט
    const m1 = new T.Mesh(prism, concrete); m1.position.y = H1 / 2; g.add(m1);
    const m2 = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, H2, 32, 1, true), paint); m2.position.y = H1 + H2 / 2; g.add(m2);
    const deck = new T.Mesh(new T.CylinderGeometry(2.9, 2.9, 0.25, 32), concrete); deck.position.y = H1 + H2; g.add(deck);
    const rail = new T.Mesh(new T.TorusGeometry(2.8, 0.04, 6, 40), metal); rail.rotation.x = Math.PI / 2; rail.position.y = H1 + H2 + 1.0; g.add(rail);
    const lamp = new T.Mesh(new T.CylinderGeometry(1.4, 1.4, 1.6, 24), glass); lamp.position.y = H1 + H2 + 0.95; g.add(lamp);
    const dome = new T.Mesh(new T.SphereGeometry(1.45, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal); dome.position.y = H1 + H2 + 1.75; g.add(dome);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  YZW.register({ id: 'lab-lighthouse', order: 70,
    init(world) { S.group = build(); (window.YZW_placeITM || ((o) => world.scene.add(o)))(S.group, 166612, 635819); },
    update() {},
    dispose() { if (!S.group) return; S.group.parent && S.group.parent.remove(S.group); S.group.traverse(o => { o.geometry && o.geometry.dispose(); }); S.group = null; } });
})();
