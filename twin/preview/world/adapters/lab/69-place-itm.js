// מיקום עצמים לפי רשת ישראל (ITM) – משותף לכל קבצי המעבדה שכתבו מודלי הענן
// העצם נכנס לסצנה מיד; הגובה מתעדכן כשאריח הקרקע שלו נטען (קודם לכן W.H מחזיר גובה ברירת מחדל ≈1 מ').
(function () {
  'use strict';
  const Q = [], G = []; let scene = null;
  function tileReady(W, x, z) { const E = x + W.OX, N = W.OY - z, t = W.tiles && W.tiles.get(Math.floor(E / 1000) + '_' + Math.floor(N / 1000)); return !!(t && t.hgt); }
  function place(obj, E, N) {
    const W = window.W27; if (!W || !W.toScene || !scene) return false;
    const s = ITM.itmToSample(E, N), p = W.toScene(s.E, s.N);
    obj.position.set(p.x, W.H ? Math.max(W.H(p.x, p.z) || 0, 0) : 0, p.z); obj.userData.itm = { E, N }; scene.add(obj);
    if (!tileReady(W, p.x, p.z)) G.push(obj); return true;
  }
  window.YZW_placeITM = (obj, E, N) => { if (!place(obj, E, N)) Q.push([obj, E, N]); };
  YZW.register({ id: 'lab-place-itm', order: 0,
    init(world) { scene = world.scene; },
    update() {
      for (let i = Q.length - 1; i >= 0; i--) if (place(...Q[i])) Q.splice(i, 1);
      const W = window.W27; if (!W) return;
      for (let i = G.length - 1; i >= 0; i--) { const o = G[i]; if (tileReady(W, o.position.x, o.position.z)) { o.position.y = Math.max(W.H(o.position.x, o.position.z) || 0, 0); G.splice(i, 1); } }
    },
    dispose() {} });
})();
