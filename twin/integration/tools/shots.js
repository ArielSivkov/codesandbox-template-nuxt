// צילומי מסך 360×800 (פורטרט) ו-800×360 (נוף) לכל מצב → shots/<שם>-<כיוון>.png
// node tools/shots.js [port|land|both]
const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => {
  const which = process.argv[2] || 'both', OUT = '/home/claude/swarm/integration/shots/';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const sizes = { port: [360, 800], land: [800, 360] };
  for (const [o, [w, h]] of Object.entries(sizes)) { if (which !== 'both' && which !== o) continue;
    const p = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })).newPage();
    await p.goto('http://localhost:8940/world/index.html?auto&nointro'); await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 180000 });
    const frames = async n => { await p.evaluate(async n => { const f = YZW.world.renderer.info.render.frame; while (YZW.world.renderer.info.render.frame - f < n) await new Promise(r => setTimeout(r, 50)); }, n); };
    const shot = async name => { await frames(4); await p.screenshot({ path: `${OUT}${name}-${o}.png` }); console.log('shot', name, o); };
    await frames(10);
    await shot('01-first-impression-golden-hour');
    const plan = [['walk', null], ['car', null], ['heli', s => { s.heli.y += 60; }], ['jetpack', null], ['drone', null], ['dev', null]];
    for (const [m, f] of plan) { await p.evaluate(([m]) => YZW.setMode(m), [m]); if (f) await p.evaluate(`(${f})(YZW.world.G27.S)`); await frames(8); await shot('mode-' + m); }
    await p.evaluate(() => YZDev.setLayer('height')); await frames(4); await shot('eye-layer-height'); await p.evaluate(() => YZDev.setLayer('none'));
    await p.evaluate(() => { const c = YZW.world.player.pos; YZDev.startDraw(); [[0, 0], [70, 0], [80, 50], [-10, 45]].forEach(([x, z]) => YZDev.addPoint(c.x + x, c.z + z)); YZDev.finish(); }); await frames(4); await shot('eye-lot-card');
    await p.evaluate(() => { document.getElementById('card').style.display = 'none'; YZW.setMode('walk'); }); await frames(15);
    await p.evaluate(() => { YZCam.view = 0; }); await frames(8); await shot('cam-first-person');
    await p.evaluate(() => { YZCam.view = 2; }); await frames(8); await shot('cam-front');
    await p.evaluate(() => { YZCam.view = 1; YZW.setTime({ preset: 'night' }); }); await frames(10); await shot('night-lights');
    await p.evaluate(() => { YZW.setTime({ preset: 'noon' }); YZW.setWeather({ aqi: 220 }); }); await frames(8); await shot('noon-haze-aqi220');
    await p.evaluate(() => { YZW.setWeather({ aqi: 45, rain: 8, cloud: 0.9 }); }); await frames(8); await shot('rain');
    await p.evaluate(() => { YZW.setWeather({ rain: 0, cloud: 0.2 }); YZW.setTime({ preset: 'golden' }); YZW.openSheet('modes'); }); await frames(3); await shot('menu-modes');
    await p.evaluate(() => YZW.openSheet('settings')); await frames(3); await shot('menu-settings');
    await p.evaluate(() => YZW.openSheet('modules')); await frames(3); await shot('menu-modules');
    await p.evaluate(() => YZW.closeSheet());
    await p.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
