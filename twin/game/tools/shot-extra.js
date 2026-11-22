// צילומים נקודתיים: גשם ואופק מגובה 214 מ'. node tools/shot-extra.js
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [tag, vw] of [['port', { width: 360, height: 800 }], ['land', { width: 800, height: 360 }]]) {
    const p = await (await b.newContext({ viewport: vw, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
    await p.goto('http://localhost:8931/index.html?auto'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 });
    await p.evaluate(() => { G27.Q.auto = false; Object.assign(G27.SIM.weather, { rain: 14, cloud: 0.9, windSpeed: 12 }); G27.applyEnv(); });
    await p.waitForTimeout(2500); await p.evaluate(() => document.getElementById('toast').style.display = 'none'); await p.screenshot({ path: `shots/${tag}-13-rain.png` });
    await p.evaluate(() => { Object.assign(G27.SIM.weather, { rain: 0, cloud: 0.2, windSpeed: 6 }); G27.applyEnv(); G27.setMode('heli'); const h = G27.S.heli; h.y = 214; h.x -= 300; h.rotor = 1; G27.S.cam.yaw = Math.PI * 1.25; G27.S.cam.pitch = 0.12; });
    await p.waitForTimeout(12000); await p.evaluate(() => document.getElementById('toast').style.display = 'none'); await p.screenshot({ path: `shots/${tag}-14-heli-214m.png` });
    console.log(tag, await p.evaluate(() => JSON.stringify({ fps: G27.fps().toFixed(1), heap: (performance.memory.usedJSHeapSize / 1048576).toFixed(0), tiles: G27.W.tiles.size, tris: G27.renderer.info.render.triangles, calls: G27.renderer.info.render.calls, fogFar: Math.round(G27.scene.fog.far) })));
  }
  await b.close();
})();
