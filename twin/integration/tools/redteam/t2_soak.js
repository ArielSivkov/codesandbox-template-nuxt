const { launch, GAME, collect } = require('./pw_common');
const DUR = +(process.argv[2] || 300) * 1000;
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = collect(p); const cdp = await ctx.newCDPSession(p);
  await p.goto(GAME + '?auto'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 90000 }); await p.waitForTimeout(3000);
  if (process.env.PINFIX) await p.evaluate(() => { const o = G27.biz; let pin = o.pin; Object.defineProperty(o, 'pin', { get() { return this.b ? pin : null; }, set(v) { pin = v; }, configurable: true }); });
  const sample = async (label) => { await cdp.send('HeapProfiler.collectGarbage'); return p.evaluate((label) => { const r = G27.renderer.info; let objs = 0; G27.scene.traverse(() => objs++);
    return { label, t: Math.round(G27.S.t), mode: G27.S.mode, geos: r.memory.geometries, tex: r.memory.textures, calls: r.render.calls, tris: r.render.triangles, progs: r.programs ? r.programs.length : null, tiles: G27.W.tiles.size, sceneObjs: objs, heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), fps: +G27.fps().toFixed(1), pos: [Math.round(G27.S.p.x), Math.round(G27.S.p.z)] }; }, label); };
  const log = [await sample('start')];
  const t0 = Date.now(); let i = 0;
  const B = await p.evaluate(() => G27.W.bounds);
  while (Date.now() - t0 < DUR) {
    i++;
    const step = i % 6;
    await p.evaluate(([step, i, B]) => {
      const G = G27, S = G.S; const rx = B.minx + ((i * 0.37) % 1) * (B.maxx - B.minx), rz = B.minz + ((i * 0.61) % 1) * (B.maxz - B.minz);
      if (step === 0) { G.setMode('heli'); S.heli.x = rx; S.heli.z = rz; S.heli.y = 120; G.input.override = { x: 0.3, y: 1, up: false, down: false }; }
      if (step === 1) { G.setMode('car'); G.input.override = { x: 0.2, y: 1, up: false, down: false }; }
      if (step === 2) { G.setMode('foot'); G.input.override = { x: 0, y: 1, up: true, down: true }; let b = null; for (const t of G.W.tiles.values()) if (t.blds && t.blds.length) { b = t.blds[i % t.blds.length]; break; } if (b) { G.toggleMine(b); G.showCard(b); document.getElementById('cClose').click(); } }
      if (step === 3) { G.setMode('jet'); G.input.override = { x: -0.5, y: 1, up: true, down: false }; if (G.SIM) { G.SIM.weather.rain = (i % 12 < 6) ? 10 : 0; G.applyEnv && G.applyEnv(); } }
      if (step === 4) { G.setMode('drone'); G.input.override = { x: 0.5, y: 1, up: true, down: false }; }
      if (step === 5) { G.setMode('foot'); G.input.override = null; G.enterInterior('biz', G.biz.b || null); setTimeout(() => G.exitInterior(), 1500); G.setQuality(i % 3); }
    }, [step, i, B]);
    await p.waitForTimeout(5000);
    if (i % 3 === 0) log.push(await sample('i' + i));
  }
  log.push(await sample('end'));
  // clear marked
  console.log(JSON.stringify({ log, errs: errs.filter(e => !/GL Driver|GPU stall/.test(e)).slice(0, 20) }, null, 0));
  await b.close();
})();
