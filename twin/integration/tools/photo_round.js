// סבב שימור-שיפור: מרנדר את העולם מאותן נקודות מבט של תמונות השטח (לילה 23.11.2026) → rounds/renders/<tag>/<id>.png
// node tools/photo_round.js <tag> [url-extra]
// התנוחות מ-swarm/procgen/data/camera_poses.json (מסגרת הדגימה; גובה עיניים 1.5 מ'); pitch לפי התמונה (מוערך בעין, מתועד כאן).
const { chromium } = require('/tmp/pw/node_modules/playwright');
const fs = require('fs');
const POSES = JSON.parse(fs.readFileSync('/home/claude/swarm/procgen/data/camera_poses.json', 'utf8')).poses;
const PICK = { '006': { pitch: 24, time: '01:00' }, '008': { pitch: 22, time: '01:00' }, '015': { pitch: 2, time: '01:06' }, '032': { pitch: 9, time: '01:21' } };
(async () => {
  const tag = process.argv[2] || 'test', extra = process.argv[3] || '';
  const OUT = `/home/claude/swarm/integration/rounds/renders/${tag}/`; fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = {};
  for (const portrait of [true, false]) {
    const ids = Object.keys(PICK).filter(id => (POSES.find(p => p.id === id).orientation === 'לאורך') === portrait); if (!ids.length) continue;
    const vp = portrait ? { width: 240, height: 320 } : { width: 320, height: 240 };
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { const t = setInterval(() => { if (!window.YZW) return; clearInterval(t);
      YZW.register({ id: 'photo-cam', name: 'מצלמת השוואה (בדיקה)', dept: 'test', order: 99, init() {},
        modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, w) { const P = window.__pose; if (!P) return null; const c = w.camera; c.position.set(P.x, P.y, P.z);
          c.lookAt(P.x + Math.sin(P.h) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z - Math.cos(P.h) * Math.cos(P.p) * 10); c.fov = P.fovV; c.near = 0.2; c.updateProjectionMatrix();
          if (w.sky) w.sky.position.copy(c.position); return { x: P.x, y: P.y - 1.5, z: P.z, speed: 0 }; } }] }); }, 5); });
    await p.goto('http://localhost:8940/world/index.html?auto&nointro&clean=1&d=2026-11-23&t=01:00' + extra);
    await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 240000 });
    await p.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading' && x.state !== 'registered'), null, { timeout: 180000 }).catch(() => {});
    for (const id of ids) {
      const P = POSES.find(q => q.id === id), K = PICK[id];
      const aspect = vp.width / vp.height, fovV = 2 * Math.atan(Math.tan(P.fov_h_deg * Math.PI / 360) / aspect) * 180 / Math.PI;
      await p.evaluate(({ P, K, fovV }) => { const W = YZW.world, s = W.data.W.toScene(P.x, P.y), y = Math.max(0, W.data.H(s.x, s.z)) + 1.5;
        YZW.setWeather({ cloud: 0.6, rain: 0, windSpeed: 3, aqi: 40 }); const [hh, mm] = K.time.split(':').map(Number); YZW.setTime({ ymd: '2026-11-23' }); YZW.setTime({ min: hh * 60 + mm, rate: 0 });
        YZW.placeAt(P.x, P.y, 0); window.__pose = { x: s.x, y, z: s.z, h: P.heading_deg * Math.PI / 180, p: K.pitch * Math.PI / 180, fovV }; YZW.setMode('photo'); }, { P, K, fovV });
      await p.evaluate(async () => { const f = YZW.world.renderer.info.render.frame; const t0 = Date.now(); while (YZW.world.renderer.info.render.frame - f < 14 && Date.now() - t0 < 90000) await new Promise(r => setTimeout(r, 60)); });
      await p.screenshot({ path: OUT + id + '.png' });
      res[id] = await p.evaluate(() => ({ calls: YZW.world.stats.calls, tris: YZW.world.stats.tris, faults: YZW.faults.length }));
      console.log('rendered', id, JSON.stringify(res[id]));
    }
    res['errors_' + (portrait ? 'p' : 'l')] = errs.slice(0, 3);
    await ctx.close();
  }
  fs.writeFileSync(OUT + 'render.json', JSON.stringify(res, null, 1)); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
