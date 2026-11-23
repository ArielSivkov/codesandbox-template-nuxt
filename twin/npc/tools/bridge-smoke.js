// בדיקת עשן לחיבור למשחק הקיים: פותחים את twin/game כמו שהוא ומזריקים את 5 הסקריפטים (בלי לשנות קבצי משחק).
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8790/game/index.html?auto'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 });
  for (const f of ['life', 'dialogue', 'crowd', 'npc', 'bridge-game']) await p.addScriptTag({ url: '/npc/js/' + f + '.js' });
  await p.waitForFunction(() => window.G27NPC && G27NPC.stats && G27NPC.stats.agents > 0, null, { timeout: 180000 });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: __dirname + '/../shots/bridge-game-land.png', timeout: 150000 });
  console.log(JSON.stringify(await p.evaluate(() => Object.assign({}, G27NPC.stats, { named: Object.keys(G27NPC.named), density: G27NPC.density(), calls: G27.renderer.info.render.calls }))));
  console.log(errs.filter(e => !/favicon|404/.test(e)).slice(0, 6).join('\n'));
  await b.close();
})();
