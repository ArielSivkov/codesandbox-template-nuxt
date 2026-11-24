// extract_area.mjs — cut the plate area (plates/AREA.json) out of the twin-world tiles into plates/data/area.json.
//   node plates/extract_area.mjs [--ref=<git ref of twin-world>] [--repo=<repo dir>]
// Reads ONLY the twin's own data contract (twin/integration/world/data/tiles/{v,t}, EPSG:2039 sample frame).
// Nothing is invented here: every number in area.json is copied or resampled from those tiles, and the record says which.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const AREA = JSON.parse(fs.readFileSync(path.join(HERE, 'AREA.json'), 'utf8'));
const REPO = path.resolve(args.repo || path.join(HERE, '..', '..'));
const REF = args.ref || AREA.source.commit;
const TDIR = AREA.source.tilesPath;               // twin/integration/world/data/tiles
const SEA = -32768, OUTSIDE = -32767;

const gitShow = p => execFileSync('git', ['-C', REPO, 'show', `${REF}:${p}`], { maxBuffer: 64 << 20 });
const manifest = JSON.parse(gitShow(AREA.source.manifest).toString('utf8'));

// ---------- area frame: u along az U_AZ (screen right), v along az U_AZ − 90 (away from the camera)
const D2R = Math.PI / 180;
const [CX, CY] = AREA.center_sample;
const uAz = AREA.axes.u_az_deg * D2R, vAz = AREA.axes.v_az_deg * D2R;
const UD = [Math.sin(uAz), Math.cos(uAz)], VD = [Math.sin(vAz), Math.cos(vAz)];
const [U0, U1] = AREA.u_range_m, [V0, V1] = AREA.v_range_m;
const toUV = (E, N) => { const dx = E - CX, dy = N - CY; return [dx * UD[0] + dy * UD[1], dx * VD[0] + dy * VD[1]]; };
const toEN = (u, v) => [CX + u * UD[0] + v * VD[0], CY + u * UD[1] + v * VD[1]];
const r1 = x => Math.round(x * 10) / 10;

// ---------- which 1 km tiles touch the area
const corners = [[U0, V0], [U1, V0], [U1, V1], [U0, V1]].map(([u, v]) => toEN(u, v));
const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
const keys = [];
for (let tx = Math.floor(Math.min(...xs) / 1000); tx <= Math.floor(Math.max(...xs) / 1000); tx++)
  for (let ty = Math.floor(Math.min(...ys) / 1000); ty <= Math.floor(Math.max(...ys) / 1000); ty++)
    if (manifest.tiles.includes(`${tx}_${ty}`)) keys.push(`${tx}_${ty}`);

// ---------- decode
const decRing = (r, ox, oy) => { const out = []; let x = ox, y = oy; for (let i = 0; i < r.length; i += 2) { x += r[i] / 10; y += r[i + 1] / 10; out.push([x, y]); } return out; };
const vt = {}, tt = {};
for (const k of keys) {
  vt[k] = JSON.parse(zlib.gunzipSync(gitShow(`${TDIR}/v/${k}.json.gz`)).toString('utf8'));
  const b = zlib.gunzipSync(gitShow(`${TDIR}/t/${k}.bin.gz`));
  const NT = b.readUInt16LE(14), NM = b.readUInt16LE(16), step = b.readUInt16LE(18);
  const z = new Int16Array(NT * NT); for (let i = 0; i < NT * NT; i++) z[i] = b.readInt16LE(20 + i * 2);
  const mb = b.subarray(20 + NT * NT * 2), mask = new Uint8Array(NM * NM);
  for (let i = 0; i < NM * NM; i++) mask[i] = (mb[i >> 3] >> (7 - (i & 7))) & 1;     // np.packbits: MSB first
  const [tx, ty] = k.split('_').map(Number);
  tt[k] = { tx, ty, NT, NM, step, z, mask, magic: b.subarray(0, 4).toString() };
}

// ---------- terrain (25 m nodes, row 0 = north) and land mask (10 m cells, row 0 = north)
function terrainNode(E, N) {                 // nearest-tile node lookup → metres | 'sea' | null
  const k = `${Math.floor(E / 1000)}_${Math.floor(N / 1000)}`, t = tt[k]; if (!t) return null;
  const col = Math.round((E - t.tx * 1000) / t.step), row = Math.round(((t.ty + 1) * 1000 - N) / t.step);
  const q = t.z[Math.max(0, Math.min(t.NT - 1, row)) * t.NT + Math.max(0, Math.min(t.NT - 1, col))];
  return q === SEA ? 'sea' : q === OUTSIDE ? null : q / 10;
}
function zAt(E, N) {                          // bilinear on the 25 m node grid; sea nodes count as 0 m
  const k = `${Math.floor(E / 1000)}_${Math.floor(N / 1000)}`, t = tt[k]; if (!t) return null;
  const fx = (E - t.tx * 1000) / t.step, fy = ((t.ty + 1) * 1000 - N) / t.step;
  const c0 = Math.min(t.NT - 2, Math.floor(fx)), r0 = Math.min(t.NT - 2, Math.floor(fy)), ax = fx - c0, ay = fy - r0;
  const val = (r, c) => { const q = t.z[r * t.NT + c]; return q === SEA ? 0 : q === OUTSIDE ? NaN : q / 10; };
  const v = (1 - ay) * ((1 - ax) * val(r0, c0) + ax * val(r0, c0 + 1)) + ay * ((1 - ax) * val(r0 + 1, c0) + ax * val(r0 + 1, c0 + 1));
  return Number.isFinite(v) ? v : null;
}
function landAt(E, N) {
  const k = `${Math.floor(E / 1000)}_${Math.floor(N / 1000)}`, t = tt[k]; if (!t) return null;
  const c = Math.floor((E - t.tx * 1000) / 10), r = Math.floor(((t.ty + 1) * 1000 - N) / 10);
  return t.mask[Math.max(0, Math.min(t.NM - 1, r)) * t.NM + Math.max(0, Math.min(t.NM - 1, c))] === 1;
}
const GS = AREA.extract.grid_m;
const NU = Math.round((U1 - U0) / GS) + 1, NV = Math.round((V1 - V0) / GS) + 1;
const gridZ = [], gridLand = [];
for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
  const [E, N] = toEN(U0 + i * GS, V0 + j * GS);
  const z = zAt(E, N); gridZ.push(z == null ? null : r1(z)); gridLand.push(landAt(E, N) ? 1 : 0);
}

// ---------- clipping to the convex area rectangle (in u,v)
const inside = (p, e) => e === 0 ? p[1] >= V0 : e === 1 ? p[0] <= U1 : e === 2 ? p[1] <= V1 : p[0] >= U0;
const cross = (a, b, e) => {
  const t = e === 0 ? (V0 - a[1]) / (b[1] - a[1]) : e === 1 ? (U1 - a[0]) / (b[0] - a[0]) : e === 2 ? (V1 - a[1]) / (b[1] - a[1]) : (U0 - a[0]) / (b[0] - a[0]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};
function clipPoly(pts) {                      // Sutherland–Hodgman
  let out = pts;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b, e)) { if (!inside(a, e)) out.push(cross(a, b, e)); out.push(b); } else if (inside(a, e)) out.push(cross(a, b, e));
    }
  }
  return out;
}
function clipLine(pts) {                      // Liang–Barsky per segment, joined into runs
  const runs = []; let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, x0 - U0], [dx, U1 - x0], [-dy, y0 - V0], [dy, V1 - y0]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p; if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const a = [x0 + dx * t0, y0 + dy * t0], b = [x0 + dx * t1, y0 + dy * t1];
    if (!cur || t0 > 0) { cur = [a]; runs.push(cur); }
    cur.push(b); if (t1 < 1) cur = null;
  }
  return runs.filter(r => r.length > 1);
}
const area2 = p => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

const buildings = [], roads = [], sea = [];
const CONF = ['מאומת', 'גבוה', 'בינוני', 'נמוך'];
for (const k of keys) {
  const j = vt[k], [ox, oy] = j.o;
  for (const b of j.b) {
    const ring = decRing(b.r[0], ox, oy).map(([E, N]) => toUV(E, N));
    const cut = clipPoly(ring);
    if (cut.length < 3 || Math.abs(area2(cut)) < 2) continue;
    const wasCut = Math.abs(Math.abs(area2(cut)) - Math.abs(area2(ring))) > 0.5;
    buildings.push({ id: b.i, tile: k, name: b.n || '', type: b.t || '', area_m2: b.a, base_m: b.z / 10, h_m: b.h / 10, sigma_m: b.s / 10,
      floors: b.f, floors_lo: b.fl, floors_hi: b.fh, src: b.src, used: b.u, conf: CONF[b.c] ?? String(b.c), cut: wasCut,
      ring_uv: cut.map(p => [r1(p[0]), r1(p[1])]) });
  }
  for (const r of j.rd || []) for (const run of clipLine(decRing(r.r, ox, oy).map(([E, N]) => toUV(E, N))))
    roads.push({ cls: r.c, name: r.n || '', tile: k, line_uv: run.map(p => [r1(p[0]), r1(p[1])]) });
  for (const s of j.sea || []) {
    const c = clipPoly(decRing(s[0], ox, oy).map(([E, N]) => toUV(E, N)));
    if (c.length >= 3 && Math.abs(area2(c)) > 1) sea.push({ tile: k, ring_uv: c.map(p => [r1(p[0]), r1(p[1])]) });
  }
}
buildings.sort((a, b) => (a.id < b.id ? -1 : 1));

const out = {
  v: 1,
  area: AREA.id,
  generated_by: 'style-kernel/plates/extract_area.mjs',
  source: { repo_branch: 'twin-world', commit: REF, tiles_path: TDIR, tiles: keys, manifest: AREA.source.manifest,
    manifest_built_at: manifest.built_at, manifest_sources: manifest.sources, manifest_attribution: manifest.attribution,
    manifest_sigma_m: manifest.sigma_m, crs: manifest.crs + ' (sample frame: real ITM = sample + offset)' },
  licence_he: 'נגזר מ-OpenStreetMap — © OpenStreetMap contributors, ODbL 1.0. פני קרקע: SRTM (2000, DSM, נחלת הכלל). קו החוף בדגימה סינתטי.',
  frame: { center_sample: AREA.center_sample, u_az_deg: AREA.axes.u_az_deg, v_az_deg: AREA.axes.v_az_deg, u_range_m: AREA.u_range_m, v_range_m: AREA.v_range_m },
  terrain: { grid_m: GS, nu: NU, nv: NV, u0: U0, v0: V0, order: 'row-major, j (v) outer, i (u) inner', z_m: gridZ, land: gridLand,
    note_he: 'גובה פני קרקע מ-SRTM 2000 (DSM) ברשת 25 מ׳, דגימה בילינארית ל-' + GS + ' מ׳. DSM כולל בניינים וצמחייה של 2000 — משוער.' },
  buildings, roads, sea,
  city: { name_he: manifest.name_he, boundary_kind: manifest.boundary_kind, bbox_sample: manifest.bbox_itm,
    note_he: 'גבול העיר בדגימה הוא משוער (estimated_from_buildings), לאיתור בלבד. טבעות חיצוניות, קואורדינטות דגימה במטרים.',
    outer_rings_sample: (manifest.boundary || []).map(poly => decRing(poly[0], 0, 0).map(([x, y]) => [Math.round(x), Math.round(y)])) },
  stats: { buildings: buildings.length, cut: buildings.filter(b => b.cut).length, roads: roads.length, sea_polys: sea.length,
    src: buildings.reduce((m, b) => (m[b.src] = (m[b.src] || 0) + 1, m), {}), max_h_m: Math.max(...buildings.map(b => b.h_m)) },
};
const dst = path.join(HERE, 'data', 'area.json');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(out));
console.log(JSON.stringify({ dst, tiles: keys, ...out.stats, terrain: [NU, NV], bytes: fs.statSync(dst).size }));
