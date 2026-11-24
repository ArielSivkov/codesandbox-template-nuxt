// בדיקת תיקון ?tel= (אותה משפחה כמו C2): כתובת זרה לא מתקבלת; כתובת מקומית מתקבלת רק כשהדף עצמו ב-localhost.
//   node tools/redteam/test-tel.js <port>   (השרת מגיש את תיקיית twin; למשל python3 -m http.server <port> מתוך twin)
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
(async () => {
  const port = process.argv[2] || '8952';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP fake.esh27.test 127.0.0.1'] });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  const cases = [
    // [מארח הדף, ערך tel, האם צפויה בקשה ליעד, תיאור]
    ['127.0.0.1', 'https://evil.example/e', false, 'דף מקומי, שרת זר'],
    ['127.0.0.1', 'http://127.0.0.1:8951/e', true, 'דף מקומי, שרת מקומי'],
    ['fake.esh27.test', 'http://127.0.0.1:8951/e', false, 'דף לא מקומי, שרת מקומי'],
  ];
  for (const [host, tel, expect, label] of cases) {
    const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true })).newPage();
    const target = new URL(tel).host, hosts = [], errs = [];
    p.on('request', r => { try { hosts.push(new URL(r.url()).host); } catch (e) { } });
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://${host}:${port}/integration/world/index.html?auto&nat=0&p=tester&tel=${encodeURIComponent(tel)}`);
    await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 180000 });
    const active = await p.evaluate(() => !!window.__w27tel);
    await p.waitForTimeout(17000);                       // שליחה כל 15 ש'
    await p.goto('about:blank').catch(() => { });         // ושליחה בסגירה
    await p.waitForTimeout(1500);
    const hit = hosts.includes(target), def = hosts.some(h => h.startsWith('esh27-telemetry.'));
    ok(active, `${label}: יומן הבדיקה פעיל`);
    ok(hit === expect, `${label}: ${hit ? 'נשלחה' : 'לא נשלחה'} בקשה ל-${target} (צפוי: ${expect ? 'כן' : 'לא'})`);
    if (!expect) ok(def, `${label}: נשלח לשרת ברירת המחדל במקום`);
    ok(errs.length === 0, `${label}: 0 שגיאות JS${errs.length ? ' – ' + errs[0].slice(0, 120) : ''}`);
    await p.context().close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
