// Writes pack/manifest.json and pack/CREDITS.txt: one entry per shipped file with exact license + source.
// Usage: node make_manifest.mjs <packDir>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const PACK = process.argv[2];
const CC0 = 'CC0-1.0', OWN = 'נוצר בתוכנה ע"י נחיל ESH27 (tools/gen_*.{py,mjs}) – משוחרר כ-CC0-1.0';
const KEN = (kit, file) => ({ license: CC0, author: 'Kenney (kenney.nl)', source: `https://github.com/KenneyNL/${kit}/blob/main/${file}`,
  license_evidence: `https://github.com/KenneyNL/${kit}/blob/main/README.md – "Assets included in this package (2D sprites, 3D models and sound effects) are CC0 licensed" (הקוד של הערכה MIT; הנכסים CC0)` });
const PH = (id) => ({ license: CC0, author: 'Poly Haven (polyhaven.com)', source: `https://github.com/mrdoob/three.js/blob/master/examples/textures/equirectangular/${id}_1k.hdr`, original: `https://polyhaven.com/a/${id}`,
  license_evidence: 'כל נכסי Poly Haven ב-CC0 (https://polyhaven.com/license). העותק נלקח ממאגר three.js; האתר polyhaven.com חסום מהסביבה – לא אומת ישירות מול דף הנכס.', modified: 'הוקטן ל-512x256 (ממוצע ליניארי) ע"י tools/hdr_resize.py' });
const rules = [
  [/^models\/kenney_vehicle_truck_red/, KEN('Starter-Kit-Racing', 'models/vehicle-truck-red.glb')],
  [/^models\/kenney_vehicle_motorcycle/, KEN('Starter-Kit-Racing', 'models/vehicle-motorcycle.glb')],
  [/^models\/kenney_character_anim/, KEN('Starter-Kit-3D-Platformer', 'models/character.glb')],
  [/^models\/kenney_road_lightposts/, KEN('Starter-Kit-City-Builder', 'models/road-straight-lightposts.glb')],
  [/^models\//, { license: CC0, author: 'ESH27 swarm', source: 'tools/gen_models.mjs', note: OWN }],
  [/^textures\//, { license: CC0, author: 'ESH27 swarm', source: 'tools/gen_textures.py', note: OWN }],
  [/^sky\/quarry_01/, PH('quarry_01')], [/^sky\/venice_sunset/, PH('venice_sunset')], [/^sky\/spruit_sunrise/, PH('spruit_sunrise')],
  [/^fonts\/heebo/, { license: 'OFL-1.1', author: 'The Heebo Project Authors (Oded Ezer)', source: 'https://www.npmjs.com/package/@fontsource/heebo (v5.3.0)', upstream: 'https://github.com/google/fonts/tree/main/ofl/heebo', license_file: 'fonts/OFL-Heebo.txt' }],
  [/^fonts\/noto-sans-hebrew/, { license: 'OFL-1.1', author: 'Google / Noto project', source: 'https://www.npmjs.com/package/@fontsource/noto-sans-hebrew (v5.3.0)', license_file: 'fonts/OFL-NotoSansHebrew.txt' }],
  [/^fonts\/OFL/, { license: 'OFL-1.1', note: 'קובץ הרישיון של הגופן' }],
  [/^vendor\/basis\//, { license: 'Apache-2.0', author: 'Binomial LLC (basis_universal) via three.js', source: 'https://www.npmjs.com/package/three (0.186.1) examples/jsm/libs/basis/' }],
  [/^vendor\/esh-assets-loaders/, { license: 'MIT', author: 'three.js authors; meshoptimizer – Arseny Kapoulkine', source: 'tools/build-loaders.sh (bundle of three@0.186.1 addons)', license_file: 'vendor/LICENSE-three.txt' }],
  [/^vendor\/LICENSE/, { license: 'MIT', note: 'רישיון three.js' }],
  [/^(report\.json|REPORT-sizes\.txt|manifest\.json|CREDITS\.txt)$/, null],
  [/^LOADER-snippet\.js$/, { license: CC0, author: 'ESH27 swarm', note: 'קוד דוגמה' }],
  [/materials\.json$/, { license: CC0, author: 'ESH27 swarm', note: 'פרמטרי חומרים' }],
];
const files = []; const walk = (d) => { for (const f of fs.readdirSync(path.join(PACK, d))) { const r = d ? `${d}/${f}` : f; fs.statSync(path.join(PACK, r)).isDirectory() ? walk(r) : files.push(r); } }; walk('');
const out = { name: 'ESH27 twin-world asset pack – Israeli city, mobile', generated: new Date().toISOString(), policy: 'רק CC0 / OFL / MIT / Apache-2.0. אין נכסי CC-BY בחבילה.', files: [] };
let missing = [];
for (const f of files.sort()) {
  const rule = rules.find(([re]) => re.test(f)); if (rule && rule[1] === null) continue;
  if (!rule) { missing.push(f); continue; }
  const buf = fs.readFileSync(path.join(PACK, f));
  out.files.push({ file: f, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), ...rule[1] });
}
if (missing.length) { console.error('NO LICENSE RULE for', missing); process.exit(1); }
fs.writeFileSync(`${PACK}/manifest.json`, JSON.stringify(out, null, 1));
const C = ['קרדיטים ורישיונות – חבילת הנכסים של ESH27 (עולם תאום)', '', 'כל קובץ ברשימה המלאה: manifest.json (רישיון, מקור, גודל, טביעת sha256).', '',
  'CC0-1.0 (נחלת הכלל, אין חובת קרדיט – נותנים בכל זאת):',
  '  Kenney – kenney.nl – Starter Kits (Racing, 3D Platformer, City Builder) מ-github.com/KenneyNL. הנכסים CC0 לפי ה-README של כל ערכה.',
  '  Poly Haven – polyhaven.com – HDRI: quarry_01, venice_sunset, spruit_sunrise (עותקים ממאגר three.js).',
  '  ESH27 – כל החומרים (textures/) וכל המודלים שאינם kenney_* נוצרו בקוד (tools/) ומשוחררים CC0.',
  '', 'SIL Open Font License 1.1:', '  Heebo – The Heebo Project Authors (Oded Ezer). Noto Sans Hebrew – Google. קבצי רישיון בתיקייה fonts/.',
  '', 'MIT: three.js (three.js authors), meshoptimizer decoder (Arseny Kapoulkine) – בתוך vendor/esh-assets-loaders.js.',
  'Apache-2.0: Basis Universal transcoder (Binomial LLC) – vendor/basis/.',
  '', 'שימוש מחוץ לחבילה: דמות Quaternius (UBC + UAL) שבתיקיית המשחק – הוגדרה CC0 ע"י צוות המשחק; מקור המקור (quaternius.com) חסום מכאן ולא אומת.', ''];
fs.writeFileSync(`${PACK}/CREDITS.txt`, C.join('\n'));
console.log('manifest entries', out.files.length, 'total bytes', out.files.reduce((s, x) => s + x.bytes, 0));
