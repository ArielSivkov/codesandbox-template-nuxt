// בדיקת עשן של העולם המשולב: node tools/smoke.js [url]   (קוד יציאה 1 בכישלון)
// טעינה · כל המצבים הזמינים · מצבים בעבודה מסומנים · מצלמה 3 מבטים · מצב יזם (שכבה, שרטוט תקין/פסול) · זמן/מזג אוויר/שבת/איכות
// · בידוד כשלים: תוסף שבור בכוונה (?) לא מפיל את העולם · אין שגיאות JS.
const { chromium } = require('/tmp/pw/node_modules/playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8940/world/index.html?auto';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|GL Driver/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  // תוסף שבור בכוונה – נרשם לפני הטעינה, זורק בעדכון השלישי
  await p.addInitScript(() => { const t = setInterval(() => { if (window.YZW) { clearInterval(t); let n = 0; YZW.register({ id: 'broken-test', name: 'תוסף שבור (בדיקה)', dept: 'test', order: 99, init() {}, update() { if (++n > 3) throw new Error('boom'); } }); } }, 5); });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  const t0 = Date.now();
  await p.goto(url); await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 120000 });
  ok(true, `נטען ב-${((Date.now() - t0) / 1000).toFixed(1)} ש'`);
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms)), out = {}, W = YZW.world;
    for (let i = 0; i < 50 && YZW.plugins().find(x => x.id === 'broken-test').state !== 'error'; i++) await sleep(100);
    out.plugins = YZW.plugins(); out.broken = out.plugins.find(x => x.id === 'broken-test');
    const f0 = W.renderer.info.render.frame; await sleep(2000); out.framesAfterFault = W.renderer.info.render.frame - f0;
    out.home = (() => { const it = W.coords.toITM(W.player.pos.x, W.player.pos.z); return [Math.round(it.E), Math.round(it.N)]; })();
    out.sunSrc = W.sun.source; out.golden = W.sun.elevation;
    out.modes = {}; for (const m of YZW.modes()) { if (!m.available) { out.modes[m.id] = 'pending'; continue; } if (m.id === 'present') continue;
      const okm = YZW.setMode(m.id); await sleep(900); out.modes[m.id] = okm && YZW.mode() === m.id ? 'ok' : 'FAIL'; }
    // מצגת (שכבת iframe) – נכנסים ויוצאים
    out.present = YZW.setMode('present'); await sleep(1500); out.presentIframe = !!document.querySelector('#yzOverlay iframe'); out.paused = YZW.paused; YZW.setMode('walk'); await sleep(400); out.presentClosed = !document.querySelector('#yzOverlay') && !YZW.paused;
    // מצלמה
    out.cam = []; for (let i = 0; i < 3; i++) { YZCam.cycle(); await sleep(1100); out.cam.push([YZCam.view, +W.camera.position.distanceTo(new THREE.Vector3(W.player.pos.x, W.player.pos.y + 1.6, W.player.pos.z)).toFixed(2)]); }
    // רחפן פיזיקלי: המראה
    YZW.setMode('drone'); await sleep(300); W.G27.input.up = true; const alt = () => W.player.pos.y - Math.max(0, W.data.H(W.player.pos.x, W.player.pos.z)); for (let i = 0; i < 40 && alt() < 2.5; i++) await sleep(200); W.G27.input.up = false; out.droneAlt = alt();
    // מצב יזם
    YZW.setMode('dev'); await sleep(600); YZDev.setLayer('height'); await sleep(300); out.overlay = YZDev.D.ov.size; YZDev.setLayer('none');
    YZDev.startDraw(); const c = W.player.pos; const A = [[0, 0], [60, 0], [60, 40], [0, 40]].map(([x, z]) => YZDev.addPoint(c.x + x, c.z + z)); out.drawAdded = A.every(Boolean);
    out.drawFinish = YZDev.finish(); out.plotArea = Math.round(YZDev.stats().area);
    YZDev.startDraw(); const B = [[0, 0], [100, 0], [50, 50], [100, 100], [0, 100], [50, 50]].map(([x, z]) => YZDev.addPoint(c.x + x, c.z + z)); out.badRejected = B.indexOf(false) >= 0 || !YZDev.finish();
    YZDev.startDraw(); [[0, 0], [100, 100], [100, 0], [0, 100]].forEach(([x, z]) => YZDev.addPoint(c.x + x, c.z + z)); out.crossRejected = YZDev.D.pts.length < 4;
    YZDev.D.draw = false; YZW.setMode('walk'); await sleep(300);
    // הגדרות
    YZW.setTime({ preset: 'night' }); await sleep(300); out.night = W.sun.elevation; YZW.setTime({ preset: 'noon' }); out.noon = W.sun.elevation; YZW.setTime({ preset: 'golden' });
    YZW.setWeather({ rain: 10, cloud: 0.9 }); await sleep(300); YZW.setWeather({ rain: 0, cloud: 0.2, aqi: 180 }); await sleep(300); YZW.setWeather({ aqi: 45 });
    YZW.setShabbat('on'); out.shabbatOn = W.shabbat.active; YZW.setShabbat('auto');
    for (const t of ['low', 'medium', 'high', 'auto']) { YZW.setTier(t); await sleep(200); } out.tier = W.quality.tier;
    YZW.openSheet('modes'); await sleep(200); out.sheetModes = document.querySelectorAll('#yzSheet [data-mode]').length; out.sheetDisabled = document.querySelectorAll('#yzSheet [data-mode][disabled]').length;
    YZW.openSheet('settings'); await sleep(150); YZW.openSheet('modules'); await sleep(150); YZW.openSheet('perf'); await sleep(150); YZW.closeSheet();
    YZW.goHome(); await sleep(3500);
    out.faults = YZW.faults.filter(f => f.id !== 'broken-test'); out.stats = { calls: W.stats.calls, tris: W.stats.tris, fps: W.stats.fps };
    return out;
  });
  ok(r.broken && r.broken.state === 'error', `תוסף שבור בכוונה הושבת לבד (${r.broken && r.broken.state})`);
  ok(r.framesAfterFault > 2, `העולם ממשיך לצייר אחרי הכשל (${r.framesAfterFault} פריימים ב-2 ש')`);
  ok(Math.abs(r.home[0] - 164751) < 15 && Math.abs(r.home[1] - 634164) < 15, `נקודת פתיחה: רחוב הארז ${r.home}`);
  ok(/physics/.test(r.sunSrc) && r.golden > -1 && r.golden < 12, `שמש מהפיזיקה, שעת זהב (${r.golden.toFixed(1)}°)`);
  for (const [m, s] of Object.entries(r.modes)) ok(s === 'ok' || s === 'pending', `מצב ${m}: ${s === 'ok' ? 'עובד' : 'בעבודה (מסומן כלא זמין)'}`);
  ok(r.present && r.presentIframe && r.paused && r.presentClosed, 'מצגת יזם נפתחת מעל עולם מושהה ונסגרת');
  ok(r.cam[0][0] === 2 && r.cam[1][0] === 0 && r.cam[2][0] === 1 && r.cam[1][1] < 0.6, `מצלמה: מלפנים → גוף ראשון (מרחק מהעיניים ${r.cam[1][1]} מ') → מאחור`);
  ok(r.droneAlt > 2, `רחפן פיזיקלי המריא (${r.droneAlt.toFixed(1)} מ')`);
  ok(r.overlay > 0, `שכבת גובה במצב יזם: ${r.overlay} אריחים`);
  ok(r.drawAdded && r.drawFinish && Math.abs(r.plotArea - 2400) < 5, `מגרש 60×40 = ${r.plotArea} מ"ר`);
  ok(r.badRejected, 'מצולע "שמונה" שנוגע בעצמו נדחה'); ok(r.crossRejected, 'מצולע חותך נדחה');
  ok(r.night < -5 && r.noon > 25, `לילה ${r.night.toFixed(1)}°, צהריים ${r.noon.toFixed(1)}°`);
  ok(r.shabbatOn === true, 'מצב שבת ידני'); ok(['low', 'medium', 'high'].includes(r.tier), 'איכות אוטומטית: ' + r.tier);
  ok(r.sheetModes >= 9, `תפריט מצבים: ${r.sheetModes} (${r.sheetDisabled} בעבודה)`);
  ok(r.faults.length === 0, 'אין כשלי מודולים' + (r.faults.length ? ': ' + JSON.stringify(r.faults.slice(0, 3)) : ''));
  ok(errs.length === 0, 'אין שגיאות JS' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
  console.log(`draw ${r.stats.calls} · tris ${(r.stats.tris / 1000).toFixed(0)}k · fps(swiftshader) ${r.stats.fps.toFixed(0)}`);
  await b.close(); console.log(fail ? `${fail} נכשלו` : 'בדיקת עשן עברה'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
