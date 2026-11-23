// קצב פריימים אמיתי (ספירת render בפועל): node tools/fps.js <url> [width] [height]
const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => {
  const url = process.argv[2], w = +(process.argv[3] || 360), h = +(process.argv[4] || 800);
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage();
  const t0 = Date.now(); await p.goto(url); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 }); const tl = (Date.now() - t0) / 1000;
  await p.waitForTimeout(8000);
  const r = await p.evaluate(async () => { const f = G27.renderer.info.render.frame, t = performance.now(); await new Promise(r => setTimeout(r, 5000));
    return { fps: +((G27.renderer.info.render.frame - f) / ((performance.now() - t) / 1000)).toFixed(2), calls: G27.renderer.info.render.calls, tris: G27.renderer.info.render.triangles, pr: G27.renderer.getPixelRatio(), q: G27.Q.level, tiles: G27.W.tiles.size }; });
  console.log(url, w + 'x' + h, 'load', tl, JSON.stringify(r)); await b.close();
})();
