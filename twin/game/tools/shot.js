// בדיקת עשן + צילומים: node tools/shot.js [url]
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8765/index.html?auto';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(url); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 60000 });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: 'shots/01-foot-landscape.png' });
  console.log(JSON.stringify(await p.evaluate(() => ({ pos: G27.S.p, tiles: G27.W.tiles.size, biz: !!G27.biz.b, anim: Object.keys(G27.AN.acts).length, fps: G27.fps() }))));
  console.log(errs.slice(0, 20).join('\n'));
  await b.close();
})();
