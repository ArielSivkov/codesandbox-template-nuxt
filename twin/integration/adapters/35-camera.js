/* מצלמה בסגנון F5 של מיינקראפט — כפתור 🎥 / מקש V / F5 מחליף: (1) גוף ראשון בגובה עיניים, (2) מאחור, (3) מלפנים מביט אחורה.
 * חל על רגלי/תרמיל (עיניים 1.6 מ׳), רכב (תא נהג), מסוק (תא טייס), רחפן (מצלמת גימבל).
 * (2) = המצלמה המקורית של המשחק (לא נוגעים). (1)/(3) נכתבות אחרי המשחק, עם ריכוך ומניעת כניסה לקירות.
 * שדה ראייה בגוף ראשון: 68° אנכי בפורטרט, 56° בנוף (≈ 90° אופקי) — לכיול מול תמונות הרחוב של אריאל (fieldphotos/).
 */
(function () {
  'use strict';
  const NAMES = ['גוף ראשון', 'מאחור', 'מלפנים'], ICONS = ['👁', '🎥', '🤳'];
  const C = { view: 1, pos: null, look: null, blend: 1, hidden: false, fov0: null };
  const EYE = 1.6;
  function cycle() { C.view = (C.view + 1) % 3; C.blend = 0; const b = document.getElementById('yzCam'); if (b) b.textContent = ICONS[C.view]; YZW.notice('מצלמה: ' + NAMES[C.view], { kind: 'info', ms: 1200 }); }
  function target(world) {
    const G = world.G27, S = G.S, m = world.player.mode;
    if (m === 'car') return { x: S.car.x, y: S.car.y, z: S.car.z, h: S.car.h, eye: 1.25, fwd: 0.1, side: 0.38, back: 9, kind: 'car' }   /* נהג משמאל (ישראל) */;
    if (m === 'heli') return { x: S.heli.x, y: S.heli.y, z: S.heli.z, h: S.heli.h, eye: 1.7, fwd: 1.6, side: -0.3, back: 19, kind: 'heli' };
    if (m === 'drone') { const d = G.drone; return { x: d.position.x, y: d.position.y, z: d.position.z, h: S.cam.yaw, eye: -0.08, fwd: 0.15, side: 0, back: 3.4, kind: 'drone' }; }
    if (m === 'walk' || m === 'jetpack') return { x: S.p.x, y: S.p.y, z: S.p.z, h: S.cam.yaw, eye: EYE, fwd: 0.12, side: 0, back: 5.2, kind: 'foot' };
    return null;   // מצבי תוספים אחרים (מטוס/סירה/יזם) מנהלים מצלמה משלהם
  }
  function clearOf(world, x, y, z) { const b = world.data.buildingAt(x, z, 0.3); return !(b && y < b.top + 0.4 && y > b.base - 1); }
  function setPlayerVisible(world, v) { const pl = world.scene.getObjectByName('player'); if (pl) pl.visible = v; C.hidden = !v; }
  YZW.register({
    id: 'camera', name: 'מצלמה: גוף ראשון / מאחור / מלפנים', dept: 'integration', order: 35, late: true,
    init(world, api) {
      const top = document.getElementById('top');
      if (top && !document.getElementById('yzCam')) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'yzCam'; b.setAttribute('aria-label', 'החלפת מבט מצלמה'); b.textContent = ICONS[C.view]; b.onclick = cycle; top.insertBefore(b, document.getElementById('bMine')); }
      C.key = e => { if (e.target && e.target.tagName === 'INPUT') return; if (e.code === 'KeyV' || e.code === 'F5') { e.preventDefault(); cycle(); } };
      addEventListener('keydown', C.key);
      api.on('mode', () => { C.blend = 0; if (C.hidden) setPlayerVisible(world, true); });
    },
    update(dt, world) {
      const G = world.G27, S = G.S, cam = world.camera;
      if (!S.started || S.inside || YZW.intro.on || YZW.paused) { if (C.hidden) setPlayerVisible(world, true); return; }
      const t = target(world);
      const portrait = innerWidth < innerHeight;
      if (!t || C.view === 1) { if (C.hidden && world.player.mode !== 'drone') setPlayerVisible(world, true); if (C.fov0) { cam.fov = portrait ? 72 : 60; cam.updateProjectionMatrix(); C.fov0 = null; } C.pos = null; return; }
      const h = t.h, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
      let pos, look;
      if (C.view === 0) {
        const pitch = t.kind === 'foot' || t.kind === 'drone' ? -(S.cam.pitch - 0.3) * 1.3 : -0.05;
        pos = new THREE.Vector3(t.x + fx * t.fwd + rx * t.side, t.y + t.eye, t.z + fz * t.fwd + rz * t.side);
        if (t.kind === 'foot') pos.y += Math.sin(S.t * 9) * Math.min(S.speed, 6) * 0.006;   // נדנוד הליכה עדין
        look = new THREE.Vector3(pos.x + fx * 10 * Math.cos(pitch), pos.y + Math.sin(pitch) * 10, pos.z + fz * 10 * Math.cos(pitch));
        if (t.kind === 'foot' && !C.hidden) setPlayerVisible(world, false);
        cam.near = 0.08; cam.fov = portrait ? 68 : 56; C.fov0 = true;
      } else {
        // מלפנים: המצלמה מול הדמות ומביטה עליה, עם קיצור מרחק מול קירות
        const cp = Math.cos(S.cam.pitch), sp = Math.sin(S.cam.pitch); let d = Math.min(t.back, S.cam.dist || t.back);
        const ty = t.y + (t.kind === 'foot' ? 1.5 : t.eye);
        for (let i = 0; i < 8; i++) { const px = t.x + fx * cp * d, pz = t.z + fz * cp * d, py = ty + sp * d; if (clearOf(world, px, py, pz)) break; d *= 0.75; }
        d = Math.max(d, 1.4);
        pos = new THREE.Vector3(t.x + fx * cp * d, ty + sp * d, t.z + fz * cp * d); const g = Math.max(world.data.H(pos.x, pos.z), 0) + 0.4; if (pos.y < g) pos.y = g;
        look = new THREE.Vector3(t.x, ty, t.z);
        if (C.hidden) setPlayerVisible(world, true);
        if (C.fov0) { cam.fov = portrait ? 72 : 60; C.fov0 = null; }
      }
      // מעבר רך: 0.35 ש׳ מהמבט הקודם
      C.blend = Math.min(1, C.blend + dt / 0.35); const k = C.blend < 1 ? 1 - Math.exp(-dt * 10) : (C.view === 0 ? 1 : 1 - Math.exp(-dt * 16));
      if (!C.pos) { C.pos = cam.position.clone(); C.look = look.clone(); }
      C.pos.lerp(pos, k); C.look.lerp(look, C.view === 0 && C.blend >= 1 ? 1 : k);
      cam.position.copy(C.pos); cam.lookAt(C.look); cam.updateProjectionMatrix();
      if (world.sky) world.sky.position.copy(cam.position);
    },
    dispose(world) { removeEventListener('keydown', C.key); const b = document.getElementById('yzCam'); if (b) b.remove(); if (C.hidden) setPlayerVisible(world, true); },
    settings: [{ id: 'view', label: 'מבט מצלמה', type: 'select', options: [['0', 'גוף ראשון'], ['1', 'מאחור'], ['2', 'מלפנים']], get: () => String(C.view), set: v => { C.view = +v; C.blend = 0; } }],
  });
  window.YZCam = { cycle, get view() { return C.view; }, set view(v) { C.view = v; C.blend = 0; } };
})();
