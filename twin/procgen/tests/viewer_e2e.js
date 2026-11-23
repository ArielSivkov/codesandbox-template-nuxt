// בדיקת קצה לקצה לצופה: 360×800, טעינה בלי שגיאות, מדידת זמן פריים וקריאות ציור, לחיצה על נקודת צילום → כרטיס, צילומי מסך.
// הרצה: node tests/viewer_e2e.js [baseURL]   (שרת סטטי על שורש swarm)
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8823/procgen/viewer.html';
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await br.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  const errs = []; pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  const t0 = Date.now(); await pg.goto(BASE); await pg.waitForFunction(() => window.__ready || window.__err, null, { timeout: 120000 });
  const ready = await pg.evaluate(() => window.__ready || { err: window.__err }); const loadMs = Date.now() - t0;
  await pg.waitForFunction(() => window.__glb !== undefined, null, { timeout: 60000 }).catch(() => {});
  const glb = await pg.evaluate(() => window.__glb);
  await pg.waitForTimeout(500); await pg.screenshot({ path: __dirname + '/shots/night3d.png' });
  await pg.evaluate(() => window.__bench(20)); await pg.waitForTimeout(100); await pg.waitForFunction(() => window.__perf.frames.length >= 20, null, { timeout: 300000 });
  const perf = await pg.evaluate(() => { const f = window.__perf.frames.slice(-20).sort((a, b) => a - b), g = window.__perf.gaps.slice(-20).sort((a, b) => a - b); return { calls: window.__perf.calls, tris: window.__perf.tris, cpu_render_ms_median: f[10], cpu_render_ms_p95: f[19], frame_gap_ms_median: g[10], cullMs: window.__perf.cullMs, budget: window.__triBudget() }; });
  // נקודת צילום 008 → כרטיס
  const xy = await pg.evaluate(() => { return null; });
  await pg.click('#bMode'); await pg.waitForTimeout(400); await pg.screenshot({ path: __dirname + '/shots/2d.png' });
  await pg.click('#bLayers'); await pg.waitForTimeout(200); await pg.screenshot({ path: __dirname + '/shots/layers.png' });
  await pg.check('#lTruth'); await pg.click('#bLayers'); await pg.click('#bMode'); await pg.waitForTimeout(400); await pg.screenshot({ path: __dirname + '/shots/truth3d.png' });
  // לחיצה על התווית של תמונה 008 (מוקרנת)
  const lbl = await pg.evaluate(() => { const e = [...document.querySelectorAll('.lbl')].find(x => x.style.display !== 'none'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom + r.height * 0.3]; });
  let cardTxt = null;
  if (lbl) { await pg.mouse.click(lbl[0], lbl[1]); await pg.waitForTimeout(300); cardTxt = await pg.evaluate(() => document.getElementById('card').classList.contains('open') ? document.getElementById('cardBody').textContent.slice(0, 160) : null); await pg.screenshot({ path: __dirname + '/shots/card.png' }); }
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const res = { loadMs, ready, glb, perf, card: cardTxt, overflow360: overflow, errors: errs };
  console.log(JSON.stringify(res, null, 1));
  require('fs').writeFileSync(__dirname + '/viewer_e2e.json', JSON.stringify(res, null, 1));
  await br.close(); process.exit(errs.length || !ready.tiles ? 1 : 0);
})();
