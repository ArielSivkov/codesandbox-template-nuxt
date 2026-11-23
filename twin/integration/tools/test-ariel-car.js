// בדיקת הרכב של אריאל (גרסה 3, במעבדה – לא פעיל במשחק) בלי דפדפן: node tools/test-ariel-car.js [תיקיית עולם] [קובץ]
// גוף אטום (0 צלעות פתוחות), איחוד לפי חומר לא משנה גאומטריה, תקציב קריאות ציור, מידות יצרן, 0 NaN, חיבור/ניתוק מהעולם.
const path = require('path'); global.self = global; global.window = global;
global.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : (typeof k === 'string' ? () => {} : undefined), set: () => true }), width: 0, height: 0 }) };
const here = path.resolve(process.argv[2] || path.join(__dirname, '../world')); require(path.join(here, 'vendor/three.min.js')); const T = global.THREE;
let D = null; global.YZW = { register: d => { D = d; } };
require(path.join(here, process.argv[3] || 'lab/ariel-car-v3/57-ariel-car-v3.js')); const A = global.ESHArielCar57;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
{ const g = A.buildWatertightBodyGeometry(T), p = g.attributes.position, idx = g.index ? g.index.array : null, n = idx ? idx.length : p.count;
  const ids = new Map(), vid = i => { const k = [p.getX(i), p.getY(i), p.getZ(i)].map(v => v.toFixed(5)).join(); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const E = new Map(); for (let t = 0; t < n; t += 3) { const v = [0, 1, 2].map(j => vid(idx ? idx[t + j] : t + j)); for (let j = 0; j < 3; j++) { const a = v[j], b = v[(j + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a; E.set(k, (E.get(k) || 0) + 1); } }
  let open = 0, nm = 0; for (const c of E.values()) { if (c === 1) open++; else if (c > 2) nm++; }
  ok(open === 0 && nm === 0, `גוף אטום: ${n / 3} משולשים, ${open} צלעות פתוחות, ${nm} צלעות שאינן יריעה`); }
const stats = o => { let m = 0, t = 0, nan = 0; o.updateMatrixWorld(true); o.traverse(x => { if (!x.isMesh) return; m++; const g = x.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; for (const v of g.attributes.position.array) if (!isFinite(v)) nan++; }); return { m, t: Math.round(t), nan, b: new T.Box3().setFromObject(o) }; };
const raw = stats(A.buildAudiA1Mesh(T)), mg = A.buildMerged(), mer = stats(mg);
ok(mer.m <= 34, `קריאות ציור: ${raw.m} → ${mer.m} (תקציב: לא יותר מגרסה 2 – 34)`);
ok(mer.t === raw.t, `איחוד בלי איבוד: ${raw.t} = ${mer.t} משולשים`);
ok(raw.b.min.distanceTo(mer.b.min) < 1e-4 && raw.b.max.distanceTo(mer.b.max) < 1e-4, 'איחוד בלי הזזה: אותה תיבה חוסמת');
ok(mer.nan === 0, `0 ערכי NaN`);
{ let neg = 0, cnt = 0; mg.traverse(x => { if (x.isMesh && x.material.color && ['f7f8fa', '141e2e'].includes(x.material.color.getHexString())) { cnt++; if (A.signedVolume(x.geometry) <= 0) neg++; } });
  ok(cnt === 2 && neg === 0, `גוף וזכוכית פונים החוצה (נפח מסומן חיובי; בחבילה המקורית היו הפוכים – הקירות נעלמו מבחוץ)`); }
const W = mg.userData.ownWheels; ok(W.length === 4, `4 גלגלים מסתובבים (${W.length})`);
const zs = W.map(w => w.position.z).sort((a, b) => a - b), xs = W.map(w => w.position.x).sort((a, b) => a - b);
ok(Math.abs((zs[3] - zs[0]) - 2.469) < 0.005, `בסיס גלגלים ${(zs[3] - zs[0]).toFixed(3)} מ' (יצרן 2.469)`);
ok(Math.abs((xs[3] - xs[0]) - 1.477) < 0.005, `מפשק ${(xs[3] - xs[0]).toFixed(3)} מ' (יצרן 1.477)`);
const s = mer.b.getSize(new T.Vector3());
ok(s.y <= 1.416 + 0.03 && s.y >= 1.39, `גובה ${s.y.toFixed(3)} מ' (יצרן 1.416)`);
ok(s.z <= 3.973 + 0.08 && s.z >= 3.95, `אורך כולל ${s.z.toFixed(3)} מ' (גוף 3.973 + לוחיות/חיישנים)`);
ok(s.x <= 1.96 + 1e-3, `רוחב עם מראות ${s.x.toFixed(3)} מ' (גוף 1.740)`);
{ const sc = new T.Scene(), car = new T.Group(), box = new T.Mesh(new T.BoxGeometry(1, 1, 1)); car.add(box); car.userData.wheels = ['orig']; sc.add(car);
  D.init({ scene: sc }); const hid = !box.visible, wh = car.userData.wheels.length === 4; D.dispose();
  ok(hid && wh && box.visible && car.userData.wheels[0] === 'orig', 'חיבור לעולם: מסתיר רכב משחק, 4 גלגלים, וסגירה מחזירה הכול'); }
console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); process.exit(fail ? 1 : 0);
