// סבב יום (עדכון היופי ביום): מרנדר את העולם מנקודות מבט משוערות של תמונות היום (23.11.2026 13:30) → rounds/renders/<tag>/<id>.png
// node tools/photo_day.js <tag> [url-extra]    env: WPATH (world), TIER (low|medium; ריק = auto), SIZE (240x320), IDS (055,062,064,061), TM (13:30)
// התנוחות משוערות (מסגרת הדגימה של camera_poses.json): רחוב הארז ציר 23.6°/203.6°, המועדון בקצה הצפוני (ראו photolearn/poses.json 039).
// side = היסט לצד שמאל של המבט במטרים (מדרכה). אין כאן פיקסלים מהתמונות — רק נתוני תנוחה.
const { chromium } = require('/tmp/pw/node_modules/playwright');
const fs = require('fs');
const POSES = {
  '055': { x: 164744, y: 634138, h: 22, p: 4, side: 5.5, eh: 1.5 },   // מדרכה מערבית, מבט צפונה למועדון
  '062': { x: 164748, y: 634150, h: 22, p: 6, side: 5.0, eh: 1.5 },   // מדרכה, עציץ דקל, מועדון ברקע
  '064': { x: 164752, y: 634160, h: 24, p: 3, side: 5.0, eh: 1.5 },   // מדרכה אדומה עם פס בהיר, גדרות כהות
  '061': { x: 164757, y: 634186, h: 45, p: 7, side: 0.0, eh: 1.5 },   // חניה מול חזית המועדון
};
(async () => {
  const tag = process.argv[2] || 'dtest', extra = process.argv[3] || '';
  const [vw, vh] = (process.env.SIZE || '240x320').split('x').map(Number);
  const ids = (process.env.IDS || Object.keys(POSES).join(',')).split(',');
  const TM = (process.env.TM || '13:30').split(':').map(Number);
  const tier = process.env.TIER ? '&tier=' + process.env.TIER : '';
  const OUT = `/home/claude/swarm/integration/rounds/renders/${tag}/`; fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
  p.setDefaultTimeout(240000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|GL Driver|404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  await p.addInitScript(() => { const t = setInterval(() => { if (!window.YZW) return; clearInterval(t);
    YZW.register({ id: 'photo-cam', name: 'מצלמת השוואה (בדיקה)', dept: 'test', order: 99, init() {},
      modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, w) { const P = window.__pose; if (!P) return null; const c = w.camera; c.position.set(P.x, P.y, P.z);
        c.lookAt(P.x + Math.sin(P.h) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z - Math.cos(P.h) * Math.cos(P.p) * 10); c.fov = P.fovV; c.near = 0.2; c.updateProjectionMatrix();
        if (w.sky) w.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; } }] }); }, 5); });
  const t0 = Date.now();
  await p.goto('http://localhost:8940/' + (process.env.WPATH || 'world') + `/index.html?auto&nointro&clean=1&d=2026-11-23&t=${process.env.TM || '13:30'}` + tier + extra);
  await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 300000 });
  await p.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading' && x.state !== 'registered'), null, { timeout: 180000 }).catch(() => {});
  const res = { loadS: (Date.now() - t0) / 1000 };
  for (const id of ids) {
    const P = POSES[id]; const aspect = vw / vh, fovH = aspect < 1 ? 54.9 : 69.4;
    const fovV = 2 * Math.atan(Math.tan(fovH * Math.PI / 360) / aspect) * 180 / Math.PI;
    await p.evaluate(({ P, fovV, TM }) => { const W = YZW.world, hr = P.h * Math.PI / 180;
      const lx = P.x - Math.cos(hr) * P.side, ly = P.y + Math.sin(hr) * P.side;   // שמאל של המבט (מזרח=+x, צפון=+y)
      const s = W.data.W.toScene(lx, ly), y = Math.max(0, W.data.H(s.x, s.z)) + P.eh;
      YZW.setWeather({ cloud: 0.08, rain: 0, windSpeed: 3, aqi: 30 }); YZW.setTime({ ymd: '2026-11-23' }); YZW.setTime({ min: TM[0] * 60 + TM[1], rate: 0 });
      YZW.placeAt(lx, ly, 0); window.__pose = { x: s.x, y, z: s.z, eh: P.eh, h: hr, p: P.p * Math.PI / 180, fovV }; YZW.setMode('photo'); }, { P, fovV, TM });
    await p.evaluate(async () => { const f = YZW.world.renderer.info.render.frame; const t0 = Date.now(); while (YZW.world.renderer.info.render.frame - f < 16 && Date.now() - t0 < 120000) await new Promise(r => setTimeout(r, 60)); });
    await p.screenshot({ path: OUT + id + '.png' });
    res[id] = await p.evaluate(() => ({ calls: YZW.world.stats.calls, tris: YZW.world.stats.tris, faults: YZW.faults.length, tier: YZW.world.quality.tier }));
    console.log('rendered', id, JSON.stringify(res[id]));
  }
  res.plugins = await p.evaluate(() => YZW.plugins().map(x => x.id + ':' + x.state).join(' '));
  res.errors = errs.slice(0, 6); res.nErrors = errs.length;
  console.log('errors', errs.length, JSON.stringify(errs.slice(0, 3)));
  fs.writeFileSync(OUT + 'render.json', JSON.stringify(res, null, 1)); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
