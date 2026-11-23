// בדיקת שכבת המפה הדו־ממדית (adapters/68-map-layers.js) בלי דפדפן: node tools/test-map2d.js [תיקיית עולם]
// שטח/היקף מגרש (שרוך), המרות סצנה ⇄ WGS84 ⇄ מרקטור, העתקה אפינית לאריח מול המרה מלאה, הלוך-חזור של פינה שהוקשה במפה,
// אימות המגרש מול YZDev.validate (40-dev.js), דליי צבע הגובה, נרמול וחיפוש רחוב, בניין מתחת לאצבע.
const path = require('path');
const here = path.resolve(process.argv[2] || path.join(__dirname, '../world'));
global.window = global;
const ITM = require(path.join(here, 'js/itm.js'));
const L = require(path.join(here, 'adapters/68-map-layers.js'));
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

// מסגרת כמו בעולם: ראשית אשדוד (מסגרת הדגימה), אותן נוסחאות כמו sceneToLL / llToSample ב-64-map.js
const OX = 166000, OY = 633000, OFF = ITM.SAMPLE_OFFSET;
const toITM = (x, z) => ({ E: x + OX, N: OY - z }), toScene = (E, N) => ({ x: E - OX, z: -(N - OY) });
const sceneToLL = (x, z) => { const s = toITM(x, z); return ITM.itmToWgs84(s.E + OFF.dE, s.N + OFF.dN); };
const llToSample = (lat, lon) => { const t = ITM.wgs84ToItm(lat, lon); return { E: t.E - OFF.dE, N: t.N - OFF.dN, trueE: t.E, trueN: t.N }; };

// 1. שטח והיקף
const rect = [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }, { x: 0, z: 40 }];
ok(L.shoelace(rect) === 2400 && L.perimeter(rect) === 200, `מלבן 60×40: שטח ${L.shoelace(rect)} מ"ר, היקף ${L.perimeter(rect)} מ'`);
ok(L.shoelace(rect.slice().reverse()) === 2400, 'שטח לא תלוי בכיוון ההקפה');
const Lsh = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 30 }, { x: 0, z: 30 }];
ok(L.shoelace(Lsh) === 500, `מצולע קעור (צורת L): ${L.shoelace(Lsh)} מ"ר (צפוי 500)`);
ok(Math.abs(L.shoelace([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 10 }]) - 50) < 1e-9, 'משולש 10×10/2 = 50');
ok(L.perimeter(rect, false) === 160, 'היקף פתוח (בזמן שרטוט) = 160');

// 2. מרקטור הלוך-חזור
let e = 0; for (const [la, lo] of [[31.8, 34.65], [32.08, 34.78], [-33.9, 151.2], [64.1, -21.9], [0, 0]]) { const m = L.merc(la, lo), b = L.unmerc(m.X, m.Y); e = Math.max(e, Math.abs(b.lat - la), Math.abs(b.lon - lo)); }
ok(e < 1e-9, `מרקטור הלוך-חזור: ${e.toExponential(1)}°`);

// 3. העתקה אפינית לאריח (1 ק"מ) מול המרה מלאה, בפיקסלים בזום 19
const A = L.affine(sceneToLL, 500, -500); let px = 0; const Z = 19, K = 256 * 2 ** Z;
for (let x = 0; x <= 1000; x += 100) for (let z = -1000; z <= 0; z += 100) { const ll = sceneToLL(x, z), m = L.merc(ll.lat, ll.lon), a = L.apply(A, x, z); px = Math.max(px, Math.hypot((m.X - a.X) * K, (m.Y - a.Y) * K)); }
ok(px < 0.15, `אפיני מול מלא בתוך אריח 1 ק"מ: שגיאה מרבית ${px.toFixed(4)} פיקסל בזום 19 (${(px * L.mpp(31.8, 19) * 100).toFixed(1)} ס"מ; סף 0.15)`);
const A2 = L.affine(sceneToLL, 15000, -15000); let px2 = 0;
for (let x = 14500; x <= 15500; x += 250) for (let z = -15500; z <= -14500; z += 250) { const ll = sceneToLL(x, z), m = L.merc(ll.lat, ll.lon), a = L.apply(A2, x, z); px2 = Math.max(px2, Math.hypot((m.X - a.X) * K, (m.Y - a.Y) * K)); }
ok(px2 < 0.15, `אפיני רחוק מהראשית (15 ק"מ): ${px2.toFixed(4)} פיקסל`);

// 4. פינה שהוקשה במפה → סצנה → חזרה (הלוך-חזור של כל השרשרת)
let rt = 0; const plotLL = rect.map(p => sceneToLL(p.x + 120, p.z - 80));
const back = plotLL.map(ll => { const s = llToSample(ll.lat, ll.lon); return toScene(s.E, s.N); });
back.forEach((q, i) => { rt = Math.max(rt, Math.hypot(q.x - (rect[i].x + 120), q.z - (rect[i].z - 80))); });
ok(rt < 0.002, `פינה ממפה לסצנה וחזרה: ${(rt * 1000).toFixed(2)} מ"מ`);
ok(Math.abs(L.shoelace(back) - 2400) < 0.05, `שטח המגרש אחרי המרה מהמפה: ${L.shoelace(back).toFixed(3)} מ"ר`);
ok(L.inIL(llToSample(31.8, 34.65)) && !L.inIL(llToSample(48.85, 2.35)), 'בתחום ישראל: אשדוד כן, פריז לא');

// 5. שטח אמיתי על הקרקע מול שטח ברשת ישראל (סטיית קנה מידה של ITM)
{ const R = 6371008.8, la0 = plotLL[0].lat * Math.PI / 180, P = plotLL.map(ll => ({ x: ll.lon * Math.PI / 180 * R * Math.cos(la0), z: ll.lat * Math.PI / 180 * R }));
  const r = L.shoelace(P) / 2400; ok(Math.abs(r - 1) < 2e-3, `שטח על הכדור / שטח ITM = ${r.toFixed(5)} (הפרש קנה מידה זניח)`); }

// 6. אימות מגרש מול 40-dev.js (אותו אימות שהמפה משתמשת בו דרך YZDev.addPoint)
global.YZW = { register() {} }; global.document = undefined; require(path.join(here, 'adapters/40-dev.js'));
ok(global.YZDev.validate(back, true) === '', 'מגרש מהמפה עובר את YZDev.validate');
ok(global.YZDev.validate([{ x: 0, z: 0 }, { x: 100, z: 100 }, { x: 100, z: 0 }, { x: 0, z: 100 }], true) !== '', 'מגרש חותך עצמו נחסם');

// 7. צבע לפי גובה
ok(L.bucket(0) === 0 && L.bucket(-3) === 0 && L.bucket(60) === 7 && L.bucket(200) === 7 && L.bucket(25) === 3, 'דליי גובה: 0→0, 25→3, 60+→7');
ok(/^rgb\(\d+,\d+,\d+\)$/.test(L.bucketColor(0)) && L.bucketColor(0) !== L.bucketColor(7), `צבעים: ${L.bucketColor(0)} … ${L.bucketColor(7)}`);

// 8. נרמול וחיפוש
ok(L.norm("רח' הָאֶרֶז") === 'הארז' && L.norm('שד׳ הרצל') === 'הרצל', 'נרמול: "רח\' הָאֶרֶז" → הארז, "שד׳ הרצל" → הרצל');
const tiles = [{ roads: [{ name: 'הארז', p: [0, 0, 100, 0] }, { name: 'הארז', p: [100, 0, 200, 0] }, { name: 'הרצל', p: [0, 50, 0, 150] }],
  blds: [{ id: 'w1', name: 'מגדלי הדקל', cx: 10, cz: 10 }, { id: 'w2', name: '', cx: 0, cz: 0 }] }];
const idx = L.buildIndex(tiles), r1 = L.search(idx, 'רחוב הארז'), r2 = L.search(idx, 'דקל');
ok(r1.length === 1 && r1[0].kind === 'street' && Math.abs(r1[0].x - 100) < 1e-9, `חיפוש "רחוב הארז" → רחוב, נקודה על הרחוב x=${r1[0] && r1[0].x}`);
ok(r2.length === 1 && r2[0].id === 'w1', 'חיפוש "דקל" → בניין מגדלי הדקל');
ok(L.search(idx, 'ה').length === 0, 'אות אחת – אין חיפוש');

// 9. בניין מתחת לאצבע + רדיוס הקשה לפי זום
const sq = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
ok(L.pip(sq, 4, 5, 5) && !L.pip(sq, 4, 11, 5), 'נקודה בתוך טביעה / מחוצה לה');
const m19 = L.mpp(31.8, 19), m15 = L.mpp(31.8, 15); ok(m19 > 0.25 && m19 < 0.26 && Math.abs(m15 / m19 - 16) < 1e-9, `מטר לפיקסל: זום 19 ${m19.toFixed(3)}, זום 15 ${m15.toFixed(2)}`);

console.log(fail ? `${fail} נכשלו` : 'הכול עבר'); process.exit(fail ? 1 : 0);
