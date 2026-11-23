// לפני/אחרי מאותן נקודות: טעינה אחת, כמה נקודות × כמה שעות. node tools/spots.js <outdir> <tag> <world-path> [WxH] [extra-query]
// הנקודות והשעות קבועות כאן (מתועדות בדוח): רחוב הארז בגובה עיניים; מבט מוגבה על השכונה ומגדלי הדקל.
const { chromium } = require('/tmp/pw/node_modules/playwright');
const fs = require('fs');
const SPOTS = { street: [-1508, 244, 1.6, 204, 3], above: [-1440, 150, 45, 219, -12] };
const TIMES = { day: '10:00', golden: '15:58', night: '01:00' };
(async () => {
  const [outdir, tag, path, size = '412x915', extra = ''] = process.argv.slice(2); fs.mkdirSync(outdir, { recursive: true });
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  p.setDefaultTimeout(240000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { const t = setInterval(() => { if (!window.YZW) return; clearInterval(t);
    YZW.register({ id: 'photo-cam', name: 'מצלמת השוואה (בדיקה)', dept: 'test', order: 99, init() {},
      modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, wd) { const P = window.__pose; if (!P) return null; const c = wd.camera; c.position.set(P.x, P.y, P.z);
        c.lookAt(P.x + Math.sin(P.h) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z - Math.cos(P.h) * Math.cos(P.p) * 10); c.fov = P.fov; c.near = 0.2; c.updateProjectionMatrix();
        if (wd.sky) wd.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; } }] }); }, 5); });
  await p.goto(`http://localhost:8940/${path}?auto&nointro&clean=1&d=2026-11-23&t=10:00${extra}`);
  await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 300000 });
  await p.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading' && x.state !== 'registered'), null, { timeout: 240000 }).catch(() => {});
  const frames = n => p.evaluate(async n => { const f = YZW.world.renderer.info.render.frame, t0 = Date.now(); while (YZW.world.renderer.info.render.frame - f < n && Date.now() - t0 < 150000) await new Promise(r => setTimeout(r, 60)); }, n);
  for (const [sk, [x, z, eh, hd, pt]] of Object.entries(SPOTS)) {
    await p.evaluate(({ x, z, eh, hd, pt, w, h }) => { const W = YZW.world, y = Math.max(0, W.data.H(x, z)) + eh; const it = W.coords.toITM(x, z); YZW.placeAt(it.E, it.N, 0);
      window.__pose = { x, y, z, eh, h: hd * Math.PI / 180, p: pt * Math.PI / 180, fov: w < h ? 70 : 55 }; YZW.setMode('photo'); }, { x, z, eh, hd, pt, w, h });
    for (const [tk, tm] of Object.entries(TIMES)) {
      const [hh, mm] = tm.split(':').map(Number);
      await p.evaluate(({ hh, mm }) => { YZW.setWeather({ cloud: 0.35, rain: 0, aqi: 40 }); YZW.setTime({ ymd: '2026-11-23' }); YZW.setTime({ min: hh * 60 + mm, rate: 0 }); }, { hh, mm });
      await frames(14); await p.screenshot({ path: `${outdir}/${sk}-${tk}-${tag}.png`, timeout: 240000 }); console.log('shot', sk, tk, tag);
    }
  }
  const st = await p.evaluate(() => ({ calls: YZW.world.stats.calls, tris: YZW.world.stats.tris, faults: YZW.faults, tier: YZW.world.quality.tier }));
  fs.writeFileSync(`${outdir}/stats-${tag}.json`, JSON.stringify({ st, errs }, null, 1)); console.log(JSON.stringify(st), errs.slice(0, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
