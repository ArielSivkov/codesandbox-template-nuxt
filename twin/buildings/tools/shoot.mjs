// צילומי מסך 360×800 של demo.html: node tools/shoot.mjs [port]  (שרת סטטי על /home/claude/swarm)
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/tmp/pw/node_modules/');
const { chromium } = require('playwright');
const port = process.argv[2] || 8765, base = `http://127.0.0.1:${port}/buildings/demo.html`;
const only = process.argv[3] ? process.argv[3].split(',') : null;
const shots = [
  ['aerial_day', 'view=aerial&t=day'], ['aerial_night', 'view=aerial&t=night'],
  ['street_day', 'view=street&t=day'], ['street_night', 'view=street&t=night'],
  ['towers_day', 'view=towers&t=day'], ['towers_night', 'view=towers&t=night'],
  ['landmarks_day', 'view=landmarks&t=day'], ['light_day', 'view=light&t=day'], ['fort_day', 'view=fort&t=day'],
  ['property_before', 'view=property&state=before'], ['property_after', 'view=property&state=after'],
  ['street_day_lite', 'view=street&t=day&lite'], ['aerial_day_baseline', 'view=aerial&t=day&facades=0'], ['street_day_baseline', 'view=street&t=day&facades=0'],
];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const out = {};
for (const [name, q] of shots) {
  if (only && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
  const errs = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const t0 = Date.now();
  await page.goto(base + '?' + q + '&hud&dpr=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DEMO_READY === true, null, { timeout: 120000 }).catch(() => errs.push('timeout DEMO_READY'));
  await page.waitForFunction(() => window.YZ && window.YZ.loaded, null, { timeout: 90000 }).catch(() => errs.push('timeout loaded'));
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => { const E = window.YZ.engine; E.renderer.render(E.scene, E.camera); const r = E.info(); const s = window.API ? window.API.stats() : null;
    return { calls: r.calls, tris: r.tris, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null, gpuVerts: r.gpuVerts, geoms: r.geoms, textures: r.textures, tilesLoaded: r.tilesLoaded, lod: r.lod,
      buildings: s && s.buildings, instances: s && s.instances, byBasis: s && s.byBasis, frameMs: (() => { const gl = E.renderer.getContext(), px = new Uint8Array(4), t = performance.now(); for (let i = 0; i < 8; i++) { E.renderer.render(E.scene, E.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return Math.round((performance.now() - t) / 8 * 10) / 10; })() }; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/home/claude/swarm/buildings/shots/${name}.png` });
  out[name] = Object.assign(st, { loadS: Math.round((Date.now() - t0) / 100) / 10, errors: errs.slice(0, 6) });
  console.log(name, JSON.stringify(out[name]));
  await page.close();
}
await browser.close();
const prev = fs.existsSync('/home/claude/swarm/buildings/shots/perf.json') ? JSON.parse(fs.readFileSync('/home/claude/swarm/buildings/shots/perf.json')) : {};
fs.writeFileSync('/home/claude/swarm/buildings/shots/perf.json', JSON.stringify(Object.assign(prev, out), null, 1));
