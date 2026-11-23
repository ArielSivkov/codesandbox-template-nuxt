// בדיקת התחלה במיקום GPS (מדומה): node tools/test-gps.js [url]
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const base = process.argv[2] || 'http://localhost:8931/index.html';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  for (const [name, lat, lon, inside] of [['קיי טאוורס, אשדוד', 31.79472, 34.64083, true], ['תל אביב (מחוץ לאזור)', 32.0853, 34.7818, false]]) {
    const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, geolocation: { latitude: lat, longitude: lon, accuracy: 8 }, permissions: ['geolocation'] });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(base + '?auto&gps=1'); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 });
    await p.waitForFunction(() => /התחלת במיקום|מחוץ לאזור/.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 40000 }).catch(() => {});
    const r = await p.evaluate(() => { const S = G27.S, W = G27.W, E = S.p.x + W.OX, N = W.OY - S.p.z, rr = ITM.sampleToItm(E, N), g = ITM.itmToWgs84(rr.E, rr.N); return { lat: g.lat, lon: g.lon, y: S.p.y - Math.max(W.H(S.p.x, S.p.z), 0), inB: !!W.buildingAt(S.p.x, S.p.z) }; });
    const d = Math.hypot((r.lat - lat) * 110900, (r.lon - lon) * 94700);
    if (inside) ok(d < 40 && Math.abs(r.y) < 0.5 && !r.inB, `${name}: התחיל ${d.toFixed(1)} מ' מהמיקום (מחוץ לבניין, ברמת הרחוב: ${r.y.toFixed(2)} מ' מעל הקרקע)`);
    else ok(d > 1000, `${name}: מחוץ לאזור – נשאר בנקודת ההתחלה (${(d / 1000).toFixed(1)} ק"מ מהמיקום)`);
    ok(errs.length === 0, 'אין שגיאות JS' + (errs.length ? ': ' + errs[0] : '')); await ctx.close();
  }
  console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); await b.close(); process.exit(fail ? 1 : 0);
})();
