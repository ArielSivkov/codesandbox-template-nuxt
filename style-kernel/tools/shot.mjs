// node style-kernel/tools/shot.mjs  →  style-kernel/preview/kernel-sheet.png (2400×1680) + kernel-sheet-1200.png
// Renders preview/index.html in headless Chromium with every non-file request blocked (no network).
// PLAYWRIGHT env var may point at playwright's index.mjs; default is the global install used in this workspace.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pw = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(pw).href);
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 2400, height: 1680 }, deviceScaleFactor: 1 });
const logs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', e => logs.push('pageerror: ' + e.message));
await p.route('**/*', r => (r.request().url().startsWith('file://') ? r.continue() : r.abort()));
await p.goto(pathToFileURL(path.join(root, 'preview', 'index.html')).href, { waitUntil: 'load' });
await p.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
const qa = await p.evaluate(() => window.__qa);
const out = path.join(root, 'preview', 'kernel-sheet.png');
await p.locator('#sheet').screenshot({ path: out });
await b.close();
const b2 = await chromium.launch();
// half-size copy for phones, downscaled with high-quality smoothing
const p2 = await b2.newPage({ viewport: { width: 1200, height: 840 } });
const data = fs.readFileSync(out).toString('base64');
await p2.setContent(`<body style="margin:0"><canvas id="k" width="1200" height="840"></canvas><script>const i=new Image();i.onload=()=>{const x=document.getElementById('k').getContext('2d');x.imageSmoothingQuality='high';x.drawImage(i,0,0,1200,840);document.title='ok'};i.src='data:image/png;base64,${data}'</script></body>`);
await p2.waitForFunction(() => document.title === 'ok');
await p2.locator('#k').screenshot({ path: path.join(root, 'preview', 'kernel-sheet-1200.png') });
await b2.close();
console.log(JSON.stringify({ out, qa, logs }, null, 1));
