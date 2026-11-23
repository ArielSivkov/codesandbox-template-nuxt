/* מתאם: חבילת הנכסים CC0 (swarm/assets/pack/models, תקציב BUDGET-mobile.txt): מחליף את רכב המשחק (קופסה אדומה) בדגם car_sedan.glb
 * (440 משולשים, 11KB, בתקציב "רכב ≤ 5,000"). הגלגלים המקוריים מוסתרים; הלוגיקה של המשחק (תנועה, התנגשות) לא משתנה.
 */
(function () {
  'use strict';
  const S = { car: null, model: null, hidden: [] };
  YZW.register({
    id: 'assets', name: 'נכסי CC0: דגם רכב', dept: 'assets', order: 56,
    async init(world, api) {
      if (!window.ESH_GLTF) await api.loadScript('vendor/loaders.js');
      const G = window.ESH_GLTF, L = new G.GLTFLoader(); if (G.MeshoptDecoder) L.setMeshoptDecoder(G.MeshoptDecoder);
      const gltf = await new Promise((ok, no) => L.load('mods/assets/models/car_sedan.glb', ok, undefined, no));
      world.scene.traverse(o => { if (!S.car && o.userData && o.userData.wheels && o.isGroup) S.car = o; });
      if (!S.car) throw new Error('רכב המשחק לא נמצא');
      const m = gltf.scene; const box = new THREE.Box3().setFromObject(m), sz = box.getSize(new THREE.Vector3());
      const k = 4.3 / Math.max(sz.x, sz.z); m.scale.setScalar(k); if (sz.x > sz.z) m.rotation.y = Math.PI / 2;
      box.setFromObject(m); m.position.y -= box.min.y; m.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
      for (const c of S.car.children) { if (c.visible) { c.visible = false; S.hidden.push(c); } }
      S.car.add(m); S.model = m;
    },
    dispose() { if (S.model && S.car) S.car.remove(S.model); for (const c of S.hidden) c.visible = true; S.hidden = []; S.model = null; },
  });
})();
