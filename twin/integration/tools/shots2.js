// צילומים משלימים (פורטרט 360×800): מטוס, חללית, סירה, לילה עם פנסים, פתיחה בשעת זהב
const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => { const OUT = '/home/claude/swarm/integration/shots/';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  await p.goto('http://localhost:8940/world/index.html?auto&nointro'); await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 180000 });
  const frames = n => p.evaluate(async n => { const f = YZW.world.renderer.info.render.frame; while (YZW.world.renderer.info.render.frame - f < n) await new Promise(r => setTimeout(r, 50)); }, n);
  await p.waitForFunction(() => YZW.plugins().every(x => x.state !== 'loading'), null, { timeout: 120000 });
  await frames(8); await p.screenshot({ path: OUT + 'v2-first-impression-port.png' });
  for (const m of ['jet', 'spaceship', 'boat']) { await p.evaluate(m => YZW.setMode(m), m); await frames(10); await p.screenshot({ path: OUT + 'v2-mode-' + m + '-port.png' }); console.log(m); }
  await p.evaluate(() => { YZW.setMode('walk'); YZW.goHome(); YZW.setTime({ preset: 'night' }); }); await frames(25); await p.screenshot({ path: OUT + 'v2-night-port.png' });
  await b.close(); })().catch(e => { console.error(e); process.exit(1); });
