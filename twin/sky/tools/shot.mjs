// Playwright screenshots of twin-sky-demo.html at 390×844 (phone). Usage: node tools/shot.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/tmp/pw/node_modules/playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const shots = [
  ['01-check-2026-11-22-moon-west', 'preset=0&fov=100&pitch=25&min=1'],
  ['01b-check-2026-11-22-east-jupiter', 'preset=0&fov=100&pitch=25&yaw=90&min=1'],
  ['01c-sky-panel', 'preset=0&fov=90&pitch=30'],
  ['02-jerusalem-eclipse-763bce', 'preset=1&fov=100&min=1'],
  ['03-jerusalem-moonrise-33ce', 'preset=2&fov=80&min=1'],
  ['04-sinai-6-sivan-2448', 'preset=3&fov=100&min=1'],
  ['05-zmanim-ashdod', 'utc=2026-11-23T08:00&place=ashdod&tab=zm'],
  ['06-calib', 'utc=2026-11-22T23:00&place=ashdod&tab=cal&yaw=265&pitch=40'],
];
for (const [name, qs] of shots) {
  await page.goto('file://' + join(root, 'twin-sky-demo.html') + '?' + qs);
  try { await page.waitForFunction(() => window.__ready === true && window.__state, null, { timeout: 60000 }); } catch (e) { console.log('TIMEOUT', name, errors); await page.screenshot({ path: join(root, 'shots', name + '-FAIL.png') }); continue; }
  if (name === '06-calib') { await page.fill('#cU', '2000'); await page.fill('#cV', '1500'); await page.click('#cGo'); }
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => Object.assign({}, window.__state, { calib: window.__calib && { heading: window.__calib.heading, pitch: window.__calib.pitch } }));
  await page.screenshot({ path: join(root, 'shots', name + '.png') });
  console.log(name, JSON.stringify(s));
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
