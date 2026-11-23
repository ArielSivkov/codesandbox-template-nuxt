/* מתאם: מחלקת התעופה (swarm/aviation/src/modes.js): מצבי "מטוס סילון" ו"חללית" (createJetMode / createShipMode).
 * מסגרת: LocalFrame ברירת מחדל = ראשית המשחק (166265, 634406 ITM, מסגרת הדגימה) → אותו מרחב סצנה. העיר = W27 (H, collide, bounds).
 * גרסה ראשונה: בלי השדה הרחוק (FarField: ישראל/גלובוס) — מחוץ לעיר "ים". גלובוס אחד בתיאום עם מחלקת הכיסוי הארצי — בשלב הבא.
 * קלט: ג׳ויסטיק = הגה (קדימה = אף למטה), ▲/▼ = מצערת למעלה/למטה (נשמרת), מקשים כמו במשחק. מתחילים באוויר מעל המיקום הנוכחי.
 * מסלול ההמראה במודול שלהם בדיוני (מסומן) ולכן לא מוצב כאן. ריצה נמוכה מעל העיר = ~433 אלף משולשים → בטלפון מגבילים את רדיוס הטעינה.
 */
(function () {
  'use strict';
  const A = { mod: null, geo: null, frame: null, wphys: null, jet: null, ship: null, thr: 0.8 };
  function input(inp, dt) { if (inp.up) A.thr = Math.min(1, A.thr + dt * 0.5); if (inp.down) A.thr = Math.max(0, A.thr - dt * 0.5);
    return { pitch: -inp.y, roll: inp.x, yaw: (inp.yawR ? 1 : 0) - (inp.yawL ? 1 : 0), throttle: A.thr, thrust: A.thr, boost: false, brake: false, edges: new Set() }; }
  function mkMode(id, name, icon, key) {
    return { id, name, icon, sub: key === 'jet' ? 'F-16 (פיזיקה)' : 'מסלול', 
      enter(world, from, pos) { const m = A[key], G = world.G27; A.thr = key === 'jet' ? 0.85 : 0.3;
        const hd = (180 - G.S.cam.yaw * 180 / Math.PI + 360) % 360, gy = Math.max(0, world.data.H(pos.x, pos.z));
        m.enter({ x: pos.x, y: gy + (key === 'jet' ? 450 : 1500), z: pos.z, heading: hd, speed: key === 'jet' ? 190 : 400, onGround: false, throttle: A.thr });
        const W = world.data.W; A.radius0 = W.hiRadius; if (world.quality.tier !== 'high') W.hiRadius = Math.min(W.hiRadius, 400);   // תקציב משולשים בטיסה נמוכה
        YZW.notice((key === 'jet' ? '✈ מטוס' : '🚀 חללית') + ': ג׳ויסטיק = הגה · ▲/▼ = מצערת', { kind: 'info', ms: 3000 }); },
      exit(world) { A[key].exit(); if (A.radius0) world.data.W.hiRadius = A.radius0; },
      update(dt, world, inp) { const m = A[key]; m.update(dt, input(inp, dt)); m.updateCamera(dt, world.camera);
        const cam = world.camera; if (cam.far < 8000) { cam.far = 8000; cam.updateProjectionMatrix(); } const f = world.scene.fog; if (f && f.far < 6000) { f.far = 6000; f.near = 2000; }
        const p = m.sim.pos, v = m.sim.vel || { x: 0, y: 0, z: 0 }; return { x: p.x, y: p.y, z: p.z, speed: Math.hypot(v.x, v.y, v.z), alt: p.y - Math.max(0, world.data.H(p.x, p.z)) }; } };
  }
  YZW.register({
    id: 'aviation', name: 'תעופה: מטוס סילון וחללית', dept: 'aviation', order: 55, provides: ['jet', 'spaceship'],
    async init(world, api) {
      A.mod = await import(new URL('mods/aviation/src/modes.js', location.href).href);
      A.geo = await import(new URL('mods/aviation/src/geo.js', location.href).href);
      const W = world.data.W; A.frame = new A.geo.LocalFrame(W.OX, W.OY);
      A.wphys = A.mod.makeWorld({ frame: A.frame, far: null, city: W, runway: null });
      const g = api.group();
      A.jet = A.mod.createJetMode({ THREE, scene: g, world: A.wphys, frame: A.frame });
      A.ship = A.mod.createShipMode({ THREE, scene: g, world: A.wphys, frame: A.frame });
    },
    dispose() { A.jet = A.ship = null; },
    modes: [mkMode('jet', 'מטוס סילון', '✈', 'jet'), mkMode('spaceship', 'חללית', '🚀', 'ship')],
    hudPanels: [{ id: 'av', render(el, world) { const m = world.player.mode === 'jet' ? A.jet : world.player.mode === 'spaceship' ? A.ship : null; if (!m) return;
      let h = {}; try { h = m.hudData() || {}; } catch (e) { /* */ } el.textContent = `${world.player.mode === 'jet' ? '✈' : '🚀'} מצערת ${(A.thr * 100) | 0}%` + (h.G != null ? ` · G ${(+h.G).toFixed(1)}` : '') + (h.stall ? ' · ⚠ הזדקרות' : ''); } }],
  });
})();
