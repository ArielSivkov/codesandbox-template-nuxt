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
  // ישיבה וסיבוב בכיסא: תנועות ידיים לא סדירות + סיבוב – אסור שייספרו צעדים
  await p.evaluate(async () => { const sl = ms => new Promise(r => setTimeout(r, ms)); const ev = (x, y, z, rot) => window.dispatchEvent(Object.assign(new Event('devicemotion'), { accelerationIncludingGravity: { x, y, z }, rotationRate: { alpha: rot, beta: 5, gamma: 5 } }));
    const gaps = [250, 900, 400, 1500, 350, 700, 1200, 300];
    for (const gp of gaps) { for (let k = 0; k < 8; k++) ev(0.5, 9.5, -2, 120); ev(1.5, 12.3, -2, 120); await sl(gp); } });
  // תיקון ראשון גרוע (±40 מ', 35 מ' מהמקום) ואז תיקון טוב – הנקודה חייבת לקפוץ למקום הנכון
  await p.evaluate(() => { const T = window.__esh27test; T.S.pos = null; T.S.track = []; T.onGps({ latitude: 31.7905 + 35 / 111195, longitude: 34.6402, accuracy: 40 }, Date.now()); T.onGps({ latitude: 31.7905, longitude: 34.6402, accuracy: 4 }, Date.now()); });
  const snap = await p.evaluate(() => { const T = window.__esh27test, d = T.enu({ lat: 31.7905, lon: 34.6402 }, T.S.pos); return Math.hypot(d.x, d.y); });
  check(snap < 1, 'תיקון GPS מדויק מחליף תיקון גרוע: ' + snap.toFixed(1) + ' מ\' מהמקום האמיתי');
  // עמידה במקום עם רעש GPS של ±3 מ' – המהירות חייבת להישאר אפס
  for (let i = 0; i < 8; i++) { await ctx.setGeolocation({ latitude: 31.7905 + (Math.random() - .5) * 5 / 111195, longitude: 34.6402 + (Math.random() - .5) * 5 / 94600, accuracy: 3 }); await p.waitForTimeout(400); }
  const still = await p.evaluate(() => window.__esh27test.S.speed);
  const drift = await p.evaluate(() => { const S = window.__esh27test.S, d = window.__esh27test.enu({ lat: 31.7905, lon: 34.6402 }, S.pos); return { m: Math.hypot(d.x, d.y), n: S.track.length, dist: S.dist }; });
  check(drift.m < 1.5 && drift.n <= 2 && drift.dist < 0.5, 'עמידה: הנקודה לא זזה במפה (' + drift.m.toFixed(2) + ' מ\', ' + drift.n + ' נקודות מסלול, ' + drift.dist.toFixed(1) + ' מ\' מרחק)');
  check(still < 0.3, 'עמידה עם רעש GPS: מהירות ' + still.toFixed(2) + ' מ/ש (צריך ≈0)');
  const sitSteps = await p.evaluate(() => window.__esh27test.S.steps);
  check(sitSteps === 0, 'ישיבה וסיבוב: ' + sitSteps + ' צעדים (צריך 0)');
  // הליכה: 10 צעדים צפונה, 1.2 מ' כל אחד, טלפון מוחזק ישר
  let lat = 31.7905;
  for (let i = 0; i < 14; i++) {
    lat += 1.2 / 111195; await ctx.setGeolocation({ latitude: lat, longitude: 34.6402, accuracy: 5 });
    await p.evaluate(() => { const ev = (x, y, z) => window.dispatchEvent(Object.assign(new Event('devicemotion'), { accelerationIncludingGravity: { x, y, z }, rotationRate: { alpha: 1, beta: 1, gamma: 1 } }));
      for (let k = 0; k < 20; k++) ev(0.2, 9.7, -0.4); ev(0.2, 11.3, -0.4);
      window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { absolute: true, alpha: 360, beta: 90, gamma: 0 })); });
    await p.waitForTimeout(600);
  }
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => { const S = window.__esh27test.S; return { shots: S.shots, dist: S.dist, steps: S.steps, head: S.head, acc: S.pos && S.pos.acc, place: document.getElementById('place').textContent, sub: document.getElementById('sub').textContent }; });
  check(st.dist > 13 && st.dist < 21, 'מרחק הליכה נמדד: ' + st.dist.toFixed(1) + ' מ\' (אמת ≈16.8)');
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
  // מצב וידאו: עוצרים צילום, עוברים לווידאו, מקליטים 3 שניות → מקטע וידאו + יומן חיישנים עולים
  if (await p.$eval('#go', e => e.textContent) === 'עצור') await p.click('#go');
  await p.click('#modeBtn'); check(await p.$eval('#go', e => e.textContent) === 'הקלט', 'מעבר למצב וידאו');
  const before = ups.length; await p.click('#go'); await p.waitForTimeout(3000); await p.click('#go'); await p.waitForTimeout(2500);
  const vids = ups.slice(before);
  check(vids.some(n => /_video\.(webm|mp4)$/.test(n)) && vids.some(n => /sensors\.json$/.test(n)), 'וידאו + יומן חיישנים עלו: ' + vids.join(', '));
  await p.click('#modeBtn');
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
