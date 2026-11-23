// בדיקת הרכב הפעיל של אריאל (גרסה 4 – Gemini QA) בלי דפדפן: node tools/test-ariel-car-active.js [תיקיית עולם]
// גוף אטום ופונה החוצה, תקציב קריאות ציור/משולשים, 0 NaN, מידות יצרן, חיבור/ניתוק מהעולם (כמו ב-game.js: קבוצה עם userData.wheels).
const path = require('path'); global.self = global; global.window = global;
global.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : (typeof k === 'string' ? () => {} : undefined), set: () => true }), width: 0, height: 0 }) };
const here = path.resolve(process.argv[2] || path.join(__dirname, '../world')); require(path.join(here, 'vendor/three.min.js')); const T = global.THREE;
let D = null; global.YZW = { register: d => { D = d; } };
const A = require(path.join(here, 'adapters/57-ariel-car.js'));
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const sv = g => { const p = g.attributes.position, ix = g.index.array; let v = 0; const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(); for (let t = 0; t < ix.length; t += 3) { a.fromBufferAttribute(p, ix[t]); b.fromBufferAttribute(p, ix[t + 1]); c.fromBufferAttribute(p, ix[t + 2]); v += a.dot(b.cross(c)) / 6; } return v; };
const car = A.build(); car.updateMatrixWorld(true);
let m = 0, tr = 0, nan = 0, body = null; car.traverse(x => { if (!x.isMesh) return; m++; const g = x.geometry; tr += (g.index ? g.index.count : g.attributes.position.count) / 3; for (const v of g.attributes.position.array) if (!isFinite(v)) nan++; if (x.name === 'ariel-a1-body') body = x; });
ok(!!body, 'יש גוף ראשי (ariel-a1-body)');
{ const g = body.geometry, p = g.attributes.position, idx = g.index.array, ids = new Map(), vid = i => { const k = [p.getX(i), p.getY(i), p.getZ(i)].map(v => v.toFixed(5)).join(); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const E = new Map(); for (let t = 0; t < idx.length; t += 3) { const v = [0, 1, 2].map(j => vid(idx[t + j])); for (let j = 0; j < 3; j++) { const a = v[j], b = v[(j + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a; E.set(k, (E.get(k) || 0) + 1); } }
  let open = 0, nm = 0; for (const c of E.values()) { if (c === 1) open++; else if (c > 2) nm++; }
  ok(open === 0 && nm === 0, `גוף אטום: ${idx.length / 3} משולשים, ${open} צלעות פתוחות, ${nm} שאינן יריעה`);
  const V = sv(g); ok(V > 4 && V < 8, `גוף פונה החוצה: נפח מסומן ${V.toFixed(2)} מ"ק (גרסה 3 הייתה ‎−4.66)`); }
ok(m <= 34, `קריאות ציור ${m} (תקציב: לא יותר מגרסה 2 – 34)`);
ok(tr <= 6000, `משולשים ${tr} (תקציב 6,000)`);
ok(nan === 0, '0 ערכי NaN');
const W = car.userData.ownWheels; ok(W && W.length === 4, `4 גלגלים (${W && W.length})`);
const zs = W.map(w => w.position.z).sort((a, b) => a - b), xs = W.map(w => w.position.x).sort((a, b) => a - b);
ok(Math.abs((zs[3] - zs[0]) - 2.469) < 0.005, `בסיס גלגלים ${(zs[3] - zs[0]).toFixed(3)} מ' (יצרן 2.469)`);
ok(Math.abs((xs[3] - xs[0]) - 1.477) < 0.04, `מפשק ${(xs[3] - xs[0]).toFixed(3)} מ' (יצרן 1.477; כמו בגרסה 2 – 3.3 ס"מ רחב, מקורב)`);
const s = new T.Box3().setFromObject(car).getSize(new T.Vector3());
ok(s.y <= 1.416 + 0.03 && s.y >= 1.39, `גובה ${s.y.toFixed(3)} מ' (יצרן 1.416)`);
ok(s.z <= 3.973 + 0.08 && s.z >= 3.95, `אורך ${s.z.toFixed(3)} מ' (3.954–3.973)`);
ok(s.x <= 1.96 + 1e-3, `רוחב עם מראות ${s.x.toFixed(3)} מ' (גוף 1.740)`);
{ const sc = new T.Scene(), grp = new T.Group(), box = new T.Mesh(new T.BoxGeometry(1, 1, 1)); grp.add(box); grp.userData.wheels = ['orig']; sc.add(grp);
  const world = { scene: sc }; D.init(world); const late = new T.Mesh(new T.BoxGeometry(1, 1, 1)); grp.add(late); D.update(1 / 60);
  const mounted = !box.visible && !late.visible && grp.userData.wheels.length === 4 && world.arielCar && world.arielCar.plate === '73-464-53';
  D.dispose(); ok(mounted && box.visible && grp.userData.wheels[0] === 'orig' && !world.arielCar, 'חיבור לעולם: מסתיר רכב משחק (גם דגם שנטען באיחור), 4 גלגלים, סגירה מחזירה הכול'); }
console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); process.exit(fail ? 1 : 0);
