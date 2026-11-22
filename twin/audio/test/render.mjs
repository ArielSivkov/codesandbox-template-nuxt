// בדיקת רינדור Playwright: OfflineAudioContext → רמות (ללא קליפינג, טווחי RMS), דטרמיניזם, דופלר, הסתרה, תקציב ערוצים,
// ובנוסף בדיקות זמן-אמת ב-demo.html: מושתק עד נגיעה, השהיית AudioContext בטאב מוסתר, מצב שבת.
// הרצה:  node test/render.mjs     (Chrome: /usr/bin/google-chrome, playwright מ-/tmp/pw/node_modules)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/tmp/pw/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const PORT = 8977 + Math.floor(Math.random() * 400);
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));

const fails = [], log = [];
const check = (ok, msg) => { (ok ? log : fails).push((ok ? 'PASS ' : 'FAIL ') + msg); };
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--autoplay-policy=user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', e => fails.push('pageerror ' + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/audio/test/offline.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 15000 });
  const names = await page.evaluate(() => window.scenarios);
  const R = {};
  for (const n of names) { R[n] = await page.evaluate(n => window.runScenario(n), n); }

  // ---- טווחי רמות לכל צליל בודד (dBFS, ערוץ משולב) ----
  const RANGE = { // [min, max] RMS
    v_car: [-36, -10], v_helicopter: [-40, -10], v_jetpack: [-36, -10], v_drone: [-40, -12], v_jet: [-36, -8], v_spaceship: [-40, -12], v_boat: [-36, -10], v_car_player: [-30, -8],
    amb_storm: [-36, -12], amb_breeze: [-50, -20], amb_waves_near: [-36, -12], amb_waves_far: [-70, -30], amb_city: [-42, -14], amb_port: [-48, -16], steps: [-50, -18],
    full: [-30, -6], full_shabbat: [-36, -10], full_8voices: [-32, -6],
  };
  for (const [n, r] of Object.entries(R)) {
    if (r.peak === undefined) continue;
    check(r.nan === 0, `${n}: no NaN`);
    check(r.peak < 0.999, `${n}: no clipping (peak ${r.peakDb.toFixed(1)} dBFS)`);
    const [lo, hi] = RANGE[n] || [-60, -6];
    check(r.rmsDb >= lo && r.rmsDb <= hi, `${n}: RMS ${r.rmsDb.toFixed(1)} dBFS in [${lo}, ${hi}]`);
    if (r.maxVoicesSeen != null) check(r.maxVoicesSeen <= 16, `${n}: voices ≤ 16 (max ${r.maxVoicesSeen})`);
  }
  const D = R.determinism; check(D.maxAbsDiff < 1e-5, `deterministic: two full-mix renders differ by ≤ ${D.maxAbsDiff.toExponential(2)} (${D.maxAbsDiffDb.toFixed(0)} dBFS), bit-exact=${D.bitExact}`);
  check(R.full_8voices.maxVoicesSeen <= 8, `maxVoices option respected (8 → ${R.full_8voices.maxVoicesSeen})`);
  check(R.full_shabbat.rmsDb < R.full.rmsDb, `Shabbat mix quieter (engines off): ${R.full_shabbat.rmsDb.toFixed(1)} < ${R.full.rmsDb.toFixed(1)}`);
  check(R.amb_waves_near.rmsDb - R.amb_waves_far.rmsDb > 12, `waves distance-driven: near ${R.amb_waves_near.rmsDb.toFixed(1)} vs far ${R.amb_waves_far.rmsDb.toFixed(1)}`);
  check(R.amb_storm.rmsDb > R.amb_breeze.rmsDb + 4, `storm louder than breeze`);
  const d = R.doppler; check(d.zcrApproach / d.zcrRecede > 1.08, `doppler: pitch higher on approach (ZCR ratio ${(d.zcrApproach / d.zcrRecede).toFixed(3)})`);
  const o = R.occlusion;
  check(o.blocked.rmsDb < o.open.rmsDb - 3, `occlusion: building lowers level ${o.open.rmsDb.toFixed(1)} → ${o.blocked.rmsDb.toFixed(1)} dB`);
  check(o.hfBlocked < o.hfOpen * 0.35, `occlusion: low-pass removes >2kHz (${(20 * Math.log10(o.hfBlocked / o.hfOpen)).toFixed(1)} dB)`);
  const cpu = R.cpu, la = (await import('node:os')).loadavg()[0];
  check(cpu.hrtf4.realtimeX > 1, `CPU: full mix 16 voices HRTF×4 renders ${cpu.hrtf4.realtimeX.toFixed(2)}× realtime (HRTF×2 ${cpu.hrtf2.realtimeX.toFixed(2)}×, none ${cpu.hrtf0.realtimeX.toFixed(2)}×) on a 2-core box at load ${la.toFixed(1)}`);
  check(cpu.hrtf2.relToRef64osc < 3, `CPU relative: mix(HRTF×2) costs ${cpu.hrtf2.relToRef64osc.toFixed(2)}× a reference graph of 64 saw-osc+biquad+gain; ${cpu.nodes} nodes in ${cpu.voices} voices; prewarm ${cpu.prewarmMs.toFixed(0)} ms`);
  check(R.full.updateMsAvg < 1, `CPU: update() avg ${R.full.updateMsAvg.toFixed(3)} ms (max ${R.full.updateMsMax.toFixed(2)})`);

  // ---- זמן אמת: demo.html ----
  const p2 = await browser.newPage();
  p2.on('pageerror', e => fails.push('demo pageerror ' + e.message));
  await p2.goto(`http://127.0.0.1:${PORT}/audio/demo.html`);
  await p2.waitForFunction(() => window.demoReady, null, { timeout: 15000 });
  const before = await p2.evaluate(() => ({ ctx: window.audio.ctx ? window.audio.ctx.state : 'none', unlocked: window.audio.unlocked }));
  check(before.ctx === 'none' && !before.unlocked, `muted by default: no AudioContext before tap (${before.ctx})`);
  await p2.click('#unlock');
  await p2.waitForTimeout(400);
  const after = await p2.evaluate(() => ({ ctx: window.audio.ctx.state, unlocked: window.audio.unlocked }));
  check(after.ctx === 'running' && after.unlocked, `tap unlocks → AudioContext ${after.ctx}`);
  await p2.click('[data-v="helicopter"]'); await p2.click('[data-a="storm"]'); await p2.waitForTimeout(2500);
  const live = await p2.evaluate(() => window.audio.stats());
  log.push(`INFO demo async prewarm: total ${live.prewarmMs.toFixed(0)} ms, longest single task ${live.prewarmMaxTaskMs.toFixed(0)} ms (load ${(await import('node:os')).loadavg()[0].toFixed(1)})`);
  check(live.continuous >= 2 && live.voices <= 16, `demo live: ${live.voices} voices (${live.active.join(', ')})`);
  await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p2.waitForTimeout(300);
  const hidden = await p2.evaluate(() => window.audio.ctx.state);
  check(hidden === 'suspended', `tab hidden → AudioContext ${hidden} (battery)`);
  await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await p2.waitForTimeout(300);
  check(await p2.evaluate(() => window.audio.ctx.state) === 'running', 'tab visible → resumed');
  await p2.click('#shabbat'); await p2.waitForTimeout(400);
  const sh = await p2.evaluate(() => ({ s: window.audio.stats(), ui: window.audio.playUI('notify') }));
  check(sh.s.shabbat && !sh.s.active.some(id => id.startsWith('helicopter')) && sh.ui === false, `Shabbat in demo: engines off, notify refused (${sh.s.active.join(', ')})`);
  mkdirSync(path.join(here, '../shots'), { recursive: true });
  await p2.setViewportSize({ width: 360, height: 800 }); await p2.click('#shabbat'); await p2.waitForTimeout(300);
  await p2.screenshot({ path: path.join(here, '../shots/demo-360x800.png'), fullPage: true });

  writeFileSync(path.join(here, 'render-results.json'), JSON.stringify(R, null, 1));
} catch (e) { fails.push('runner error ' + (e.stack || e)); }
finally { if (browser) await browser.close(); srv.kill(); }
console.log(log.join('\n')); if (fails.length) console.log(fails.join('\n'));
console.log(`\n${log.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
