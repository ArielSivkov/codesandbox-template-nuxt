// בדיקת עשן אוטומטית: node tools/smoke.js [url]   (יוצא עם קוד 1 בכישלון)
// מריץ: טעינה, 5 מצבים, התנגשות בבניין, כרטיס + קישור #pre, נכס שלי, כניסה/יציאה מהעסק, שמש/מזג אוויר, בלי שגיאות JS.
const { chromium } = require(process.env.PW || '/tmp/pw/node_modules/playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8931/index.html?auto';
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  const t0 = Date.now();
  await p.goto(url); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 });
  ok(true, `נטען ב-${((Date.now() - t0) / 1000).toFixed(1)} ש'`);
  const r = await p.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms)), out = {}; G27.Q.auto = false;
    out.tiles = G27.W.tiles.size; out.biz = !!G27.biz.b; out.char = Object.keys(G27.AN.acts).length;
    for (const m of ['car', 'heli', 'jet', 'drone', 'foot']) { G27.setMode(m); await sleep(300); if (G27.S.mode !== m) out.modeFail = m; }
    // התנגשות: הליכה ישר אל קיר העסק לא חוצה אותו
    G27.spawn(); const b = G27.biz.b, w = G27.biz.wall, dr = G27.biz.door; G27.S.p.set(dr.x + w.nx * 1.5, dr.y, dr.z + w.nz * 1.5); G27.S.heading = Math.atan2(-w.nx, -w.nz); G27.S.cam.yaw = G27.S.heading;
    G27.input.override = { x: 0, y: 1, up: false, down: false }; await sleep(5000); G27.input.override = null;
    out.inside = G27.W.pip(b, G27.S.p.x, G27.S.p.z); out.distWall = G27.W.edgeDist(b, G27.S.p.x, G27.S.p.z).d;
    // כרטיס + #pre
    G27.showCard(b); const a = document.getElementById('cQuote'); out.href = a && a.href;
    try { const pre = JSON.parse(decodeURIComponent(a.href.split('#pre=')[1])); out.pre = pre.lines.map(l => l.id).join(',') + '|' + pre.lines[1].qty; } catch (e) { out.pre = 'ERR ' + e.message; }
    // נכס שלי
    const had = G27.mine.has(b.id); G27.toggleMine(b); out.mine = G27.mine.has(b.id) !== had && !!localStorage.getItem('w27.mine'); G27.toggleMine(b);
    // פנים
    G27.enterInterior('biz', b); await sleep(300); out.in = G27.S.inside; G27.exitInterior(); out.out = G27.S.inside;
    // שמש: 12:00 בשעון ישראל → גובה חיובי, 00:00 → שלילי
    const d = new Date(G27.ENV.date); d.setUTCHours(10, 0); G27.ENV.date = d; G27.applyEnv(); out.noon = G27.ENV.sun.elevation;
    d.setUTCHours(22, 0); G27.ENV.date = d; G27.applyEnv(); out.night = G27.ENV.sun.elevation;
    G27.SIM.weather.rain = 10; G27.applyEnv(); await sleep(300); G27.SIM.weather.rain = 0; G27.applyEnv();
    out.fps = G27.fps(); out.heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
    return out;
  });
  ok(r.tiles > 3, `אריחים טעונים: ${r.tiles}`); ok(r.biz, 'בניין העסק נמצא ושולט הוצב'); ok(r.char > 10, `דמות + ${r.char} אנימציות`);
  ok(!r.modeFail, 'כל 5 המצבים מתחלפים'); ok(!r.inside && r.distWall >= 0.3 && r.distWall < 1.5, `התנגשות: לא נכנס לקיר (מרחק ${r.distWall.toFixed(2)} מ')`);
  ok(r.href && r.href.startsWith('https://yazam.esh27.com/#pre=') && /^P001,P002,P037,P031,P035,P088\|\d+$/.test(r.pre), `קישור לוח היזם: ${r.pre}`);
  ok(r.mine, 'סימון נכס נשמר ב-localStorage'); ok(r.in === 'biz' && r.out === null, 'כניסה ויציאה מהעסק');
  ok(r.noon > 20 && r.night < 0, `שמש: צהריים ${r.noon.toFixed(1)}°, לילה ${r.night.toFixed(1)}°`);
  ok(errs.length === 0, 'אין שגיאות JS' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(`fps (swiftshader, לא מייצג טלפון) ${r.fps.toFixed(1)} · heap ${r.heap ? r.heap.toFixed(0) + ' MB' : 'n/a'}`);
  await b.close(); console.log(fail ? `${fail} נכשלו` : 'בדיקת עשן עברה'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
