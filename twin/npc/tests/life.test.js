// node --test tests/  — לוגיקת לוח זמנים, שבת, מסלולים, הימנעות, תגובה לשחקן, ועצי שיח
const test = require('node:test'), assert = require('node:assert');
const L = require('../js/life.js'), D = require('../js/dialogue.js');
const TREES = require('../data/dialogues.json');

// עיר סינתטית: רשת רחובות כל 100 מ', בניינים בתוך הבלוקים, ים ממערב ל-x=-420
const md = v => { const m = ((v % 100) + 100) % 100; return Math.min(m, 100 - m); };
const roadDist = (x, z) => Math.min(md(x), md(z));
function synthWorld() {
  const roads = [], buildings = [];
  // כמו ב-OSM: קודקוד בכל צומת
  const line = (f) => { const a = []; for (let k = -4; k <= 4; k++) a.push(...f(k * 100)); return Float32Array.from(a); };
  for (let i = -4; i <= 4; i++) { roads.push({ p: line(v => [i * 100, v]), w: 8 }); roads.push({ p: line(v => [v, i * 100]), w: 8 }); }
  let id = 0;
  const types = ['apartments', '', '', '', 'retail', 'school', 'synagogue', 'office', 'construction', ''];
  for (let i = -4; i < 4; i++) for (let j = -4; j < 4; j++) for (const [ox, oz] of [[25, 25], [65, 25], [25, 65], [65, 65]]) {
    const x0 = i * 100 + ox - 12, z0 = j * 100 + oz - 12, x1 = x0 + 22, z1 = z0 + 22;
    const t = types[(id * 7) % types.length];
    buildings.push({ id: 'b' + id++, type: t, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, area: 484, h: 12, floors: 4, n: 4, p: Float32Array.from([x0, z0, x1, z0, x1, z1, x0, z1]) });
  }
  const inB = (x, z) => buildings.some(b => x > b.p[0] && x < b.p[2] && z > b.p[1] && z < b.p[5]);
  return { roads, buildings, isSea: (x) => x < -420, blocked: inB, H: () => 1,
    nearBuilding: (x, z, r) => buildings.some(b => x > b.p[0] - r && x < b.p[2] + r && z > b.p[1] - r && z < b.p[5] + r),
    nearRoad: (x, z, r) => roadDist(x, z) < r,
    openSpots: [{ x: 50, z: 150 }, { x: -150, z: 50 }], beachSpots: [{ x: -410, z: 0 }, { x: -410, z: 100 }] };
}

test('שעון ישראל ושקיעה: 21.6 ו-21.12 באשדוד', () => {
  const s = L.sunTimes(172, 180), w = L.sunTimes(355, 120);
  assert.ok(Math.abs(s.sunset - (19 * 60 + 50)) < 8, 'קיץ ~19:50, יצא ' + s.sunset);
  assert.ok(Math.abs(w.sunset - (16 * 60 + 43)) < 8, 'חורף ~16:43, יצא ' + w.sunset);
  const c = L.clock(new Date('2026-11-27T10:00:00Z'));   // יום שישי 12:00 שעון ישראל
  assert.equal(c.dow, 5); assert.equal(Math.round(c.min), 12 * 60); assert.equal(c.off, 120);
});

test('מעבר שבת: שישי לפני/אחרי כניסה, שבת, מוצאי שבת', () => {
  const doy = 331, ss = L.sunTimes(doy, 120).sunset;
  assert.equal(L.dayType(L.clockAt(3, 600, doy)), 'weekday');
  assert.equal(L.dayType(L.clockAt(5, 600, doy)), 'friday');
  assert.equal(L.shabbat(L.clockAt(5, 13 * 60, doy)).phase, 'erev');
  assert.equal(L.dayType(L.clockAt(5, ss - L.CANDLE_MIN - 1, doy)), 'friday');
  assert.equal(L.dayType(L.clockAt(5, ss - L.CANDLE_MIN + 1, doy)), 'shabbat');
  assert.equal(L.dayType(L.clockAt(6, 600, doy)), 'shabbat');
  assert.equal(L.dayType(L.clockAt(6, ss + L.TZEIT_MIN + 1, doy)), 'motzash');
  // צפיפות: בשבת מעט רכבים, ובבוקר שבת יש הולכי רגל
  const sh = L.density(L.clockAt(6, 8.5 * 60, doy)), wk = L.density(L.clockAt(2, 8 * 60, doy));
  assert.ok(sh.cars < 0.2 && wk.cars > 0.8, `רכבים שבת ${sh.cars} חול ${wk.cars}`);
  assert.ok(sh.pedestrians > 0.5);
  assert.ok(L.density(L.clockAt(2, 18.8 * 60, doy), { rain: 3 }).pedestrians < L.density(L.clockAt(2, 18.8 * 60, doy)).pedestrians * 0.5, 'גשם מוריד הולכי רגל');
});

test('לוח זמנים: עובד בעבודה בבוקר חול, לא עובד בשבת; תלמיד בבית ספר', () => {
  const doy = 331; let atWork = 0, shabbatWork = 0, school = 0, syn = 0, N = 400;
  for (let s = 0; s < N; s++) {
    if (L.scheduledActivity('worker', L.clockAt(2, 10 * 60, doy), s * 7919).act === 'work') atWork++;
    const sh = L.scheduledActivity('worker', L.clockAt(6, 9 * 60, doy), s * 7919).act; if (sh === 'work' || sh === 'site' || sh === 'market') shabbatWork++; if (sh === 'synagogue') syn++;
    if (L.scheduledActivity('student', L.clockAt(1, 10 * 60, doy), s * 31).act === 'school') school++;
  }
  assert.ok(atWork / N > 0.8, 'עובדים בעבודה ' + atWork);
  assert.equal(shabbatWork, 0, 'אף אחד לא בעבודה/שוק בשבת');
  assert.ok(syn / N > 0.3 && syn / N < 0.75, 'חלק (לא כולם) בבית הכנסת: ' + syn);
  assert.ok(school / N > 0.85);
  // פועל בנייה: באתר בחול, לא בשבת
  assert.equal(L.scheduledActivity('builder', L.clockAt(6, 10 * 60, doy), 5).act === 'site', false);
  // גשם: כמעט אף אחד בחוף
  let beachDry = 0, beachRain = 0;
  for (let s = 0; s < N; s++) { if (L.scheduledActivity('young', L.clockAt(6, 11 * 60, doy), s * 13).act === 'beach') beachDry++; if (L.scheduledActivity('young', L.clockAt(6, 11 * 60, doy), s * 13, { rain: 4 }).act === 'beach') beachRain++; }
  assert.ok(beachDry > 50 && beachRain < beachDry * 0.1, `חוף יבש ${beachDry} גשם ${beachRain}`);
  // דטרמיניסטי
  assert.deepEqual(L.scheduledActivity('parent', L.clockAt(2, 900, doy), 42), L.scheduledActivity('parent', L.clockAt(2, 900, doy), 42));
});

test('גרף רחובות ו-A*: מסלול על המדרכה בין שתי נקודות', () => {
  const w = synthWorld(), g = L.buildGraph(w.roads);
  assert.ok(g.n > 50);
  const s = L.nearestNode(g, -195, -205), t = L.nearestNode(g, 210, 190);
  const path = L.astar(g, s, t); assert.ok(path && path.length > 2);
  let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(g.xs[path[i]] - g.xs[path[i - 1]], g.zs[path[i]] - g.zs[path[i - 1]]);
  assert.ok(Math.abs(len - 800) < 1, 'אורך מנהטן 800, יצא ' + len);
  const sw = L.sidewalkPath(g, path, { x: -195, z: -205 }, { x: 210, z: 190 }, 1, 0);
  // כל נקודות הביניים במרחק 5.4 מ' (4 + 1.4) מקו האמצע של רחוב כלשהו, ולא בתוך בניין
  for (let i = 2; i < sw.length - 2; i += 2) { const x = sw[i], z = sw[i + 1], nd = path[i / 2 - 1]; const off = Math.hypot(x - g.xs[nd], z - g.zs[nd]);
    assert.ok(off > 5.3 && off < 7.7, 'היסט מדרכה מקו האמצע ' + off); assert.ok(!w.blocked(x, z), 'לא בתוך בניין'); }
});

function mkSim(clock, extra) {
  const w = synthWorld(); const sim = L.createSim(w, Object.assign({ maxAgents: 400, radius: 450, center: { x: 0, z: 0 } }, extra || {}));
  sim.graph = L.buildGraph(w.roads); sim.populate(); sim.update(0.1, clock); return { sim, w };
}
function run(sim, secs, clock, dt) { dt = dt || 0.2; for (let t = 0; t < secs; t += dt) sim.update(dt, clock); }

test('סימולציה: בוקר חול – יוצאים לעבודה ומגיעים; שבת – אין יציאה לעבודה', () => {
  const doy = 331;
  const { sim } = mkSim(L.clockAt(2, 6 * 60, doy));
  run(sim, 30, L.clockAt(2, 6 * 60, doy));
  const home0 = sim.agents.filter(a => a.state === 'inside').length;
  assert.ok(home0 / sim.agents.length > 0.9, 'בשש בבוקר כמעט כולם בבית');
  // 8:30 → רבים בדרך/בעבודה
  const c = L.clockAt(2, 8.5 * 60, doy); run(sim, 600, c, 0.5);
  const atWork = sim.agents.filter(a => a.act === 'work' && a.state === 'inside' && a.atPlace === a.work).length;
  assert.ok(atWork > 40, 'הגיעו לעבודה: ' + atWork);
  assert.ok(sim.stats.pathFail / Math.max(1, sim.stats.paths) < 0.05, 'כשלי מסלול ' + sim.stats.pathFail + '/' + sim.stats.paths);
  // שבת בבוקר: אף אחד לא בעבודה
  const s = L.clockAt(6, 9.5 * 60, doy); run(sim, 900, s, 0.5);
  assert.equal(sim.agents.filter(a => a.act === 'work' || a.act === 'site' || a.act === 'market').length, 0);
  const syn = sim.agents.filter(a => a.act === 'synagogue').length;
  assert.ok(syn > 30, 'בדרך/בבית הכנסת ' + syn);
  const kidsWithParent = sim.agents.filter(a => a.child && a.followOn).length;
  assert.ok(kidsWithParent > 5, 'ילדים הולכים עם ההורים ' + kidsWithParent);
});

test('הימנעות: שני הולכים זה מול זה לא מתנגשים; זזים הצידה מהשחקן', () => {
  const w = synthWorld(); const sim = L.createSim(w, { maxAgents: 0 }); sim.graph = null; sim.populate();
  const mk = (id, x, tx) => ({ id, seed: id, persona: 'worker', x, z: 5, vx: 0, vz: 0, heading: 0, speed: 0, pref: 1.4, state: 'walk', act: 'x', path: [x, 5, tx, 5], pi: 1, tier: 0, next: 1e9, look: {}, dest: { place: { x: tx, z: 5 }, inside: false }, side: 1, jit: 0 });
  const a = mk(1, -20, 20), b = mk(2, 20, -20); sim.agents.push(a, b); sim.byId = null;
  let minD = 1e9; const clock = L.clockAt(2, 600);
  for (let t = 0; t < 40; t += 0.05) { sim.update(0.05, clock); if (a.state === 'walk' && b.state === 'walk') minD = Math.min(minD, Math.hypot(a.x - b.x, a.z - b.z)); }
  assert.ok(minD > 0.55, 'מרחק מינימלי ' + minD.toFixed(2));
  assert.ok(a.x > 15 && b.x < -15, 'שניהם הגיעו');
  // שחקן עומד על המסלול: ההולך עוקף אותו
  const c = mk(3, -20, 20); c.z = 50; c.path = [-20, 50, 20, 50]; sim.agents.length = 0; sim.agents.push(c); sim.byId = null;
  sim.setPlayer({ x: 0, z: 50, vx: 0, vz: 0, mode: 'foot', speed: 0 }); let minP = 1e9;
  for (let t = 0; t < 40; t += 0.05) { sim.update(0.05, clock); minP = Math.min(minP, Math.hypot(c.x, c.z - 50)); }
  assert.ok(minP > 0.7, 'עקף את השחקן במרחק ' + minP.toFixed(2));
});

test('בריחה מרכב מהיר', () => {
  const w = synthWorld(); const sim = L.createSim(w, { maxAgents: 0 }); sim.populate();
  const a = { id: 1, seed: 1, persona: 'worker', x: 0, z: 0, vx: 0, vz: 0, heading: 0, speed: 0, pref: 1.4, state: 'stay', act: 'park', tier: 0, next: 1e9, look: {}, dest: { spot: 'park' }, stayT: 0 };
  sim.agents.push(a); sim.byId = null;
  sim.setPlayer({ x: -25, z: 0.5, vx: 16, vz: 0, mode: 'car', speed: 16 });   // ~58 קמ"ש ישר אליו
  sim.update(0.05, L.clockAt(2, 600));
  assert.ok(a.flee > 0, 'התחיל לברוח'); assert.equal(a.anim, 'run');
  for (let t = 0; t < 1.2; t += 0.05) sim.update(0.05, L.clockAt(2, 600));
  assert.ok(Math.abs(a.z) > 2.5, 'התרחק מקו הנסיעה: ' + a.z.toFixed(2));
  // רכב איטי – לא בורחים
  const b = Object.assign({}, a, { id: 2, x: 100, z: 0, flee: 0, state: 'stay' }); sim.agents.push(b); sim.byId = null;
  sim.setPlayer({ x: 80, z: 0.5, vx: 3, vz: 0, mode: 'car', speed: 3 }); sim.update(0.05, L.clockAt(2, 600));
  assert.ok(!(b.flee > 0));
});

test('גשם: מטריות לרוב ההולכים, חוף מתרוקן', () => {
  const doy = 331, c = L.clockAt(6, 11 * 60, doy);
  const { sim } = mkSim(c); sim.setWeather({ rain: 3 });
  const u = sim.agents.filter(a => a.look.umbrella).length; assert.ok(u / sim.agents.length > 0.6);
  run(sim, 900, c, 0.5);
  assert.ok(sim.agents.filter(a => a.act === 'beach').length < 3);
});

test('עצי שיח: תקינים, כל הצמתים נגישים, אין מבוי סתום', () => {
  assert.ok(TREES.trees.length >= 4);
  for (const t of TREES.trees) { const v = D.validate(t); assert.ok(v.ok, t.id + ': ' + v.errors.join('; ')); }
  // הבודק תופס שגיאות
  const bad = { id: 'x', start: 'a', nodes: { a: { text: 'א', options: [{ text: '1', next: 'b' }] }, b: { text: 'ב', options: [{ text: '2', next: 'a' }] }, c: { text: 'ג', options: [{ text: '3', end: true }] }, d: { text: 'ד', options: [] } } };
  const r = D.validate(bad); assert.equal(r.ok, false); assert.ok(r.unreachable.includes('c')); assert.ok(r.deadEnds.includes('a') && r.deadEnds.includes('b'));
  // מריץ + תבניות + תנאי
  const run = D.Runner(TREES.trees[0], { greet: 'שבת שלום', flags: { llm: false } });
  assert.ok(run.node().text.startsWith('שבת שלום'));
  assert.ok(!run.node().options.some(o => o.text.includes('חופשית')), 'אפשרות מודל השפה מוסתרת כשלא מחובר');
  const i = run.node().options.find(o => o.text.includes('כמה עולה')).i; run.choose(i);
  const pre = run.node().options.find(o => o.action && o.action.type === 'pre'); assert.ok(pre);
  // הליכה אקראית מגיעה תמיד לסיום
  for (const t of TREES.trees) for (let k = 0; k < 50; k++) { const R = L.rng(k + 1), rr = D.Runner(t, { flags: {} }); let steps = 0, end = false; while (!end && steps < 200) { const os = rr.node().options; end = rr.choose(os[Math.floor(R() * os.length)].i).end; steps++; } assert.ok(steps < 200); }
});

test('מודל שפה: בלי כתובת – לא מקוון, מחזיר נפילה', async () => {
  const h = D.LLMHook({}); assert.equal(h.enabled(), false);
  const r = await h.ask({ role: 'קבלן' }, 'שאלה'); assert.equal(r.ok, false); assert.equal(r.reason, 'offline');
});

test('התיישבות מיידית (settle): חול מול שבת, בלי הרצה', () => {
  const doy = 331;
  const { sim } = mkSim(L.clockAt(2, 10 * 60, doy));
  sim.settle(L.clockAt(2, 10 * 60, doy));
  const atWork = sim.agents.filter(a => a.state === 'inside' && a.act === 'work').length;
  assert.ok(atWork > 60, 'בעבודה ' + atWork);
  sim.settle(L.clockAt(6, 10 * 60 + 15, doy));
  assert.equal(sim.agents.filter(a => ['work', 'site', 'market'].includes(a.act)).length, 0, 'בשבת אין עבודה/שוק');
  const syn = sim.agents.filter(a => a.act === 'synagogue').length;
  assert.ok(syn > 30, 'בבית הכנסת ' + syn);
  // אחרי התפילה (11:00) – מתאספים בחוץ / הולכים הביתה
  for (let m = 0; m < 50; m += 2) run(sim, 120, L.clockAt(6, 10 * 60 + 15 + m, doy), 1);
  assert.ok(sim.agents.filter(a => a.state !== 'inside').length > 20, 'אחרי התפילה יש אנשים בחוץ');
});
