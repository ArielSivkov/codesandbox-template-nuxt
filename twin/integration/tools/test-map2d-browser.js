// בדיקת דפדפן למפה הדו־ממדית (68-map-layers): node tools/test-map2d-browser.js [url]   – צילומים ל-$SHOTS (ברירת מחדל /tmp/map2d-shots)
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
const SH = (process.env.SHOTS || '/tmp/map2d-shots') + '/'; require('fs').mkdirSync(SH, { recursive: true });
(async () => {
  const url = process.argv[2] || 'http://localhost:8940/world/index.html?auto&nat=0';
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|GL Driver|ERR_TUNNEL|ERR_CONNECTION|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
  await p.goto(url); await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 150000 });
  await p.waitForTimeout(4000);
  const pl = await p.evaluate(() => YZW.plugins().filter(x => /map/.test(x.id)).map(x => x.id + ':' + x.state));
  ok(pl.some(s => /^map-layers:/.test(s) && !/error|fail/.test(s)), 'מודול נטען: ' + pl.join(', '));
  // פתיחה דרך המפה המוקטנת
  await p.locator('#mm').click({ force: true }); await p.waitForTimeout(400);
  ok(await p.evaluate(() => YZMap.open), 'הקשה על המפה המוקטנת פותחת את המפה');
  // בניין קרוב לשחקן – מרכזים עליו בזום 17.5
  const info = await p.evaluate(() => { const W = YZW.world, P = W.player.pos; let best = null, bd = 1e9;
    for (const t of W.data.tiles.values()) for (const bb of t.blds || []) { const d = Math.hypot(bb.cx - P.x, bb.cz - P.z); if (d < bd && bb.area > 150) { bd = d; best = bb; } }
    const ll = YZMap.sceneToLL(best.cx, best.cz); YZMap.lat = ll.lat; YZMap.lon = ll.lon; YZMap.z = 17.5; YZMap.dirty = true;
    let nb = 0; for (const t of W.data.tiles.values()) nb += (t.blds || []).length; return { id: best.id, name: best.name, nb, tiles: W.data.tiles.size }; });
  await p.waitForTimeout(1200);
  console.log('     אריחים טעונים', info.tiles, 'בניינים', info.nb);
  await p.screenshot({ path: SH + '01-heights.png' });
  const toPx = `(x, z) => { const M = YZMap, ll = M.sceneToLL(x, z), cv = M.el.querySelector('canvas'), w = cv.clientWidth, h = cv.clientHeight, L = YZMapLayers, a = L.merc(ll.lat, ll.lon), c = L.merc(M.lat, M.lon), K = 256 * 2 ** M.z; return { x: (a.X - c.X) * K + w / 2, y: (a.Y - c.Y) * K + h / 2 }; }`;
  // הקשה על הבניין
  const tp = await p.evaluate(`(() => { const f = ${toPx}; const b = YZW.world.data.buildingById(${JSON.stringify(info.id)}); return f(b.cx, b.cz); })()`);
  await p.touchscreen.tap(tp.x, tp.y); await p.waitForTimeout(500);
  const card = await p.evaluate(() => { const c = document.querySelector('#yzMap .yzP'); return c && c.style.display === 'block' ? c.innerText : ''; });
  ok(/קומות/.test(card) && /טביעה/.test(card), 'הקשה על בניין → כרטיס: ' + card.replace(/\s+/g, ' ').slice(0, 90));
  await p.screenshot({ path: SH + '02-building-card.png' });
  const m0 = await p.evaluate(() => YZW.world.G27.mine.size);
  await p.locator('#yzLMine').click(); await p.waitForTimeout(300);
  const m1 = await p.evaluate(id => YZW.world.G27.mine.has(id), info.id);
  ok(m1, `⭐ סמן כשלי → נוסף ל-G27.mine (${m0}→${await p.evaluate(() => YZW.world.G27.mine.size)})`);
  await p.locator('#yzLX').click();
  // שרטוט מגרש: 4 הקשות
  await p.locator('#yzMap [data-t=draw]').click(); await p.waitForTimeout(300);
  const c0 = await p.evaluate(() => { const ll = { lat: YZMap.lat, lon: YZMap.lon }, s = YZMap.llToSample(ll.lat, ll.lon), q = YZW.world.coords.toScene(s.E, s.N); return q; });
  const corners = [[-40, -30], [40, -30], [40, 30], [-40, 30]];
  for (const [dx, dz] of corners) { const q = await p.evaluate(`(${toPx})(${c0.x + dx}, ${c0.z + dz})`); await p.touchscreen.tap(q.x, q.y); await p.waitForTimeout(380); }
  const st = await p.evaluate(() => ({ n: YZDev.D.pts.length, a: YZMapLayers.shoelace(YZDev.D.pts), draw: YZDev.D.draw, bar: document.querySelectorAll('#yzMap .yzP')[1].innerText }));
  ok(st.n === 4 && Math.abs(st.a - 4800) < 60, `4 פינות במפה → YZDev.D.pts=${st.n}, שטח ${st.a.toFixed(1)} מ"ר (צפוי ~4800, דיוק הקשה בפיקסלים)`);
  ok(/4800|4,8|4.8/.test(st.bar.replace(/\s/g, '')) || /שטח/.test(st.bar), 'סרגל השרטוט: ' + st.bar.replace(/\s+/g, ' ').slice(0, 80));
  await p.screenshot({ path: SH + '03-plot-drawing.png' });
  await p.locator('#yzLDU').click(); await p.waitForTimeout(200);
  ok(await p.evaluate(() => YZDev.D.pts.length === 3 && YZDev.D.draw), '↶ ביטול פינה: 3 פינות, עדיין בשרטוט');
  { const q = await p.evaluate(`(${toPx})(${c0.x - 40}, ${c0.z + 30})`); await p.touchscreen.tap(q.x, q.y); await p.waitForTimeout(380); }
  await p.locator('#yzLDOk').click(); await p.waitForTimeout(300);
  const fin = await p.evaluate(() => ({ draw: YZDev.D.draw, n: YZDev.D.pts.length, s: YZDev.stats(), card: document.querySelector('#yzMap .yzP').innerText, plot3d: !!YZDev.D.plotObj }));
  ok(!fin.draw && fin.n === 4 && fin.plot3d && /מגרש משורטט/.test(fin.card), `✔ סיום → כרטיס מגרש; YZDev.stats().area=${fin.s.area.toFixed(1)}, מבנים ${fin.s.nb}; מגרש קיים בתלת־ממד: ${fin.plot3d}`);
  await p.screenshot({ path: SH + '04-plot-done.png' });
  // חיפוש רחוב
  const street = await p.evaluate(() => { for (const t of YZW.world.data.tiles.values()) for (const r of t.roads || []) if (r.name && r.name.length > 3) return r.name; return ''; });
  await p.locator('#yzMap [data-t=srch]').click(); await p.locator('#yzMap .yzS input').fill(street); await p.waitForTimeout(300);
  const nres = await p.locator('#yzMap .yzS [data-i]').count(); ok(nres > 0, `חיפוש "${street}": ${nres} תוצאות`);
  await p.screenshot({ path: SH + '05-search.png' });
  if (nres) { await p.locator('#yzMap .yzS [data-i]').first().click(); await p.waitForTimeout(600); }
  ok(await p.evaluate(() => !!YZMapLayers.S.street), 'בחירת רחוב → הרחוב מודגש');
  await p.screenshot({ path: SH + '06-street.png' });
  // הנכסים שלי
  await p.locator('#yzMap [data-t=mine]').click(); await p.waitForTimeout(300);
  const ml = await p.evaluate(() => document.querySelector('#yzMap .yzP').innerText); ok(/הנכסים שלי \(\d+\)/.test(ml), 'רשימת הנכסים שלי: ' + ml.split('\n')[0]);
  await p.locator('#yzMap .yzL [data-id]').first().click(); await p.waitForTimeout(600);
  await p.screenshot({ path: SH + '07-mine.png' });
  // גדלי כפתורים בטלפון 360
  const small = await p.evaluate(() => [...document.querySelectorAll('#yzMap button, #yzMap a.btn')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.dataset.t || e.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[2] < 40 || x[1] < 40));
  ok(small.length === 0, 'כל הכפתורים הגלויים במפה ≥ 40 פיקסל' + (small.length ? ': ' + JSON.stringify(small) : ''));
  const over = await p.evaluate(() => { const r = [...document.querySelectorAll('#yzMap .yzT .btn')].map(e => e.getBoundingClientRect()), tb = document.querySelector('#yzMap .tb').getBoundingClientRect(); return r.some(x => x.top < tb.bottom) || r.some(x => x.right > innerWidth); });
  ok(!over, 'עמודת הכלים לא חופפת את הסרגל העליון ולא חורגת מהמסך');
  // 3D: כפתור בתלת־ממד בכרטיס בניין
  const has3d = await p.locator('#yzL3d').count();
  if (has3d) { await p.locator('#yzL3d').click(); await p.waitForTimeout(1500); ok(await p.evaluate(() => !YZMap.open && YZW.mode() === 'dev'), '👁 בתלת־ממד → המפה נסגרת, העין הגדולה'); await p.screenshot({ path: SH + '08-3d.png' }); }
  // נקודה רגילה עדיין עובדת (הקשה על ים/שטח ריק)
  await p.evaluate(() => YZMap.openMap()); await p.waitForTimeout(300);
  await p.evaluate(() => { YZMap.z = 12; YZMap.lat = 31.9; YZMap.lon = 34.4; YZMap.dirty = true; }); await p.waitForTimeout(300);
  await p.touchscreen.tap(180, 400); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !!YZMap.pick && document.querySelector('#yzMap .pk:not(.yzP)').style.display === 'block'), 'הקשה מחוץ לבניין → בחירת נקודה רגילה (ללכת לכאן / גוגל)');
  ok(errs.length === 0, 'אין שגיאות JS' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  console.log(fail ? fail + ' נכשלו' : 'הכול עבר'); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
