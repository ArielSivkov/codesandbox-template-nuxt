// render_sunrise.mjs — reference plate "זריחה" for the agents of the living Ashdod (style kernel v0).
//   node style-kernel/plates/render_sunrise.mjs            → plates/sunrise.png (2400×1350) + plates/sunrise.json
//   node style-kernel/plates/render_sunrise.mjs --master   → also plates/sunrise_8k.png (7680×4320)
//   options: --ref=<twin-world commit> (default: AREA.json source.commit)  --keep (keep the generated page in _work/)
// Needs: the twin-world git objects in this repo (git fetch origin twin-world), python3 + pyluach, Playwright Chromium.
// Deterministic: no Math.random, no clock, no network (every non-file request is aborted).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as Sky from '../sky.js';
import { buildScene, lin, hexOf, scaleHex, mix, Y } from './sunrise_scene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), KROOT = path.resolve(HERE, '..'), REPO = path.resolve(KROOT, '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const AREA = JSON.parse(fs.readFileSync(path.join(HERE, 'AREA.json'), 'utf8'));
const STYLE = JSON.parse(fs.readFileSync(path.join(KROOT, 'style.json'), 'utf8'));
const W = 2400, H = 1350;
const t0 = Date.now();

// ───────────────────────────── scene (data + light)
const sc = buildScene({ repo: REPO, ref: args.ref, area: AREA, style: STYLE, W, H, scale: 2.7, oy: 205 + 210 * 2.7 });

// ───────────────────────────── one global tone map (order of brightness preserved), so the plate meets the kernel budget
// Y' = k·Y / (1 + k·Y / m): lifts the deep shade, compresses the lit faces under the focus. k, m documented in sunrise.json.
const TM = { k: 3.5, m: 0.17, skyDim: 0.28 };
const tm = hex => { const l = lin(hex), y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; if (y <= 0) return hex; const y2 = TM.k * y / (1 + TM.k * y / TM.m); return hexOf(l.map(v => Math.min(1, v * y2 / y))); };
for (const c of sc.cells) c.c = tm(c.c);
for (const b of sc.bldgs) { b.roofC = tm(b.roofC); for (const w of b.walls) { w.c = tm(w.c); if (w.litC) w.litC = tm(w.litC); } }
const M = STYLE.materials.items, roles = STYLE.palette.roles;
const shadeAmb = (hex, k = 1) => { const a = lin(sc.sky.ambient.hex), b = lin(hex); return hexOf(b.map((v, i) => v * a[i] * sc.sky.ambient.intensity * k)); };
const road = mix(tm(shadeAmb(M.asphalt.base, 0.8)), '#2E3240', 0.45);

// ───────────────────────────── palette of the plate (style.json roles; the night ink for marks on a dark plate)
const C = {
  plateTop: '#0B1431', plateBottom: '#080F26',
  hairline: roles.hairline.dawn, pearl: roles.pearl.night, moon: roles.moon.all, ink: roles.ink.night, skyInk: roles.ink.dawn,
  seaInk: roles.silver.night, seaGlint: scaleHex(sc.sky.antisun.hex, TM.skyDim * 1.3), sandInk: '#141B30',
  road, roadEdge: '#0A0F1F', skirt: mix(tm(shadeAmb(M.kurkar.base, 0.35)), '#0E1630', 0.55),
  greenDot: mix(M.greenery.palm, roles.silver.night, 0.35), openDot: mix(M.greenery.dryGrass, roles.silver.night, 0.4),
  wallInk: '#10162A', shadowInk: '#04060F', litInk: '#3A2418', edge: roles.ink.night, band: roles.pearl.night,
  focusFill: sc.sky.focus.fill || '#E3A33A', focusEdge: sc.sky.focus.edge || '#1A1408',
  textDim: roles.ink.night, text: roles.pearl.night, title: roles.pearl.night, brass: roles.hairline.night, ember: roles.ember.dawn,
};
sc.colors = C;

// ───────────────────────────── the sky ribbon: western panorama, azimuth 220°…20° (through 300°), altitude 0°…22°
const RB = { x0: sc.cells.reduce((m, c) => Math.min(m, ...c.pts.map(p => p[0])), 1e9), x1: sc.cells.reduce((m, c) => Math.max(m, ...c.pts.map(p => p[0])), -1e9), y0: 46, y1: 182 };
const AZ0 = 220, AZ1 = 380, ALT1 = 22;
const azX = az => { let a = az; while (a < AZ0) a += 360; return RB.x0 + (a - AZ0) / (AZ1 - AZ0) * (RB.x1 - RB.x0); };
{
  const stops = sc.sky.stops, at = alt => 1 - alt / 90;
  const vert = a => { // stops 0 (zenith) … 1 (horizon), linear in 'at'
    for (let i = 0; i < stops.length - 1; i++) if (a <= stops[i + 1].at) return mix(stops[i].hex, stops[i + 1].hex, (a - stops[i].at) / (stops[i + 1].at - stops[i].at));
    return stops[stops.length - 1].hex;
  };
  const rows = [], NR = 48, NC = 160;
  for (let j = 0; j < NR; j++) {
    const alt = ALT1 * (1 - (j + 0.5) / NR), row = [];
    for (let i = 0; i < NC; i++) {
      const az = AZ0 + (i + 0.5) / NC * (AZ1 - AZ0), dAnti = Math.abs(((az - sc.sky.antisun.azimuth + 540) % 360) - 180);
      const horizon = mix(sc.sky.antisun.hex, stops[stops.length - 1].hex, Math.min(1, dAnti / 90));
      const v = vert(at(alt)), w = Math.exp(-alt / 5);                       // the horizon colour fades upward within ~5°
      row.push(Sky.hexToRgb(scaleHex(mix(v, horizon, w), TM.skyDim)));
    }
    rows.push(row);
  }
  const ticks = []; for (let a = 230; a <= 370; a += 10) ticks.push({ x: azX(a), major: a % 30 === 0, az: a % 360 });
  const marks = [{ kind: 'anti', x: azX(sc.sky.antisun.azimuth) }];
  if (sc.sun.moonSetAz != null) marks.push({ kind: 'moon', x: azX(sc.sun.moonSetAz) });
  sc.ribbon = { ...RB, rows, ticks, marks };
}
sc.block = { x0: RB.x0, x1: RB.x1 };

// ───────────────────────────── height ruler at the near-right corner (valid for any vertical in a parallel projection)
const cosE = Math.cos(sc.elevDeg * Math.PI / 180);
const nr = sc.skirt[sc.skirt.length - 1].bot;          // near-right corner at sea level
const rulerX = nr[0] + 34, rulerY0 = nr[1];
const term = sc.numbers.towerTerminator;
const termLo = Math.min(...sc.focusRuns.flatMap(f => f.zs)), termHi = Math.max(...sc.focusRuns.flatMap(f => f.zs));
sc.ruler = { x: rulerX, y0: rulerY0, k: sc.S * cosE, max: 130, term: [termLo, termHi], tops: sc.numbers.towers.map(t => ({ top: t.top, sigma: t.sigma })) };

// ───────────────────────────── texts (all Hebrew via SVG)
const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2), num = x => Math.round(x).toLocaleString('en-US');
const signed = (x, d = 2) => (x < 0 ? '−' : '+') + Math.abs(x).toFixed(d);
const LRI = '\u2066', RLI = '\u2067', PDI = '\u2069', ltr = x => `${LRI}${x}${PDI}`;   // bidi isolates (kernel typography)
const T = [];
const add = (x, y, s, o = {}) => T.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, s, ...o });
const sun = sc.sun, N = sc.numbers, L = sc.labels;

// ribbon captions
add(RB.x1 - 10, RB.y0 + 20, `שמי המערב ברגע הזריחה · צבעי מודל הגרעין (${ltr('sky.js')}), מעומעמים ${ltr('×' + TM.skyDim)} לתקציב הבהירות`, { size: 13, fill: C.text, opacity: 0.8 });
add(RB.x1 - 10, RB.y0 + 38, `רצועת פנורמה: אזימוט ${ltr('220°–20°')} דרך מערב (לא בקנה המידה של הלוח)`, { size: 12, opacity: 0.7 });
for (const t of sc.ribbon.ticks) if (t.major) add(t.x, RB.y1 + 19, `${t.az}°`, { size: 11, anchor: 'middle', dir: 'ltr', opacity: 0.75 });
add(azX(270), RB.y1 + 33, 'מערב', { size: 11, anchor: 'middle', opacity: 0.6 });
add(azX(360), RB.y1 + 33, 'צפון', { size: 11, anchor: 'middle', opacity: 0.6 });
{
  const xa = azX(sc.sky.antisun.azimuth), xm = sun.moonSetAz != null ? azX(sun.moonSetAz) : null;
  add(xa - 8, RB.y1 - 8, `נגד השמש ${ltr(f1(sc.sky.antisun.azimuth) + '°')}`, { size: 12, anchor: 'start', fill: C.text, opacity: 0.8 });
  if (xm != null) add(xm + 8, RB.y1 - 24, `כאן שקע הירח המלא ב-${sun.moonSet} (${ltr(f1(sun.moonSetAz) + '°')}), ${sun.moonSetMinBefore} דק׳ לפני הזריחה`, { size: 12, anchor: 'end', fill: C.text, opacity: 0.8 });
}

// in-plate labels
const tw = L.towers.slice().sort((a, b) => a.top[0] - b.top[0]);
const tLeft = tw[0], tRight = tw[tw.length - 1];
{
  const ax = tRight.top[0] + 30, ay = Math.min(...tw.map(t => t.top[1])) - 30;
  add(ax + 300, ay - 22, 'מגדלי הדקל', { family: 'Frank Ruhl Libre', size: 22, weight: 500, fill: C.text, leader: [[ax + 4, ay - 14], [tRight.top[0] + 2, tRight.top[1] + 4]] });
  add(ax + 300, ay, `גובה 100 מ׳ ${ltr('±8')} · מקור P: משוער מתמונות שטח · קונטור ${ltr('OSM')}`, { size: 13, opacity: 0.85 });
  add(ax + 300, ay + 17, `בסיס כ-${ltr(`${Math.round(N.towers[0].base)} / ${Math.round(N.towers[1].base)}`)} מ׳ מעל הים (${ltr('SRTM')}, משוער)`, { size: 13, opacity: 0.7 });
}
{
  // the focus label: to the right of the eastern tower, at the height of the line
  // the focus label: up and to the left of the western tower, over the quiet sand
  const all = sc.focusRuns.flatMap(f => f.pts), p = all.reduce((m, q) => (q[0] < m[0] ? q : m), all[0]);
  const lx = p[0] - 70, ly = p[1] - 205;
  add(lx, ly, 'קו האור הראשון', { family: 'Frank Ruhl Libre', size: 22, weight: 500, fill: C.text, leader: [[lx - 60, ly + 42], [p[0] - 3, p[1] - 3]], leaderAlpha: 0.6 });
  add(lx, ly + 19, `${ltr(`${Math.round(termLo)}–${Math.round(termHi)}`)} מ׳ מעל הים · מחושב מהנתונים`, { size: 13, opacity: 0.85 });
  add(lx, ly + 35, 'מעליו השמש כבר נראית; מתחתיו צל הדיונות והבתים שבמזרח', { size: 13, opacity: 0.7 });
}
{
  const nd = sc.bldgs.find(b => b.name === 'מגדל המדרחוף');
  if (nd) { const p = nd.label; add(p[0] - 16, p[1] + 66, `״מגדל המדרחוף״ בנתונים: ${Math.round(nd.h)} מ׳ ${ltr('±' + Math.round(nd.sigma))} על קונטור של ${Math.round(nd.area)} מ״ר`, { size: 12, anchor: 'start', fill: C.ember, opacity: 0.9, leader: [[p[0] - 12, p[1] + 62], [p[0] - 2, p[1] + 50]], leaderAlpha: 0.5 });
    add(p[0] - 16, p[1] + 82, 'גובה מכלל אצבע לפי השם — חשוד, דורש בדיקה', { size: 12, anchor: 'start', fill: C.ember, opacity: 0.75 }); }
}
if (L.coastAt) add(L.coastAt[0] + 8, L.coastAt[1] - 10, 'קו חוף סינתטי בנתוני הדגימה · משוער', { size: 12, anchor: 'end', opacity: 0.75 });
add(L.seaAt[0], L.seaAt[1], 'הים התיכון', { family: 'Frank Ruhl Libre', size: 26, weight: 400, fill: C.text, opacity: 0.55, anchor: 'middle', ls: 4 });
add(L.sandAt[0], L.sandAt[1] + 4, 'חול וחוף · כיסוי קרקע משוער', { size: 12, anchor: 'middle', opacity: 0.7 });
add(L.skirtAt[0] + 220, L.skirtAt[1] + 6, 'חתך התבליט עד פני הים · סכמטי', { size: 12, opacity: 0.6 });
{ // park: the land-cover layer of the twin marks it (class 2, estimated) — label at the centre of its cells beyond the towers
  const pk = sc.cells.filter(c => c.kind === 2 && c.j * 4 + sc.area.v[0] > 120);
  if (pk.length) { const x = pk.reduce((m, c) => m + c.pts[0][0], 0) / pk.length, y = pk.reduce((m, c) => m + c.pts[0][1], 0) / pk.length;
    add(x + 60, y - 48, 'פארק (נקודות) · כיסוי קרקע משוער', { size: 12, anchor: 'middle', opacity: 0.7 }); }
}

// ruler labels
const ry = z => rulerY0 - sc.S * cosE * z;
for (const z of [0, 50, 100]) add(rulerX + 12, ry(z) + 4, `${z}`, { size: 12, anchor: 'start', dir: 'ltr', opacity: 0.75 });
add(rulerX + 4, ry(130) - 10, 'מ׳ מעל הים', { size: 12, anchor: 'middle', opacity: 0.7 });

// compass (on the ground plane, same projection) + scale bar, in the left margin
const CMP = { cx: 168, cy: 1000, r: 70 };
{
  const D2R = Math.PI / 180, ua = AREA.axes.u_az_deg * D2R, va = AREA.axes.v_az_deg * D2R, sinE = Math.sin(sc.elevDeg * D2R);
  const dir = az => { const e = Math.sin(az * D2R), n = Math.cos(az * D2R); const du = e * Math.sin(ua) + n * Math.cos(ua), dv = e * Math.sin(va) + n * Math.cos(va); return [du, -dv * sinE]; };
  const at = (az, r) => { const [x, y] = dir(az); return [CMP.cx + x * r, CMP.cy + y * r]; };
  sc.compass = { ...CMP, ellipse: Array.from({ length: 73 }, (_, i) => at(i * 5, CMP.r)), north: at(0, CMP.r + 16), sun: at(sun.az, CMP.r), shadow: at(sun.az + 180, CMP.r + 34), view: at(AREA.axes.v_az_deg, CMP.r) };
  const pn = at(0, CMP.r + 28), ps = at(sun.az, CMP.r + 22), ph = at(sun.az + 180, CMP.r + 48);
  add(pn[0], pn[1] + 4, 'צפון', { size: 12, anchor: 'middle', opacity: 0.8 });
  add(ps[0] + 6, ps[1] + 14, `שמש ${ltr(f1(sun.az) + '°')}`, { size: 12, anchor: 'middle', fill: C.text, opacity: 0.85 });
  add(ph[0], ph[1] - 6, `צל ${ltr(f1((sun.az + 180) % 360) + '°')}`, { size: 12, anchor: 'middle', opacity: 0.8 });
  add(CMP.cx, CMP.cy + CMP.r * 0.5 + 40, 'שושנה על מישור הקרקע', { size: 11, anchor: 'middle', opacity: 0.55 });
}
const SB = { x0: CMP.cx - 50 * sc.S, x1: CMP.cx + 50 * sc.S, y: CMP.cy + 92 };
sc.labels.scale = { x0: SB.x0, x1: SB.x1, y: SB.y };
add(CMP.cx, SB.y + 18, '100 מ׳ · לאורך הציר האופקי בלבד', { size: 12, anchor: 'middle', opacity: 0.75 });

// cartouche (bottom right, RTL)
const CX = W - 48, CY = 1150;
add(CX, CY, 'זריחה', { family: 'Frank Ruhl Libre', size: 44, weight: 500, fill: C.title });
add(CX - 128, CY - 2, `${RLI}${AREA.name_he}${PDI}`, { family: 'Frank Ruhl Libre', size: 22, weight: 400, fill: C.text, opacity: 0.85 });
add(CX, CY + 32, `יום ${sun.dow} · ${sun.date_he} · ${sun.localSec} · ${sc.heb.he}`, { size: 17, fill: C.text, weight: 500 });
add(CX, CY + 56, `שמש: אזימוט ${ltr(f1(sun.az) + '°')} · גובה גאומטרי ${ltr(signed(sun.alt) + '°')} · שפה עליונה נראית ${ltr(signed(sun.upperLimb) + '°')} (שבירת אור כלולה)`, { size: 14 });
add(CX, CY + 76, `צל של עמוד 10 מ׳ עכשיו: כ-${f1(sun.shadow10 / 1000)} ק״מ, כלומר עד האופק · אחרי 10 דק׳: ${num(sun.ladder[0].shadow10)} מ׳ · 30 דק׳: ${num(sun.ladder[2].shadow10)} מ׳ · 60 דק׳: ${num(sun.ladder[3].shadow10)} מ׳`, { size: 14 });
{
  const fb = N.beachFirst;
  const tallNote = fb.tallLatest ? ` · מאחורי מגדלי הדקל רק ב-${fb.tallLatest}` : '';
  add(CX, CY + 96, `השמש תגיע לחול בקו המים (לפי התבליט בנתונים): ${ltr(`${fb.earliest}–${fb.openLatest || fb.latest}`)}, כשתעלה מעל ${ltr(`${f1(fb.hMin)}°–${f1(Math.max(...fb.points.filter(p => !p.behindTall).map(p => p.horizon)))}°`)}${tallNote} · שעת הזהב נגמרת ב-${sun.goldenEnd}`, { size: 14 });
}
add(CX, CY + 118, `גרעין סגנון v0 · ${ltr('sky.js ' + Sky.VERSION)} · זרע 5787 · מוקד: דיו מוזהב (${ltr('sky.focus = ink')})`, { size: 13, fill: C.brass, opacity: 0.9 });

// sources and legend (bottom left, RTL lines anchored at their right edge)
const SXr = 1290, SY0 = 1122;
const srcLines = [
  ['מקורות ורישיונות', { weight: 700, fill: C.text, size: 14 }],
  [`מבנים, כבישים וקו החוף: ${LRI}© OpenStreetMap contributors, ODbL 1.0${PDI} (תמצית Geofabrik בדגימת העולם התאום)`, {}],
  [`העולם התאום: ענף ${ltr('twin-world')}, ${ltr(String(sc.sources.commit).slice(0, 7))} · ${N.tilesUsed.length} אריחים ${ltr(`${N.tilesUsed[0]} … ${N.tilesUsed[N.tilesUsed.length - 1]}`)} · מסגרת הדגימה: ${ltr('ITM = sample + (1507.82, 757.76)')}`, {}],
  ['תבליט: SRTM 2000 (DSM, כולל מבנים וצמחייה), נחלת הכלל · כיסוי קרקע: שכבת הצמחייה של העולם התאום (משוער)', {}],
  [`גבהים: ${N.bySrc.R} מבנים לפי כלל אצבע (מקור R) ${ltr('±6–20')} מ׳; 2 מגדלי הדקל (מקור P) ${ltr('±8')} מ׳ · אור ישיר מחושב עד ${(N.reach_m / 1000).toFixed(1)} ק״מ מזרחה; מעבר לזה אופק מתמטי`, {}],
  ['לא בנתונים ולכן לא מצוירים: עצים (רק משוערים), אנשים, רכבים · רוחב כבישים, חולות וחתך: סכמטי · חומרים וצבעים: השראה, לא מדידה', {}],
  [`הצללה באלכסון: הצל הרך של המגדלים לכיוון ${ltr(f1((sun.az + 180) % 360) + '°')} — זוהר הזריחה שהם מסתירים (מודל משוער) · מיפוי טונים אחיד ${ltr('×' + TM.k)} (סדר הבהירות נשמר)`, {}],
];
srcLines.push(['לוח השראה לסוכנים. אין בלוח זה זכות כלשהי בקרקע האמיתית.', { opacity: 0.6 }]);   // style.json → digitalAssets (same line as night/noon)
srcLines.forEach(([s, o], i) => add(SXr, SY0 + i * 19, s, { size: 13, opacity: 0.8, ...o }));
// legend (small, under the compass)
const LG = [
  ['קו חד = קונטור מדוד (OSM)', C.edge], [`קו מנוקד ורצועה = גובה ${ltr('±σ')}`, C.band], ['פנים חמים = מעל קו האור', '#B88468'], ['זהב = המוקד היחיד', C.focusFill],
];
sc.legend = LG.map(([s, c], i) => ({ x: 280, y: 1196 + i * 21, c }));
LG.forEach(([s, c], i) => add(268, 1200 + i * 21, s, { size: 13, opacity: 0.85 }));
sc.texts = T;

// numbers that the cartouche needs from the scene (computed in the data step)
// (beachFirst is attached by buildScene → N.beachFirst)

// ───────────────────────────── page + capture
const WORK = path.join(KROOT, '_work', 'sunrise');
fs.mkdirSync(WORK, { recursive: true });
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>render</title>
<link rel="stylesheet" href="${pathToFileURL(path.join(KROOT, 'fonts', 'fonts.css')).href}">
<style>html,body{margin:0;background:${C.plateBottom}}#plate{position:relative;width:${W}px;height:${H}px;overflow:hidden}
canvas{position:absolute;left:0;top:0;width:${W}px;height:${H}px}svg{position:absolute;left:0;top:0}
text{font-kerning:normal;text-rendering:geometricPrecision}</style></head>
<body><div id="plate"><canvas id="cv"></canvas><svg id="ov" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg></div>
<script>window.SCENE=${JSON.stringify(sc)};</script>
<script src="${pathToFileURL(path.join(HERE, 'sunrise_page.js')).href}"></script></body></html>`;
const pagePath = path.join(WORK, 'sunrise.html');
fs.writeFileSync(pagePath, html);

const pw = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(pw).href);
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
async function shoot(dpr, out) {
  const t = Date.now();
  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await p.route('**/*', r => (r.request().url().startsWith('file://') ? r.continue() : r.abort()));
  await p.goto(pathToFileURL(pagePath).href, { waitUntil: 'load', timeout: 300000 });
  await p.waitForFunction(() => document.title === 'ready', null, { timeout: 300000 });
  const info = await p.evaluate(() => ({ qa: window.__qa, fonts: window.__fonts, errors: window.__errors || null, focus: window.__focus }));
  await p.locator('#plate').screenshot({ path: out, timeout: 300000 });
  await p.close();
  return { ...info, logs, seconds: (Date.now() - t) / 1000 };
}
const outPng = path.join(HERE, 'sunrise.png');
const r1 = await shoot(1, outPng);
let r8 = null;
if (args.master) r8 = await shoot(3.2, path.join(HERE, 'sunrise_8k.png'));

// ───────────────────────────── QA: kernel brightness budget on the 1080-px-wide downscale (sky.js brightnessBudget)
async function budget(png) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const b64 = fs.readFileSync(png).toString('base64');
  const qaPage = path.join(WORK, 'qa.html');
  fs.writeFileSync(qaPage, `<!doctype html><meta charset="utf-8"><title>qa</title><script type="module">import * as Sky from '${pathToFileURL(path.join(KROOT, 'sky.js')).href}'; window.Sky = Sky; document.title = 'sky';</script>`);
  await p.route('**/*', r => (r.request().url().startsWith('file://') || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
  await p.goto(pathToFileURL(qaPage).href);
  await p.waitForFunction(() => document.title === 'sky');
  const res = await p.evaluate(async ({ b64, focus, W, focusFill }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const w = 1080, h = Math.round(img.height * w / img.width), c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
    const data = x.getImageData(0, 0, w, h).data;
    // focal mask: the focus polylines (plate px → 1080 px), widened to cover the line and its edge
    const m = document.createElement('canvas'); m.width = w; m.height = h; const mx = m.getContext('2d');
    const k = w / W; mx.strokeStyle = '#fff'; mx.lineWidth = 5; mx.lineCap = 'round';
    for (const f of focus) { mx.beginPath(); f.forEach((p, i) => (i ? mx.lineTo(p[0] * k, p[1] * k) : mx.moveTo(p[0] * k, p[1] * k))); mx.stroke(); }
    const md = mx.getImageData(0, 0, w, h).data, isFocal = (X, Yy) => md[(Yy * w + X) * 4 + 3] > 0;
    const plain = Sky.brightnessBudget({ data, width: w, height: h }, isFocal, { focusY: Sky.luminance(focusFill) });
    const measured = Sky.brightnessBudget({ data, width: w, height: h }, isFocal);
    // quiet field: share of pixels whose local 5×5 range of Y is small (sky, sea, plain ground)
    let quiet = 0; const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, bb = data[i * 4 + 2] / 255; lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * bb; }
    for (let yy = 2; yy < h - 2; yy++) for (let xx = 2; xx < w - 2; xx++) { let lo = 1, hi = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const v = lum[(yy + dy) * w + xx + dx]; if (v < lo) lo = v; if (v > hi) hi = v; } if (hi - lo < 0.06) quiet++; }
    return { size: [w, h], plain, measured, quietFieldFraction: quiet / ((w - 4) * (h - 4)) };
  }, { b64, focus: r1.focus, W, focusFill: C.focusFill });
  await p.close();
  return res;
}
const qa = await budget(outPng);
await browser.close();

// ───────────────────────────── provenance record next to the plate
const rec = {
  plate: 'sunrise', title_he: 'זריחה', kernel: STYLE.version, sky_js: Sky.VERSION, seed: 5787,
  moment: { utc: sun.iso, local: `${sun.date_he} ${sun.localSec}`, dow_he: `יום ${sun.dow}`, hebrew_date: sc.heb, definition_he: 'זריחה לפי sky.js: מרכז השמש ב-−0.833° (מוסכמת NOAA), אופק מתמטי' },
  sun: { az: sun.az, alt_geometric: sun.alt, alt_apparent_centre: sun.altApparent, upper_limb_apparent: sun.upperLimb, semidiameter: sun.semidiameter, shadow_of_10m_pole_m: sun.shadow10, ladder: sun.ladder, golden_hour_ends: sun.goldenEnd, moonset: { local: sun.moonSet, az: sun.moonSetAz, illumination: sun.moonIllum } },
  sky_model: sc.sky,
  area: { id: AREA.id, file: 'plates/AREA.json', name_he: AREA.name_he, center_sample: AREA.center_sample, center_itm: AREA.center_itm, center_wgs84: AREA.center_wgs84, u_range_m: AREA.u_range_m, v_range_m: AREA.v_range_m, axes: AREA.axes },
  view: { camera_az_deg: AREA.view_suggested.camera_az_deg, elevation_deg: sc.elevDeg, projection: 'parallel (axonometric)', px_per_m: sc.S },
  data: { ...sc.sources, tiles_loaded: N.tilesUsed,
    files_read: [sc.sources.manifest, ...N.tilesUsed.flatMap(k => [`twin/integration/world/data/tiles/v/${k}.json.gz`, `twin/integration/world/data/tiles/t/${k}.bin.gz`, `twin/integration/world/mods/vegetation/data/tiles/g/${k}.json.gz`])], why_beyond_area_he: 'אריחים מזרחה לאזור (עד 2.4 ק״מ) נטענים רק כדי לחשב מה חוסם את האור הראשון.' },
  computed: { tower_first_light_m_asl: [termLo, termHi], tower_terminator_samples: term, towers: N.towers, beach_first_sun: N.beachFirst, buildings_in_area: N.buildingsInArea, by_src: N.bySrc, lit_ground_cells: N.litGroundCells, land_cells: N.landCells, sand_cells: N.sandCells },
  approximations_he: [
    'אור ישיר: קרן מהשפה העליונה של השמש (+0.05°), חסימה מפני השטח (SRTM DSM) ומגגות (בסיס + גובה) ברשת 2 מ׳, עד 2.4 ק״מ מזרחה; עקמומיות כדור הארץ עם k = 0.13. הרי השפלה רחוק יותר אינם בנתונים — בפועל השמש נראית כמה דקות מאוחר יותר (משוער).',
    'צללים רכים: זוהר הזריחה הוא 70% מאור הסביבה (משוער); משקלו exp(−(Δאזימוט/20°)²)·exp(−גובה/5°) ב-41 כיוונים ±40° סביב השמש. כל נקודה מאבדת את החלק שהתבליט והבניינים מסתירים (טון). ההצללה באלכסון מסמנת רק את החלק שמסתירים הבניינים בני 40 מ׳ ומעלה — מודל משוער, לא פוטומטריה.',
    'גבהים: R (כלל אצבע) ±6–20 מ׳; מגדלי הדקל P ±8 מ׳. כל גג מצויר בגובה הנומינלי, עם רצועה ±σ וקו מנוקד ב-+σ.',
    'קו החוף בדגימה סינתטי. כיסוי קרקע (חול/חוף) משכבת הצמחייה, מסומן משוער. רוחב כבישים לפי סוג — סכמטי. החתך הקדמי — סכמטי.',
    'צבעים: חומרים מ-style.json (השראה, לא מדידה), מוארים במודל האור של הגרעין ברגע הזריחה (+1 שנ׳), ואחר כך מיפוי טונים אחיד אחד לכל הלוח.',
  ],
  tone_map: TM,
  credits: { osm: '© OpenStreetMap contributors, ODbL 1.0', srtm: 'SRTM 2000 (NASA/USGS), public domain', fonts: 'Heebo, Frank Ruhl Libre (SIL OFL 1.1)' },
  qa: { budget_1080: qa, render: { plate_2400: { seconds: r1.seconds, fonts: r1.fonts, qa: r1.qa, errors: r1.errors, logs: r1.logs }, master_8k: r8 && { seconds: r8.seconds, fonts: r8.fonts, qa: r8.qa, errors: r8.errors, logs: r8.logs } } },
  files: { plate: 'plates/sunrise.png', master: r8 ? 'plates/sunrise_8k.png' : null, renderer: 'plates/render_sunrise.mjs', helpers: ['plates/sunrise_scene.mjs', 'plates/sunrise_page.js'] },
};
fs.writeFileSync(path.join(HERE, 'sunrise.json'), JSON.stringify(rec, null, 1) + '\n');
if (!args.keep) { /* the generated page stays in _work/ (git-ignored) for inspection */ }
console.log(JSON.stringify({ out: outPng, master: r8 ? path.join(HERE, 'sunrise_8k.png') : null, seconds: (Date.now() - t0) / 1000, r1: { s: r1.seconds, fonts: r1.fonts, qa: r1.qa, errors: r1.errors, logs: r1.logs.slice(0, 8) }, r8: r8 && { s: r8.seconds, errors: r8.errors }, budget: { plain: qa.plain, measured: qa.measured, quiet: qa.quietFieldFraction }, term: [termLo, termHi], beach: N.beachFirst }, null, 1));
