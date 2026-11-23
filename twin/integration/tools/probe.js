// בדיקה מהירה: node tools/probe.js [url] [js-to-eval]  → מדפיס שגיאות, מצב תוספים, צילום shots/_probe.png
const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8940/world/index.html?auto';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const p = await (await b.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 300)); });
  await p.goto(url); await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 120000 });
  await p.waitForTimeout(+(process.env.WAIT || 4000));
  const r = await p.evaluate(process.argv[3] || '(async()=>({plugins:YZW.plugins(),modes:YZW.modes().map(m=>m.id+(m.available?"":"(x)")).join(" "),diag:YZW.diag(),faults:YZW.faults}))()');
  console.log(JSON.stringify(r, null, 1));
  await p.screenshot({ path: '/home/claude/swarm/integration/shots/_probe.png' });
  console.log('ERRORS:', errs.join('\n'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
