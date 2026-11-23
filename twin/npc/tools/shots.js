// צילומי הדגמה: node tools/shots.js   (צריך את tools/serve.js רץ על 8790)   ONLY=morning,shabbat לבחירה
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8790/npc/demo.html';
const OUT = __dirname + '/../shots/';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SHOTS = [
  ['morning', '?preset=morning&auto=1'], ['evening', '?preset=evening&auto=1'], ['shabbat', '?preset=shabbat&at=synagogue&auto=1'], ['rain', '?preset=rain&auto=1'],
  ['talk-contractor', '?preset=morning&at=contractor&talk=contractor&auto=1'], ['talk-resident', '?preset=evening&at=resident&talk=resident&auto=1'],
  ['lifeguard', '?preset=evening&at=lifeguard&auto=1'], ['shop', '?preset=morning&at=shop&auto=1'],
];
const PORT = ['morning', 'shabbat', 'talk-contractor', 'evening'];
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [orient, vp] of [['land', { width: 800, height: 360 }], ['port', { width: 360, height: 800 }]]) {
    for (const [name, q] of SHOTS) {
      if (only && !only.includes(name)) continue;
      if (orient === 'port' && !PORT.includes(name)) continue;
      if (process.env.ORIENT && process.env.ORIENT !== orient) continue;
      const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const p = await ctx.newPage(); const errs = [];
      p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); if (/^preset/.test(m.text())) console.log('  ', m.text()); });
      p.on('pageerror', e => errs.push('pageerror: ' + e.message));
      await p.goto(BASE + q); await p.waitForFunction(() => window.NPCDEMO && NPCDEMO.ready, null, { timeout: 180000 });
      await p.waitForTimeout(+(process.env.WAIT || 5000));
      await p.screenshot({ path: `${OUT}${name}-${orient}.png`, timeout: 150000 });
      const st = await p.evaluate(() => Object.assign({}, NPCDEMO.npc.stats, { loadMs: Math.round(NPCDEMO.loadMs), bake: NPCDEMO.npc.crowd.stats.bakeMs.toFixed(0), gpuMB: NPCDEMO.npc.crowd.stats.gpuMB.toFixed(2), named: Object.keys(NPCDEMO.npc.named), calls: NPCDEMO.renderer.info.render.calls }));
      console.log(name, orient, JSON.stringify(st)); if (errs.length) console.log(errs.slice(0, 8).join('\n'));
      await ctx.close();
    }
  }
  await b.close();
})();
