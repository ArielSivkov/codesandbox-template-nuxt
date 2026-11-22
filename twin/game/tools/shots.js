// צילומי מסך לכל המצבים, לאורך ולרוחב (360×800). node tools/shots.js
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright');
const BASE = process.env.URL || 'http://localhost:8931/index.html?auto';
const hold = (p, inp, ms) => p.evaluate(([i, m]) => new Promise(r => { G27.input.override = i; setTimeout(() => { G27.input.override = null; r(); }, m); }), [inp, ms]);
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const only = process.argv[2];
  for (const [tag, vw] of [['land', { width: 800, height: 360 }], ['port', { width: 360, height: 800 }]]) {
    if (only && only !== tag) continue;
    const ctx = await b.newContext({ viewport: vw, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); }); p.on('pageerror', e => errs.push('pageerror ' + e.message));
    await p.goto(BASE); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 90000 }); await p.waitForTimeout(2500);
    const shot = async n => { await p.waitForTimeout(400); await p.evaluate(() => document.getElementById('toast').style.display = 'none'); await p.screenshot({ path: `shots/${tag}-${n}.png` }); };
    await p.evaluate(() => { G27.Q.auto = false; document.getElementById('toast').style.display = 'none'; });
    await shot('01-foot');
    await hold(p, { x: 0, y: 1, up: false, down: false }, 2500); await shot('02-walk');
    await p.evaluate(() => G27.setMode('car')); await hold(p, { x: 0.2, y: 1 }, 4000); await shot('03-car');
    await p.evaluate(() => G27.setMode('heli')); await hold(p, { x: 0, y: 0, up: true }, 6000); await hold(p, { x: 0.3, y: 1 }, 3000); await shot('04-heli');
    await p.evaluate(() => G27.setMode('jet')); await hold(p, { x: 0, y: 0.6, up: true }, 2000); await shot('05-jet');
    await p.evaluate(() => { G27.setMode('foot'); G27.spawn(); }); await p.waitForTimeout(1500);
    await p.evaluate(() => { G27.setMode('drone'); const q = G27.S.drone; q.y += 14; q.landed = false; q.vy = 0; }); await hold(p, { x: 0, y: 0.6 }, 4000); await shot('06-drone');
    await p.evaluate(() => { G27.setMode('foot'); G27.spawn(); G27.showCard(G27.biz.b); }); await shot('07-card');
    await p.evaluate(() => { G27.toggleMine(G27.biz.b); document.getElementById('card').style.display = 'none'; G27.flyTo(G27.biz.b.cx, G27.biz.b.cz, G27.biz.b.top); }); await p.waitForTimeout(1500); await shot('08-mine-glow');
    await p.evaluate(() => { G27.setMode('foot'); G27.spawn(); G27.enterInterior('biz', G27.biz.b); }); await shot('09-interior');
    await p.evaluate(() => { G27.exitInterior(); document.getElementById('bEnv').click(); }); await shot('10-weather');
    await p.evaluate(() => { document.getElementById('env').style.display = 'none'; Object.assign(G27.SIM.weather, { rain: 12, cloud: 0.9, windSpeed: 14 }); G27.applyEnv(); }); await shot('11-rain');
    await p.evaluate(() => { Object.assign(G27.SIM.weather, { rain: 0, cloud: 0.1, windSpeed: 6 }); const d = new Date(G27.ENV.date); d.setUTCHours(14, 25); G27.ENV.date = d; G27.applyEnv(); }); await shot('12-sunset');
    const st = await p.evaluate(() => ({ fps: G27.fps().toFixed(1), heapMB: performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null, calls: G27.renderer.info.render.calls, tris: G27.renderer.info.render.triangles, tiles: G27.W.tiles.size }));
    console.log(tag, JSON.stringify(st)); if (errs.length) console.log('ERR', errs.slice(0, 8).join('\n'));
    await ctx.close();
  }
  await b.close();
})();
