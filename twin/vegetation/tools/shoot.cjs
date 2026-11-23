// צילומי Playwright 360x800 של demo.html → shots/. הרצה: PORT=8771 node tools/shoot.cjs  (שרת סטטי בתיקיית vegetation)
const { chromium } = require('/tmp/pw/node_modules/playwright');
const PORT = process.env.PORT || 8771, OUT = __dirname + '/../shots/';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SHOTS = [
  ['01-street-may-jacaranda', 'view=street&sp=JACA&month=5&wind=8'],
  ['02-street-june-poinciana', 'view=street&sp=DELO&month=6&wind=8'],
  ['03-street-february-bare', 'view=street&sp=JACA&month=2&wind=8'],
  ['04-park-may', 'view=park&month=5&wind=6'],
  ['05-dunes-february-retama', 'view=dune&month=2&wind=10'],
  ['06-beach-august', 'view=beach&month=8&wind=6'],
  ['07-aerial-may', 'view=aerial&month=5&wind=8'],
  ['08-aerial-january', 'view=aerial&month=1&wind=8'],
];
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server', '--enable-precise-memory-info'] });
  const p = await b.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  const report = [];
  for (const [name, q] of SHOTS) {
    if (ONLY && !ONLY.some(o => name.includes(o))) continue;
    await p.goto(`http://127.0.0.1:${PORT}/demo.html?shot=1&${q}`);
    await p.waitForFunction(() => window.__veg && window.__veg.ready, null, { timeout: 300000 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: OUT + name + '.png', timeout: 120000 });
    report.push({ name, ...(await p.evaluate(() => window.__veg)) });
  }
  console.log(JSON.stringify(report.map(r => ({ name: r.name, calls: r.calls, tris: r.tris, vegCalls: r.veg.drawCalls, vegTris: r.veg.tris, near: r.veg.near, far: r.veg.far, plants: r.veg.plants, selMs: r.veg.ms, heapMB: r.heapMB, fps: r.fps })), null, 0).replace(/},{/g, '},\n{'));
  if (errs.length) console.log('ERRORS', [...new Set(errs)].slice(0, 20));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
