// extract_landcover.mjs — cut the twin's land-cover layer (vegetation department, tiles/g) for the plate area into
// plates/data/landcover.json, on the same 10 m (u, v) grid as plates/data/area.json → terrain.
//   node plates/extract_landcover.mjs [--ref=<git ref of twin-world>] [--repo=<repo dir>]
// Nothing is invented: every cell copies the class of the 10 m land-cover cell under its centre, with the tile's own
// "estimated" bit (0x80). In this area every land class is flagged estimated by the twin; the sea cells are not.
// The twin's individual plants (layer "t") are NOT copied: here they are all procedural (src 3 = estimated street slot,
// src 5 = procedural in estimated cover), so drawing them would add invented detail.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const AREA = JSON.parse(fs.readFileSync(path.join(HERE, 'AREA.json'), 'utf8'));
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'area.json'), 'utf8'));
const REPO = path.resolve(args.repo || path.join(HERE, '..', '..'));
const REF = args.ref || AREA.source.commit;
const GDIR = 'twin/integration/world/mods/vegetation/data/tiles/g';
const gitShow = p => execFileSync('git', ['-C', REPO, 'show', `${REF}:${p}`], { maxBuffer: 64 << 20 });

const D2R = Math.PI / 180, [CX, CY] = AREA.center_sample;
const UD = [Math.sin(AREA.axes.u_az_deg * D2R), Math.cos(AREA.axes.u_az_deg * D2R)], VD = [Math.sin(AREA.axes.v_az_deg * D2R), Math.cos(AREA.axes.v_az_deg * D2R)];
const toEN = (u, v) => [CX + u * UD[0] + v * VD[0], CY + u * UD[1] + v * VD[1]];
const T = DATA.terrain;

const tiles = {}, used = [];
for (const k of AREA.source.tiles) {
  const p = `${GDIR}/${k}.json.gz`;
  const g = JSON.parse(zlib.gunzipSync(gitShow(p)).toString('utf8'));
  tiles[k] = { ox: g.o[0], oy: g.o[1], step: g.lc_step || 10, lc: Buffer.from(g.lc, 'base64'), stats: g.stats };
  used.push(p);
}
const cls = [], est = [];
const counts = {};
for (let j = 0; j < T.nv; j++) for (let i = 0; i < T.nu; i++) {
  const [E, N] = toEN(T.u0 + i * T.grid_m, T.v0 + j * T.grid_m), k = `${Math.floor(E / 1000)}_${Math.floor(N / 1000)}`, t = tiles[k];
  if (!t) { cls.push(null); est.push(null); continue; }
  const n = Math.round(1000 / t.step), c = Math.min(n - 1, Math.floor((E - t.ox) / t.step)), r = Math.min(n - 1, Math.floor((t.oy + 1000 - N) / t.step));
  const b = t.lc[r * n + c];
  cls.push(b & 0x7f); est.push(b & 0x80 ? 1 : 0);
  const key = `${b & 0x7f}${b & 0x80 ? 'e' : ''}`; counts[key] = (counts[key] || 0) + 1;
}
const out = {
  v: 1, area: AREA.id, generated_by: 'style-kernel/plates/extract_landcover.mjs',
  source: { repo_branch: AREA.source.repo_branch, commit: REF, files: used, contract: 'twin/vegetation/README.txt (tiles/g: lc 100×100 uint8, row 0 = north, class | 0x80 = estimated)' },
  classes_he: ['עירוני / לא ידוע', 'מדשאה', 'פארק', 'חורש', 'בתה', 'חול', 'חוף', 'חולית מיוצבת', 'שדה', 'מטע', 'בית עלמין', 'מגרש ספורט', 'גינה / חצר', 'שטח פתוח / אחו', 'ים', 'חולית נודדת'],
  grid: { grid_m: T.grid_m, nu: T.nu, nv: T.nv, u0: T.u0, v0: T.v0, order: T.order, sample: 'class of the 10 m land-cover cell under each grid node' },
  cls, est, counts,
  note_he: 'כיסוי הקרקע של מחלקת הצמחייה בעולם התאום. כל מחלקות היבשה באזור מסומנות שם "משוער"; הים לא. הצמחים הבודדים (שכבה t) לא הועתקו — כאן כולם פרוצדורליים.',
};
fs.mkdirSync(path.join(HERE, 'data'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'data', 'landcover.json'), JSON.stringify(out));
console.log(JSON.stringify({ out: 'plates/data/landcover.json', ref: REF, counts }));
