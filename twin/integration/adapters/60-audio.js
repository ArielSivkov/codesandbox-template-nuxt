/* מתאם: מחלקת הקול (swarm/audio/audio.js — ES module, Web Audio, הכול מסונתז).
 * צליל נפתח אחרי הנגיעה הראשונה (מדיניות autoplay). מקשיב = המצלמה. רכב השחקן לפי המצב הפעיל.
 * סביבה: מזג אוויר מהמקור האחד, מרחק לחוף (דגימה מערבה עד שהקרקע ים), צפיפות תנועה לפי כביש קרוב, שבת → setShabbat.
 * מיפוי מצבים: walk/car/heli→helicopter/jetpack/drone/jet/spaceship/boat ; dev/present → אווירה בלבד.
 */
(function () {
  'use strict';
  const A = { au: null, veh: null, vehMode: null, envT: 0, last: null, btn: null, muted: false };
  const MAP = { walk: 'walk', car: 'car', heli: 'helicopter', jetpack: 'jetpack', drone: 'drone', jet: 'jet', spaceship: 'spaceship', boat: 'boat' };
  function shoreDist(world, x, z) { const H = world.data.H; for (let d = 0; d <= 3000; d += 60) if (H(x - d, z) <= 0.05 && d > 0) return d; return 3000; }
  function stateFn(world) {
    return () => { const G = world.G27, S = G.S, m = world.player.mode, p = world.player.pos;
      const o = m === 'car' ? S.car : m === 'heli' ? S.heli : p; const sp = world.player.speed || 0;
      return { x: o.x, y: o.y, z: o.z, speed: sp, throttle: G.input.y > 0.1 || G.input.up ? 1 : 0.15, collective: G.input.up ? 1 : G.input.down ? -0.5 : 0.2, thrust: G.input.up ? 1 : 0.2, running: true, onGround: S.grounded, surface: 'asphalt' }; };
  }
  function bindVehicle(world) {
    const m = MAP[world.player.mode] || null; if (m === A.vehMode) return;
    if (A.veh) { try { A.veh.detach(); } catch (e) { /* */ } A.veh = null; } A.vehMode = m;
    if (m) A.veh = A.au.attachToVehicle(m, stateFn(world), { player: true });
  }
  YZW.register({
    id: 'audio', name: 'קול: עיר, ים, רוח, מנועים', dept: 'audio', order: 60,
    async init(world, api) {
      const mod = await import(new URL('mods/audio/audio.js', location.href).href);
      A.au = mod.createAudio({ shabbat: world.shabbat.active }); A.au.installUnlock(document);
      api.on('user-gesture', () => { try { A.au.unlock && A.au.unlock(); } catch (e) { /* */ } });
      api.on('mode', () => bindVehicle(world)); api.on('shabbat', s => A.au.setShabbat(s.active));
      api.on('env', () => { const w = world.weather; A.au.setEnvironment({ weather: { wind_10m_ms: w.windSpeed, gust_ms: w.windSpeed * w.gust, precip_mm: w.rain } }); });
      bindVehicle(world);
      const top = document.getElementById('top'); if (top) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'yzSnd'; b.setAttribute('aria-label', 'קול'); b.textContent = '🔊';
        b.onclick = () => { A.muted = !A.muted; A.au.setMuted(A.muted); b.textContent = A.muted ? '🔇' : '🔊'; }; top.insertBefore(b, document.getElementById('bMenu')); A.btn = b; }
    },
    update(dt, world) {
      if (!A.au) return; A.au.setListenerFromCamera(world.camera, dt);
      A.envT -= dt; if (A.envT <= 0) { A.envT = 1; const p = world.player.pos, road = world.data.onRoad(p.x, p.z);
        A.au.setEnvironment({ shoreDist: shoreDist(world, p.x, p.z), areaDist: { mainRoad: road ? 10 : 60, park: 300, port: Math.hypot(p.x - 600, p.z + 2600) } }); }
      A.au.update(dt);
    },
    dispose() { if (A.veh) try { A.veh.detach(); } catch (e) { /* */ } if (A.au) try { A.au.setMuted(true); } catch (e) { /* */ } if (A.btn) A.btn.remove(); A.au = null; A.veh = null; A.vehMode = null; },
  });
})();
