// render_night.mjs — the night reference plate for the agents of the living Ashdod (style kernel v0).
//   node plates/render_night.mjs            → plates/night.png (2400×1350) + plates/night_8k.png (7680×4320) + plates/night.qa.json
//   node plates/render_night.mjs --no8k     → only the 2400×1350 plate
//   node plates/render_night.mjs --crops    → also 1:1 crops of the 8K master into _work/plates/ (for review)
// Moment: Mon 23.11.2026 22:30 Israel time (the moment of the kernel's source artwork). Area: plates/AREA.json.
// Data: plates/data/area.json (cut from the twin-world tiles by plates/extract_area.mjs). Sky: ../sky.js. Words: Hebrew, SVG only.
// Deterministic: every random choice goes through sky.js seededRandom(); no network (all requests outside file:// are aborted).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as SKY from '../sky.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORK = path.join(ROOT, '_work', 'plates');
const args = new Set(process.argv.slice(2));
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);

const AREA = JSON.parse(fs.readFileSync(path.join(HERE, 'AREA.json'), 'utf8'));
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'area.json'), 'utf8'));
const STYLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'style.json'), 'utf8'));
if (DATA.area !== AREA.id) throw new Error(`area.json is for ${DATA.area}, AREA.json is ${AREA.id} — run plates/extract_area.mjs`);

// ───────────── the moment and the real sky (sky.js only — nothing typed by hand)
const MOMENT = '2026-11-23T20:30:00Z';
const [lat, lon] = AREA.center_wgs84;
const place = { lat, lon, elevation: 10, tz: 'Asia/Jerusalem' };
const sun = SKY.sunPosition(MOMENT, place), moon = SKY.moonPosition(MOMENT, place), sky = SKY.skyColors(MOMENT, place);
const times = SKY.sunTimes(MOMENT, place), lt = SKY.localTime(MOMENT, place.tz);
const phases = SKY.moonPhases('2026-11-20T00:00:00Z');
const fullLocal = SKY.localTime(phases.fullMoon, place.tz);
const afterSunset = new Date(MOMENT) > new Date(times.sunset);

// Hebrew date with pyluach (after sunset the evening belongs to the next Hebrew day)
const gy = +lt.date_he.split('.')[2], gm = +lt.date_he.split('.')[1], gd = +lt.date_he.split('.')[0];
const heb = JSON.parse(execFileSync('python3', ['-I', '-c', `
import json, sys
from pyluach import dates
g = dates.GregorianDate(${gy}, ${gm}, ${gd})
h = (g + (1 if ${afterSunset ? 'True' : 'False'} else 0)).to_heb()
print(json.dumps({"s": h.hebrew_date_string(), "weekday": g.weekday(), "iso": [h.year, h.month, h.day]}, ensure_ascii=False))
`], { encoding: 'utf8' }));
const hp = heb.s.split(' '); hp[1] = 'ב' + hp[1];
const hebrewDate = (afterSunset ? 'ליל ' : '') + hp.join(' ');
const WEEKDAY = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][heb.weekday];

// moon glitter on the sea: the facet tilt that would send moonlight to this camera (Cox–Munk: >25° is vanishingly rare)
const VIEW = { elevation_deg: 34, camera_az_deg: (AREA.axes.v_az_deg + 180) % 360 };
const d2r = Math.PI / 180, vec = (alt, az) => [Math.cos(alt * d2r) * Math.sin(az * d2r), Math.cos(alt * d2r) * Math.cos(az * d2r), Math.sin(alt * d2r)];
const cam = vec(VIEW.elevation_deg, VIEW.camera_az_deg), mv = vec(moon.alt, moon.az), hv = cam.map((c, i) => c + mv[i]);
const glintTilt = Math.acos(hv[2] / Math.hypot(...hv)) / d2r;
const shadowPerM = 1 / Math.tan(moon.alt * d2r);

// ───────────── kernel tokens used by the page
const R = STYLE.palette.roles, night = k => R[k].night;
const kernel = {
  version: STYLE.version, kernel: STYLE.kernel,
  roles: Object.fromEntries(['ink', 'hairline', 'pearl', 'silver', 'grid', 'region_title', 'city_light', 'sea_surface', 'sea_deep'].map(k => [k, night(k)])),
  focus: { core: STYLE.palette.focus.night.core, glow: STYLE.palette.focus.night.glow, bead: STYLE.palette.focus.night.bead_core },
};

// ───────────── layout (logical 2400×1350; the 8K master is the same page at device scale 3.2)
const W = 2400, H = 1350;
const [U0, U1] = AREA.u_range_m, [V0, V1] = AREA.v_range_m;
const s = 2.56, left = 74;
const sE = Math.sin(VIEW.elevation_deg * d2r), cE = Math.cos(VIEW.elevation_deg * d2r);
const frontY = 96 + (V1 - V0) * sE * s + 33 * cE * s;
const view = { ...VIEW, px_per_m: s, left, frontY };
const slabRight = left + (U1 - U0) * s;

const fmt = (x, d = 1) => x.toFixed(d).replace('-', '−');
const LRI = '⁦', PDI = '⁩';
const ltr = t => LRI + t + PDI;
const deg = (x, d = 1) => ltr(fmt(x, d) + '°'), pm = x => ltr('±' + x), num = x => ltr(String(x));
const tiles = DATA.source.tiles.join(' · ');
const fb = DATA.buildings.find(b => b.id === AREA.focus_suggested.building);
const twins = DATA.buildings.filter(b => b.src === 'P');
const midr = DATA.buildings.find(b => b.id === 'w713054398');
const typical = DATA.buildings.find(b => b.id === 'w543568889');            // a front-row house of the fabric, by id (stable)
const SIG = DATA.buildings.filter(b => b.src === 'R').map(b => b.sigma_m);

const labels = {
  title: 'לוח השראה · לילה',
  place: AREA.name_he,
  coords: `מרכז ${ltr(`${lat.toFixed(4)}°N ${lon.toFixed(4)}°E`)} · אזור ${ltr(`${U1 - U0}×${V1 - V0}`)} מ׳ · מבט מאזימוט ${deg(VIEW.camera_az_deg, 0)}, בזווית ${deg(VIEW.elevation_deg, 0)}`,
  when: `יום ${WEEKDAY} · ${num(lt.date_he)} · ${num(lt.hhmm)} שעון ישראל`,
  heb: hebrewDate,
  dial: [
    { t: `ירח: גובה ${deg(moon.alt)} · אזימוט ${deg(moon.az)}`, w: 500 },
    { t: `מואר ${num((moon.illumination * 100).toFixed(2) + '%')} · מלא ב-${num(fullLocal.date_he.slice(0, 5))} בשעה ${num(fullLocal.hhmm)}`, a: 0.7 },
    { t: `שמש: גובה ${deg(sun.alt)} · אזימוט ${deg(sun.az)}`, w: 500 },
    { t: `מתחת לאופק · שקעה בשעה ${num(SKY.localTime(times.sunset, place.tz).hhmm)}`, a: 0.7 },
    { t: `צל ירח: ${num(shadowPerM.toFixed(3))} × הגובה, לאזימוט ${deg((moon.az + 180) % 360)}`, w: 500 },
    { t: `מגדל של ${num(100)} מ׳ מטיל צל של ${num((100 * shadowPerM).toFixed(1))} מ׳`, a: 0.7 },
    { t: `אין שביל ירח בים: כדי להחזיר את הירח אל`, a: 0.6, size: 11 , gap: 14},
    { t: `המבט הזה נדרש גל בשיפוע ${deg(glintTilt, 0)} — נדיר מאוד (משוער)`, a: 0.6, size: 11 },
    { t: `חלונות דולקים: ${num((sky.windowLightProbability * 100).toFixed(1) + '%')} (עקומת הגרעין לשעה ${num(lt.hhmm)})`, a: 0.7, size: 11 },
  ],
  legend: [
    { k: 'focus', t: 'קו המוקד: קו המתאר של מגדל הדקל המערבי בגובה הקרקע', t2: `OSM ${ltr(fb.id)} · קו מתאר של בניין, לא גבול חלקה רשום` },
    { k: 'sharp', t: 'טביעת רגל מ-OSM (נמדד) — קו חד' },
    { k: 'band', t: 'גובה משוער ±σ: הילה רכה וטבעת מנוקדת בגובה h+σ', t2: `כלל טיפולוגי (R): ${pm(Math.min(...SIG) + '–' + Math.max(...SIG))} מ׳ · מגדלי הדקל (P): ${pm(twins[0].sigma_m)} מ׳` },
    { k: 'shadow', t: 'צל ירח מ-sky.js לגובה h ול-h+σ, על קרקע אופקית' },
    { k: 'contour', t: 'קווי גובה כל מטר (5 ו-10 מ׳ מודגשים)', t2: `${ltr('SRTM 2000')} (${ltr('DSM')}, כולל בנייה של אז) · משוער` },
    { k: 'window', t: 'חלונות: קומות מהנתונים; מיקום והדלקה — סכמטי, לפי זרע' },
    { k: 'lamp', t: 'אור רחוב (נתרן) ורוחב הרחובות — סכמטי (קו המרכז מ-OSM)' },
    { k: 'dash', t: 'קו החוף של הדגימה סינתטי — סכמטי' },
  ],
  sources: [
    { t: 'מקורות ורישיונות', size: 12, w: 500, a: 0.75, gap: 17 },
    { t: `בניינים ורחובות: ${ltr('© OpenStreetMap contributors, ODbL 1.0')}` },
    { t: `דרך אריחי העולם התאום (${ltr('twin-world @' + DATA.source.commit.slice(0, 7))}), נבנו ${ltr(DATA.source.manifest_built_at.slice(0, 10))}` },
    { t: `אריחים ${ltr(tiles)} · ${DATA.stats.buildings} בניינים, ${DATA.stats.cut} חתוכים בשולי האזור` },
    { t: `פני קרקע: ${ltr('SRTM 2000')} (${ltr('NASA/USGS')}, נחלת הכלל), רשת ${num(25)} מ׳` },
    { t: `מסגרת: ${ltr('ITM')} = דגימה + ${ltr('(1507.82, 757.76)')} ${pm('0.56')} מ׳` },
    { t: `שמש, ירח ושמיים: ${ltr('sky.js')} ${STYLE.version}, נבדק מול ${ltr('PyEphem')} · לוח עברי: ${ltr('pyluach')}`, gap: 20 },
    { t: `גרעין סגנון ${STYLE.kernel} · זרע 5787 · ${ltr('night|2026-11-23|22')}`, size: 11.5, fill: STYLE.palette.roles.hairline.night, a: 0.72, w: 500, gap: 15 },
    { t: 'השראה לסוכנים, לא מדידה. אין בלוח זה זכות כלשהי בקרקע האמיתית.', size: 10.5, a: 0.5 },
  ],
  callouts: [
    { id: twins.find(b => b.id !== fb.id).id, at: 'top', dx: 70, dy: -56, lines: [{ t: 'מגדלי הדקל', serif: true, size: 15, fill: kernel.roles.hairline, a: 0.75 }, { t: `${num(twins[0].h_m)} מ׳ ${pm(twins[0].sigma_m)} כל אחד · משוער מתמונות שטח (P)`, size: 11.5 }] },
    { id: midr.id, at: 'top', dx: -60, dy: -34, lines: [{ t: `מגדל המדרחוף · ${num(midr.h_m)} מ׳ ${pm(midr.sigma_m)} (R)`, size: 11.5 }, { t: `טביעת הרגל בנתונים ${Math.round(midr.area_m2)} מ״ר — לבדיקה`, size: 10.5, a: 0.55 }] },
    { id: typical.id, at: 'top', dx: -70, dy: 172, lines: [{ t: `בית טיפוסי: ${num(typical.h_m)} מ׳ ${pm(typical.sigma_m)} · ${num(typical.floors)} קומות (R)`, size: 11.5 }, { t: 'גובה מכלל אצבע — הטבעת המנוקדת היא h+σ', size: 10.5, a: 0.55 }] },
  ],
  sea: { u: -215, v: 350, title: 'הים התיכון', note: 'קו החוף בדגימה סינתטי — סכמטי' },
  section: `חתך פני הקרקע (${ltr('SRTM')}); מתחתיו — סכמטי`,
  roadNames: [{ name: 'הטיילת', at: 45 }, { name: 'שדרות משה דיין', at: 50 }],
  col: { x0: slabRight + 46, x1: W - 34, y0: 40, y1: H - 40 },
  scale: { u: U0 + 30, y: frontY + 14 * cE * s + 44, note: 'קנה מידה לאורך ציר הרוחב (מקביל לחוף)' },
  north: { x: left + 690, y: frontY + 14 * cE * s + 40 },
};

const PLATE = {
  W, H, view, data: DATA, kernel, labels,
  sun: { alt: sun.alt, az: sun.az }, moon: { alt: moon.alt, az: moon.az, illumination: moon.illumination },
  sky: { stops: sky.stops.map(x => x.hex), shadowTint: sky.shadowTint, windowLightProbability: sky.windowLightProbability, streetLight: sky.streetLight, ambient: sky.ambient, phase: sky.phase },
  focus: { building: fb.id },
};

// ───────────── page
fs.mkdirSync(WORK, { recursive: true });
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>render</title>
<link rel="stylesheet" href="../../fonts/fonts.css">
<style>html,body{margin:0;background:${sky.stops[0].hex}}#wrap{position:relative;width:${W}px;height:${H}px;overflow:hidden}
canvas,svg{position:absolute;left:0;top:0;width:${W}px;height:${H}px}</style></head>
<body><div id="wrap"><canvas id="c"></canvas><svg id="t" xmlns="http://www.w3.org/2000/svg"><defs></defs></svg></div>
<script>window.PLATE = ${JSON.stringify(PLATE)};</script>
<script type="module">
import * as SKY from '../../sky.js';
import { draw } from '../../plates/night_scene.js';
window.__errors = [];
try {
  await Promise.all(['300','400','500','700'].flatMap(w => [document.fonts.load(w + ' 20px Heebo', 'אבג 0123'), document.fonts.load(w + ' 20px "Frank Ruhl Libre"', 'אבג 0123')]));
  await draw(window.PLATE, SKY);
} catch (e) { window.__errors.push(String(e && e.stack || e)); }
document.title = 'ready';
</script></body></html>`;
const htmlPath = path.join(WORK, 'night.html');
fs.writeFileSync(htmlPath, html);

async function shoot(scale, out) {
  const t0 = Date.now();
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await p.route('**/*', r => (r.request().url().startsWith('file://') ? r.continue() : r.abort()));
  await p.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 300000 });
  await p.waitForFunction(() => document.title === 'ready', null, { timeout: 600000 });
  const info = await p.evaluate(() => ({ qa: window.__qa, errors: window.__errors, fonts: window.__fonts, focus: window.__focus }));
  await p.locator('#wrap').screenshot({ path: out, timeout: 600000 });
  await b.close();
  return { ...info, logs, seconds: (Date.now() - t0) / 1000 };
}

const out1 = path.join(HERE, 'night.png');
const r1 = await shoot(1, out1);
if (r1.errors?.length || r1.logs.length) console.error(JSON.stringify({ errors: r1.errors, logs: r1.logs }, null, 1));

// brightness budget on the final pixels (text included): kernel rule, tested at 1080 px width (plates/qa_budget.py)
const focusJson = path.join(WORK, 'night.focus.json');
fs.writeFileSync(focusJson, JSON.stringify({ W, H, pts: r1.focus?.pts || [], bead: r1.focus?.bead, radius: r1.focus?.radius }));
const budget = JSON.parse(execFileSync('python3', ['-I', path.join(HERE, 'qa_budget.py'), out1, focusJson], { encoding: 'utf8' }));

let r8 = null;
if (!args.has('--no8k')) {
  const out8 = path.join(HERE, 'night_8k.png');
  r8 = await shoot(3.2, out8);
  if (r8.seconds > 90) console.error(`8K render took ${r8.seconds}s (> 90 s budget)`);
  if (args.has('--crops')) execFileSync('python3', ['-I', '-c', `
from PIL import Image
im = Image.open(${JSON.stringify(out8)})
for name, box in {"towers": (2600, 1560, 4520, 3140), "sea": (300, 300, 2220, 1380), "front": (200, 2700, 2120, 3780), "cartouche": (5800, 120, 7680, 2200), "legend": (5800, 2000, 7680, 4320), "fabric": (3600, 2300, 5520, 3380)}.items():
    im.crop(box).save(${JSON.stringify(WORK)} + "/crop8k_" + name + ".png")
`]);
}

const qa = {
  plate: 'night', moment: MOMENT, local: `${lt.date_he} ${lt.hhmm}`, hebrewDate, area: AREA.id,
  sun: { alt: +sun.alt.toFixed(3), az: +sun.az.toFixed(3) }, moon: { alt: +moon.alt.toFixed(3), az: +moon.az.toFixed(3), illumination: +moon.illumination.toFixed(4) },
  sunset_local: SKY.localTime(times.sunset, place.tz).hhmm, fullMoon_local: `${fullLocal.date_he} ${fullLocal.hhmm}`,
  moonShadow_per_m: +shadowPerM.toFixed(4), glintTilt_deg: +glintTilt.toFixed(1), windowLightProbability: sky.windowLightProbability,
  render: { s2400: r1.seconds, s8k: r8?.seconds ?? null, fonts: r1.fonts, errors: [...(r1.errors || []), ...(r8?.errors || [])], logs: [...r1.logs, ...(r8?.logs || [])] },
  page: r1.qa, budget,
  data: { source: DATA.source, stats: DATA.stats },
};
fs.writeFileSync(path.join(HERE, 'night.qa.json'), JSON.stringify(qa, null, 1));
console.log(JSON.stringify({ out: out1, out8k: r8 ? path.join(HERE, 'night_8k.png') : null, seconds: [r1.seconds, r8?.seconds], fonts: r1.fonts, errors: qa.render.errors, budget, counts: r1.qa?.counts, layout: r1.qa?.layout, colBottom: r1.qa?.colBottom }, null, 1));
