// render_noon.mjs — the noon reference plate for the agents of the living Ashdod (style kernel v0).
//   node plates/render_noon.mjs            → plates/noon.png (2400×1350) + plates/noon_8k.png (7680×4320) + plates/noon.qa.json
//   node plates/render_noon.mjs --no8k     → only the 2400×1350 plate
//   node plates/render_noon.mjs --crops    → also 1:1 crops of both renders into _work/plates/ (for review)
// Moment: Tue 24.11.2026 at TRUE SOLAR NOON over the plate area (sky.js sunTimes().solarNoon — computed, never typed).
// Area: plates/AREA.json (shared with the other plates). Data: plates/data/area.json (extract_area.mjs) and
// plates/data/landcover.json (extract_landcover.mjs), both cut from the twin-world tiles at AREA.source.commit.
// Shadows: exact polygons of the OSM prisms projected along the real sun ray (plates/noon_geom.js) — on the SRTM ground,
// on roofs and on sun-facing walls. Words: Hebrew, SVG only. Deterministic: seededRandom() only; no network.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as SKY from '../sky.js';
import * as G from './noon_geom.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORK = path.join(ROOT, '_work', 'plates');
const args = new Set(process.argv.slice(2));
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);

const AREA = JSON.parse(fs.readFileSync(path.join(HERE, 'AREA.json'), 'utf8'));
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'area.json'), 'utf8'));
const LCJ = path.join(HERE, 'data', 'landcover.json');
if (!fs.existsSync(LCJ)) execFileSync('node', [path.join(HERE, 'extract_landcover.mjs')], { stdio: 'inherit' });
const LC = JSON.parse(fs.readFileSync(LCJ, 'utf8'));
const STYLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'style.json'), 'utf8'));
if (DATA.area !== AREA.id || LC.area !== AREA.id) throw new Error('data files are not for ' + AREA.id);

// ───────────── the moment: true solar noon over the area centre (sky.js)
const [lat, lon] = AREA.center_wgs84;
const place = { lat, lon, elevation: 20, tz: 'Asia/Jerusalem' };
const DAY = '2026-11-24T10:00:00Z';
const times = SKY.sunTimes(DAY, place);
const MOMENT = times.solarNoon.toISOString();
const sun = SKY.sunPosition(MOMENT, place), sky = SKY.skyColors(MOMENT, place), lt = SKY.localTime(MOMENT, place.tz);
const secs = Math.round(lt.s + (new Date(MOMENT).getUTCMilliseconds() / 1000));
const p2 = n => String(n).padStart(2, '0');
const hhmmss = `${p2(lt.h)}:${p2(lt.min + Math.floor(secs / 60))}:${p2(secs % 60)}`;

// grid convergence: ITM (EPSG:2039, central meridian 35.2045169°E) → true north lies at grid azimuth +γ here
const LON0 = 35.2045169444444, d2r = Math.PI / 180;
const dl = (lon - LON0) * d2r, phi = lat * d2r, ep2 = 0.00673949677548, eta2 = ep2 * Math.cos(phi) ** 2;
const gamma = -(dl * Math.sin(phi) * (1 + (dl * dl * Math.cos(phi) ** 2 / 3) * (1 + 3 * eta2 + 2 * eta2 * eta2))) / d2r;
const sunGrid = { altDeg: sun.altApparent, azGridDeg: sun.az + gamma };
const sf = G.sunFrame(sunGrid, DATA.frame);

// Hebrew date (pyluach). The plate is at midday, so the civil date's Hebrew day.
const [gd, gm, gy] = lt.date_he.split('.').map(Number);
const heb = JSON.parse(execFileSync('python3', ['-I', '-c', `
import json
from pyluach import dates
g = dates.GregorianDate(${gy}, ${gm}, ${gd})
h = g.to_heb()
print(json.dumps({"s": h.hebrew_date_string(), "weekday": g.weekday(), "iso": [h.year, h.month, h.day]}, ensure_ascii=False))
`], { encoding: 'utf8' }));
const hp = heb.s.split(' '); hp[1] = 'ב' + hp[1];
const hebrewDate = hp.join(' ');
const WEEKDAY = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][heb.weekday];

// independent check of the transit time and altitude with PyEphem (kernel's reference library)
let ephemCheck = null;
try {
  ephemCheck = JSON.parse(execFileSync('python3', ['-I', '-c', `
import json, ephem, math
o = ephem.Observer(); o.lat, o.lon, o.elevation = '${lat}', '${lon}', 20
o.date = '2026/11/24 00:00:00'; o.pressure = 0
s = ephem.Sun(); t = o.next_transit(s); o.date = t; s.compute(o)
print(json.dumps({"transit_utc": str(ephem.Date(t)), "alt_deg": math.degrees(s.alt), "az_deg": math.degrees(s.az), "ephem": ephem.__version__}))
`], { encoding: 'utf8' }));
} catch (e) { ephemCheck = { error: String(e.message || e).slice(0, 200) }; }

// sun path of the day (for the dial): every 5 minutes from sunrise to sunset; hour marks
const path5 = [];
for (let t = +times.sunrise; t <= +times.sunset + 1; t += 5 * 60000) { const p = SKY.sunPosition(t, place); path5.push([p.az, p.altApparent]); }
{ const p = SKY.sunPosition(times.sunset, place); path5.push([p.az, p.altApparent]); }
const hours = [];
for (let h = 7; h <= 16; h++) {
  const t = new Date(`${DAY.slice(0, 10)}T${p2(h - lt.offsetMinutes / 60)}:00:00Z`);
  const p = SKY.sunPosition(t, place); hours.push({ h, az: p.az, alt: p.altApparent });
}
const rise = SKY.sunPosition(times.sunrise, place), set = SKY.sunPosition(times.sunset, place);

// sun glitter on the sea: the facet tilt that would send the sun to this view (Cox–Munk: > 25° is vanishingly rare)
const VIEW = { elevation_deg: 34, camera_az_deg: (AREA.axes.v_az_deg + 180) % 360 };
const vec = (alt, az) => [Math.cos(alt * d2r) * Math.sin(az * d2r), Math.cos(alt * d2r) * Math.cos(az * d2r), Math.sin(alt * d2r)];
const camTrue = VIEW.camera_az_deg - gamma;                         // the view's azimuth is a grid azimuth
const hv = vec(VIEW.elevation_deg, camTrue).map((c, i) => c + vec(sun.altApparent, sun.az)[i]);
const glintTilt = Math.acos(hv[2] / Math.hypot(...hv)) / d2r;

// ───────────── the focus: the noon line — the shadow of the vertical axis of the west Dekel tower (a gnomon)
const prisms = DATA.buildings.map(G.prism);
const { zAt } = G.terrain(DATA.terrain);
const FOCUS_ID = AREA.focus_suggested.building;                    // w1013192689 — the measured-most building of the area
const gnomon = prisms.find(p => p.id === FOCUS_ID);
const noon = G.gnomonShadow(gnomon, prisms, sf, zAt);
const noonLo = G.gnomonShadow(gnomon, prisms, sf, zAt, gnomon.z1 - gnomon.sig);
const noonHi = G.gnomonShadow(gnomon, prisms, sf, zAt, gnomon.z1 + gnomon.sig);
// elevation along the meridian through the gnomon (for the small diagram under the plate): all from data
const along = p => (p[0] - gnomon.c[0]) * sf.d[0] + (p[1] - gnomon.c[1]) * sf.d[1];
const tExt = [Math.min(...gnomon.ring.map(along)), Math.max(...gnomon.ring.map(along))];
const prof = []; for (let t = Math.floor(tExt[0] - 14); t <= Math.ceil(noonHi.length_m + 16); t += 1) prof.push([t, +zAt(gnomon.c[0] + sf.d[0] * t, gnomon.c[1] + sf.d[1] * t).toFixed(2)]);
const elev = { tExt, z0: gnomon.z0, z1: gnomon.z1, sig: gnomon.sig, prof, tips: [noonLo, noon, noonHi].map(r => [+r.length_m.toFixed(2), +r.tip[2].toFixed(2)]), alt: sun.altApparent };
const meridianErr = Math.abs(Math.atan2(noon.tip[0] - noon.base[0], noon.tip[1] - noon.base[1]) / d2r - Math.atan2(sf.d[0], sf.d[1]) / d2r);

// ───────────── kernel tokens → day tones (light: sky.js shade(); then the engraving's calm compression toward the paper)
const R = STYLE.palette.roles, M = STYLE.materials.items, TX = STYLE.palette.text.onLight, F = STYLE.palette.focus.day;
const sinA = Math.sin(sun.altApparent * d2r), cosA = Math.cos(sun.altApparent * d2r);
// Tone map (style): displayed = paper × (raw ÷ lit plaster)^γ in linear light. It compresses the light model's range so the
// plate stays calm (kernel day budget), and keeps every surface's hue ratio — the cool blue of the shade, the warm of the sand.
const PAPER = M.plaster.lit;                                         // the city's lit white plaster is the paper
const REF = SKY.shade(M.plaster.base, sky, { facing: sinA });        // raw light-model colour of lit plaster, horizontal
const lin = hex => SKY.hexToRgb(hex).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
const enc = c => SKY.rgbToHex(c.map(v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const GAMMA = { surface: 0.22, sand: 0.4, sea: 0.15, road: 0.06, section: 0.18 };
const tmap = (raw, g) => { const r = lin(raw), f = lin(REF), p = lin(PAPER); return enc(r.map((v, i) => Math.min(1, p[i] * Math.max(1e-4, v / f[i]) ** g))); };
const mats = {
  plaster: M.plaster.base, roof: SKY.mixHex(M.plaster.base, M.roof_flat.base, 0.5), sand: M.sand.base, asphalt: M.asphalt.base,
  olive: M.greenery.olive, dryGrass: M.greenery.dryGrass, kurkar: M.kurkar.base,
};
const lit = b => SKY.shade(b, sky, { facing: sinA }), dark = b => SKY.shade(b, sky, { inShadow: true });
const shadeRatio = enc(lin(dark(mats.plaster)).map((v, i) => (v / lin(lit(mats.plaster))[i]) ** GAMMA.surface));   // multiply colour for the ground
const C = {
  paper: PAPER, ink: R.ink.day, hairline: R.hairline.day, region: R.region_title.day, silver: R.silver.day, grid: R.grid.day, pearl: R.pearl.day,
  groundUrban: PAPER,                                                // ground cover unknown → plain paper (texture only)
  groundSand: SKY.mixHex(PAPER, tmap(lit(mats.sand), GAMMA.sand), 0.7),
  groundGreen: PAPER,                                                // estimated green cover: texture (dots) only, no tint
  groundShadow: tmap(dark(mats.plaster), GAMMA.surface), mulGround: shadeRatio,
  road: tmap(lit(mats.asphalt), GAMMA.road),
  seaNear: tmap(M.sea.day_nearshore, GAMMA.sea), seaFar: tmap(M.sea.day_surface, GAMMA.sea), foam: M.sea.foam,
  section: tmap(dark(mats.kurkar), GAMMA.section),
  focusFill: F.fill, focusEdge: F.edge, text: TX,
};
const tone = { wallBase: mats.plaster, roofBase: mats.roof, ref: REF, paper: PAPER, gamma: GAMMA.surface };

// ───────────── layout (logical 2400×1350; the 8K master is the same page at device scale 3.2)
const W = 2400, H = 1350;
const [U0, U1] = AREA.u_range_m, [V0, V1] = AREA.v_range_m;
const s = 2.85, left = 56;
const sE = Math.sin(VIEW.elevation_deg * d2r), cE = Math.cos(VIEW.elevation_deg * d2r);
const frontY = 84 + (V1 - V0) * sE * s;
const view = { ...VIEW, px_per_m: s, left, frontY };
const slabRight = left + (U1 - U0) * s;

const fmt = (x, d = 1) => x.toFixed(d).replace('-', '−');
const LRI = '⁦', PDI = '⁩';
const ltr = t => LRI + t + PDI;
const deg = (x, d = 1) => ltr(fmt(x, d) + '°'), pm = x => ltr('±' + x), num = x => ltr(String(x));
const tiles = DATA.source.tiles.join(' · ');
const twins = prisms.filter(p => p.b.src === 'P');
const other = twins.find(p => p.id !== FOCUS_ID);
const midr = prisms.find(p => p.id === 'w713054398');
const typical = prisms.find(p => p.id === 'w543568889');
const SIG = DATA.buildings.filter(b => b.src === 'R').map(b => b.sigma_m);
const Lh = noon.length_m, Llo = noonLo.length_m, Lhi = noonHi.length_m;
const dayLen = times.dayLengthMinutes;

const labels = {
  title: 'לוח השראה · צהריים',
  place: AREA.name_he,
  coords: `מרכז ${ltr(`${lat.toFixed(4)}°N ${lon.toFixed(4)}°E`)} · אזור ${ltr(`${U1 - U0}×${V1 - V0}`)} מ׳ · מבט מאזימוט ${deg(VIEW.camera_az_deg, 0)}, בזווית ${deg(VIEW.elevation_deg, 0)}`,
  when: `יום ${WEEKDAY} · ${num(lt.date_he)} · ${num(hhmmss)} שעון ישראל`,
  heb: hebrewDate,
  noonNote: 'חצות היום האמיתית באזור: השמש על קו האורך',
  sunLines: [
    { t: `שמש: גובה ${deg(sun.altApparent, 2)} (נראה) · אזימוט ${deg(sun.az, 1)}`, w: 500 },
    { t: `צל: ${num((1 / Math.tan(sun.altApparent * d2r)).toFixed(3))} × הגובה, לצפון האמיתי (ברשת ${ltr('ITM')}: ${deg(gamma, 2)})`, a: 0.8 },
    { t: `זריחה ${num(times.local.sunrise)} · שקיעה ${num(times.local.sunset)} · אורך היום ${num(`${Math.floor(dayLen / 60)}:${p2(Math.round(dayLen % 60))}`)} שע׳`, a: 0.8 },
    { t: `אין נצנוץ שמש בים במבט הזה: נדרש גל בשיפוע ${deg(glintTilt, 0)} (משוער)`, a: 0.62, size: 11 },
  ],
  focus: {
    title: 'קו הצהריים',
    sub: `${num(hhmmss)} · צל ציר מגדל הדקל המערבי מצביע לצפון האמיתי`,
    sub2: `${num(Math.round(Lh))} מ׳ ${pm(Math.round(Math.max(Lh - Llo, Lhi - Lh)))} על הקרקע (${ltr(Math.round(Llo) + '–' + Math.round(Lhi))} לגובה ${num(gnomon.b.h_m)} מ׳ ${pm(gnomon.sig)})`,   // whole metres: the height is ±8 m
  },
  legend: [
    { k: 'focus', t: 'קו הצהריים: הצל של ציר המגדל (שעון שמש)', t2: `${ltr('OSM ' + FOCUS_ID)} · מרכז טביעת הרגל · הקו המקווקו: ${pm(gnomon.sig)} מ׳ בגובה` },
    { k: 'sharp', t: 'טביעת רגל מ-OSM (נמדד) — קו חד' },
    { k: 'band', t: 'גובה ±σ: רצועה חיוורת וקו מנוקד בגובה h+σ', t2: `כלל טיפולוגי (R): ${pm(Math.min(...SIG) + '–' + Math.max(...SIG))} מ׳ · מגדלי הדקל (P): ${pm(twins[0].sig)} מ׳` },
    { k: 'shadow', t: 'צל שמש מ-sky.js לגובה h, מדויק לגאומטריה (חריטה ב-45°)', t2: 'על פני הקרקע, על גגות ועל קירות שפונים לשמש · הילה חיוורת עד h+σ' },
    { k: 'contour', t: 'קווי גובה כל מטר (5 ו-10 מ׳ מודגשים)', t2: `${ltr('SRTM 2000')} (${ltr('DSM')}, כולל בנייה של אז) · משוער` },
    { k: 'cover', t: 'כיסוי קרקע: חוף, חולית, פארק, גינה — משוער', t2: 'מחלקת הצמחייה של העולם התאום · עצים בודדים לא צוירו (פרוצדורליים)' },
    { k: 'floors', t: 'קווי קומה: מספר הקומות מהנתונים, הגובה שלהן סכמטי' },
    { k: 'road', t: 'רחובות: קו מרכז מ-OSM; רוחב לפי סוג — סכמטי' },
    { k: 'dash', t: 'קו החוף של הדגימה סינתטי — סכמטי' },
  ],
  sources: [
    { t: 'מקורות ורישיונות', size: 12, w: 500, a: 0.8, gap: 17 },
    { t: `בניינים ורחובות: ${ltr('© OpenStreetMap contributors, ODbL 1.0')}` },
    { t: `דרך אריחי העולם התאום (${ltr('twin-world @' + DATA.source.commit.slice(0, 7))}), נבנו ${ltr(DATA.source.manifest_built_at.slice(0, 10))}` },
    { t: `אריחים ${ltr(tiles)} · ${DATA.stats.buildings} בניינים, ${DATA.stats.cut} חתוכים בשולי האזור` },
    { t: `כיסוי קרקע: ${ltr('tiles/g')} של מחלקת הצמחייה (אותם אריחים) · משוער` },
    { t: `פני קרקע: ${ltr('SRTM 2000')} (${ltr('NASA/USGS')}, נחלת הכלל), רשת ${num(25)} מ׳` },
    { t: `מסגרת: ${ltr('ITM')} = דגימה + ${ltr('(1507.82, 757.76)')} ${pm('0.56')} מ׳ · צפון אמיתי ${deg(gamma, 2)} מצפון הרשת` },
    { t: `שמש ושמיים: ${ltr('sky.js')} ${STYLE.version}, נבדק מול ${ltr('PyEphem')} · לוח עברי: ${ltr('pyluach')}`, gap: 20 },
    { t: `גרעין סגנון ${STYLE.kernel} · זרע 5787 · ${ltr('noon|2026-11-24|11')}`, size: 11.5, fill: C.hairline, a: 0.95, w: 500, gap: 15 },
    { t: 'גוונים, חריטה וחומרים — סגנון הגרעין: השראה, לא מדידה.', size: 10.5, a: 0.62, gap: 13 },
    { t: 'לוח השראה לסוכנים. אין בלוח זה זכות כלשהי בקרקע האמיתית.', size: 10.5, a: 0.62 },
  ],
  callouts: [
    { id: other.id, lines: [{ t: 'מגדלי הדקל', serif: true, size: 15, fill: C.region, a: 1 }, { t: `${num(other.b.h_m)} מ׳ ${pm(other.sig)} כל אחד · משוער מתמונות שטח (P)`, size: 11.5 }] },
    { id: midr.id, lines: [{ t: `מגדל המדרחוף · ${num(midr.b.h_m)} מ׳ ${pm(midr.sig)} (R)`, size: 11.5 }, { t: `טביעת הרגל בנתונים ${Math.round(midr.b.area_m2)} מ״ר — לבדיקה`, size: 10.5, a: 0.62 }] },
    { id: typical.id, lines: [{ t: `בית טיפוסי: ${num(typical.b.h_m)} מ׳ ${pm(typical.sig)} · ${num(typical.b.floors)} קומות (R)`, size: 11.5 }, { t: 'גובה מכלל אצבע — הקו המנוקד הוא h+σ', size: 10.5, a: 0.62 }] },
  ],
  sea: { u: -215, v: 392, title: 'הים התיכון', note: 'קו החוף בדגימה סינתטי — סכמטי' },
  section: `חתך פני הקרקע (${ltr('SRTM')}, מ׳ מעל הים); מתחתיו — סכמטי`,
  scale: { note: 'קנה מידה לאורך ציר הרוחב (מקביל לחוף)' },
  north: { t: 'צפון אמיתי', t2: 'בצהריים האמיתיים — גם כיוון כל הצללים' },
  roadNames: ['הטיילת', 'שדרות משה דיין', 'יצחק נשיא'],
  col: { x0: slabRight + 50, x1: W - 46, y0: 52, y1: H - 46 },
};

const PLATE = {
  W, H, view, data: DATA, landcover: { cls: LC.cls, est: LC.est }, labels, C, tone,
  sun: { alt: sun.alt, altApparent: sun.altApparent, az: sun.az, azGrid: sunGrid.azGridDeg, gamma },
  sky: { stops: sky.stops.map(x => x.hex), shadowTint: sky.shadowTint, ambient: sky.ambient, sunLight: sky.sunLight, weights: sky.weights, streetLight: sky.streetLight },
  dial: { path: path5, hours, noon: { az: sun.az, alt: sun.altApparent, local: hhmmss.slice(0, 5) }, rise: { az: rise.az, local: times.local.sunrise }, set: { az: set.az, local: times.local.sunset } },
  focus: { building: FOCUS_ID, pieces: noon.pieces, tip: noon.tip, tipLo: noonLo.tip, tipHi: noonHi.tip, base: noon.base },
  seedKey: 'noon|2026-11-24|11',
  elev,
  layout: { focusLabel: [44, -118], typical: [-70, 'below'] },  // label offsets in px (composition only)
};

// ───────────── page
fs.mkdirSync(WORK, { recursive: true });
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>render</title>
<link rel="stylesheet" href="../../fonts/fonts.css">
<style>html,body{margin:0;background:${PAPER}}#wrap{position:relative;width:${W}px;height:${H}px;overflow:hidden}
canvas,svg{position:absolute;left:0;top:0;width:${W}px;height:${H}px}</style></head>
<body><div id="wrap"><canvas id="c"></canvas><svg id="t" xmlns="http://www.w3.org/2000/svg"><defs></defs></svg></div>
<script>window.PLATE = ${JSON.stringify(PLATE)};</script>
<script type="module">
import * as SKY from '../../sky.js';
import * as GEO from '../../plates/noon_geom.js';
import { draw } from '../../plates/noon_scene.js';
window.__errors = [];
try {
  await Promise.all(['300','400','500','700'].flatMap(w => [document.fonts.load(w + ' 20px Heebo', 'אבג 0123'), document.fonts.load(w + ' 20px "Frank Ruhl Libre"', 'אבג 0123')]));
  await draw(window.PLATE, SKY, GEO);
} catch (e) { window.__errors.push(String(e && e.stack || e)); }
document.title = 'ready';
</script></body></html>`;
const htmlPath = path.join(WORK, 'noon.html');
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

const out1 = path.join(HERE, 'noon.png');
const r1 = await shoot(1, out1);
if (r1.errors?.length || r1.logs.length) console.error(JSON.stringify({ errors: r1.errors, logs: r1.logs }, null, 1));

// the kernel's DAY budget on the final pixels (text included), tested at 1080 px width: local contrast |Y − Y(paper)|
const focusJson = path.join(WORK, 'noon.focus.json');
fs.writeFileSync(focusJson, JSON.stringify({ W, H, pts: r1.focus?.pts || [], bead: r1.focus?.bead, radius: r1.focus?.radius, boxes: r1.focus?.boxes || [], words: r1.focus?.words || [], keys: r1.focus?.keys || [], column: [labels.col.x0 - 30, 0, W - labels.col.x0 + 30, H], background: PAPER }));
const budget = JSON.parse(execFileSync('python3', ['-I', path.join(HERE, 'qa_noon.py'), out1, focusJson], { encoding: 'utf8' }));

let r8 = null;
if (!args.has('--no8k')) {
  const out8 = path.join(HERE, 'noon_8k.png');
  r8 = await shoot(3.2, out8);
  if (r8.seconds > 90) console.error(`8K render took ${r8.seconds}s (> 90 s budget)`);
}
if (args.has('--crops')) execFileSync('python3', ['-I', '-c', `
import os
from PIL import Image
W = ${JSON.stringify(WORK)}
im = Image.open(${JSON.stringify(out1)})
for name, box in {"focus": (900, 520, 1560, 900), "fabricL": (60, 560, 760, 1000), "sea": (60, 60, 900, 420), "col": (1780, 0, 2400, 1350), "front": (60, 950, 1800, 1350)}.items():
    im.crop(box).save(W + "/noon_crop_" + name + ".png")
p8 = ${JSON.stringify(path.join(HERE, 'noon_8k.png'))}
if os.path.exists(p8):
    im = Image.open(p8)
    for name, box in {"towers": (2900, 1500, 4820, 3080), "focus": (3500, 2100, 5420, 3180), "col": (5780, 120, 7680, 2200), "fabric": (400, 2200, 2320, 3280)}.items():
        im.crop(box).save(W + "/noon8k_crop_" + name + ".png")
`]);

// lossless re-compression (PIL optimize): same pixels, fewer bytes
const pngs = [out1, ...(r8 ? [path.join(HERE, 'noon_8k.png')] : [])];
execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nfor p in sys.argv[1:]:\n    im = Image.open(p); im.load(); im.save(p, optimize=True)', ...pngs]);

const qa = {
  plate: 'noon', moment: MOMENT, local: `${lt.date_he} ${hhmmss}`, hebrewDate, weekday: WEEKDAY, area: AREA.id,
  sun: { alt: +sun.alt.toFixed(4), altApparent: +sun.altApparent.toFixed(4), az: +sun.az.toFixed(4), azGrid: +sunGrid.azGridDeg.toFixed(4), hourAngle: sun.hourAngle },
  gridConvergence_deg: +gamma.toFixed(4),
  ephemCheck,
  shadow: { per_m: +(1 / Math.tan(sun.altApparent * d2r)).toFixed(4), toward_true_az: 0, toward_grid_az: +gamma.toFixed(4), dir_uv: sf.d.map(x => +x.toFixed(5)) },
  noonLine: {
    gnomon: FOCUS_ID, base_uv: noon.base.map(x => +x.toFixed(2)), tip_uvz: noon.tip.map(x => +x.toFixed(2)), on: noon.tipOn, length_m: +Lh.toFixed(2),
    length_lo_m: +Llo.toFixed(2), length_hi_m: +Lhi.toFixed(2), height_m: gnomon.b.h_m, sigma_m: gnomon.sig, azimuth_error_deg: +meridianErr.toExponential(2),
  },
  times_local: times.local, dayLength_min: +dayLen.toFixed(1), glintTilt_deg: +glintTilt.toFixed(1),
  tones: { paper: PAPER, ref: REF, gamma: GAMMA, C },
  render: { s2400: r1.seconds, s8k: r8?.seconds ?? null, fonts: r1.fonts, errors: [...(r1.errors || []), ...(r8?.errors || [])], logs: [...r1.logs, ...(r8?.logs || [])] },
  page: r1.qa, budget,
  data: {
    area_json: { file: 'plates/data/area.json', source: DATA.source, stats: DATA.stats },
    landcover_json: { file: 'plates/data/landcover.json', source: LC.source, counts: LC.counts },
    note: 'tiles and manifest are byte-identical at twin-world 735c5ff (checked with git diff on 24.11.2026)',
  },
};
fs.writeFileSync(path.join(HERE, 'noon.qa.json'), JSON.stringify(qa, null, 1));
console.log(JSON.stringify({ out: out1, out8k: r8 ? path.join(HERE, 'noon_8k.png') : null, seconds: [r1.seconds, r8?.seconds], fonts: r1.fonts, errors: qa.render.errors, budget, noonLine: qa.noonLine, ephemCheck, counts: r1.qa?.counts, layout: r1.qa?.layout }, null, 1));
