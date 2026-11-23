/* מתאם: המחלקה הימית (swarm/maritime/maritime.js — ES module): ים עם גלים לפי הרוח, נמל, מרינה, אוניות, חוף, ומצב "סירה".
 * מסגרות: מאפייני הים (fixtures) ב-ITM אמיתי → toScene מזיז למסגרת הדגימה (אמיתי = דגימה + 1507.82/757.76), כמו בהדגמה שלהם.
 * סיווג יבשה/ים: W27.H (אותו מקור קרקע של העולם). הים הפשוט של המשחק מוסתר כשהמודול פעיל ומוחזר אם נכשל.
 * שמש/שמיים/ערפל/רוח – ממקור האמת האחד (אירוע env).
 */
(function () {
  'use strict';
  const SHIFT = { dE: 1507.82, dN: 757.76 };
  const X = { M: null, boat: null, mod: null, seaWas: true };
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  function sky(world) { const M = X.M; if (!M) return; const u = world.sky && world.sky.material.uniforms, f = world.scene.fog;
    M.setWind(world.weather.wind); M.setSun(world.sun.dir);
    M.setSky({ top: u && u.top.value, hor: u && u.hor.value, fogColor: f && f.color, fogNear: f && f.near, fogFar: f && f.far }); }
  YZW.register({
    id: 'maritime', name: 'ים, נמל, מרינה, אוניות, סירה', dept: 'maritime', order: 45, provides: ['boat'], timeoutMs: 40000,
    async init(world, api) {
      const W = world.data, WW = W.W;
      X.mod = await import(new URL('mods/maritime/maritime.js', location.href).href);
      const fx = await (await fetch('mods/maritime/fixtures/ashdod_maritime_fixture.json')).json();
      const tileFrame = { toITM: (x, z) => WW.toITM(x, z), toScene: (E, N) => WW.toScene(E, N) };
      X.M = X.mod.createMaritime(THREE, { scene: api.group(), toScene: (E, N) => WW.toScene(E - SHIFT.dE, N - SHIFT.dN), tileFrame, bboxITM: WW.manifest.bbox_itm, features: fx.features,
        classify: (x, z) => { const h = W.H(x, z); return { land: h > 0.3, h }; }, isBuilding: (x, z, pad) => !!W.buildingAt(x, z, pad || 0) });
      if (WW.sea) { X.seaWas = WW.sea.visible; WW.sea.visible = false; }
      api.on('env', () => sky(world)); sky(world);
    },
    update(dt, world) { if (!X.M) return; if (world.data.W.sea) world.data.W.sea.visible = false; const cam = world.camera; if (cam.far < 4500) { cam.far = 4500; cam.updateProjectionMatrix(); }   // ים עד האופק (המשחק חותך ב-fog+600)
      X.M.update(dt, cam, { boats: X.boat ? [X.boat] : [] }); },
    dispose(world) { const WW = world.data.W; if (WW.sea) WW.sea.visible = X.seaWas; X.M = null; X.boat = null; },
    modes: [{
      id: 'boat', name: 'סירה', icon: '🚤', sub: 'מהמרינה',
      enter(world, from, pos) {
        const M = X.M; let x = pos.x, z = pos.z;
        const lights = M.features.filter(f => f.kind === 'light').slice(-2);
        if (lights.length === 2) { x = (lights[0].pts[0][0] + lights[1].pts[0][0]) / 2 + 25; z = (lights[0].pts[0][1] + lights[1].pts[0][1]) / 2 + 70; }
        if (!M.isWater(x, z)) { for (let d = 20; d < 4000; d += 20) if (M.isWater(pos.x - d, pos.z)) { x = pos.x - d - 30; z = pos.z; break; } }
        X.boat = M.createBoat(x, z, Math.PI * 0.9); world.G27.S.cam.yaw = Math.PI * 0.9; world.G27.S.cam.pitch = 0.25;
        YZW.notice('🚤 סירה: ג׳ויסטיק = מצערת והגה · ▲ טורבו · ▼ אחורה', { kind: 'info', ms: 3000 });
      },
      exit(world) { if (X.boat) { X.boat.mesh.parent && X.boat.mesh.parent.remove(X.boat.mesh); X.boat.mesh.material.dispose(); X.boat = null; } },
      update(dt, world, inp) {
        const b = X.boat, s = b.state, G = world.G27, c = G.S.cam, cam = world.camera;
        b.step(dt, { throttle: inp.down ? -1 : inp.y, steer: inp.x, boost: inp.up });
        if (Math.abs(s.u) > 1.5) c.yaw += angDiff(c.yaw, s.h) * Math.min(1, dt * 2.2);
        const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), d = 13, tx = s.x, ty = s.y + 1.4, tz = s.z;
        const want = new THREE.Vector3(tx - Math.sin(c.yaw) * cp * d, ty + sp * d, tz - Math.cos(c.yaw) * cp * d); if (want.y < 1) want.y = 1;
        if (cam.position.distanceTo(want) > 80) cam.position.copy(want); else cam.position.lerp(want, 1 - Math.exp(-dt * 10)); cam.lookAt(tx, ty, tz);
        if (world.sunLight && world.sky) { const v = world.sky.material.uniforms.sun.value; world.sunLight.target.position.set(tx, ty, tz); world.sunLight.position.set(tx + v.x * 400, ty + v.y * 400, tz + v.z * 400); }
        return { x: s.x, y: s.y, z: s.z, speed: Math.abs(s.u), alt: 0 };
      },
    }],
    hudPanels: [{ id: 'boat', render(el, world) { if (world.player.mode !== 'boat' || !X.boat) return; const s = X.boat.state; el.textContent = `⚓ ${X.mod.knots(Math.abs(s.u)).toFixed(0)} קשר${s.planing ? ' · גלישה' : ''}`; } }],
  });
})();
