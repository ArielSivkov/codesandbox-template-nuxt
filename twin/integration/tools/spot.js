// צילום מנקודה קבועה (לפני/אחרי מאותו מקום): node tools/spot.js <out.png> <base-url-path> <x,z,eyeH,headingDeg,pitchDeg> [hh:mm] [WxH]
// דוגמה: node tools/spot.js shots/villa-after.png world/index.html -1475,262,1.6,200,2 12:00 360x800
const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => {
  const [out, path, pose, tm = '12:00', size = '360x800'] = process.argv.slice(2);
  const [x, z, eh, hd, pt] = pose.split(',').map(Number), [w, h] = size.split('x').map(Number);
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { const t = setInterval(() => { if (!window.YZW) return; clearInterval(t);
    YZW.register({ id: 'photo-cam', name: 'מצלמת השוואה (בדיקה)', dept: 'test', order: 99, init() {},
      modes: [{ id: 'photo', name: 'צילום', icon: '📷', enter() {}, update(dt, wd) { const P = window.__pose; if (!P) return null; const c = wd.camera; c.position.set(P.x, P.y, P.z);
        c.lookAt(P.x + Math.sin(P.h) * Math.cos(P.p) * 10, P.y + Math.sin(P.p) * 10, P.z - Math.cos(P.h) * Math.cos(P.p) * 10); c.fov = P.fov; c.near = 0.2; c.updateProjectionMatrix();
        if (wd.sky) wd.sky.position.copy(c.position); return { x: P.x, y: P.y - P.eh, z: P.z, speed: 0 }; } }] }); }, 5); });
  await p.goto(`http://localhost:8940/${path}?auto&nointro&clean=1&t=${tm}`);
  await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 240000 });
  await p.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading' && x.state !== 'registered'), null, { timeout: 180000 }).catch(() => {});
  await p.evaluate(({ x, z, eh, hd, pt, w, h }) => { const W = YZW.world, y = Math.max(0, W.data.H(x, z)) + eh; const it = W.coords.toITM(x, z); YZW.placeAt(it.E, it.N, 0);
    window.__pose = { x, y, z, eh, h: hd * Math.PI / 180, p: pt * Math.PI / 180, fov: w < h ? 70 : 55 }; YZW.setMode('photo'); }, { x, z, eh, hd, pt, w, h });
  await p.evaluate(async () => { const f = YZW.world.renderer.info.render.frame, t0 = Date.now(); while (YZW.world.renderer.info.render.frame - f < 16 && Date.now() - t0 < 120000) await new Promise(r => setTimeout(r, 60)); });
  await p.screenshot({ path: out }); console.log('shot', out, errs.length ? 'ERR ' + errs[0] : 'ok');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
