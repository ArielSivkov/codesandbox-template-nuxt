// בדיקה אוטומטית לסורק ההליכה: מצלמה מדומה, GPS זז, חיישני תנועה, צעדים, צילום אוטומטי, העלאה, מצב הדגמה.
// הרצה: node test-walk.js http://127.0.0.1:8941/   (הדף מוגש מקומית; ה-API מדומה)
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8941/';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 850 }, permissions: ['camera', 'geolocation'], geolocation: { latitude: 31.7905, longitude: 34.6402, accuracy: 5 } });
  const p = await ctx.newPage(); const errs = [], ups = []; let ok = true;
  const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) ok = false; };
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/api/**', r => { const u = r.request().url(); if (u.includes('upload')) ups.push(u.split('name=')[1]); r.fulfill({ json: { ok: true, key_ok: true } }); });
  await p.goto(url + '?k=test'); await p.click('#begin'); await p.waitForTimeout(1500);
  check(await p.$eval('#intro', e => e.style.display === 'none'), 'מסך פתיחה נסגר אחרי הרשאות');
  await p.click('#go');
  // הליכה: 10 צעדים צפונה, 1.2 מ' כל אחד, טלפון מוחזק ישר
  let lat = 31.7905;
  for (let i = 0; i < 14; i++) {
    lat += 1.2 / 111195; await ctx.setGeolocation({ latitude: lat, longitude: 34.6402, accuracy: 5 });
    await p.evaluate(() => { const ev = (x, y, z) => window.dispatchEvent(Object.assign(new Event('devicemotion'), { accelerationIncludingGravity: { x, y, z }, rotationRate: { alpha: 1, beta: 1, gamma: 1 } }));
      for (let k = 0; k < 20; k++) ev(0.2, 9.7, -0.4); ev(0.2, 12.5, -0.4);
      window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { absolute: true, alpha: 360, beta: 90, gamma: 0 })); });
    await p.waitForTimeout(600);
  }
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => { const S = window.__esh27test.S; return { shots: S.shots, dist: S.dist, steps: S.steps, head: S.head, acc: S.pos && S.pos.acc, place: document.getElementById('place').textContent, sub: document.getElementById('sub').textContent }; });
  check(st.dist > 10 && st.dist < 25, 'מרחק הליכה נמדד: ' + st.dist.toFixed(1) + ' מ\' (אמת ≈16.8)');
  check(st.shots >= 3, 'צילום אוטומטי בהליכה: ' + st.shots + ' צילומים');
  check(st.steps >= 10, 'זיהוי צעדים: ' + st.steps);
  check(st.head !== null && Math.abs(st.head) < 1, 'מצפן: ' + st.head);
  check(ups.length >= 3, 'העלאות: ' + ups.length);
  check(/הולך|עומד/.test(st.sub), 'שורת מצב: ' + st.sub);
  // אחיזה לא נכונה → הנחיה
  await p.evaluate(() => { for (let k = 0; k < 30; k++) window.dispatchEvent(Object.assign(new Event('devicemotion'), { accelerationIncludingGravity: { x: 0, y: 3, z: -9 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } })); });
  await p.waitForTimeout(500);
  check(/הרם|הורד/.test(await p.textContent('#guide')), 'הנחיית אחיזה: ' + await p.textContent('#guide'));
  await p.screenshot({ path: process.argv[3] || 'walk.png' });
  // בדיקה עצמית ומדידה
  await p.click('#openTools'); await p.click('#tbS'); await p.click('#runTest');
  check((await p.textContent('#selftest')).includes('✅ מצלמה'), 'בדיקה עצמית: מצלמה');
  await p.click('#tbM'); await p.click('#mLast'); await p.waitForTimeout(1200); await p.click('#mmP');
  const bx = await p.locator('#mCv').boundingBox();
  for (const [x, y] of [[.2, .6], [.6, .6], [.7, .9], [.1, .9], [.3, .3], [.8, .3]]) await p.mouse.click(bx.x + bx.width * x, bx.y + bx.height * y);
  await p.waitForTimeout(500); check((await p.textContent('#mOut')).includes('±'), 'מדידה עם סטיית תקן');
  check(errs.length === 0, 'בלי שגיאות JS ' + errs.join(' | '));
  console.log(ok ? 'בדיקת הסורק עברה' : 'בדיקת הסורק נכשלה'); await b.close(); process.exit(ok ? 0 : 1);
})();
