/* ESH27 twin — maritime / grid.js  (pure, no THREE)
 *
 * The "maritime grid": one regular grid (default 25 m, aligned to the pipeline terrain lattice) holding
 *   depth  (m, positive below mean sea level; land nodes = −ground height)
 *   shelter (0..1, 1 = open sea, <1 inside breakwaters)
 * It feeds: wave attenuation (GPU + CPU, identical bilinear), water colour, shore foam, beach placement,
 * coastline polylines (marching squares on depth = 0).
 *
 * Bathymetry: the free sources (GEBCO 2025 grid — public domain; EMODnet DTM — CC BY 4.0) are not reachable
 * from this sandbox, so depth offshore = ESTIMATED profile over distance-from-shore (BATHY_PROFILE below,
 * labelled). The pipeline patch (yazam/bathy.py) bakes real GEBCO/EMODnet depth into tiles/b/*.bin.gz;
 * when such a grid is passed in (opts.depthFn) it replaces the profile.
 */

// Inner shelf off Ashdod — ESTIMATE (order of magnitude from general knowledge of the SE Levant shelf,
// NOT measured): [distance from shoreline m, depth m]
export const BATHY_PROFILE = [[0, 0], [60, 1.2], [150, 2.8], [300, 4.5], [600, 7], [1000, 10], [2000, 16],
  [3500, 24], [6000, 35], [9000, 55], [14000, 100], [20000, 250]];
export const BATHY_LABEL = 'עומק משוער (פרופיל לפי מרחק מהחוף) – לא נתוני מדידה; להחליף ב-GEBCO/EMODnet דרך הצינור';

export function profileDepth(d, P = BATHY_PROFILE) {
  if (d <= 0) return 0;
  for (let i = 1; i < P.length; i++) if (d <= P[i][0]) { const [d0, h0] = P[i - 1], [d1, h1] = P[i]; return h0 + (h1 - h0) * (d - d0) / (d1 - d0); }
  return P[P.length - 1][1];
}

// ------------------------------------------------------------------ tile terrain (pipeline contract)
const SEA = -32768, OUT = -32767;
/** decode tiles/t/<k>.bin.gz (already gunzipped) → {tx,ty,nt,step,z:Int16Array} — layout from pipeline/yazam/tiles.py */
export function decodeTerrainBin(buf) {
  const dv = new DataView(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'YZT1') throw new Error('not a YZT1 terrain tile');
  const tx = dv.getInt32(6, true), ty = dv.getInt32(10, true), nt = dv.getUint16(14, true), step = dv.getUint16(18, true);
  const z = new Int16Array(nt * nt); for (let i = 0; i < nt * nt; i++) z[i] = dv.getInt16(20 + i * 2, true);
  return { tx, ty, nt, step, z };
}

/**
 * ITM sampler over decoded tiles. Returns f(E,N) → {state: 'land'|'sea'|'unknown', h}
 * Nearest node (tiles are on the 25 m lattice, so on-lattice queries are exact).
 * Unknown (no tile / outside study area) → coast line fit E = A + B·N (same as world.js fallbackH).
 */
export function terrainSampler(tiles, { tile = 1000, A = -125006.9, B = 0.45566 } = {}) {
  const map = new Map(); for (const t of tiles) map.set(t.tx + '_' + t.ty, t);
  return function (E, N) {
    const tx = Math.floor(E / tile), ty = Math.floor(N / tile), t = map.get(tx + '_' + ty);
    if (t) {
      const k = Math.round((E - tx * tile) / t.step), r = Math.round(((ty + 1) * tile - N) / t.step);
      const v = t.z[Math.min(t.nt - 1, Math.max(0, r)) * t.nt + Math.min(t.nt - 1, Math.max(0, k))];
      if (v === SEA) return { state: 'sea', h: 0 };
      if (v !== OUT) return { state: 'land', h: Math.max(0.6, v / 10) };
    }
    return E > A + B * N + 300 ? { state: 'unknown-land', h: 1 } : { state: 'unknown-sea', h: 0 };
  };
}

/**
 * Fast fill of land/height arrays straight from decoded tiles (no per-node lookups).
 * Grid node (i, j) ↔ ITM (E0 + i·cs, N1 − j·cs) in the TILE frame; cs must equal the tile step (25 m).
 * Nodes without a tile, or OUTSIDE: the fitted coast line E > A + B·N + 300 → land (as world.js).
 */
export function fillFromTiles(tiles, { E0, N1, nx, nz, cs = 25, A = -125006.9, B = 0.45566, tile = 1000 }) {
  const N = nx * nz, land = new Uint8Array(N), hgt = new Float32Array(N), known = new Uint8Array(N);
  for (const t of tiles) {
    if (t.step !== cs) throw new Error('grid cs must equal tile step');
    for (let r = 0; r < t.nt; r++) {
      const j = Math.round((N1 - ((t.ty + 1) * tile - r * t.step)) / cs); if (j < 0 || j >= nz) continue;
      for (let c = 0; c < t.nt; c++) {
        const i = Math.round((t.tx * tile + c * t.step - E0) / cs); if (i < 0 || i >= nx) continue;
        const v = t.z[r * t.nt + c], k = j * nx + i;
        if (v === SEA) { land[k] = 0; hgt[k] = 0; known[k] = 1; }
        else if (v !== OUT) { land[k] = 1; hgt[k] = Math.max(0.6, v / 10); known[k] = 1; }
      }
    }
  }
  for (let j = 0; j < nz; j++) { const Nn = N1 - j * cs; for (let i = 0; i < nx; i++) { const k = j * nx + i; if (known[k]) continue; const l = E0 + i * cs > A + B * Nn + 300; land[k] = l ? 1 : 0; hgt[k] = l ? 1 : 0; } }
  return { land, hgt, known };
}

// ------------------------------------------------------------------ geometry helpers
export function pointInPoly(poly, x, z) {   // poly: [[x,z],...]
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function polyBounds(p) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of p) { if (x < a) a = x; if (z < b) b = z; if (x > c) c = x; if (z > d) d = z; } return [a, b, c, d]; }

/**
 * Build the grid in SCENE coordinates.
 * opts: { x0, z0, nx, nz, cs, classify(x,z) → {land:bool, h}, basins: [{poly:[[x,z]..], depth, shelter}],
 *         depthFn?(x,z,distFromShore) → depth (real bathymetry), profile? }
 */
export function buildGrid(opts) {
  const { x0, z0, nx, nz, cs = 25, classify, prefill = null, basins = [], depthFn = null, profile = BATHY_PROFILE } = opts;
  const N = nx * nz;
  let land, hgt;
  if (prefill) ({ land, hgt } = prefill);
  else {
    land = new Uint8Array(N); hgt = new Float32Array(N);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = classify(x0 + i * cs, z0 + j * cs), k = j * nx + i;
      land[k] = c.land ? 1 : 0; hgt[k] = c.land ? c.h : 0;
    }
  }
  // basins (port / marina water inside breakwaters) are water even if a coarse mask says otherwise
  for (const b of basins) {
    const [bx0, bz0, bx1, bz1] = polyBounds(b.poly);
    for (let j = Math.max(0, Math.floor((bz0 - z0) / cs)); j <= Math.min(nz - 1, Math.ceil((bz1 - z0) / cs)); j++)
      for (let i = Math.max(0, Math.floor((bx0 - x0) / cs)); i <= Math.min(nx - 1, Math.ceil((bx1 - x0) / cs)); i++)
        if (b.forceWater && pointInPoly(b.poly, x0 + i * cs, z0 + j * cs)) { land[j * nx + i] = 0; hgt[j * nx + i] = 0; }
  }
  // distance to nearest land node (two-pass 3-4 chamfer, metres; error ≤ ~8 %)
  const INF = 1e9, dist = new Float32Array(N);
  for (let k = 0; k < N; k++) dist[k] = land[k] ? 0 : INF;
  const a = cs, d = cs * Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = dist[k]; if (!v) continue;
    if (i > 0) v = Math.min(v, dist[k - 1] + a);
    if (j > 0) { v = Math.min(v, dist[k - nx] + a); if (i > 0) v = Math.min(v, dist[k - nx - 1] + d); if (i < nx - 1) v = Math.min(v, dist[k - nx + 1] + d); }
    dist[k] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = dist[k]; if (!v) continue;
    if (i < nx - 1) v = Math.min(v, dist[k + 1] + a);
    if (j < nz - 1) { v = Math.min(v, dist[k + nx] + a); if (i < nx - 1) v = Math.min(v, dist[k + nx + 1] + d); if (i > 0) v = Math.min(v, dist[k + nx - 1] + d); }
    dist[k] = v;
  }
  const depth = new Float32Array(N), shelter = new Float32Array(N).fill(1);
  const LMAX = profile[profile.length - 1][0], lut = new Float32Array(Math.ceil(LMAX) + 1);   // 1 m lookup table
  for (let d = 0; d < lut.length; d++) lut[d] = profileDepth(d, profile);
  const deepest = profile[profile.length - 1][1];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (land[k]) { depth[k] = -hgt[k]; continue; }
    // the coastline lies ~half a cell (plus the terrain ramp) seaward of the last land node
    const ds = Math.max(0, dist[k] - cs * 0.55);
    if (depthFn) depth[k] = depthFn(x0 + i * cs, z0 + j * cs, ds);
    else depth[k] = ds >= LMAX ? deepest : lut[ds | 0] + (lut[Math.min(lut.length - 1, (ds | 0) + 1)] - lut[ds | 0]) * (ds - (ds | 0));
    if (dist[k] >= INF / 2) depth[k] = deepest;
  }
  for (const b of basins) {
    const [bx0, bz0, bx1, bz1] = polyBounds(b.poly);
    for (let j = Math.max(0, Math.floor((bz0 - z0) / cs)); j <= Math.min(nz - 1, Math.ceil((bz1 - z0) / cs)); j++)
      for (let i = Math.max(0, Math.floor((bx0 - x0) / cs)); i <= Math.min(nx - 1, Math.ceil((bx1 - x0) / cs)); i++) {
        const k = j * nx + i; if (land[k] || !pointInPoly(b.poly, x0 + i * cs, z0 + j * cs)) continue;
        if (b.depth != null) depth[k] = b.depth;          // dredged basin depth (fixture value, labelled)
        if (b.shelter != null) shelter[k] = Math.min(shelter[k], b.shelter);
      }
  }
  // soften shelter edges (1 box pass) so the waves fade instead of stepping
  const sh2 = shelter.slice();
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i; let s = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += shelter[k + dj * nx + di]; sh2[k] = s / 9;
  }
  const known = (prefill && prefill.known) || new Uint8Array(N).fill(1);
  const g = { x0, z0, nx, nz, cs, land, depth, shelter: sh2, dist, known };
  /** true if the nearest node (and its 8 neighbours) came from real tile data, not the coast-line fallback */
  g.knownAt = (x, z) => { const i = Math.round((x - x0) / cs), j = Math.round((z - z0) / cs); if (i < 1 || j < 1 || i > nx - 2 || j > nz - 2) return false; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (!known[(j + b) * nx + i + a]) return false; return true; };
  g.sample = (x, z) => sampleGrid(g, x, z);
  return g;
}

/**
 * Bilinear sample of depth & shelter — node-centred, EXACTLY the formula used in ocean.js GLSL
 * (texelFetch of 4 nodes, clamp, mix). Outside the grid: open deep sea {depth:250, shelter:1}.
 */
export function sampleGrid(g, x, z, out = {}) {
  const fx = (x - g.x0) / g.cs, fz = (z - g.z0) / g.cs;
  if (fx < 0 || fz < 0 || fx > g.nx - 1 || fz > g.nz - 1) { out.depth = 250; out.shelter = 1; return out; }
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.nz - 2, Math.floor(fz));
  const u = fx - i, v = fz - j, k = j * g.nx + i;
  const D = g.depth, S = g.shelter;
  const d0 = D[k] + (D[k + 1] - D[k]) * u, d1 = D[k + g.nx] + (D[k + g.nx + 1] - D[k + g.nx]) * u;
  const s0 = S[k] + (S[k + 1] - S[k]) * u, s1 = S[k + g.nx] + (S[k + g.nx + 1] - S[k + g.nx]) * u;
  out.depth = d0 + (d1 - d0) * v; out.shelter = s0 + (s1 - s0) * v; return out;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** wave amplitude factor — same formula in GLSL (ocean.js `atten`). hb = depth where breaking-limited damping ends */
export function attenuation(g, hb) {
  const s = {};
  return (x, z) => { sampleGrid(g, x, z, s); return s.shelter * smoothstep(0.0, hb, s.depth); };
}
export const breakDepth = HsTotal => Math.max(0.8, 1.6 * HsTotal);   // H/h ≈ 0.78 breaking criterion → h ≈ 1.3 H (labelled approx)

// ------------------------------------------------------------------ coastline (marching squares on depth = iso)
export function contour(g, iso = 0) {
  const { nx, nz, x0, z0, cs, depth } = g, segs = [];
  const P = (i, j) => depth[j * nx + i] - iso;
  const lerp = (ax, az, av, bx, bz, bv) => { const t = av / (av - bv); return [ax + (bx - ax) * t, az + (bz - az) * t]; };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const X = x0 + i * cs, Z = z0 + j * cs, pts = [];
    if ((a > 0) !== (b > 0)) pts.push(lerp(X, Z, a, X + cs, Z, b));
    if ((b > 0) !== (c > 0)) pts.push(lerp(X + cs, Z, b, X + cs, Z + cs, c));
    if ((c > 0) !== (d > 0)) pts.push(lerp(X + cs, Z + cs, c, X, Z + cs, d));
    if ((d > 0) !== (a > 0)) pts.push(lerp(X, Z + cs, d, X, Z, a));
    if (pts.length === 2) segs.push(pts);
    else if (pts.length === 4) { segs.push([pts[0], pts[1]]); segs.push([pts[2], pts[3]]); }
  }
  // chain segments into polylines
  const key = p => Math.round(p[0] * 10) + ',' + Math.round(p[1] * 10);
  const ends = new Map();
  segs.forEach((s, idx) => { for (const e of [0, 1]) { const k = key(s[e]); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(idx); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue; used[s0] = 1;
    const line = [segs[s0][0], segs[s0][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? line[line.length - 1] : line[0];
        const cand = (ends.get(key(tip)) || []).find(i => !used[i]);
        if (cand == null) break; used[cand] = 1;
        const s = segs[cand], nxt = key(s[0]) === key(tip) ? s[1] : s[0];
        if (dir) line.push(nxt); else line.unshift(nxt);
      }
    }
    lines.push(line);
  }
  return lines.filter(l => l.length > 3);
}

/** Chaikin smoothing + resampling every `step` m */
export function smoothLine(line, iters = 2) {
  let p = line;
  for (let k = 0; k < iters; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const [ax, az] = p[i], [bx, bz] = p[i + 1]; q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]); }
    q.push(p[p.length - 1]); p = q;
  }
  return p;
}
export function resample(line, step) {
  const out = [line[0]]; let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
    let s = step - carry;
    while (s <= L) { out.push([ax + (bx - ax) * s / L, az + (bz - az) * s / L]); s += step; }
    carry = L - (s - step);
  }
  return out;
}
export const lineLength = l => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };
