// בדיקת תיקון C2: ?acct= זר לא מתקבל; כתובת מקומית כן (רק ב-localhost). node test-acct-c2.js <base>
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8997/integration/world/index.html';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  for (const [q, expectEvil] of [['evil.example', false], ['127.0.0.1:8950', true]]) {
    const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true })).newPage();
    const hosts = []; p.on('request', r => hosts.push(new URL(r.url()).host));
    await p.goto(`${base}?auto&nat=0&acct=http://${q}`);
    await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 120000 }); await p.waitForTimeout(2500);
    const hit = hosts.includes(q);
    ok(hit === expectEvil, `acct=${q}: ${hit ? 'נשלחה בקשה' : 'לא נשלחה בקשה'} (צפוי: ${expectEvil ? 'כן' : 'לא'})`);
    await p.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
