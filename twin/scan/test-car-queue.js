// בדיקה: מצב רכב (בלי צעדים, כיוון לפי GPS) + תור העלאה ששורד סגירת דף.
// הרצה: node test-car-queue.js http://127.0.0.1:8942/
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8942/';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 850 }, permissions: ['camera', 'geolocation'], geolocation: { latitude: 31.788, longitude: 34.66, accuracy: 3 } });
  let ok = true; const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) ok = false; };
  const errs = []; let online = false; const ups = [];
  await ctx.route('**/api/**', r => { const u = r.request().url();
    if (u.includes('upload')) { if (!online) return r.abort(); ups.push(decodeURIComponent(u.split('name=')[1])); }
    r.fulfill({ json: { ok: true, key_ok: true } }); });
  let p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(url + '?k=test'); await p.click('#begin'); await p.waitForTimeout(1200); await p.click('#go');
  // נסיעה: GPS עם מהירות 12 מ/ש לכיוון 290°, מצפן "משוגע" ורעידות רכב
  await p.evaluate(async () => { const T = window.__esh27test, sl = ms => new Promise(r => setTimeout(r, ms));
    let lat = 31.788, lon = 34.66;
    for (let i = 0; i < 12; i++) { lat += 12 * Math.cos(290 * Math.PI / 180) / 111195; lon += 12 * Math.sin(290 * Math.PI / 180) / 94600;
      T.onGps({ latitude: lat, longitude: lon, accuracy: 2.5, speed: 12, heading: 290 }, Date.now());
      window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { absolute: true, alpha: (i * 47) % 360, beta: 90, gamma: 0 }));
      for (let k = 0; k < 10; k++) window.dispatchEvent(Object.assign(new Event('devicemotion'), { accelerationIncludingGravity: { x: 0.2, y: 9.7 + (k % 3 ? 0 : 2.5), z: -0.4 }, rotationRate: { alpha: 1, beta: 1, gamma: 1 } }));
      await sl(500); } });
  const st = await p.evaluate(() => ({ car: window.__esh27test.S.car, steps: window.__esh27test.S.steps, shots: window.__esh27test.S.shots, head: document.getElementById('dHead').textContent }));
  check(st.car, 'זוהתה נסיעה (מצב רכב)');
  check(st.steps === 0, 'ברכב לא נספרים צעדים: ' + st.steps);
  check(/🚗 290/.test(st.head), 'כיוון לפי GPS: ' + st.head);
  check(st.shots >= 2, 'צילומים בנסיעה: ' + st.shots);
  await p.waitForTimeout(800);
  const saved = await p.evaluate(() => window.__esh27test.idbDo(s => s.count()));
  check(saved >= 2, 'בלי רשת: ' + saved + ' צילומים שמורים בטלפון');
  // סוגרים את הדף לפני שעלו, פותחים מחדש עם רשת
  await p.close(); online = true;
  p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(url + '?k=test'); await p.waitForTimeout(3000);
  check(ups.length >= saved, 'אחרי פתיחה מחדש עלו ' + ups.length + '/' + saved);
  const left = await p.evaluate(() => window.__esh27test.idbDo(s => s.count()));
  check(left === 0, 'הזיכרון בטלפון התרוקן אחרי העלאה: ' + left);
  check(errs.length === 0, 'בלי שגיאות JS ' + errs.join(' | '));
  await b.close(); console.log(ok ? 'בדיקת רכב ותור עברה' : 'בדיקת רכב ותור נכשלה'); process.exit(ok ? 0 : 1);
})();
