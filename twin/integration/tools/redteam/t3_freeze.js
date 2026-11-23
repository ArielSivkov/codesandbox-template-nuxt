// Repro: flying ~3 km from spawn unloads the business tile -> frame() throws every frame -> world stops rendering/streaming
const { launch, GAME, collect } = require('./pw_common');
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = collect(p);
  if (process.env.BIZ) await p.addInitScript(() => localStorage.setItem('w27.bizId', 'w239080011')); await p.goto(GAME + '?auto'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 90000 }); await p.waitForTimeout(2000);
  const st = () => p.evaluate(() => ({ frame: G27.renderer.info.render.frame, tiles: G27.W.tiles.size, t: +G27.S.t.toFixed(1), biz: !!G27.biz.b, pin: !!G27.biz.pin }));
  const a = await st();
  await p.evaluate(() => { G27.setMode('heli'); G27.S.heli.y = 150; G27.input.override = { x: 0, y: 1, up: false, down: false }; G27.S.heli.z -= 3500; }); // teleport 3.5 km north (same as "טוס" to a far owned building)
  await p.waitForTimeout(40000);
  const bb = await st(); await p.waitForTimeout(3000); const c = await st();
  await p.screenshot({ path: 'shots/freeze-after-flight.png' });
  console.log(JSON.stringify({ before: a, after70s: bb, after73s: c, renderedFramesInLast3s: c.frame - bb.frame, pos: await p.evaluate(() => [G27.S.heli.x, G27.S.heli.z].map(Math.round)), errs: [...new Set(errs.filter(e => !/GL Driver|GPU stall/.test(e)))] }));
  await b.close();
})();
