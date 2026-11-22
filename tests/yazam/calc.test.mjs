// בדיקות מנוע החישוב של לוח היזם. רץ ב-CI על כל שינוי בתיקיית yazam.
// שולף את בלוקי price-data ו-calc-core מהקובץ ומריץ אותם בלי דפדפן.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const file = process.argv[2] || 'yazam/index.html';
const html = readFileSync(file, 'utf8');
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('✓ ' + msg); else { failed++; console.error('✗ ' + msg); } };

function block(id) {
  const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html);
  if (!m) throw new Error('חסר בלוק ' + id);
  return m[1];
}
const data = block('price-data');
const core = block('calc-core');

// 1. מנוע החישוב מוגן: אסור שישתנה בלי לעדכן כאן את החתימה בכוונה.
const CORE_SHA = 'e25896c99606968dd3eabbbc37c824cad4c6cb0c5de97655d98e4f2985923bb2';
const coreSha = createHash('sha256').update(core).digest('hex');
ok(coreSha === CORE_SHA, 'מנוע החישוב לא השתנה (sha256)');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(data + '\n' + core + '\nthis.D=LUACH_DATA;this.C=LuachCalc;', ctx);
const D = ctx.D, C = ctx.C;

// 2. תקינות המחירון
ok(Array.isArray(D.items) && D.items.length > 0, 'יש סעיפים במחירון');
const ids = new Set();
let bad = 0;
for (const it of D.items) {
  if (ids.has(it[0])) bad++;
  ids.add(it[0]);
  if (!(typeof it[4] === 'number' && it[4] > 0)) bad++;
  if (!['c', 'd', 'e'].includes(it[5])) bad++;
  if (!it[2] || !it[3]) bad++;
}
ok(bad === 0, 'כל הסעיפים עם מזהה ייחודי, מחיר חיובי, סוג תקין, שם ויחידה');
ok(D.config.vatPercent === 18, 'מע"מ 18%');

// 3. מקרי חישוב קבועים
function q(input) { return C.quote(input, D); }
const first = D.items.find(i => i[5] === 'c');
const cost = D.items.find(i => i[5] === 'd');
let r = q({ address: 'הארז 4, אשדוד', lines: [{ id: first[0], qty: '2' }] });
ok(r.canIssue && r.subtotal === first[4] * 2, 'סעיף מחיר-ללקוח × 2');
ok(r.vat === Math.round(r.net * 0.18) && r.total === r.net + r.vat, 'מע"מ מעוגל לשקל וסה"כ נכון');

r = q({ address: 'x', markupPercent: '28', lines: [{ id: cost[0], qty: '1' }] });
ok(r.canIssue && r.lines[0].priceSource === 'list+markup', 'סעיף עלות מקבל תוספת');

r = q({ address: 'x', lines: [{ id: first[0], qty: '1', price: '100' }], discount: { type: 'percent', value: '10' } });
ok(r.subtotal === 100 && r.discount === 10 && r.net === 90 && r.vat === 16 && r.total === 106, 'הנחה באחוזים');

r = q({ address: '', lines: [{ id: first[0], qty: '1' }] });
ok(!r.canIssue && r.errors.includes('missing_address'), 'בלי כתובת אין הצעה');

r = q({ address: 'x', lines: [{ id: first[0], qty: '1', optional: true }] });
ok(!r.canIssue && r.errors.includes('no_lines') && r.optionsTotal > 0, 'אופציה לא נכנסת לסה"כ');

r = q({ address: 'x', lines: [{ custom: true, name: 'בדיקה', unit: 'יח\'', price: '0.1', qty: '0.1' }] });
ok(r.canIssue && r.subtotal === 0, 'עיגול חצי-כלפי-מעלה במספרים קטנים');

r = q({ address: 'x', lines: [{ id: first[0], qty: '1' }] });
const t = C.text(r, { business: 'עסק', client: '', address: 'x', dateText: '01.01.2027', validityDays: '30', notIncluded: '' }, D);
ok(typeof t === 'string' && t.includes('סה"כ לתשלום') && t.includes('הופק בלוח היזם'), 'טקסט ההצעה נבנה');

if (failed) { console.error(`\n${failed} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
