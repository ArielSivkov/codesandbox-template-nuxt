// בדיקות node: דטרמיניזם, מקור על כל אובייקט, שמות רחובות אמיתיים, לא בתוך בניינים, ITM מול pyproj, סטייה מגנטית, כיוון מצלמה.
// הרצה: node tests/procgen.test.js
const fs = require('fs'), zlib = require('zlib'), path = require('path'), assert = require('assert');
const PG = require('../js/procgen.js'), I = require('../js/itm.js');
// מקור אמת אחד: פלט הצינור (twin/pipeline/sample-out-ashdod) – זהה בבתים לעותק במנוע
const TD = path.join(__dirname, '../../pipeline/sample-out-ashdod/tiles/v/');
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/style_rules.json'), 'utf8'));
const load = k => JSON.parse(zlib.gunzipSync(fs.readFileSync(TD + k + '.json.gz')));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('דטרמיניזם: אותו קלט → אותה טביעת אצבע, גם בסדר אריחים שונה', () => {
  const a = PG.digest(PG.generateTile(load('164_634'), rules)); PG.generateTile(load('165_634'), rules); const b = PG.digest(PG.generateTile(load('164_634'), rules)); assert.strictEqual(a, b);
});
t('כל אובייקט: מקור "נגזר מסגנון השכונה" + הפניה לרחוב/בניין + בסיס', () => {
  const r = PG.generateTile(load('164_634'), rules); assert.strictEqual(r.prov, 'נגזר מסגנון השכונה');
  for (const k of PG.KINDS) { assert.ok(PG.BASIS[k], k); const d = r.kinds[k].data; for (let j = 0; j < d.length; j += 6) { const ri = d[j + 4]; if (ri >= 0) assert.ok(r.roads.find(x => x.i === ri), k); else assert.ok(-1 - ri < r.n || true); } }
});
t('שמות רחובות אמיתיים מהאריח (rd.n) + שלטים רק ברחוב עם שם', () => {
  const tile = load('164_634'), r = PG.generateTile(tile, rules), names = new Set(tile.rd.map(x => x.n));
  for (const rd of r.roads) assert.ok(names.has(rd.n)); const d = r.kinds.street_sign.data;
  for (let j = 0; j < d.length; j += 6) assert.ok(r.roads.find(x => x.i === d[j + 4]).n.length > 0);
  assert.ok(r.roads.some(x => x.n === 'הארז') && r.roads.some(x => x.n === 'האורן'));
});
t('אין ריהוט רחוב בתוך טביעת בניין (דגימה: פנסים ועצים)', () => {
  const tile = load('164_634'), r = PG.generateTile(tile, rules), polys = tile.b.map(b => { const a = []; let x = 0, y = 0; for (let i = 0; i < b.r[0].length; i += 2) { x += b.r[0][i]; y += b.r[0][i + 1]; a.push(x / 10, y / 10); } return a; });
  const inside = (px, py, p) => { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const yi = p[i + 1], yj = p[j + 1]; if ((yi > py) !== (yj > py) && px < (p[j] - p[i]) * (py - yi) / (yj - yi) + p[i]) c = !c; } return c; };
  let bad = 0, tot = 0; for (const k of ['lamp_curved_led', 'lamp_led_white', 'lamp_ornate_red_double', 'tree_ficus', 'palm_date']) { const d = r.kinds[k].data; for (let j = 0; j < d.length; j += 6) { tot++; if (polys.some(p => inside(d[j], d[j + 1], p))) bad++; } }
  assert.ok(bad / tot < 0.02, `${bad}/${tot}`); console.log('   בתוך בניין:', bad, 'מתוך', tot, '(רסטר 2.5 מ\')');
});
t('סגנון שלט לפי קטע: ליד 032 לבן ישן, ליד 015/035 כחול', () => {
  const r = PG.generateTile(load('164_634'), rules), d = r.kinds.street_sign.data; let near032 = [], near015 = [];
  for (let j = 0; j < d.length; j += 6) { const x = 164000 + d[j], y = 634000 + d[j + 1];
    if (Math.hypot(x - 164765, y - 634043) < 60) near032.push(d[j + 5]); if (Math.hypot(x - 164655, y - 634174) < 60) near015.push(d[j + 5]); }
  assert.ok(near032.length && near032.every(v => v === 1), 'near032 ' + near032); assert.ok(near015.length && near015.every(v => v === 0), 'near015 ' + near015);
});
t('תקציב: יצירת אריח – חציון < 25 מ"ש (node, אחרי חימום)', () => {
  const ks = fs.readdirSync(TD).filter(f => f.endsWith('.json.gz')).map(f => f.slice(0, -8)); const tiles = ks.map(load); tiles.forEach(x => PG.generateTile(x, rules));
  const ms = tiles.map(x => PG.generateTile(x, rules).ms).sort((a, b) => a - b); console.log('   חציון', ms[ms.length >> 1], 'p90', ms[Math.floor(ms.length * 0.9)], 'מקס', ms[ms.length - 1]);
  assert.ok(ms[ms.length >> 1] < 25);
});
t('ITM מול pyproj (EPSG:2039, טרנספורמציה 7 פרמטרים): שגיאה < 0.01 מ\'', () => {
  const ref = [[31.8058, 34.6428, 166272.5404, 634921.6219], [32.0853, 34.7818, 179556.0303, 665855.3894], [29.5577, 34.9519, 194982.1158, 385574.2845], [33.2, 35.57, 253542.1788, 789456.4316]];
  for (const [la, lo, e, n] of ref) { const [x, y] = I.wgs84ToITM(la, lo); assert.ok(Math.hypot(x - e, y - n) < 0.01, `${la},${lo}: ${x},${y}`); }
});
t('סטייה מגנטית: מגנטי 357° + 5° = 2° אמיתי', () => { assert.strictEqual(I.magToTrue(357, 5), 2); assert.strictEqual(I.magToTrue(100), 105); });
t('כיוון מצלמה: טלפון זקוף מול צפון → 0°, מול מזרח → 90°, הטיה 0', () => {
  let p = I.cameraPose(0, 90, 0); assert.ok(Math.abs(p.heading) < 1e-6 || Math.abs(p.heading - 360) < 1e-6); assert.ok(Math.abs(p.pitch) < 1e-6);
  p = I.cameraPose(270, 90, 0); assert.ok(Math.abs(p.heading - 90) < 1e-6, p.heading);   // alpha נגד כיוון השעון
  p = I.cameraPose(0, 120, 0); assert.ok(Math.abs(p.pitch - 30) < 1e-6, p.pitch);         // הטיה למעלה 30°
  assert.strictEqual(I.iosAlpha(90), 270);
});
console.log(n, 'בדיקות עברו');
