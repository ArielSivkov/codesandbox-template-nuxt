// frustum לכל משימה: אילו בניינים בשדה הראייה (lab/cloud/frustum.js, כולל הסתרה) + "קו רקיע של בניינים":
// לכל פרוסת כיוון של 0.25° – זווית הגג הגבוהה ביותר מעל עין המצלמה (עם גובה קרקע הבניין b.z ומיקום המצלמה האמיתי מהרינדור).
// node frustum_jobs.mjs [--out DIR] [--size 360x800] [--range 3000]
// פלט: <out>/frustum/<size>/<id>.json – compare/fixes משתמשים בו כדי לייחס הפרש בקו הרקיע לבניין מסוים (תיקון גובה).
import fs from 'fs'; import path from 'path'; import zlib from 'zlib'; import { createRequire } from 'module';
import { visible } from '../../../lab/cloud/frustum.js';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname), TWIN = path.resolve(HERE, '../../..');
globalThis.ITM = require(path.join(TWIN, 'integration/world/js/itm.js'));
const OFF = [1507.82, 757.76], D2R = Math.PI / 180;
const A = process.argv.slice(2), opt = k => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : null; };
const OUT = opt('out') || '/home/claude/swarm/photomatch-out', SIZE = opt('size') || '360x800', RANGE = +(opt('range') || 3000);
const TILES = path.join(TWIN, 'integration/world/data/tiles/v');
const cache = new Map();
function tile(key) { if (cache.has(key)) return cache.get(key); const f = path.join(TILES, key + '.json.gz'); const t = fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f))) : null; cache.set(key, t); return t; }
function tilesAround(E, N, R) { const m = new Map(); for (let x = Math.floor((E - R) / 1000); x <= Math.floor((E + R) / 1000); x++) for (let y = Math.floor((N - R) / 1000); y <= Math.floor((N + R) / 1000); y++) { const k = x + '_' + y, t = tile(k); if (t) m.set(k, t); } return m; }
function ring(r, o) { const rr = Array.isArray(r[0]) ? r[0] : r, out = []; let x = o[0], y = o[1]; for (let i = 0; i + 1 < rr.length; i += 2) { x += rr[i] / 10; y += rr[i + 1] / 10; out.push([x, y]); } return out; }

function skylineByBuildings(tiles, cam, hfov, step = 0.25) {
  const nb = Math.ceil(hfov / step), half = hfov / 2, best = new Array(nb).fill(null), nb1 = Math.ceil(hfov), cands = Array.from({ length: nb1 }, () => new Map());
  for (const t of tiles.values()) for (const b of t.b || []) {
    const P = ring(b.r, t.o); let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= P.length; cy /= P.length;
    const dc = Math.hypot(cx - cam.E, cy - cam.N); if (dc > RANGE + 80 || dc < 1) continue;
    const top = b.z / 10 + Math.max(3, b.h / 10);
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length], L = Math.hypot(x2 - x1, y2 - y1), k = Math.max(1, Math.ceil(L / 2));
      for (let j = 0; j <= k; j++) { const x = x1 + (x2 - x1) * j / k, y = y1 + (y2 - y1) * j / k, d = Math.hypot(x - cam.E, y - cam.N); if (d < 1 || d > RANGE) continue;
        let rel = Math.atan2(x - cam.E, y - cam.N) / D2R - cam.heading; rel = ((rel + 540) % 360) - 180; if (rel < -half || rel >= half) continue;
        const s = Math.floor((rel + half) / step), e = Math.atan2(top - cam.Y, d) / D2R;
        const rec = { elev: +e.toFixed(3), id: b.i, name: b.n || '', dist: +d.toFixed(1), top_abs: +top.toFixed(1), h: b.h / 10, base: b.z / 10, floors: b.f || null, area: Math.round(b.a || 0) };
        if (!best[s] || e > best[s].elev) best[s] = rec;
        const s1 = Math.min(nb1 - 1, Math.floor(rel + half)), c = cands[s1].get(b.i); if (!c || d < c.dist) cands[s1].set(b.i, rec); }
    }
  }
  // מועמדים לכל מעלה: כל הבניינים בטווח (עד 30, לפי מרחק) – כי מגבעה כל הבניינים מתחת לעין, ו"הגבוה בזווית" הוא דווקא הרחוק ביותר
  return { slices: best.map((v, s) => Object.assign({ rel_deg: +(-half + (s + 0.5) * step).toFixed(3) }, v || { elev: null })),
           bins_1deg: cands.map((m, s) => ({ rel_from: +(-half + s).toFixed(2), rel_to: +Math.min(half, -half + s + 1).toFixed(2), buildings: [...m.values()].sort((a, b) => a.dist - b.dist).slice(0, 30) })) };
}

const J = JSON.parse(fs.readFileSync(path.join(OUT, 'jobs.json'), 'utf8'));
fs.mkdirSync(path.join(OUT, 'frustum', SIZE), { recursive: true });
for (const job of J.jobs) {
  const mp = path.join(OUT, 'renders', SIZE, job.id + '.json'); if (!fs.existsSync(mp)) continue;
  const meta = JSON.parse(fs.readFileSync(mp, 'utf8')), c = meta.camera;
  const cmpP = path.join(OUT, 'compare', SIZE, job.id + '.json'); const win = fs.existsSync(cmpP) ? JSON.parse(fs.readFileSync(cmpP, 'utf8')).window : null;
  const hfov = win ? win.fov_h_deg : 2 * Math.atan(Math.tan(c.fov_v_deg * D2R / 2) * c.aspect) / D2R;
  const cam = { E: c.itm_real.E - OFF[0], N: c.itm_real.N - OFF[1], heading: c.grid_az_deg, hfov, Y: c.y };
  const tiles = tilesAround(cam.E, cam.N, RANGE);
  const vis = visible(tiles, cam, { range: RANGE });
  // תיקון גובה זוויתי לפי קרקע (frustum.js מניח קרקע שטוחה וגובה עיניים 1.5): גג מוחלט מול עין המצלמה
  const byId = new Map(); for (const t of tiles.values()) for (const b of t.b || []) byId.set(b.i, b);
  for (const v of vis) { const b = byId.get(v.id); if (b) { const top = b.z / 10 + Math.max(3, b.h / 10); v.roof_elev_deg_terrain = +(Math.atan2(top - cam.Y, v.dist_m) / D2R).toFixed(2); v.base_abs = b.z / 10; } }
  const SK = skylineByBuildings(tiles, cam, hfov), sky = SK.slices;
  const res = { id: job.id, size: SIZE, cam: { itm_sample: [cam.E, cam.N], itm_real: c.itm_real, grid_heading: cam.heading, hfov_window_deg: +hfov.toFixed(2), eye_abs_m: c.y }, range_m: RANGE,
    frustum_js: 'twin/lab/cloud/frustum.js visible() – הסתרה לפי כיוון, 0.5°', visible: vis, skyline_by_buildings: sky, candidates_by_degree: SK.bins_1deg,
    note: 'גבהים מהאריחים (b.h, b.z בדצימטרים). מיקום/כיוון המצלמה – מהרינדור בפועל. גבעת יונה: קרקע המצלמה מהתבליט של mapi-bridge (משוער).' };
  fs.writeFileSync(path.join(OUT, 'frustum', SIZE, job.id + '.json'), JSON.stringify(res, null, 1));
  const tall = vis.slice().sort((a, b) => b.map_height_m - a.map_height_m).slice(0, 3).map(v => `${v.id}${v.name ? '(' + v.name + ')' : ''} ${v.map_height_m}m@${v.dist_m}m`);
  console.log(job.id.padEnd(38), 'visible', String(vis.length).padStart(3), 'skyline slices w/ bld', sky.filter(s => s.elev != null).length + '/' + sky.length, '| tallest:', tall.join(', '));
}
