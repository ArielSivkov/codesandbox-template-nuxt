// Playwright screenshots 800x360 (phone landscape) → shots/.   node tools/shoot.cjs   [ONLY=01,03]
// No local server: requests to http://twin.local/ are answered by Playwright from an allow-list of read-only folders.
const { chromium } = require('/tmp/pw/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = __dirname + '/../shots/';
const ROOT = '/home/claude';
const ALLOW = ['swarm/maritime/', 'swarm/weather/', 'swarm/physics/src/', 'swarm/aviation/src/', 'codesandbox-template-nuxt/twin/game/'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.gz': 'application/octet-stream', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const BASE = `http://twin.local/swarm/maritime/demo.html?shot=1`;
const SHOTS = (process.env.ONLY ? process.env.ONLY.split(',') : null);
const LIST = [
  ['01-beach', 'view=beach&wx=sea-breeze'],
  ['02-boat', 'view=boat&wx=sea-breeze'],
  ['03-port-aerial', 'view=port&wx=sea-breeze'],
  ['04-sunset-glint', 'view=sunset&wx=calm-clear&hour=16.5'],
  ['05-boat-storm', 'view=boat&wx=winter-storm'],
  ['06-ais-fixture', 'view=ais&wx=calm-clear&ais=1'],
].filter(([n]) => !SHOTS || SHOTS.some(s => n.startsWith(s)));
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server', '--enable-precise-memory-info'] });
  const p = await b.newPage({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.route('http://twin.local/**', route => {
    const rel = path.posix.normalize(decodeURIComponent(new URL(route.request().url()).pathname)).replace(/^\/+/, '');
    if (rel.includes('..') || !ALLOW.some(a => rel.startsWith(a))) return route.fulfill({ status: 403, body: 'forbidden' });
    const f = path.join(ROOT, rel);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' } });
  });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  const report = [];
  for (const [name, q] of LIST) {
    await p.goto(`${BASE}&${q}`);
    await p.waitForFunction(() => window.__mar && window.__mar.ready, null, { timeout: 180000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: OUT + name + '.png' });
    const extra = q.includes('view=boat') ? { gpuCheck: await p.evaluate(() => window.__gpucheck()) } : {};
    report.push({ name, ...(await p.evaluate(() => window.__mar)), ...extra });
  }
  console.log(JSON.stringify(report, null, 1)); if (errs.length) console.log('CONSOLE', [...new Set(errs)].slice(0, 30));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
