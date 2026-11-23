// בדיקת עשן למצלמת השטח: נטען ב-360 רוחב, בלי שגיאות, מודול השמיים נטען, אין גלילה אופקית. GPS/מצפן מדומים.
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
(async () => { const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const ctx = await br.newContext({ viewport: { width: 360, height: 800 }, geolocation: { latitude: 31.8058, longitude: 34.6428, accuracy: 6 }, permissions: ['geolocation'] });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await pg.goto(process.argv[2] || 'http://127.0.0.1:8823/procgen/capture.html'); await pg.click('#perm');
  await pg.evaluate(() => { const e = new Event('deviceorientationabsolute'); Object.assign(e, { alpha: 270, beta: 90, gamma: 0, absolute: true }); window.dispatchEvent(e); });
  await pg.waitForTimeout(2500);
  const r = await pg.evaluate(() => ({ gps: document.getElementById('gps').textContent, itm: document.getElementById('itm').textContent, head: document.getElementById('head').textContent, sky: document.getElementById('sky').textContent, overflow: document.documentElement.scrollWidth > innerWidth }));
  await pg.screenshot({ path: __dirname + '/shots/capture.png' }); console.log(JSON.stringify({ ...r, errors: errs })); await br.close(); process.exit(errs.length ? 1 : 0); })();
