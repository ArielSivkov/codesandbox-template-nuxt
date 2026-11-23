// מיקום עצמים לפי רשת ישראל (ITM) – משותף לכל קבצי המעבדה שכתבו מודלי הענן
(function () {
  'use strict';
  const Q = []; let scene = null;
  function place(obj, E, N) {
    const W = window.W27; if (!W || !W.toScene || !scene) return false;
    const s = ITM.itmToSample(E, N), p = W.toScene(s.E, s.N);
    const g = W.H ? Math.max(W.H(p.x, p.z) || 0, 0) : 0;
    obj.position.set(p.x, g, p.z); obj.userData.itm = { E, N }; scene.add(obj); return true;
  }
  window.YZW_placeITM = (obj, E, N) => { if (!place(obj, E, N)) Q.push([obj, E, N]); };
  YZW.register({ id: 'lab-place-itm', order: 0,
    init(world) { scene = world.scene; },
    update() { for (let i = Q.length - 1; i >= 0; i--) if (place(...Q[i])) Q.splice(i, 1); },
    dispose() {} });
})();
