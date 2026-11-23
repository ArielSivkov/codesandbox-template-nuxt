// בדיקות לוגיקה: מרובה משתתפים (החלקה, המתנה גדלה, ניקוי), מבוקש (כוכבים, דעיכה, שרשרת), ושרת esh27-mp עם שקעים מדומים.
// node twin/integration/tools/test-mp.js   (קוד יציאה 1 בכישלון)
const path = require('path');
const W = path.join(__dirname, '..', 'world', 'adapters');
const MP = require(path.join(W, '65-multiplayer.js')), WN = require(path.join(W, '66-wanted.js'));
let fail = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- זוויות
ok(near(MP.wrap(3 * Math.PI), -Math.PI) || near(MP.wrap(3 * Math.PI), Math.PI), 'wrap 3π → ±π');
ok(near(MP.lerpAngle(3.0, -3.0, 0.5), Math.PI, 0.01) || near(Math.abs(MP.lerpAngle(3.0, -3.0, 0.5)), Math.PI, 0.01), 'זווית: 3.0→−3.0 עוברת דרך π (הדרך הקצרה), לא דרך 0');
ok(near(MP.lerpAngle(0.2, 0.6, 0.25), 0.3), 'זווית: אינטרפולציה רגילה');

// ---------------------------------------------------------------- ניקוי
const base = { E: 164751, N: 634164, y: 3, h: 1, m: 'car', v: 8, nm: 'שון' };
ok(MP.clean(base) && MP.clean(base).m === 'car', 'מצב תקין עובר');
ok(MP.clean(Object.assign({}, base, { E: NaN })) === null && MP.clean(Object.assign({}, base, { N: 1e9 })) === null && MP.clean(null) === null, 'NaN / מחוץ לתחום / null נדחים');
ok(MP.clean(Object.assign({}, base, { m: 'tank' })).m === 'walk' && MP.clean(Object.assign({}, base, { w: 9 })).w === 0, 'מצב לא מוכר → רגלי; כוכבים מחוץ לתחום → 0');
ok(MP.clean(Object.assign({}, base, { nm: 'x'.repeat(99) })).nm.length === 24, 'שם נחתך ל-24');

// ---------------------------------------------------------------- החלקה (5 פעמים בשנייה)
const buf = []; for (let i = 0; i <= 5; i++) MP.push(buf, i * 0.2, MP.clean({ E: 164700 + i * 2, N: 634100, y: 0, h: 0, m: 'walk', v: 10 }));   // 10 מ'/ש' מזרחה
let s = MP.sample(buf, 0.5); ok(near(s.E, 164705, 1e-6) && s.ext === 0, `באמצע בין דגימות: E=${s.E} (מצופה 164705)`);
s = MP.sample(buf, -1); ok(s.E === 164700, 'לפני הדגימה הראשונה: נשאר בראשונה');
s = MP.sample(buf, 1.2); ok(near(s.E, 164712, 1e-6) && near(s.ext, 0.2), `המשך קצר אחרי האחרונה (0.2 ש'): E=${s.E.toFixed(2)} (מצופה 164712)`);
s = MP.sample(buf, 5); ok(near(s.E, 164710 + 10 * MP.EXTRAP, 1e-6), `המשך מוגבל ל-${MP.EXTRAP} ש' ואז עצירה: E=${s.E.toFixed(2)}`);
// הגעה לא סדירה (רעד רשת): זמנים לא עולים מתוקנים
const jb = []; MP.push(jb, 1, MP.clean(base)); MP.push(jb, 1, MP.clean(Object.assign({}, base, { E: base.E + 1 }))); ok(jb[1].t > jb[0].t, 'זמן הגעה כפול מתוקן (עולה ממש)');
// קפיצה במפה (מעבר מקום) – לא "עפים" באמצע
const kb = []; MP.push(kb, 0, MP.clean(base)); MP.push(kb, 0.2, MP.clean(Object.assign({}, base, { E: base.E + 5000 })));
s = MP.sample(kb, 0.05); ok(s.E === base.E, 'קפיצה של 5 ק"מ: אין מיקום ביניים'); s = MP.sample(kb, 0.5); ok(s.E === base.E + 5000, 'קפיצה: אין המשך תנועה אחרי');
// כיוון בהחלקה
const hb = []; MP.push(hb, 0, MP.clean(Object.assign({}, base, { h: 3.0 }))); MP.push(hb, 0.2, MP.clean(Object.assign({}, base, { h: -3.0 })));
s = MP.sample(hb, 0.1); ok(Math.abs(Math.abs(s.h) - Math.PI) < 0.01, `כיוון באמצע 3.0→−3.0: ${s.h.toFixed(3)} (±π)`);
// גיזום
const pb = buf.slice(); MP.prune(pb, 0.75); ok(pb.length >= 2 && pb[0].t <= 0.75 && pb[1].t > 0.75, `גיזום משאיר את הדגימה שלפני זמן ההצגה (${pb.length} נשארו)`);
ok(MP.sample(pb, 0.7).E === MP.sample(buf, 0.7).E, 'גיזום לא משנה את התוצאה');
// תקרת חוצץ
const big = []; for (let i = 0; i < 100; i++) MP.push(big, i, MP.clean(base)); ok(big.length === MP.MAXBUF, 'חוצץ מוגבל ל-' + MP.MAXBUF);
// סימולציה: רוח שנעה במעגל, חבילות 5 בשנייה עם רעד ±40 מ"ש ואיבוד 10% → שגיאת מיקום מול האמת בזמן ההצגה
function circ(JIT) { const R = 30, w = 0.5, truth = t => ({ E: 164700 + R * Math.cos(w * t), N: 634100 + R * Math.sin(w * t) }); const b = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pk = []; for (let t = 0; t < 20; t += 0.2) { if (rnd() < 0.1) continue; const p = truth(t); pk.push({ at: t + 0.05 + (rnd() - 0.5) * 2 * JIT, s: MP.clean({ E: p.E, N: p.N, y: 0, h: 0, m: 'walk', v: R * w }) }); }
  // כמו בלקוח: בכל פריים (60 לשנייה) מכניסים את מה שהגיע, גוזמים, ודוגמים בזמן ההצגה = עכשיו − DELAY
  let mx = 0, sum = 0, k = 0, j = 0; for (let t = 0; t < 19; t += 1 / 60) { while (j < pk.length && pk[j].at <= t) { MP.push(b, pk[j].at, pk[j].s); j++; } if (t < 2) continue;
    const rt = t - MP.DELAY; MP.prune(b, rt); const q = MP.sample(b, rt), p = truth(rt - 0.05); const e = Math.hypot(q.E - p.E, q.N - p.N); mx = Math.max(mx, e); sum += e; k++; }
  return { mx, avg: sum / k }; }
{ const a = circ(0), b2 = circ(0.04);
  ok(a.mx < 0.2, `החלקה במעגל (15 מ'/ש', 10% חבילות אבדו, בלי רעד): ממוצע ${a.avg.toFixed(3)} מ', מרבי ${a.mx.toFixed(3)} מ' (< 0.2 = קשת של חבילה שאבדה)`);
  ok(b2.mx < 0.8, `אותו דבר עם רעד ±40 מ"ש בזמן ההגעה: ממוצע ${b2.avg.toFixed(3)} מ', מרבי ${b2.mx.toFixed(3)} מ' (< 0.8 ≈ רעד×מהירות 0.6 + קשת)`); }

// ---------------------------------------------------------------- המתנה גדלה ושליחה
ok(MP.backoff(0, 0.5) === 1000 && MP.backoff(3, 0.5) === 8000 && MP.backoff(10, 0.5) === 30000, 'המתנה: 1, 8, ותקרה 30 ש\'');
ok(MP.backoff(0, 0) === 750 && MP.backoff(0, 1) === 1250, 'המתנה: פיזור ±25%');
const a0 = { E: 1, N: 2, y: 0, h: 0, m: 'walk', w: 0 };
ok(MP.shouldSend(null, a0, 0.2) && !MP.shouldSend(a0, Object.assign({}, a0, { E: 5 }), 0.1), 'שליחה: לא מהר מ-5 בשנייה');
ok(!MP.shouldSend(a0, a0, 0.5) && MP.shouldSend(a0, a0, 2), 'עומד במקום: רק סימן חיים כל 2 ש\'');
ok(MP.shouldSend(a0, Object.assign({}, a0, { m: 'car' }), 0.2) && MP.shouldSend(a0, Object.assign({}, a0, { h: 0.1 }), 0.2), 'שינוי מצב / כיוון נשלח');
ok(MP.kind('car') === 'car' && MP.kind('heli') === 'air' && MP.kind('drone') === 'air' && MP.kind('walk') === 'foot' && MP.kind('jetpack') === 'foot' && MP.kind('dev') === 'eye', 'סוגי רוחות');

// ---------------------------------------------------------------- מבוקש
{ const w = WN.create(); ok(w.level === 0, 'מתחיל ב-0 כוכבים');
  let r = WN.add(w, WN.crashHeat(20), 'תאונה'); ok(r.from === 0 && r.to === 1, `תאונה ב-20 קמ"ש → כוכב 1 (חום ${w.heat})`);
  WN.tick(w, 10); r = WN.add(w, WN.crashHeat(20)); ok(near(w.heat, 76 + 76 * 1.5) && w.level === 2, `תאונה שנייה תוך 30 ש' – פי 1.5 (חום ${w.heat}) → 2 כוכבים`);
  const h0 = w.heat; WN.tick(w, 19.9); ok(w.heat === h0, 'אין דעיכה ב-20 השניות הראשונות');
  WN.tick(w, 0.2); WN.tick(w, 10); ok(near(w.heat, h0 - 2.5 * 10, 0.6), `אחרי ההמתנה: דעיכה 2.5 לשנייה (${w.heat.toFixed(1)})`);
  const h1 = w.heat; WN.tick(w, 4, true); ok(near(h1 - w.heat, 20, 1e-9), 'ברגל: דעיכה כפולה (20 ב-4 ש\')');
  let t = 0; while (w.level > 0 && t < 600) { WN.tick(w, 0.1); t += 0.1; } ok(w.level === 0 && w.heat === 0, `דועך לגמרי ל-0 (${t.toFixed(1)} ש' נוספות)`);
  const w2 = WN.create(); for (let i = 0; i < 20; i++) { WN.add(w2, 300); WN.tick(w2, 1); } ok(w2.level === 5 && w2.heat === 500, 'תקרה: 5 כוכבים, 500 חום');
  ok(WN.levelOf(0) === 0 && WN.levelOf(0.5) === 1 && WN.levelOf(100) === 1 && WN.levelOf(100.1) === 2 && WN.levelOf(1e6) === 5, 'כוכבים = עיגול למעלה של חום/100, 0–5');
  ok(WN.crashHeat(5) === WN.crashHeat(11) && WN.crashHeat(100) === 140 && WN.crashHeat(NaN) === WN.crashHeat(11) && WN.crashHeat(1e4) === 220, 'חום תאונה: 60+0.8×קמ"ש, 11–200 קמ"ש');
  const w3 = WN.create(); WN.add(w3, 50); WN.tick(w3, 31); WN.add(w3, 50); ok(near(w3.heat, 50 - 2.5 * 11 + 50), `עבירה אחרי 30 ש' – בלי מכפיל; דעיכה רק על 11 השניות שאחרי ההמתנה (${w3.heat})`);
  const w4 = WN.create(); const r4 = WN.add(w4, -5); ok(w4.heat === 0 && r4.to === 0, 'חום שלילי מתעלמים'); ok(WN.stars(2) === '★★☆☆☆', 'תצוגה ★★☆☆☆'); }

// ---------------------------------------------------------------- שרת esh27-mp (Durable Object) עם שקעים מדומים
(async () => {
  const srv = await import(path.join(__dirname, '..', '..', 'servers', 'esh27-mp', 'worker.js'));
  const { Room, cleanState, cleanName, LIMITS } = srv;
  ok(cleanState(base).E === 164751 && cleanState({ E: 'x' }) === null && cleanState(Object.assign({}, base, { extra: 1, m: 'x' })).m === 'walk' && !('extra' in cleanState(Object.assign({}, base, { extra: 1 }))), 'שרת: ניקוי מצב (שדות לא מוכרים נזרקים)');
  ok(cleanName('<b>שון</b>') === 'bשון/b' && cleanName('a'.repeat(50)).length === 24, 'שרת: ניקוי שם');
  class Sock { constructor() { this.out = []; this.att = null; this.closed = null; } send(s) { if (this.closed) throw new Error('closed'); this.out.push(JSON.parse(s)); } close(c) { this.closed = c || 1000; }
    serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); } deserializeAttachment() { return this.att; } last(t) { return this.out.filter(o => !t || o.t === t).slice(-1)[0]; } }
  const ctx = { socks: [], acceptWebSocket(ws) { this.socks.push(ws); }, getWebSockets() { return this.socks.filter(s => !s.closed); } };
  const room = new Room(ctx, {});
  const A = new Sock(), B = new Sock();
  const ida = room.accept(A, 'אריאל', 'בדיקה'); const hiA = A.last('hi'); ok(hiA && hiA.id === ida && hiA.peers.length === 0 && hiA.rate === 5, 'שרת: הצטרפות ראשונה – hi עם מזהה, בלי שחקנים');
  room.webSocketMessage(A, JSON.stringify(Object.assign({ t: 's' }, base)));
  const idb = room.accept(B, '', 'בדיקה'); const hiB = B.last('hi'); ok(hiB.peers.length === 1 && hiB.peers[0].id === ida && hiB.peers[0].nm === 'אריאל' && /^אורח-/.test(hiB.nm), 'שרת: מצטרף שני מקבל את מצב הראשון; בלי שם → אורח');
  const n0 = B.out.length; room.webSocketMessage(A, JSON.stringify(Object.assign({ t: 's' }, base, { E: base.E + 1 }))); ok(B.out.length === n0, 'שרת: הודעה מהר מ-120 מ"ש נזרקת');
  room.last.set(ida, 0); room.webSocketMessage(A, JSON.stringify(Object.assign({ t: 's' }, base, { E: base.E + 2, evil: '<script>' })));
  const m = B.last('s'); ok(m && m.id === ida && m.E === base.E + 2 && !('evil' in m) && m.nm === 'אריאל', 'שרת: הפצה לאחרים, עם מזהה ושם מהשרת, בלי שדות זרים');
  ok(!A.out.some(o => o.t === 's'), 'שרת: השולח לא מקבל את עצמו');
  room.last.set(ida, 0); const n1 = B.out.length; room.webSocketMessage(A, '{bad json'); room.webSocketMessage(A, JSON.stringify({ t: 's', E: NaN })); room.webSocketMessage(A, 'x'.repeat(600)); room.webSocketMessage(A, new ArrayBuffer(8));
  ok(B.out.length === n1, 'שרת: JSON שבור / NaN / הודעה ארוכה / בינארי – לא מופץ ולא קורס');
  room.webSocketMessage(B, '{"t":"ping"}'); ok(B.last().t === 'pong', 'שרת: ping → pong');
  room.webSocketClose(A, 1001); ok(B.last('bye') && B.last('bye').id === ida && !room.st.has(ida), 'שרת: יציאה → bye לשאר, המצב נמחק');
  // חדר מלא
  const r2 = new Room({ socks: [], acceptWebSocket(ws) { this.socks.push(ws); }, getWebSockets() { return this.socks.filter(s => !s.closed); } }, {});
  for (let i = 0; i < LIMITS.MAX_PLAYERS; i++) r2.accept(new Sock(), 'p' + i, 'x'); const X = new Sock(); const idx = r2.accept(X, 'עודף', 'x');
  ok(idx === null && X.out[0].t === 'full' && X.closed === 4001, `שרת: שחקן מס' ${LIMITS.MAX_PLAYERS + 1} מקבל full ונסגר (4001)`);
  r2.webSocketClose(X, 4001); ok(true, 'שרת: סגירת שקע "מלא" (בלי מזהה) לא קורסת');
  // ניתוב ה-Worker
  const env = { ROOMS: { idFromName: n => n, get: () => ({ fetch: async () => ({ status: 101 }) }) } };
  const H = (p, h) => srv.default.fetch(new Request('https://esh27-mp.example' + p, { headers: h || {} }), env);
  ok((await H('/health')).status === 200, 'Worker: /health 200');
  ok((await H('/room/' + encodeURIComponent('שון'))).status === 426, 'Worker: בלי שדרוג WebSocket → 426');
  ok((await H('/room/a', { upgrade: 'websocket', origin: 'https://evil.example' })).status === 403, 'Worker: מקור זר → 403');
  ok((await H('/room/a', { upgrade: 'websocket' })).status === 403, 'Worker: בלי מקור → 403');
  ok((await H('/room/' + encodeURIComponent('a b<'), { upgrade: 'websocket', origin: 'https://raw.githack.com' })).status === 400, 'Worker: שם חדר לא תקין → 400');
  ok((await H('/room/' + encodeURIComponent('שון'), { upgrade: 'websocket', origin: 'https://raw.githack.com' })).status === 101, 'Worker: מקור שלנו + חדר תקין → מועבר לחדר');
  ok((await H('/nope')).status === 404, 'Worker: נתיב אחר → 404');
  console.log(`\n${n - fail}/${n} עברו`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL exception', e); process.exit(1); });
