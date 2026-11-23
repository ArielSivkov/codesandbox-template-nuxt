#!/usr/bin/env node
// איחוד העותקים (משימה 1 בתור): מקור אחד לכל קובץ משותף, והסקריפט בונה ממנו את העותקים.
//   node integration/tools/sync-copies.js          → מעתיק מהמקור לכל העותקים
//   node integration/tools/sync-copies.js --check  → רק בודק; מדפיס את מספר ההבדלים, קוד יציאה 1 אם יש הבדל
// מקור האמת לקוד המשחק = integration/world (פסק הסנהדרין 23.11.2026); מקור מודולי המחלקות = תיקיית המחלקה.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');   // twin/
const COPIES = ['game', 'preview/world'];        // עותקי קוד המשחק
const WORLDS = ['integration/world', 'preview/world'];

/** רשימת זוגות [מקור, יעד] יחסית ל-twin/ */
function manifest() {
  const pairs = [];
  for (const f of ['js/sim.js', 'js/itm.js']) for (const c of COPIES) pairs.push(['integration/world/' + f, c + '/' + f]);
  // מודולי מחלקות שמועתקים כמות שהם (קבצי src בלבד; קבצי dist נבנים בנפרד)
  for (const mod of ['physics/src', 'aviation/src']) {
    const dir = path.join(ROOT, mod); if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js')).sort())
      for (const w of WORLDS) pairs.push([mod + '/' + f, w + '/mods/' + mod + '/' + f]);
  }
  for (const w of WORLDS) pairs.push(['weather/weather.js', w + '/mods/weather/weather.js']);
  return pairs;
}

function run(check) {
  const diffs = [];
  for (const [s, d] of manifest()) {
    const src = fs.readFileSync(path.join(ROOT, s)), dp = path.join(ROOT, d);
    const same = fs.existsSync(dp) && Buffer.compare(fs.readFileSync(dp), src) === 0;
    if (same) continue;
    diffs.push(d);
    if (!check) { fs.mkdirSync(path.dirname(dp), { recursive: true }); fs.writeFileSync(dp, src); }
  }
  return { pairs: manifest().length, diffs };
}

module.exports = { manifest, run };
if (require.main === module) {
  const check = process.argv.includes('--check'), r = run(check);
  if (check) { console.log(`עותקים: ${r.pairs} · הבדלים: ${r.diffs.length}` + (r.diffs.length ? '\n  ' + r.diffs.join('\n  ') : '')); process.exit(r.diffs.length ? 1 : 0); }
  console.log(`עותקים: ${r.pairs} · עודכנו: ${r.diffs.length}` + (r.diffs.length ? '\n  ' + r.diffs.join('\n  ') : ''));
}
