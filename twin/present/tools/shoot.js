/* בדיקה חזותית: Playwright + Chrome, 360×800 לאורך ו-800×360 לרוחב. node tools/shoot.js [port] */
'use strict';
const { chromium } = require('/tmp/pw/node_modules/playwright');
const port = process.argv[2] || 47391, ONLY = process.argv[3] || '', DSF = +(process.argv[4] || 2), BASE = `http://127.0.0.1:${port}/index.html`, OUT = __dirname + '/../shots/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const report = [];
  for (const [tag, vw, vh] of [['portrait', 360, 800], ['landscape', 800, 360]].filter(t => !ONLY || ONLY.split(',').includes(t[0]))) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true, locale: 'he-IL' });
    const page = await ctx.newPage(); const errs = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    const ready = async () => { await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }); };
    const settle = async (extra = 600) => { await page.waitForFunction(() => window.P && !window.P.isAnimating(), null, { timeout: 60000 }); await sleep(extra); };
    const snap = async name => { await page.screenshot({ path: OUT + `${tag}-${name}.png` }); report.push(`${tag}-${name}.png`); };
    if (!process.env.STORY_ONLY) {
    await page.goto(BASE + '#v=after'); await ready(); await settle(); await snap('01-after');
    await page.evaluate(() => P.setView('swipe', 0.5)); await sleep(500); await snap('02-swipe');
    await page.evaluate(() => P.setView('before')); await sleep(400); await snap('03-before');
    await page.evaluate(() => P.setView('after'));
    // ניתוחים
    await page.evaluate(s => document.querySelector(s).click(), '#tabs [data-t=anal]'); await sleep(300); await snap('04-metrics');
    await page.evaluate(s => document.querySelector(s).click(), '#bShadow'); await page.waitForFunction(() => P.lastAnalysis, null, { timeout: 60000 }); await sleep(600);
    const an = await page.evaluate(() => ({ ms: P.lastAnalysis.ms, rec: P.lastAnalysis.receivers, a1: P.lastAnalysis.affected1h, any: P.lastAnalysis.affectedAny, roof: P.lastAnalysis.roofAffected, top: P.lastAnalysis.per.slice(0, 3) }));
    report.push(tag + ' analysis ' + JSON.stringify(an));
    // בדיקה צולבת: אותה מסה – קרן↔מנסרה מול Raycaster על המשולשים שמוצגים בפועל
    const cross = await page.evaluate(() => { const pr = P.state.proposal; const a = P.analyzeShadows({ dry: true });
      pr.kind = 'gltf'; pr.object = P.groups.proposal; const b = P.analyzeShadows({ dry: true }); pr.kind = 'massing'; delete pr.object;
      const mb = new Map(b.per.map(p => [p.id, p])); let maxd = 0; for (const p of a.per) { const q = mb.get(p.id); maxd = Math.max(maxd, Math.abs(p.lostMaxH - q.lostMaxH), Math.abs(p.roofLostH - q.roofLostH)); }
      const sens = [-1, 1].map(k => P.analyzeShadows({ sigmaK: k, dry: true }).affected1h);
      return { prismMs: a.ms, rayMs: b.ms, maxDiffHours: maxd, affected: [a.affected1h, b.affected1h], sensitivity_minus_plus_sigma: sens }; });
    report.push(tag + ' cross-check ' + JSON.stringify(cross));
    const info = await page.evaluate(() => ({ calls: P.renderer.info.render.calls, tris: P.renderer.info.render.triangles, buildings: P.world.buildings.length, geoms: P.renderer.info.memory.geometries }));
    report.push(tag + ' render ' + JSON.stringify(info));
    await page.evaluate(() => { document.getElementById('cFan').click(); }); await sleep(300);
    await page.evaluate(() => { const pr = P.state.proposal; return P.animate({ to: { pos: [pr.center[0] + 30, pr.center[1] - 240, pr.baseZ + 260], target: [pr.center[0], pr.center[1] + 50, pr.baseZ] }, dur: 0.1 }); }); await settle();
    await page.evaluate(() => { document.getElementById('iHour').value = 9.5; document.getElementById('iHour').oninput(); }); await sleep(500);
    await snap('05-shadow');
    await page.evaluate(() => document.getElementById('pbody').scrollTop = 9999); await sleep(200); await snap('06-shadow-list');
    // glTF
    await page.evaluate(s => document.querySelector(s).click(), '#tabs [data-t=proj]'); await page.evaluate(s => document.querySelector(s).click(), '#kseg [data-k=gltf]'); await page.waitForFunction(() => P.state.proposal.kind === 'gltf', null, { timeout: 30000 });
    await page.evaluate(() => { document.getElementById('cFan').checked = false; P.setFan(false); P.setHeat(false); P.setSun('2026-12-21', 11); const pr = P.state.proposal; return P.animate({ to: { pos: [pr.center[0] + 110, pr.center[1] - 150, pr.baseZ + 90], target: [pr.center[0], pr.center[1], pr.baseZ + 20] }, dur: 0.1 }); }); await settle();
    await snap('07-gltf');
    const g = await page.evaluate(() => { const a = P.analyzeShadows({}); return { ms: a.ms, a1: a.affected1h, method: a.method }; }); report.push(tag + ' gltf analysis ' + JSON.stringify(g));
    // השוואת שיטות: מסה במנסרות מול Raycaster על אותה מסה
    }
    // סיפור – כל צילום, בלי ניגון אוטומטי
    await page.goto(BASE + '#shot=0'); await page.reload(); await ready();
    const n = await page.evaluate(() => story.shots.length);
    for (let i = 0; i < n; i++) {
      await page.evaluate(i => story.go(i), i); await sleep(300); await settle(900);
      await snap('story-' + String(i).padStart(2, '0') + '-' + await page.evaluate(i => story.shots[i].id, i));
    }
    const hash = await page.evaluate(() => location.hash); report.push(tag + ' hash ' + hash);
    const fps = await page.evaluate(() => P.fps); report.push(tag + ' fps(swiftshader) ' + fps);
    report.push(tag + ' errors: ' + (errs.length ? errs.join(' | ') : 'none'));
    await ctx.close();
  }
  await browser.close();
  console.log(report.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
