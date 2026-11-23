// בדיקת היכולות החדשות בדפדפן: שעות שמש בחזיתות + לפי קומה + דוח CSV, איפה אני, זריחה/שקיעה, שעות שמש כאן
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8931/index.html?auto', shot = process.argv[3];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  await p.goto(url); await p.waitForFunction(() => window.G27 && G27.S.started, null, { timeout: 120000 });
  await p.evaluate(() => { G27.Q.auto = false; const pp = G27.S.p, bb = G27.biz.b || G27.W.near(pp.x, pp.z, 120).sort((a, c) => c.h - a.h)[0]; G27.showCard(bb); document.getElementById('cSun').click(); });
  await p.waitForFunction(() => document.getElementById('sfOut') && document.getElementById('sfOut').querySelectorAll('tr').length > 1, null, { timeout: 60000 });
  const card = await p.evaluate(() => ({ rows: document.querySelectorAll('#cSunOut table tr').length, floors: +document.getElementById('sfR').max }));
  ok(card.rows >= 10, `טבלאות שעות שמש בכרטיס (${card.rows} שורות), בורר קומות עד ${card.floors}`);
  if (shot) { await p.evaluate(() => { const c = document.getElementById('card'); c.scrollTop = c.scrollHeight; }); await p.screenshot({ path: shot.replace('.png', '-card.png') }); }
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#sCsv')]);
  const fs = require('fs'), path = await dl.path(), csv = fs.readFileSync(path, 'utf8').split('\n');
  ok(csv[0].includes('building_id,floor') && csv.length >= 1 + card.floors * 2 * 2, `דוח CSV: ${csv.length - 2} שורות נתונים (${card.floors} קומות × 2 תאריכים × חזיתות)`);
  await p.evaluate(() => { document.getElementById('cClose').click(); document.getElementById('bMenu').click(); });
  await p.waitForSelector('#mWhere', { timeout: 10000 }); await p.click('#mWhere');
  const where = await p.evaluate(() => document.getElementById('whereOut').innerText);
  const m = where.match(/GPS:\s*([\d.]+),\s*([\d.]+)/); ok(m && Math.abs(+m[1] - 31.8) < 0.1 && Math.abs(+m[2] - 34.65) < 0.1, `איפה אני: ${where.split('\n')[0]}`);
  await p.evaluate(() => document.getElementById('bEnv').click());
  await p.waitForSelector('#eHere', { timeout: 10000 });
  const sunTxt = await p.evaluate(() => document.querySelector('#env .ro').innerText);
  ok(/זריחה \d\d:\d\d · 🌇 שקיעה \d\d:\d\d/.test(sunTxt), 'זריחה ושקיעה בפאנל השמש: ' + sunTxt.split('\n').pop());
  await p.click('#eHere'); const here = await p.evaluate(() => document.getElementById('eHereOut').innerText);
  ok(/מתוך/.test(here), 'שעות שמש כאן: ' + here.slice(0, 60));
  ok(await p.evaluate(() => !document.getElementById('eLive').disabled), 'כפתור מזג אוויר אמיתי זמין בלחיצה');
  if (shot) await p.screenshot({ path: shot });
  ok(errs.length === 0, 'אין שגיאות JS' + (errs.length ? ': ' + errs[0] : ''));
  console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); await b.close(); process.exit(fail ? 1 : 0);
})();
