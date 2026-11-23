// מדידת ביצועים: node tools/perf.js [throttle=1|6] [seconds=180]  → shots/perf-<throttle>x.json
// טעינה, 3 דקות משחק מתוסרט דרך כל המצבים, ערימה (אחרי GC) כל 15 ש', קריאות ציור ומשולשים, 20 החלפות עין⇄דמות (זמן מעבר + דליפה).
const { chromium } = require('/tmp/pw/node_modules/playwright');
const fs = require('fs');
(async () => {
  const thr = +(process.argv[2] || 1), SECS = +(process.argv[3] || 180);
  const url = 'http://localhost:8940/world/index.html?auto';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (thr > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
  const t0 = Date.now(); await p.goto(url);
  await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 400000 });
  const loadS = (Date.now() - t0) / 1000;
  const heap = async () => { await p.evaluate(() => window.gc && gc()); const h = await cdp.send('Runtime.getHeapUsage'); return +(h.usedSize / 1048576).toFixed(1); };
  const res = { throttle: thr, loadS, firstPaintToStartS: await p.evaluate(() => +(YZW.world.stats.startMs / 1000).toFixed(1)), samples: [] };
  res.heapStart = await heap();
  const modes = ['walk', 'car', 'heli', 'jetpack', 'drone', 'dev', 'walk'];
  const per = SECS / modes.length;
  for (const m of modes) {
    await p.evaluate(m => { YZW.setMode(m); const i = YZW.world.G27.input; i.y = m === 'dev' ? 0.3 : 1; i.x = 0.25; i.up = m === 'heli' || m === 'drone' || m === 'jetpack'; }, m);
    const tEnd = Date.now() + per * 1000; let maxC = 0, maxT = 0, sumF = 0, n = 0;
    while (Date.now() < tEnd) { await p.waitForTimeout(1000); const s = await p.evaluate(() => { const S = YZW.world.stats; const i = YZW.world.G27.input; i.x = Math.sin(Date.now() / 3000) * 0.5; if (YZW.mode() === 'heli' || YZW.mode() === 'drone') i.up = YZW.world.player.pos.y - Math.max(0, YZW.world.data.H(YZW.world.player.pos.x, YZW.world.player.pos.z)) < 60; return { c: S.calls, t: S.tris, f: S.fps }; });
      maxC = Math.max(maxC, s.c); maxT = Math.max(maxT, s.t); sumF += s.f; n++; }
    res.samples.push({ mode: m, maxCalls: maxC, maxTrisK: Math.round(maxT / 1000), avgFps: +(sumF / Math.max(n, 1)).toFixed(1), heapMB: await heap(), tiles: await p.evaluate(() => YZW.world.data.tiles.size) });
  }
  await p.evaluate(() => { const i = YZW.world.G27.input; i.x = i.y = 0; i.up = false; });
  res.heapAfterPlay = await heap();
  // 20 החלפות עין⇄דמות
  const h0 = await heap(); const tt = [];
  for (let k = 0; k < 20; k++) {
    const a = await p.evaluate(async () => { const s = ms => new Promise(r => setTimeout(r, ms)); const t = performance.now(); YZW.setMode(YZW.mode() === 'dev' ? 'walk' : 'dev'); await s(100);
      while (YZW.intro.on || (window.YZDev && YZDev.D.tr)) await s(30); return Math.round(performance.now() - t); });
    tt.push(a); await p.waitForTimeout(300);
  }
  res.toggle = { n: 20, msMedian: tt.slice().sort((a, b) => a - b)[10], msMax: Math.max(...tt), heapBeforeMB: h0, heapAfterMB: await heap() };
  res.final = await p.evaluate(() => ({ calls: YZW.world.stats.calls, tris: YZW.world.stats.tris, geoms: YZW.world.stats.geoms, texs: YZW.world.stats.texs, tier: YZW.world.quality.tier, faults: YZW.faults, plugins: YZW.plugins().filter(x => x.state === 'on').map(x => x.id + ':' + x.ms + 'ms') }));
  res.errors = errs.slice(0, 5);
  fs.writeFileSync(`/home/claude/swarm/integration/shots/perf-${thr}x.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
