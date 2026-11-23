/* מתאם: מחלקת הדמויות (swarm/npc/js: life, dialogue, crowd, npc) — אנשים אמיתיים (Quaternius CC0, VAT), שגרות, שבת, שיח.
 * מחליף את הולכי הרגל-קופסאות של גרסת הגישור (life-lite ממשיך רק עם הרכבים; צפיפות הרכבים מ-npc.density()).
 * שעון = שעון העולם (לא new Date) → אותה שעה, אותה שבת; גשם = מזג האוויר האחד. מצלמה אחת לכל המוצר (F5 של המארח).
 * הקשה על דמות → שיח (לפני הקשה על בניין). "הדגמת הדמויות" של המחלקה = כאן מצב/פריסט: ?people=busy / ?t=17:30.
 */
(function () {
  'use strict';
  const N = { npc: null, cv: null };
  YZW.register({
    id: 'npc', name: 'דמויות: אנשים, שגרות, שבת, שיח', dept: 'npc', order: 58, timeoutMs: 90000,
    scripts: ['mods/npc/js/life.js', 'mods/npc/js/dialogue.js', 'mods/npc/js/crowd.js', 'mods/npc/js/npc.js'], requires: () => !!(window.NPC && window.NPC.create),
    async init(world, api) {
      const G = world.G27, S = G.S;
      const posOf = () => { const p = world.player.pos, m = world.player.mode; return { x: p.x, z: p.z, vx: m === 'car' ? Math.sin(S.car.h) * S.car.v : 0, vz: m === 'car' ? Math.cos(S.car.h) * S.car.v : 0, speed: world.player.speed || 0,
        mode: m === 'car' ? 'car' : m === 'walk' || m === 'jetpack' ? 'foot' : 'air' }; };
      N.npc = await NPC.create({ scene: api.group(), camera: world.camera, renderer: world.renderer, W: world.data.W, assets: 'assets/', vendor: 'vendor/', data: 'mods/npc/data/dialogues.json',
        player: posOf, clock: () => world.clock.date, weather: () => ({ rain: world.weather.rain || 0 }) });
      const p = posOf(); N.npc.spawnAround(p.x, p.z); N.npc.warmup(30, 5);
      world.providers.pedestrians = 'npc'; world.providers.density = () => N.npc.density();
      N.cv = world.renderer.domElement; let down = null;
      N.pd = e => { down = { x: e.clientX, y: e.clientY }; }; N.pu = e => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return; try { if (N.npc.tap(e.clientX, e.clientY)) { e.stopImmediatePropagation(); e.preventDefault(); } } catch (er) { /* */ } };
      N.cv.addEventListener('pointerdown', N.pd, true); N.cv.addEventListener('pointerup', N.pu, true);
      window.G27NPC = N.npc;
    },
    update(dt, world) { if (!world.player.inside) N.npc.update(Math.min(0.05, dt)); },
    dispose(world) { if (N.cv) { N.cv.removeEventListener('pointerdown', N.pd, true); N.cv.removeEventListener('pointerup', N.pu, true); }
      world.providers.pedestrians = null; world.providers.density = null; try { N.npc && N.npc.dispose && N.npc.dispose(); } catch (e) { /* */ } N.npc = null; },
  });
})();
