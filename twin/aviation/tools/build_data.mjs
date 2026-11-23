// Builds data/region.json (Israel + east Mediterranean) and data/world.json (globe land) from Natural Earth (public domain).
// Inputs (downloaded once into _dl/, not shipped): NE 10m lakes + admin0 (GitHub nvkelso/natural-earth-vector),
// NE land 10m/50m via npm world-atlas@2 (ISC; data = Natural Earth). Usage: node tools/build_data.mjs <dl_dir> <node_modules>
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const [dl, nm] = process.argv.slice(2); const _u = 0; //  = process.argv.slice(2);
const require = createRequire(path.join(nm, 'x.js'));
const topo = require('topojson-client');
const BBOX = [30.0, 27.5, 39.0, 36.5];          // lon0, lat0, lon1, lat1 (region far-field)
const inB = (r, b) => { let a = 1e9, c = -1e9, d = 1e9, e = -1e9; for (const [x, y] of r) { a = Math.min(a, x); c = Math.max(c, x); d = Math.min(d, y); e = Math.max(e, y); } return c >= b[0] && a <= b[2] && e >= b[1] && d <= b[3]; };
function dp(pts, tol) { // Douglas-Peucker on lon/lat (deg)
  if (pts.length < 4) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) { const [i, j] = st.pop(); let md = 0, mi = -1; const [x1, y1] = pts[i], [x2, y2] = pts[j]; const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1e-12;
    for (let k = i + 1; k < j; k++) { const d = Math.abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / L; if (d > md) { md = d; mi = k; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([i, mi], [mi, j]); } }
  return pts.filter((_, k) => keep[k]); }
function dpRing(r, tol) { if (r.length < 8) return r; const m = r.length >> 1; return dp(r.slice(0, m + 1), tol).slice(0, -1).concat(dp(r.slice(m), tol)); }
function clip(r, b) { // Sutherland-Hodgman against the bbox rectangle (convex => correct fill)
  const edges = [[0, b[0], 1], [0, b[2], -1], [1, b[1], 1], [1, b[3], -1]]; let out = r;
  for (const [ax, v, sg] of edges) { const inp = out; out = []; if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) { const P = inp[i], Q = inp[(i + 1) % inp.length]; const pin = (P[ax] - v) * sg >= 0, qin = (Q[ax] - v) * sg >= 0;
      if (pin) out.push(P); if (pin !== qin) { const t = (v - P[ax]) / (Q[ax] - P[ax]); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); } } }
  if (out.length) out.push(out[0]); return out; }
const rnd = (r, q) => r.map(([x, y]) => [+x.toFixed(q), +y.toFixed(q)]);
function rings(geom) { const out = []; const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []; for (const p of polys) for (const r of p) out.push(r); return out; }
function collect(features, bbox, tol, q) { const out = []; for (const f of features) for (const r of rings(f.geometry)) { if (!inB(r, bbox)) continue; const c = bbox[0] > -180 ? clip(r, bbox) : r; const s = rnd(dpRing(c, tol), q); if (s.length >= 4) out.push(s); } return out; }
const land10 = require('world-atlas/land-10m.json'), land50 = require('world-atlas/land-50m.json');
const L10 = topo.feature(land10, land10.objects.land).features, L50 = topo.feature(land50, land50.objects.land).features;
const lakes = JSON.parse(fs.readFileSync(path.join(dl, 'lakes10.geojson'), 'utf8')).features;
const adm = JSON.parse(fs.readFileSync(path.join(dl, 'ne10.geojson'), 'utf8')).features;
const isr = adm.filter(f => f.properties.ADM0_A3 === 'ISR');
const region = { v: 1, source: 'Natural Earth 1:10m (public domain): land (via npm world-atlas@2), lakes, admin-0 Israel. Simplified (Douglas-Peucker 0.0015 deg ≈ 150 m).',
  bbox: BBOX, land: collect(L10, BBOX, 0.0015, 4), lakes: collect(lakes, BBOX, 0.0015, 4), israel: collect(isr, BBOX, 0.001, 4) };
const world = { v: 1, source: 'Natural Earth 1:50m land (public domain) via npm world-atlas@2, simplified 0.06 deg', land: collect(L50, [-180, -90, 180, 90], 0.06, 2) };
fs.writeFileSync(new URL('../data/region.json', import.meta.url), JSON.stringify(region));
fs.writeFileSync(new URL('../data/world.json', import.meta.url), JSON.stringify(world));
const n = a => a.reduce((s, r) => s + r.length, 0);
console.log('region land rings', region.land.length, 'pts', n(region.land), 'lakes', region.lakes.length, n(region.lakes), 'israel', region.israel.length, n(region.israel), 'world', world.land.length, n(world.land));
