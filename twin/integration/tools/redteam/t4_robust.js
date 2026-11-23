const { launch, GAME, collect } = require('./pw_common');
const fs = require('fs');
async function open(b, route) {
  const ctx = await b.newContext({ viewport: { width: 640, height: 360 }, hasTouch: true, isMobile: true });
  if (route) await route(ctx);
  const p = await ctx.newPage(); const errs = collect(p);
  await p.goto(GAME + '?auto'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 }).catch(e => errs.push('NOT STARTED: ' + e.message));
  await p.waitForTimeout(1500); return { ctx, p, errs };
}
const clean = e => [...new Set(e.filter(x => !/GL Driver|GPU stall/.test(x)))].slice(0, 8);
(async () => {
  const b = await launch(); const R = {};
  // A: corrupted / missing tiles next to spawn
  { const { ctx, p, errs } = await open(b, async ctx => {
      await ctx.route('**/tiles/v/165_633.json.gz', r => r.fulfill({ status: 200, body: Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3]) }));          // truncated gzip
      await ctx.route('**/tiles/v/164_633.json.gz', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"v":1,"k":"164_633","o":[164000,633000],"b":[{"i":"x1","a":10,"z":0,"h":100,"s":10,"f":3}],"rd":[{"c":2,"r":[1]}]}' })); // building without ring, road with 1 coord
      await ctx.route('**/tiles/t/166_633.bin.gz', r => r.fulfill({ status: 200, body: Buffer.alloc(30) }));            // short terrain
      await ctx.route('**/tiles/v/165_634.json.gz', r => r.fulfill({ status: 404, body: '' }));
    });
    const st = await p.evaluate(() => { const o = {}; for (const k of ['165_633', '164_633', '166_633', '165_634']) { const t = G27.W.tiles.get(k); o[k] = t ? { failed: !!t.failed, blds: t.blds ? t.blds.length : null, hasH: !!t.hgt } : 'absent'; } return { o, H: G27.W.H(G27.S.p.x, G27.S.p.z), frame: G27.renderer.info.render.frame }; }).catch(e => ({ err: e.message }));
    await p.waitForTimeout(3000); const fr2 = await p.evaluate(() => G27.renderer.info.render.frame).catch(() => -1);
    R.A_corrupt = { st, framesAdvancing: fr2 > st.frame, errs: clean(errs) }; await ctx.close(); }
  // B: offline after start, then move to unvisited area, then back online
  { const { ctx, p, errs } = await open(b);
    await ctx.setOffline(true);
    await p.evaluate(() => { G27.setMode('foot'); G27.S.p.x += 1500; });  // stays within bounds, new tiles needed
    await p.waitForTimeout(6000);
    const off = await p.evaluate(() => [...G27.W.tiles.values()].filter(t => t.failed).map(t => t.key));
    await ctx.setOffline(false); await p.waitForTimeout(8000);
    const on = await p.evaluate(() => ({ stillFailed: [...G27.W.tiles.values()].filter(t => t.failed).map(t => t.key), ground: G27.W.H(G27.S.p.x, G27.S.p.z), nearBuildings: G27.W.near(G27.S.p.x, G27.S.p.z, 200).length }));
    R.B_offline = { failedWhileOffline: off, afterOnline8s: on, errs: clean(errs) }; await ctx.close(); }
  // C: NaN injection + recovery, and fallback-ground -> real terrain (stuck under ground?)
  { const { ctx, p, errs } = await open(b);
    const c = await p.evaluate(async () => { const G = G27, S = G.S; G.setMode('car'); G.input.override = { x: NaN, y: 1, up: false, down: false };
      await new Promise(r => setTimeout(r, 400)); G.input.override = { x: 0, y: 1, up: false, down: false }; await new Promise(r => setTimeout(r, 1500));
      const car = { x: S.car.x, z: S.car.z, h: S.car.h, steer: S.car.steer }; G.input.override = null; return car; });
    const d = await p.evaluate(async () => { const G = G27, S = G.S; G.setMode('drone'); G.input.override = { x: Infinity, y: 0, up: true, down: false };
      await new Promise(r => setTimeout(r, 1500)); G.input.override = null; return { x: S.drone.x, y: S.drone.y, vx: S.drone.vx }; });
    R.C_nan = { carAfterNaNsteer: c, droneAfterInfStick: d, errs: clean(errs) }; await ctx.close(); }
  // D: teleport on foot into a not-yet-loaded tile (fallback ground 1.0 m), then walk
  { const { ctx, p, errs } = await open(b);
    const r = await p.evaluate(async () => { const G = G27, S = G.S, W = G.W; G.setMode('foot');
      // pick a loaded-later tile: far east inside bounds
      S.p.set(W.bounds.maxx - 400, 0, W.bounds.minz + 2500); const y0 = W.floorAt(S.p.x, S.p.z, 50); S.p.y = y0; S.vy = 0; S.grounded = true;
      const before = { y: S.p.y, H: W.H(S.p.x, S.p.z) };
      await new Promise(r => setTimeout(r, 12000));
      const mid = { y: S.p.y, H: W.H(S.p.x, S.p.z) };
      const x0 = S.p.x, z0 = S.p.z; G.input.override = { x: 0, y: 1, up: false, down: false }; await new Promise(r => setTimeout(r, 8000)); G.input.override = null;
      return { before, mid, moved: Math.hypot(S.p.x - x0, S.p.z - z0), after: { y: S.p.y, H: W.H(S.p.x, S.p.z) }, t: S.t }; });
    R.D_fallbackGround = { ...r, errs: clean(errs) }; await ctx.close(); }
  fs.writeFileSync('t4_robust.json', JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})();
