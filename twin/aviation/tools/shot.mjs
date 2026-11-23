// Screenshots of demo.html at 800×360 (phone landscape) with Chrome + SwiftShader. Usage: node tools/shot.mjs [port] [scn,...]
import fs from 'node:fs';
const { chromium } = await import('/tmp/pw/node_modules/playwright/index.mjs');
const port = process.argv[2] || fs.readFileSync('/tmp/av_port', 'utf8').trim();
const list = (process.argv[3] || 'takeoff,lowpass,high,orbit,globe,reentry').split(',');
const T = process.env.T || '2026-11-23T13:20:00Z';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 800, height: 360 }, deviceScaleFactor: +(process.env.DPR || 1.5), hasTouch: true, isMobile: true });
const out = {}; let n = 0;
for (const s of list) {
  const p = await ctx.newPage(); const logs = []; p.on('console', m => { if (m.type() !== 'log') logs.push(m.text().slice(0, 300)); }); p.on('pageerror', e => logs.push('ERR ' + e.message));
  const t0 = Date.now(); await p.goto(`http://127.0.0.1:${port}/swarm/aviation/demo.html?shot=1&scn=${s}&t=${T}${process.env.EXTRA || ''}`);
  try { await p.waitForFunction(() => window.SHOT_READY, null, { timeout: 240000 }); } catch (e) { logs.push('TIMEOUT'); }
  await p.waitForTimeout(400);
  const f = `shots/${String(++n).padStart(2, '0')}-${s}${process.env.SUFFIX || ''}.png`; await p.screenshot({ path: f });
  out[s] = await p.evaluate(() => window.SHOT_INFO && { far: SHOT_INFO.far, calls: SHOT_INFO.calls, tris: SHOT_INFO.tris, alt: Math.round(SHOT_INFO.alt), layer: SHOT_INFO.layer, kt: SHOT_INFO.hud.kt && Math.round(SHOT_INFO.hud.kt), spd: SHOT_INFO.hud.speed && Math.round(SHOT_INFO.hud.speed), crashed: SHOT_INFO.hud.crashed });
  console.log(s, f, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(out[s]), logs.slice(0, 6).join(' | '));
  await p.close();
}
await b.close();
