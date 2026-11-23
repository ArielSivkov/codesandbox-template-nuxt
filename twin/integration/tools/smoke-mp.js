// בדיקת עשן בדפדפן: מרובה משתתפים + מבוקש.  node tools/smoke-mp.js [בסיס-כתובת]   (קוד יציאה 1 בכישלון)
// השרת: במקום קלאודפלייר, Playwright מיירט את ה-WebSocket ומחבר אותו למחלקה Room האמיתית מ-twin/servers/esh27-mp/worker.js (בתוך node).
// כך שני דפדפנים אמיתיים מדברים זה עם זה דרך קוד השרת האמיתי – בלי פריסה ובלי רשת חיצונית.
const path = require('path');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/tmp/pw/node_modules/playwright'); } })();
const BASE = process.argv[2] || 'http://127.0.0.1:8978/world/index.html';
const Q = '?auto&nat=0&nointro';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const { Room } = await import(path.join(__dirname, '..', '..', 'servers', 'esh27-mp', 'worker.js'));
  const ctx = { socks: [], acceptWebSocket(ws) { this.socks.push(ws); }, getWebSockets() { return this.socks.filter(s => !s.closed); } };
  const room = new Room(ctx, {});
  const routes = [];
  const bridge = async page => page.routeWebSocket(/mp\.test/, ws => {
    const u = new URL(ws.url()); const sock = { closed: false, att: null, route: ws, page,
      send(s) { if (this.closed) throw new Error('closed'); ws.send(s); }, close(c) { if (this.closed) return; this.closed = true; try { ws.close({ code: c || 1000 }); } catch (e) { /* */ } },
      serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); }, deserializeAttachment() { return this.att; } };
    routes.push(sock);
    room.accept(sock, decodeURIComponent(u.searchParams.get('n') || ''), 'x');
    ws.onMessage(m => { if (!sock.closed) room.webSocketMessage(sock, typeof m === 'string' ? m : String(m)); });
    ws.onClose(code => { if (sock.closed) return; sock.closed = true; room.webSocketClose(sock, code || 1005); });
  });
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const open = async (q, mp) => {
    const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|GL Driver|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_REFUSED|WebSocket connection to|net::ERR/.test(m.text())) p.errs.push(m.text().slice(0, 200)); });
    if (mp) { await bridge(p); p.on('close', () => { for (const s of routes) if (s.page === p && !s.closed) { s.closed = true; room.webSocketClose(s, 1001); } }); }
    const t0 = Date.now(); await p.goto(BASE + Q + q); await p.waitForFunction(() => window.YZW && YZW.world.stats.startMs, null, { timeout: 150000 });
    p.loadS = (Date.now() - t0) / 1000; return p;
  };
  // תקלה ידועה שקיימת כבר בענף לפני המודולים האלה (נבדק עם ?wanted=0 ובלי ?mp): camera/אתחול insertBefore – לא נספרת כאן, מדווחת
const KNOWN = f => f.id === 'camera' && /insertBefore/.test(f.msg);
  const faults = p => p.evaluate(src => { const K = eval(src); return YZW.faults.filter(f => !K(f)).map(f => f.id + '/' + f.phase + ': ' + f.msg); }, KNOWN.toString());
  const known = p => p.evaluate(() => YZW.faults.filter(f => f.id === 'camera').length);
  const plug = (p, id) => p.evaluate(id => (YZW.plugins().find(x => x.id === id) || {}).state || 'none', id);

  // 1) בלי ?mp: המודול לא נרשם; מבוקש פעיל; תאונה → כוכב; דעיכה
  const P0 = await open('', false); ok(true, `נטען בלי ?mp (${P0.loadS.toFixed(1)} ש')`);
  ok(await plug(P0, 'multiplayer') === 'none', 'בלי ?mp: מרובה משתתפים לא נרשם בכלל (כבוי כברירת מחדל)');
  ok(await plug(P0, 'wanted') === 'on', 'מבוקש: פעיל');
  const w = await P0.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms)), L = window.YZTraffic, out = { cars: L && L.cars ? L.cars.length : 0 };
    out.hidden0 = document.getElementById('yzWanted').hidden;
    YZW.world.G27.S.car.v = -0.25 * 50 / 3.6;   // כאילו פגיעה ב-50 קמ"ש (life-lite כבר הכפיל ב-−0.25)
    const c = L.cars.find(c => c.r) || L.cars[0]; c.crash = 10; await sleep(600);
    out.level1 = YZWanted.level(); out.chip = document.getElementById('yzWanted').textContent; out.hidden1 = document.getElementById('yzWanted').hidden; out.off = YZWanted.offenses.slice(-1)[0];
    const c2 = L.cars.filter(x => x !== c)[0]; c2.crash = 10; await sleep(600); out.level2 = YZWanted.level(); out.heat2 = YZWanted.st.heat; out.h1 = out.off.heat;
    YZW.bus.emit('offense', { heat: 1000, reason: 'בדיקה' }); await sleep(200); out.level5 = YZWanted.level();
    YZWanted.st.since = 999; const h = YZWanted.st.heat, t0 = YZW.world.clock.t; await sleep(2000); out.decay = h - YZWanted.st.heat; out.gameDt = YZW.world.clock.t - t0; out.off2 = YZWanted.offenses.slice(-2)[0];
    YZWanted.st.heat = 0.01; await sleep(500); out.level0 = YZWanted.level(); out.hidden0b = document.getElementById('yzWanted').hidden;
    return out; });
  ok(w.cars > 0 && w.hidden0, `תג המבוקש מוסתר ב-0 כוכבים (${w.cars} רכבים בתנועה)`);
  ok(w.level1 === 1 && !w.hidden1 && /★☆☆☆☆/.test(w.chip) && /50 קמ"ש/.test(w.off.reason), `תאונה (זוהתה מ-life-lite) → ${w.chip} · "${w.off.reason}" חום ${w.off.heat}`);
  ok(w.off2 && Math.abs(w.heat2 - (w.h1 + w.off2.heat)) < 1 && Math.abs(w.off2.heat - 1.5 * w.h1) < 1 && w.level2 === Math.ceil(w.heat2 / 100), `תאונה שנייה תוך 30 ש' – פי 1.5 (נוסף ${w.off2 && w.off2.heat}): חום ${Math.round(w.heat2)} → ${w.level2} כוכבים`);
  ok(w.level5 === 5, 'דיווח עבירה דרך האפיק (offense) → תקרה 5');
  ok(Math.abs(w.decay - 5 * w.gameDt) < 0.3, `דעיכה בדפדפן: ${w.decay.toFixed(2)} חום ב-${w.gameDt.toFixed(2)} ש' של שעון המשחק (ברגל: 2.5×2 → מצופה ${(5 * w.gameDt).toFixed(2)}; שעון המשחק איטי מהשעון האמיתי ב-fps נמוך כי dt חתוך ל-0.1)`);
  ok(w.level0 === 0 && w.hidden0b, 'חזרה ל-0 → התג נעלם');
  ok(!(await faults(P0)).length && !P0.errs.length, `בלי תקלות מודולים / שגיאות JS (${(await faults(P0)).join(' | ') || '0'} · ${P0.errs.join(' | ') || '0'})`);
  await P0.context().close();

  // 2) ?mp בלי שרת: לא קורס, מנסה שוב
  const PN = await open('&mp=בדיקה&mpsrv=ws://127.0.0.1:9', false);
  await PN.waitForTimeout(6000);
  const n = await PN.evaluate(() => ({ st: YZMP.status, tries: YZMP.tries, next: YZMP.nextMs, chip: document.getElementById('yzMp').textContent }));
  ok(await plug(PN, 'multiplayer') === 'on' && n.st === 'down' && n.tries >= 2, `בלי שרת: מצב "${n.st}", ${n.tries} ניסיונות, הבא בעוד ${n.next} מ"ש · תג: ${n.chip}`);
  ok(!(await faults(PN)).length && !PN.errs.length, `בלי שרת: אין תקלות מודולים / שגיאות JS (${(await faults(PN)).join(' | ') || '0'} · ${PN.errs.join(' | ') || '0'})`);
  await PN.context().close();

  // 3) שני שחקנים דרך קוד השרת האמיתי
  const A = await open('&mp=חדר1&mpsrv=ws://mp.test&mpn=' + encodeURIComponent('אריאל'), true);
  const B = await open('&mp=חדר1&mpsrv=ws://mp.test&mpn=' + encodeURIComponent('שון'), true);
  await B.waitForFunction(() => YZMP.status === 'open' && YZMP.peers.size === 1, null, { timeout: 20000 }).catch(() => {});
  await A.waitForFunction(() => YZMP.peers.size === 1, null, { timeout: 20000 }).catch(() => {});
  await B.waitForFunction(() => [...YZMP.peers.values()].some(p => p.obj), null, { timeout: 20000 }).catch(() => {});
  const seeA = async () => { const a = await A.evaluate(() => ({ x: YZW.world.player.pos.x, z: YZW.world.player.pos.z, id: YZMP.id }));
    const g = await B.evaluate(id => { const p = YZMP.peers.get(id); return p && p.obj ? { x: p.obj.position.x, z: p.obj.position.z, kind: p.kind, vis: p.obj.visible, label: p.label } : null; }, a.id); return { a, g }; };
  let r = await seeA();
  ok(r.g && Math.hypot(r.g.x - r.a.x, r.g.z - r.a.z) < 1, `B רואה את A כרוח (${r.g && r.g.kind}, "${r.g && r.g.label}") במרחק ${r.g ? Math.hypot(r.g.x - r.a.x, r.g.z - r.a.z).toFixed(2) : '—'} מ' מהמיקום האמיתי`);
  await A.waitForFunction(() => [...YZMP.peers.values()].some(p => p.obj && p.label), null, { timeout: 20000 }).catch(() => {});
  ok(await A.evaluate(() => { const p = [...YZMP.peers.values()][0]; return !!(p && p.obj && p.label.startsWith('שון')); }), 'A רואה את B');
  // A זז 40 מ' (קפיצה) ועובר לרכב → אצל B הרוח עוברת ומתחלפת לרכב
  await A.evaluate(() => { const c = YZW.world.coords, p = YZW.world.player.pos, it = c.toITM(p.x + 40, p.z); YZW.placeAt(it.E, it.N, 0); YZW.setMode('car'); });
  await A.waitForTimeout(4000); r = await seeA(); const r2 = await seeA(); r.moving = Math.hypot(r2.a.x - r.a.x, r2.a.z - r.a.z);
  ok(r.g && r.g.kind === 'car' && Math.hypot(r.g.x - r.a.x, r.g.z - r.a.z) < 2, `אחרי מעבר ורכב: רוח ${r.g && r.g.kind}, סטייה ${r.g ? Math.hypot(r.g.x - r.a.x, r.g.z - r.a.z).toFixed(2) : '—'} מ' (A זז ${r.moving.toFixed(2)} מ' בין שתי מדידות)`);
  // A מקבל כוכב → מופיע בשם אצל B
  await A.evaluate(() => YZWanted.add(150, 'בדיקה')); await B.waitForTimeout(2500); r = await seeA();
  ok(r.g && /★★/.test(r.g.label), `כוכבי מבוקש עוברים לשם הרוח: "${r.g && r.g.label}"`);
  // תנועה רציפה: החלקה – דגימת מיקום הרוח כל 50 מ"ש, אין קפיצות > 1.5 מ' בין פריימים (רכב ~15 מ'/ש')
  await A.evaluate(() => { const S = YZW.world.G27.S; S.car.v = 15; YZW.world.G27.input.y = 1; });
  const tr = await B.evaluate(async id => { const out = []; for (let i = 0; i < 40; i++) { const p = YZMP.peers.get(id); if (p && p.obj) out.push([p.obj.position.x, p.obj.position.z]); await new Promise(r => setTimeout(r, 50)); } return out; }, r.a.id);
  await A.evaluate(() => { YZW.world.G27.input.y = 0; });
  let mj = 0, tot = 0; for (let i = 1; i < tr.length; i++) { const d = Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]); mj = Math.max(mj, d); tot += d; }
  ok(tr.length > 30 && tot > 1 && mj < 1.5, `החלקה בזמן נסיעה: ${tot.toFixed(1)} מ' ב-2 ש', צעד מרבי ${mj.toFixed(2)} מ' בין דגימות של 50 מ"ש`);
  // השרת סוגר את החיבור של B → B מתחבר מחדש לבד
  const idB0 = await B.evaluate(() => YZMP.id);
  const sB = routes.find(s => s.att && s.att.id === idB0); if (sB) { sB.closed = true; room.webSocketClose(sB, 1012); try { sB.route.close({ code: 1012 }); } catch (e) { /* */ } }
  await B.waitForFunction(id0 => YZMP.status === 'open' && YZMP.id && YZMP.id !== id0 && YZMP.peers.size === 1, idB0, { timeout: 15000 }).catch(() => {});
  const rb = await B.evaluate(() => ({ st: YZMP.status, id: YZMP.id, n: YZMP.peers.size }));
  ok(rb.st === 'open' && rb.id !== idB0 && rb.n === 1, `ניתוק מהשרת → חיבור מחדש (מזהה ${idB0}→${rb.id}, רואה ${rb.n})`);
  // A סוגר את הדף → אצל B הרוח נעלמת
  const fa = await faults(A), ea = A.errs.slice(); await A.context().close();
  await B.waitForFunction(() => YZMP.peers.size === 0, null, { timeout: 10000 }).catch(() => {});
  ok(await B.evaluate(() => YZMP.peers.size === 0 && !YZW.world.scene.getObjectByName('mp-ghosts').children.length), 'A יצא → הרוח נמחקה אצל B');
  // כיבוי המודול מהתפריט → נסגר בלי שגיאה, בלי ניסיונות חוזרים
  await B.evaluate(() => YZW.enable('multiplayer', false, true)); await B.waitForTimeout(1500);
  ok(await B.evaluate(() => YZMP.status === 'off' && !YZMP.ws && !document.getElementById('yzMp')), 'כיבוי המודול: החיבור נסגר, התג הוסר');
  const fb = await faults(B);
  console.log('  מידע: תקלת camera/אתחול ידועה (קיימת בענף לפני השינוי): ' + (await known(B)) + ' פעמים');
  ok(!fa.length && !fb.length && !ea.length && !B.errs.length, `שני השחקנים: אין תקלות מודולים / שגיאות JS (${[...fa, ...fb, ...ea, ...B.errs].join(' | ') || '0'})`);
  const st = await B.evaluate(() => ({ fps: YZW.world.stats.fps, calls: YZW.world.stats.calls, ms: (YZW.plugins().find(p => p.id === 'wanted') || {}).ms }));
  console.log(`  מידע: fps ${st.fps.toFixed(1)} (רינדור תוכנה), draw calls ${st.calls}, מבוקש ${st.ms} מ"ש/פריים`);
  await b.close();
  console.log(fail ? `\n${fail} נכשלו` : '\nהכול עבר'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL exception', e); process.exit(1); });
