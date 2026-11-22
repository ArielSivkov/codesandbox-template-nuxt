// Screenshot viewer.html at 360x800 (mobile) with Playwright + system Chrome. Usage: node shot.mjs [baseUrl]
import { createRequire } from 'node:module';
const require = createRequire('/tmp/pw/node_modules/');
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8127/assets/viewer.html';
const out = '/home/claude/swarm/assets/shots';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const logs = []; page.on('console', m => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const results = {};
for (const [v, extra] of (process.env.VIEWS ? process.env.VIEWS.split(',').map(v => [v, '']) : [['street', ''], ['air', ''], ['mat', ''], ['veh', ''], ['street', '&tex=webp&sky=venice_sunset']])) {
  await page.goto(`${base}?view=${v}${extra}`); 
  await page.waitForFunction(() => window.__VIEWER && (window.__VIEWER.ready || window.__VIEWER.errors.some(e => e.startsWith('fatal'))), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({ info: window.__VIEWER.info, errors: window.__VIEWER.errors, loaded: window.__VIEWER.loaded.length, loadMs: window.__VIEWER.loadMs }));
  const name = `viewer-${v}${extra ? '-webp-sunset' : ''}.png`;
  await page.screenshot({ path: `${out}/${name}`, timeout: 120000, animations: 'disabled' }); results[name] = info; console.log(name, JSON.stringify(info));
}
console.log(logs.filter(l => !/^(log|debug|info)/.test(l)).slice(0, 20).join('\n'));
await browser.close();
